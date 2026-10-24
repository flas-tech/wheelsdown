/**
 * FBO portal (beta, invite-only).
 *
 * FBOs sign in on their own home-screen app (fbo.getwheelsdown.com, or /fbo-portal on the main host until DNS is in
 * place) to manage restaurant/hotel recommendations, crew discounts, FBO intel, their own text ads and printable QR
 * cards. Crews scan the QR at the desk and land on a public page (getwheelsdown.com/f/<slug>) that is labeled as provided
 * by the FBO.
 *
 * Separation from crews, by construction:
 *  - FBO people live in fbo_users (not users), sign in with fbo_sessions, and own nothing in spots/reviews/votes,
 *    so they can never appear on the leaderboard or accrue points.
 *  - Nothing in the crew app links here. Accounts exist only when an admin creates one.
 *  - FBO ads sit in the shared ads table (fbo_id set) but don't serve to crews until the admin switch
 *    fbo_ads_serving = "on"; a paused account's ads and public page stop immediately.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { db } from "./db";
import { logChange } from "./ops";
import { hashPassword, checkPassword as verifyPassword } from "./storage";
import { refAirport, isCode } from "./airportsData";
import { sendEmail } from "./email";
import { untracked, dayKey } from "./metrics";
import {
  FBO_CATEGORIES, FBO_CAT_PLURAL, FBO_INTEL_FIELDS, FBO_INTEL_KEYS, FBO_LIMITS, FBO_ROLES, isoDate, nameKey,
  type FboCategory, type FboRole,
} from "@shared/fbo";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
const num = (v: unknown) => (v == null ? 0 : Number(v));
const rows = async <T = any>(q: any) => ((await db().execute(q)).rows as T[]);
const one = async <T = any>(q: any) => (await rows<T>(q))[0];
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+$/g, "").slice(0, n).trim();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const now = () => Date.now();
const DAY = 86_400_000;
const PROD = process.env.NODE_ENV === "production";
const SALT = process.env.METRICS_SALT || process.env.ADMIN_KEY || "wheelsdown";

const APP_URL = () => (process.env.APP_URL || "https://getwheelsdown.com").replace(/\/$/, "");
/** Where FBO staff sign in. Set FBO_URL=https://fbo.getwheelsdown.com once the subdomain points at this service. */
export const FBO_URL = () => (process.env.FBO_URL || `${APP_URL()}/fbo-portal`).replace(/\/$/, "");
/** Host names that serve the FBO portal at their root. */
export function isFboHost(req: Request) {
  const h = String(req.hostname || "").toLowerCase();
  return h.startsWith("fbo.") || (!!process.env.FBO_HOST && h === process.env.FBO_HOST.toLowerCase());
}

// ---------------------------------------------------------------- schema
const MIGRATION = `
CREATE TABLE IF NOT EXISTS fbo_accounts (id serial PRIMARY KEY, slug text NOT NULL UNIQUE, name text NOT NULL, icao text NOT NULL,
  phone text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '', address text NOT NULL DEFAULT '',
  about text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'active', created_at bigint NOT NULL DEFAULT 0, created_by text NOT NULL DEFAULT '',
  last_active_at bigint);
CREATE TABLE IF NOT EXISTS fbo_users (id serial PRIMARY KEY, fbo_id integer NOT NULL, email text NOT NULL UNIQUE, name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'editor', password_hash text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'invited',
  created_at bigint NOT NULL DEFAULT 0, last_login_at bigint);
CREATE INDEX IF NOT EXISTS fbo_users_fbo_idx ON fbo_users (fbo_id);
CREATE TABLE IF NOT EXISTS fbo_sessions (token_hash text PRIMARY KEY, user_id integer NOT NULL, created_at bigint NOT NULL DEFAULT 0, expires_at bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS fbo_sessions_user_idx ON fbo_sessions (user_id);
CREATE TABLE IF NOT EXISTS fbo_tokens (token_hash text PRIMARY KEY, kind text NOT NULL, fbo_id integer NOT NULL, user_id integer,
  email text NOT NULL DEFAULT '', role text NOT NULL DEFAULT 'editor', created_at bigint NOT NULL DEFAULT 0, expires_at bigint NOT NULL DEFAULT 0, used_at bigint);
CREATE TABLE IF NOT EXISTS fbo_places (id serial PRIMARY KEY, fbo_id integer NOT NULL, category text NOT NULL, name text NOT NULL,
  address text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '', notes text NOT NULL DEFAULT '',
  crew_rate text NOT NULL DEFAULT '', distance text NOT NULL DEFAULT '', favorite integer NOT NULL DEFAULT 0, sort integer NOT NULL DEFAULT 0,
  hidden integer NOT NULL DEFAULT 0, created_at bigint NOT NULL DEFAULT 0, updated_at bigint NOT NULL DEFAULT 0, updated_by text NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS fbo_places_fbo_idx ON fbo_places (fbo_id, category);
CREATE TABLE IF NOT EXISTS fbo_offers (id serial PRIMARY KEY, fbo_id integer NOT NULL, place_id integer, title text NOT NULL,
  code text NOT NULL DEFAULT '', details text NOT NULL DEFAULT '', expires_on text NOT NULL DEFAULT '', active integer NOT NULL DEFAULT 1,
  created_at bigint NOT NULL DEFAULT 0, updated_at bigint NOT NULL DEFAULT 0, updated_by text NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS fbo_offers_fbo_idx ON fbo_offers (fbo_id);
CREATE TABLE IF NOT EXISTS fbo_intel (fbo_id integer NOT NULL, field text NOT NULL, value text NOT NULL DEFAULT '', updated_at bigint NOT NULL DEFAULT 0,
  updated_by text NOT NULL DEFAULT '', PRIMARY KEY (fbo_id, field));
CREATE TABLE IF NOT EXISTS fbo_events (id serial PRIMARY KEY, fbo_id integer NOT NULL, at bigint NOT NULL, kind text NOT NULL,
  actor text NOT NULL DEFAULT '', detail text NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS fbo_events_fbo_idx ON fbo_events (fbo_id, at);
CREATE TABLE IF NOT EXISTS fbo_views (fbo_id integer NOT NULL, day text NOT NULL, src text NOT NULL, vid text NOT NULL, n integer NOT NULL DEFAULT 1,
  PRIMARY KEY (fbo_id, day, src, vid));
ALTER TABLE ads ADD COLUMN IF NOT EXISTS fbo_id integer;
INSERT INTO app_settings (key, value) VALUES ('fbo_ads_serving', 'off') ON CONFLICT (key) DO NOTHING
`;
async function migrate() {
  for (const stmt of MIGRATION.split(";").map((s) => s.trim()).filter(Boolean)) await db().execute(sql.raw(stmt));
}

// ---------------------------------------------------------------- ads served to crews
let hiddenCache: { at: number; ids: Set<number> } | null = null;
/** Ad ids the crew app must not serve: every FBO ad while the beta switch is off, and ads of paused FBO accounts. */
export async function fboHiddenAdIds(): Promise<Set<number>> {
  if (hiddenCache && now() - hiddenCache.at < 30_000) return hiddenCache.ids;
  const ids = new Set<number>();
  try {
    const serving = (await one(sql`SELECT value FROM app_settings WHERE key = 'fbo_ads_serving'`))?.value === "on";
    const r = serving
      ? await rows(sql`SELECT a.id FROM ads a LEFT JOIN fbo_accounts f ON f.id = a.fbo_id WHERE a.fbo_id IS NOT NULL AND (f.id IS NULL OR f.status <> 'active')`)
      : await rows(sql`SELECT id FROM ads WHERE fbo_id IS NOT NULL`);
    for (const x of r) ids.add(num(x.id));
  } catch { /* table not migrated yet */ }
  hiddenCache = { at: now(), ids };
  return ids;
}
const bustAds = () => { hiddenCache = null; };

// ---------------------------------------------------------------- helpers
type Ctx = { user: { id: number; fboId: number; email: string; name: string; role: FboRole }; fbo: any };
const ctx = (req: Request) => (req as any).fbo as Ctx;

async function event(fboId: number, kind: string, actor: string, detail = "") {
  try { await db().execute(sql`INSERT INTO fbo_events (fbo_id, at, kind, actor, detail) VALUES (${fboId}, ${now()}, ${kind}, ${clip(actor, 120)}, ${clip(detail, 400)})`); } catch { /* never break a request */ }
}
async function touch(fboId: number) { await db().execute(sql`UPDATE fbo_accounts SET last_active_at = ${now()} WHERE id = ${fboId}`); }

function cleanUrl(v: unknown): string {
  let s = clip(v, 400);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { const u = new URL(s); return /^https?:$/.test(u.protocol) && u.hostname.includes(".") ? u.toString() : ""; } catch { return ""; }
}
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
const emailOk = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

function slugFor(name: string, icao: string) {
  const base = name.toLowerCase().replace(/&/g, "and").replace(/\b(fbo|aviation|services|inc|llc|jet center|the)\b/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
  return `${icao.toLowerCase()}${base ? "-" + base : ""}`;
}

function accountOut(f: any) {
  const ap = refAirport(f.icao);
  return { id: num(f.id), slug: f.slug, name: f.name, icao: f.icao, airportName: ap ? `${ap.name}${ap.city ? ", " + ap.city : ""}` : "", phone: f.phone, email: f.email,
    website: f.website, address: f.address, about: f.about, status: f.status, createdAt: num(f.created_at),
    publicUrl: `${APP_URL()}/f/${f.slug}`, qrUrl: `${APP_URL()}/f/${f.slug}?s=qr` };
}
const placeOut = (p: any) => ({ id: num(p.id), category: p.category, name: p.name, address: p.address, phone: p.phone, website: p.website, notes: p.notes,
  crewRate: p.crew_rate, distance: p.distance, favorite: !!num(p.favorite), sort: num(p.sort), hidden: !!num(p.hidden), updatedAt: num(p.updated_at), updatedBy: p.updated_by });
const offerOut = (o: any) => ({ id: num(o.id), placeId: o.place_id == null ? null : num(o.place_id), title: o.title, code: o.code, details: o.details,
  expiresOn: o.expires_on, active: !!num(o.active), updatedAt: num(o.updated_at), updatedBy: o.updated_by });
const adOut = (a: any) => ({ id: num(a.id), slot: a.slot, headline: a.headline, body: a.body || "", cta: a.cta || "", url: a.url || "", active: !!num(a.active), impressions: num(a.impressions), clicks: num(a.clicks) });

const todayIso = () => dayKey();
const offerLive = (o: any) => !!num(o.active) && (!o.expires_on || o.expires_on >= todayIso());

async function newSession(userId: number) {
  const token = randomBytes(32).toString("base64url");
  await db().execute(sql`INSERT INTO fbo_sessions (token_hash, user_id, created_at, expires_at) VALUES (${sha(token)}, ${userId}, ${now()}, ${now() + 30 * DAY})`);
  await db().execute(sql`UPDATE fbo_users SET last_login_at = ${now()} WHERE id = ${userId}`);
  return token;
}
async function newToken(kind: "invite" | "reset", fboId: number, email: string, role: FboRole, userId: number | null, days: number) {
  const token = randomBytes(24).toString("base64url");
  await db().execute(sql`INSERT INTO fbo_tokens (token_hash, kind, fbo_id, user_id, email, role, created_at, expires_at)
    VALUES (${sha(token)}, ${kind}, ${fboId}, ${userId}, ${email}, ${role}, ${now()}, ${now() + days * DAY})`);
  return token;
}

/** Invite someone to an FBO account (new user, or a fresh link for an invited one). Returns the sign-up link. */
async function inviteUser(fboId: number, email: string, role: FboRole, by: string) {
  const fbo = await one(sql`SELECT * FROM fbo_accounts WHERE id = ${fboId}`);
  if (!fbo) throw Object.assign(new Error("FBO account not found"), { status: 404 });
  const existing = await one(sql`SELECT * FROM fbo_users WHERE email = ${email}`);
  if (existing && num(existing.fbo_id) !== fboId) throw Object.assign(new Error("That email already belongs to another FBO account."), { status: 409 });
  if (existing && existing.status === "active") throw Object.assign(new Error("That person already has access."), { status: 409 });
  const n = num((await one(sql`SELECT COUNT(*) AS n FROM fbo_users WHERE fbo_id = ${fboId} AND status <> 'removed'`))?.n);
  if (!existing && n >= FBO_LIMITS.users) throw Object.assign(new Error(`Accounts are limited to ${FBO_LIMITS.users} people during the beta.`), { status: 400 });
  let userId: number;
  if (existing) {
    userId = num(existing.id);
    await db().execute(sql`UPDATE fbo_users SET status = 'invited', role = ${role} WHERE id = ${userId}`);
  } else {
    userId = num((await one(sql`INSERT INTO fbo_users (fbo_id, email, role, status, created_at) VALUES (${fboId}, ${email}, ${role}, 'invited', ${now()}) RETURNING id`)).id);
  }
  const token = await newToken("invite", fboId, email, role, userId, 14);
  const link = `${FBO_URL()}/#/invite/${token}`;
  const text = `You've been invited to manage ${fbo.name} (${fbo.icao}) on Wheelsdown for FBOs.

Set your password here (link works for 14 days):
${link}

From there you can post your restaurant and hotel recommendations, crew discounts and FBO intel, and print a QR code crews can scan at your desk.

Wheels down,
The Wheelsdown crew`;
  const sent = await sendEmail(email, `Your Wheelsdown FBO access for ${fbo.name}`, text).catch(() => false);
  await event(fboId, "user_invited", by, `${email} as ${role}${sent ? " (emailed)" : ""}`);
  return { link, emailed: !!sent, userId };
}

// ---------------------------------------------------------------- public page (/f/:slug)
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmtDate = (t: number) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }).format(t);
const fmtIso = (d: string) => { const t = Date.parse(d + "T12:00:00Z"); return Number.isFinite(t) ? fmtDate(t) : d; };
const LOGO = `<svg viewBox="0 0 40 40" width="26" height="26" fill="none" aria-hidden="true"><path d="M20 5v12M15 12.5l5 5 5-5" stroke="#F5B700" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="14" cy="26" r="4" stroke="#F5B700" stroke-width="2.8"/><circle cx="26" cy="26" r="4" stroke="#F5B700" stroke-width="2.8"/><path d="M5 34h30" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="4.5 3"/></svg>`;

function pageShell(title: string, body: string, desc = "") {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><meta name="robots" content="noindex"><meta name="theme-color" content="#0B1222">
<link rel="icon" type="image/png" href="/favicon.png"><link href="https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600,700&display=swap" rel="stylesheet">
<style>
:root{--bg:#F8F6F1;--fg:#141B2D;--muted:#5B6474;--card:#fff;--line:#E2E5EA;--accent:#F5B700;--accent-fg:#141B2D;--chip:#FFF6D6}
@media (prefers-color-scheme:dark){:root{--bg:#0B1222;--fg:#EEF1F6;--muted:#9AA4B5;--card:#131C30;--line:#24304A;--chip:#2A2410}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "General Sans",system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}.wrap{max-width:720px;margin:0 auto;padding:16px 16px 48px}
.top{display:flex;align-items:center;gap:8px;font-weight:600;font-size:14px;text-decoration:none;padding:4px 0 14px}
.hero{background:#0B1222;color:#fff;border-radius:18px;padding:20px;margin-bottom:16px}
.hero h1{margin:4px 0 2px;font-size:26px;line-height:1.15}.hero .ap{color:#C9D1DE;font-size:14px}.eyebrow{display:inline-block;background:var(--accent);color:#141B2D;font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;border-radius:999px;padding:3px 9px}
.hero .meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.hero .meta a{background:rgba(255,255,255,.1);border-radius:999px;padding:6px 12px;text-decoration:none;font-size:14px}
.hero p{color:#DCE2EB;margin:12px 0 0}
h2{font-size:17px;margin:26px 0 10px;display:flex;align-items:center;gap:8px}.count{color:var(--muted);font-weight:500;font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:10px}
.card h3{margin:0;font-size:16px}.row{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.sub{color:var(--muted);font-size:13px;margin-top:2px}.notes{margin:8px 0 0}.links{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.links a{border:1px solid var(--line);border-radius:999px;padding:5px 11px;font-size:13px;text-decoration:none;font-weight:500}
.star{color:#C98F00;font-weight:700;font-size:12px;white-space:nowrap}.chip{display:inline-block;background:var(--chip);border-radius:8px;padding:2px 8px;font-size:12px;font-weight:600;margin-top:6px}
.offer{border:1.5px dashed var(--accent);border-radius:12px;padding:10px 12px;margin-top:10px}.offer b{display:block}.code{font:700 18px/1.2 ui-monospace,"JetBrains Mono",monospace;letter-spacing:.06em;user-select:all;-webkit-user-select:all;margin-top:4px}
.small{font-size:12px;color:var(--muted)}.crew{font-size:12px;margin-top:8px;color:var(--muted)}.crew a{font-weight:600}
.intel{display:grid;grid-template-columns:minmax(120px,170px) 1fr;gap:0;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.intel div{padding:10px 12px;border-top:1px solid var(--line)}.intel div:nth-child(-n+2){border-top:0}.intel .k{font-weight:600;font-size:13px}.intel .v{white-space:pre-wrap}
.label{font-size:12px;color:var(--muted);margin:-4px 0 10px}.cta{display:block;text-align:center;background:var(--accent);color:var(--accent-fg);text-decoration:none;font-weight:700;border-radius:999px;padding:13px;margin-top:26px}
.foot{text-align:center;color:var(--muted);font-size:12px;margin-top:18px}
@media (max-width:520px){.intel{grid-template-columns:1fr}.intel div:nth-child(2){border-top:0}.intel .k{border-top:1px solid var(--line);padding-bottom:0}.intel .v{border-top:0;padding-top:2px}.intel div:first-child{border-top:0}}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

async function renderPublic(slug: string, req: Request, res: Response) {
  const f = await one(sql`SELECT * FROM fbo_accounts WHERE slug = ${slug}`);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  if (!f || f.status !== "active") {
    return res.status(404).type("html").send(pageShell("Not available · Wheelsdown", `<a class="top" href="${APP_URL()}/">${LOGO}Wheelsdown</a><div class="card"><h3>This page isn't available</h3><p class="sub">The FBO page you scanned is offline right now. You can still find crew-rated spots on Wheelsdown.</p></div><a class="cta" href="${APP_URL()}/">Open Wheelsdown</a>`));
  }
  const fboId = num(f.id);
  // count the visit (bots, previews and admin requests are skipped); one row per device per day per source
  if (!untracked(req)) {
    const src = String(req.query.s || "") === "qr" ? "qr" : "link";
    const vid = sha(SALT + String(req.ip || "") + String(req.get("user-agent") || "") + dayKey()).slice(0, 24);
    db().execute(sql`INSERT INTO fbo_views (fbo_id, day, src, vid, n) VALUES (${fboId}, ${dayKey()}, ${src}, ${vid}, 1)
      ON CONFLICT (fbo_id, day, src, vid) DO UPDATE SET n = fbo_views.n + 1`).catch(() => {});
  }
  const ap = refAirport(f.icao);
  const places = await rows(sql`SELECT * FROM fbo_places WHERE fbo_id = ${fboId} AND hidden = 0 ORDER BY favorite DESC, sort, lower(name)`);
  const offers = (await rows(sql`SELECT * FROM fbo_offers WHERE fbo_id = ${fboId} ORDER BY id`)).filter(offerLive);
  const intel = await rows(sql`SELECT * FROM fbo_intel WHERE fbo_id = ${fboId} AND value <> ''`);
  // crew listings at this airport with the same name, so crews can see what other crews think
  const crew = await rows(sql`SELECT s.id, s.name, COUNT(r.id) AS n, AVG(r.rating) AS avg FROM spots s LEFT JOIN reviews r ON r.spot_id = s.id AND r.status = 'live'
    WHERE s.icao = ${f.icao} AND s.status = 'live' GROUP BY s.id, s.name`).catch(() => [] as any[]);
  const crewBy = new Map<string, any>();
  for (const c of crew) crewBy.set(nameKey(c.name), c);
  const offersBy = new Map<number, any[]>();
  const general: any[] = [];
  for (const o of offers) { if (o.place_id == null) general.push(o); else { const k = num(o.place_id); offersBy.set(k, [...(offersBy.get(k) || []), o]); } }
  const placeIds = new Set(places.map((p) => num(p.id)));
  for (const [pid, list] of Array.from(offersBy)) if (!placeIds.has(pid)) general.push(...list); // offer tied to a hidden/removed place still shows

  const offerHtml = (o: any) => `<div class="offer"><b>${esc(o.title)}</b>${o.code ? `<div class="code">${esc(o.code)}</div>` : ""}${o.details ? `<div class="sub">${esc(o.details)}</div>` : ""}${o.expires_on ? `<div class="small">Good through ${esc(fmtIso(o.expires_on))}</div>` : ""}</div>`;
  const mapsLink = (p: any) => `https://maps.apple.com/?q=${encodeURIComponent(p.name + (p.address ? ", " + p.address : ""))}`;
  const placeHtml = (p: any) => {
    const c = crewBy.get(nameKey(p.name));
    const crewLine = c ? (num(c.n) ? `<div class="crew">Crews rate it ${Number(c.avg).toFixed(1)}★ (${num(c.n)}) · <a href="${APP_URL()}/#/spot/${num(c.id)}">See crew reviews</a></div>` : `<div class="crew">Listed by crews on Wheelsdown · <a href="${APP_URL()}/#/spot/${num(c.id)}">Open listing</a></div>`) : "";
    const links = [
      p.address ? `<a href="${esc(mapsLink(p))}" rel="noopener">Directions</a>` : "",
      p.phone ? `<a href="tel:${esc(p.phone.replace(/[^\d+]/g, ""))}">Call</a>` : "",
      p.website ? `<a href="${esc(p.website)}" rel="noopener nofollow" target="_blank">Website</a>` : "",
    ].filter(Boolean).join("");
    return `<div class="card"><div class="row"><div><h3>${esc(p.name)}</h3>${p.address || p.distance ? `<div class="sub">${esc([p.address, p.distance].filter(Boolean).join(" · "))}</div>` : ""}</div>${num(p.favorite) ? `<span class="star">★ FBO favorite</span>` : ""}</div>
${p.crew_rate ? `<span class="chip">${esc(p.crew_rate)}</span>` : ""}${p.notes ? `<p class="notes">${esc(p.notes)}</p>` : ""}${(offersBy.get(num(p.id)) || []).map(offerHtml).join("")}${links ? `<div class="links">${links}</div>` : ""}${crewLine}</div>`;
  };
  const favs = places.filter((p) => num(p.favorite));
  const sections = FBO_CATEGORIES.map((cat) => {
    const list = places.filter((p) => p.category === cat && !num(p.favorite));
    return list.length ? `<h2>${FBO_CAT_PLURAL[cat as FboCategory]} <span class="count">${list.length}</span></h2>${list.map(placeHtml).join("")}` : "";
  }).join("");
  const intelOrder = new Map(FBO_INTEL_FIELDS.map((x, i) => [x.key, i]));
  const intelRows = intel.filter((i) => FBO_INTEL_KEYS.has(i.field)).sort((a, b) => (intelOrder.get(a.field) ?? 0) - (intelOrder.get(b.field) ?? 0));
  const latest = intelRows.reduce((m, i) => Math.max(m, num(i.updated_at)), 0);
  const fbo = esc(f.name);
  const body = `<a class="top" href="${APP_URL()}/">${LOGO}Wheelsdown</a>
<section class="hero"><span class="eyebrow">Crew picks from the FBO</span><h1>${fbo}</h1><div class="ap">${esc(f.icao)}${ap ? " · " + esc(ap.name) + (ap.city ? ", " + esc(ap.city) : "") : ""}</div>
${f.about ? `<p>${esc(f.about)}</p>` : ""}<div class="meta">${f.phone ? `<a href="tel:${esc(String(f.phone).replace(/[^\d+]/g, ""))}">Call the desk</a>` : ""}${f.website ? `<a href="${esc(f.website)}" rel="noopener" target="_blank">Website</a>` : ""}${f.address ? `<a href="https://maps.apple.com/?q=${encodeURIComponent(f.name + ", " + f.address)}" rel="noopener">Directions</a>` : ""}</div></section>
<p class="label">Everything on this page is provided by ${fbo}. It isn't rated or verified by Wheelsdown crews.</p>
${general.length ? `<h2>Crew discounts</h2>${general.map(offerHtml).join("")}` : ""}
${favs.length ? `<h2>Our favorites <span class="count">${favs.length}</span></h2>${favs.map(placeHtml).join("")}` : ""}
${sections}
${!places.length && !general.length ? `<div class="card"><h3>Recommendations coming soon</h3><p class="sub">${fbo} hasn't posted its picks yet. Ask at the desk, or see what crews rate nearby.</p></div>` : ""}
${intelRows.length ? `<h2>FBO intel</h2><p class="label">Provided by ${fbo}${latest ? ` · updated ${esc(fmtDate(latest))}` : ""}. Confirm fees and fuel prices at the desk.</p><div class="intel">${intelRows.map((i) => `<div class="k">${esc(FBO_INTEL_FIELDS.find((x) => x.key === i.field)?.label)}</div><div class="v">${esc(i.value)}</div>`).join("")}</div>` : ""}
<a class="cta" href="${APP_URL()}/#/map?route=${encodeURIComponent(f.icao)}">See what crews rate at ${esc(f.icao)}</a>
<p class="foot">Discounts and offers are honored by the business or ${fbo}, not Wheelsdown. Rates can change; confirm when you book.<br>What to do when you get wheels down.</p>`;
  res.type("html").send(pageShell(`${f.name} crew picks · ${f.icao} · Wheelsdown`, body, `Restaurant and hotel recommendations and crew discounts from ${f.name} at ${f.icao}.`));
}

// ---------------------------------------------------------------- routes
export function registerFbo(app: Express, deps: { requireAdmin: Mw }) {
  const { requireAdmin } = deps;
  const ready = migrate().catch((e) => console.error("[fbo] migration failed", e?.message));
  const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { message: "Too many attempts. Try again in a few minutes." } });
  const writeLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { message: "Slow down a moment and try again." } });

  app.get("/f/:slug", async (req, res, next) => {
    try { await ready; await renderPublic(String(req.params.slug).toLowerCase().slice(0, 60), req, res); } catch (e) { next(e); }
  });

  const tokenOf = (req: Request) => String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const requireFbo: Mw = async (req, res, next) => {
    await ready;
    const t = tokenOf(req);
    if (!t) return res.status(401).json({ message: "Sign in" });
    const r = await one(sql`SELECT u.id, u.fbo_id, u.email, u.name, u.role, u.status, f.status AS fbo_status FROM fbo_sessions s
      JOIN fbo_users u ON u.id = s.user_id JOIN fbo_accounts f ON f.id = u.fbo_id WHERE s.token_hash = ${sha(t)} AND s.expires_at > ${now()}`);
    if (!r || r.status !== "active") return res.status(401).json({ message: "Sign in" });
    if (r.fbo_status !== "active") return res.status(403).json({ message: "This FBO account is paused. Contact hello@getwheelsdown.com." });
    const fbo = await one(sql`SELECT * FROM fbo_accounts WHERE id = ${num(r.fbo_id)}`);
    (req as any).fbo = { user: { id: num(r.id), fboId: num(r.fbo_id), email: r.email, name: r.name, role: r.role }, fbo } as Ctx;
    next();
  };
  const requireOwner: Mw = (req, res, next) => (ctx(req).user.role === "owner" ? next() : res.status(403).json({ message: "Only account owners can manage the team." }));
  const who = (req: Request) => ctx(req).user.name || ctx(req).user.email;
  const fid = (req: Request) => ctx(req).user.fboId;

  // ---- auth
  app.post("/api/fbo/login", authLimit, async (req, res) => {
    await ready;
    const email = clip(req.body?.email, 200).toLowerCase();
    const u = await one(sql`SELECT u.*, f.status AS fbo_status FROM fbo_users u JOIN fbo_accounts f ON f.id = u.fbo_id WHERE u.email = ${email}`);
    const ok = u && u.status === "active" && u.password_hash && (await verifyPassword(String(req.body?.password || ""), u.password_hash));
    if (!ok) return res.status(401).json({ message: "That email and password don't match." });
    if (u.fbo_status !== "active") return res.status(403).json({ message: "This FBO account is paused. Contact hello@getwheelsdown.com." });
    const token = await newSession(num(u.id));
    await event(num(u.fbo_id), "login", u.name || u.email);
    await touch(num(u.fbo_id));
    res.json({ token });
  });
  app.post("/api/fbo/logout", async (req, res) => {
    const t = tokenOf(req);
    if (t) await db().execute(sql`DELETE FROM fbo_sessions WHERE token_hash = ${sha(t)}`);
    res.json({ ok: true });
  });
  app.get("/api/fbo/invite/:token", authLimit, async (req, res) => {
    await ready;
    const t = await one(sql`SELECT t.*, f.name AS fbo_name, f.icao FROM fbo_tokens t JOIN fbo_accounts f ON f.id = t.fbo_id
      WHERE t.token_hash = ${sha(String(req.params.token))} AND t.used_at IS NULL AND t.expires_at > ${now()}`);
    if (!t) return res.status(404).json({ message: "This link has expired or was already used. Ask your account owner for a new one." });
    res.json({ kind: t.kind, email: t.email, fboName: t.fbo_name, icao: t.icao, role: t.role });
  });
  app.post("/api/fbo/invite/:token", authLimit, async (req, res) => {
    await ready;
    const t = await one(sql`SELECT * FROM fbo_tokens WHERE token_hash = ${sha(String(req.params.token))} AND used_at IS NULL AND expires_at > ${now()}`);
    if (!t) return res.status(404).json({ message: "This link has expired or was already used." });
    const pw = String(req.body?.password || "");
    if (pw.length < FBO_LIMITS.passwordMin) return res.status(400).json({ message: `Use at least ${FBO_LIMITS.passwordMin} characters.` });
    const name = clip(req.body?.name, 80);
    const u = await one(sql`SELECT * FROM fbo_users WHERE id = ${num(t.user_id)}`);
    if (!u || u.status === "removed") return res.status(404).json({ message: "This invitation was withdrawn." });
    if (t.kind === "invite" && !name) return res.status(400).json({ message: "Add your name so teammates know who changed what." });
    await db().execute(sql`UPDATE fbo_users SET password_hash = ${await hashPassword(pw)}, status = 'active', name = ${name || u.name} WHERE id = ${num(u.id)}`);
    await db().execute(sql`UPDATE fbo_tokens SET used_at = ${now()} WHERE token_hash = ${t.token_hash}`);
    await db().execute(sql`DELETE FROM fbo_sessions WHERE user_id = ${num(u.id)}`);
    await event(num(t.fbo_id), t.kind === "invite" ? "user_joined" : "password_reset", name || u.name || u.email);
    res.json({ token: await newSession(num(u.id)) });
  });
  app.post("/api/fbo/forgot", authLimit, async (req, res) => {
    await ready;
    const email = clip(req.body?.email, 200).toLowerCase();
    const u = await one(sql`SELECT * FROM fbo_users WHERE email = ${email} AND status = 'active'`);
    if (u) {
      const token = await newToken("reset", num(u.fbo_id), email, u.role, num(u.id), 1 / 24);
      const link = `${FBO_URL()}/#/invite/${token}`;
      await sendEmail(email, "Reset your Wheelsdown FBO password", `Hi ${u.name || ""},\n\nReset your Wheelsdown FBO password here (link works for 1 hour):\n${link}\n\nIf you didn't ask for this, ignore this email.\n\nThe Wheelsdown crew`).catch(() => false);
    }
    res.json({ ok: true }); // same answer either way
  });

  // ---- session + account
  app.get("/api/fbo/me", requireFbo, async (req, res) => {
    const c = ctx(req);
    const serving = (await one(sql`SELECT value FROM app_settings WHERE key = 'fbo_ads_serving'`))?.value === "on";
    res.json({ user: c.user, account: accountOut(c.fbo), adsServing: serving, limits: FBO_LIMITS });
  });
  app.patch("/api/fbo/account", requireFbo, writeLimit, async (req, res) => {
    const b = req.body || {};
    const f = ctx(req).fbo;
    const next = {
      name: b.name != null ? clip(b.name, FBO_LIMITS.name) || f.name : f.name,
      phone: b.phone != null ? clip(b.phone, 40) : f.phone,
      email: b.email != null ? clip(b.email, 200) : f.email,
      website: b.website != null ? cleanUrl(b.website) : f.website,
      address: b.address != null ? clip(b.address, FBO_LIMITS.short) : f.address,
      about: b.about != null ? clip(b.about, FBO_LIMITS.about) : f.about,
    };
    await db().execute(sql`UPDATE fbo_accounts SET name = ${next.name}, phone = ${next.phone}, email = ${next.email}, website = ${next.website}, address = ${next.address}, about = ${next.about}, last_active_at = ${now()} WHERE id = ${fid(req)}`);
    if (next.name !== f.name) await db().execute(sql`UPDATE ads SET advertiser = ${next.name} WHERE fbo_id = ${fid(req)}`);
    await event(fid(req), "edit", who(req), "profile");
    res.json(accountOut(await one(sql`SELECT * FROM fbo_accounts WHERE id = ${fid(req)}`)));
  });
  app.patch("/api/fbo/me", requireFbo, writeLimit, async (req, res) => {
    const c = ctx(req);
    if (req.body?.name != null) await db().execute(sql`UPDATE fbo_users SET name = ${clip(req.body.name, 80) || c.user.name} WHERE id = ${c.user.id}`);
    if (req.body?.newPassword != null) {
      const u = await one(sql`SELECT password_hash FROM fbo_users WHERE id = ${c.user.id}`);
      if (!(await verifyPassword(String(req.body.password || ""), u.password_hash))) return res.status(400).json({ message: "Your current password isn't right." });
      if (String(req.body.newPassword).length < FBO_LIMITS.passwordMin) return res.status(400).json({ message: `Use at least ${FBO_LIMITS.passwordMin} characters.` });
      await db().execute(sql`UPDATE fbo_users SET password_hash = ${await hashPassword(String(req.body.newPassword))} WHERE id = ${c.user.id}`);
      await db().execute(sql`DELETE FROM fbo_sessions WHERE user_id = ${c.user.id} AND token_hash <> ${sha(tokenOf(req))}`);
    }
    res.json({ ok: true });
  });
  app.get("/api/fbo/stats", requireFbo, async (req, res) => {
    const id = fid(req);
    const since = (d: number) => dayKey(now() - (d - 1) * DAY);
    const v = async (d: number) => one(sql`SELECT COALESCE(SUM(n),0) AS views, COUNT(*) AS devices, COALESCE(SUM(CASE WHEN src = 'qr' THEN n ELSE 0 END),0) AS qr FROM fbo_views WHERE fbo_id = ${id} AND day >= ${since(d)}`);
    const [d7, d30, all] = [await v(7), await v(30), await v(100000)];
    const ads = await one(sql`SELECT COALESCE(SUM(impressions),0) AS imp, COALESCE(SUM(clicks),0) AS clk FROM ads WHERE fbo_id = ${id}`);
    const counts = await one(sql`SELECT (SELECT COUNT(*) FROM fbo_places WHERE fbo_id = ${id} AND hidden = 0) AS places,
      (SELECT COUNT(*) FROM fbo_places WHERE fbo_id = ${id} AND favorite = 1 AND hidden = 0) AS favorites,
      (SELECT COUNT(*) FROM fbo_offers WHERE fbo_id = ${id} AND active = 1 AND (expires_on = '' OR expires_on >= ${todayIso()})) AS offers,
      (SELECT COUNT(*) FROM fbo_intel WHERE fbo_id = ${id} AND value <> '') AS intel,
      (SELECT COUNT(*) FROM fbo_events WHERE fbo_id = ${id} AND kind = 'print') AS prints`);
    const daily = await rows(sql`SELECT day, SUM(n) AS views, SUM(CASE WHEN src = 'qr' THEN n ELSE 0 END) AS qr FROM fbo_views WHERE fbo_id = ${id} AND day >= ${since(30)} GROUP BY day ORDER BY day`);
    const pack = (x: any) => ({ views: num(x?.views), devices: num(x?.devices), qr: num(x?.qr) });
    res.json({ d7: pack(d7), d30: pack(d30), all: pack(all), adImpressions: num(ads?.imp), adClicks: num(ads?.clk),
      places: num(counts?.places), favorites: num(counts?.favorites), offers: num(counts?.offers), intel: num(counts?.intel), prints: num(counts?.prints),
      daily: daily.map((d) => ({ day: d.day, views: num(d.views), qr: num(d.qr) })) });
  });
  app.post("/api/fbo/printed", requireFbo, writeLimit, async (req, res) => {
    const kind = ["card", "sheet", "poster", "qr_png", "qr_svg"].includes(String(req.body?.kind)) ? String(req.body.kind) : "card";
    await event(fid(req), "print", who(req), kind);
    res.json({ ok: true });
  });

  // ---- places
  const placeFields = (b: any, cur?: any) => {
    const cat = FBO_CATEGORIES.includes(b.category) ? (b.category as FboCategory) : (cur?.category as FboCategory) || "eat";
    const pick = (k: string, col: string, n: number) => (b[k] != null ? clip(b[k], n) : cur ? cur[col] : "");
    return {
      category: cat, name: pick("name", "name", FBO_LIMITS.name), address: pick("address", "address", FBO_LIMITS.short), phone: pick("phone", "phone", 40),
      website: b.website != null ? cleanUrl(b.website) : cur ? cur.website : "", notes: pick("notes", "notes", FBO_LIMITS.notes),
      crewRate: pick("crewRate", "crew_rate", 80), distance: pick("distance", "distance", 40),
      favorite: b.favorite != null ? (b.favorite ? 1 : 0) : cur ? num(cur.favorite) : 0,
      hidden: b.hidden != null ? (b.hidden ? 1 : 0) : cur ? num(cur.hidden) : 0,
    };
  };
  app.get("/api/fbo/places", requireFbo, async (req, res) => {
    res.json((await rows(sql`SELECT * FROM fbo_places WHERE fbo_id = ${fid(req)} ORDER BY category, favorite DESC, sort, lower(name)`)).map(placeOut));
  });
  app.post("/api/fbo/places", requireFbo, writeLimit, async (req, res) => {
    const p = placeFields(req.body || {});
    if (!p.name) return res.status(400).json({ message: "Add the business name." });
    const n = num((await one(sql`SELECT COUNT(*) AS n FROM fbo_places WHERE fbo_id = ${fid(req)}`))?.n);
    if (n >= FBO_LIMITS.places) return res.status(400).json({ message: `Accounts hold up to ${FBO_LIMITS.places} recommendations during the beta.` });
    const r = await one(sql`INSERT INTO fbo_places (fbo_id, category, name, address, phone, website, notes, crew_rate, distance, favorite, hidden, sort, created_at, updated_at, updated_by)
      VALUES (${fid(req)}, ${p.category}, ${p.name}, ${p.address}, ${p.phone}, ${p.website}, ${p.notes}, ${p.crewRate}, ${p.distance}, ${p.favorite}, ${p.hidden}, ${n}, ${now()}, ${now()}, ${who(req)}) RETURNING *`);
    await event(fid(req), "edit", who(req), `added ${p.category}: ${p.name}`); await touch(fid(req));
    res.json(placeOut(r));
  });
  app.patch("/api/fbo/places/:id", requireFbo, writeLimit, async (req, res) => {
    const cur = await one(sql`SELECT * FROM fbo_places WHERE id = ${Number(req.params.id)} AND fbo_id = ${fid(req)}`);
    if (!cur) return res.status(404).json({ message: "Not found" });
    const p = placeFields(req.body || {}, cur);
    if (!p.name) return res.status(400).json({ message: "Add the business name." });
    const r = await one(sql`UPDATE fbo_places SET category = ${p.category}, name = ${p.name}, address = ${p.address}, phone = ${p.phone}, website = ${p.website}, notes = ${p.notes},
      crew_rate = ${p.crewRate}, distance = ${p.distance}, favorite = ${p.favorite}, hidden = ${p.hidden}, updated_at = ${now()}, updated_by = ${who(req)} WHERE id = ${num(cur.id)} RETURNING *`);
    await event(fid(req), "edit", who(req), `updated ${p.name}`); await touch(fid(req));
    res.json(placeOut(r));
  });
  app.delete("/api/fbo/places/:id", requireFbo, writeLimit, async (req, res) => {
    const cur = await one(sql`DELETE FROM fbo_places WHERE id = ${Number(req.params.id)} AND fbo_id = ${fid(req)} RETURNING name`);
    if (cur) { await db().execute(sql`UPDATE fbo_offers SET place_id = NULL WHERE place_id = ${Number(req.params.id)} AND fbo_id = ${fid(req)}`); await event(fid(req), "edit", who(req), `removed ${cur.name}`); }
    res.json({ ok: true });
  });
  /** Bulk import. Rows are matched to existing picks by name; mode "update" refreshes matches, "skip" leaves them alone. */
  app.post("/api/fbo/places/bulk", requireFbo, writeLimit, async (req, res) => {
    const list: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const mode = req.body?.mode === "update" ? "update" : "skip";
    if (!list.length) return res.status(400).json({ message: "Nothing to import." });
    if (list.length > FBO_LIMITS.bulkRows) return res.status(400).json({ message: `Import up to ${FBO_LIMITS.bulkRows} rows at a time.` });
    const id = fid(req);
    const existing = await rows(sql`SELECT * FROM fbo_places WHERE fbo_id = ${id}`);
    const byKey = new Map(existing.map((p) => [`${p.category}|${nameKey(p.name)}`, p]));
    let count = existing.length, added = 0, updated = 0, skipped = 0, offers = 0;
    const errors: { row: number; message: string }[] = [];
    for (let i = 0; i < list.length; i++) {
      const raw = list[i] || {};
      const p = placeFields({ ...raw, favorite: !!raw.favorite });
      if (!p.name) { errors.push({ row: i + 1, message: "No name" }); continue; }
      if (!FBO_CATEGORIES.includes(raw.category)) { errors.push({ row: i + 1, message: "Category must be restaurant, hotel or thing to do" }); continue; }
      const key = `${p.category}|${nameKey(p.name)}`;
      const cur = byKey.get(key);
      let placeId: number;
      if (cur) {
        if (mode === "skip") { skipped++; continue; }
        const merged = placeFields({ ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v != null)), favorite: raw.favorite ? true : !!num(cur.favorite) }, cur);
        await db().execute(sql`UPDATE fbo_places SET address = ${merged.address}, phone = ${merged.phone}, website = ${merged.website}, notes = ${merged.notes}, crew_rate = ${merged.crewRate},
          distance = ${merged.distance}, favorite = ${merged.favorite}, updated_at = ${now()}, updated_by = ${who(req)} WHERE id = ${num(cur.id)}`);
        placeId = num(cur.id); updated++;
      } else {
        if (count >= FBO_LIMITS.places) { errors.push({ row: i + 1, message: `Over the ${FBO_LIMITS.places}-pick limit` }); continue; }
        const r = await one(sql`INSERT INTO fbo_places (fbo_id, category, name, address, phone, website, notes, crew_rate, distance, favorite, hidden, sort, created_at, updated_at, updated_by)
          VALUES (${id}, ${p.category}, ${p.name}, ${p.address}, ${p.phone}, ${p.website}, ${p.notes}, ${p.crewRate}, ${p.distance}, ${p.favorite}, 0, ${count}, ${now()}, ${now()}, ${who(req)}) RETURNING *`);
        byKey.set(key, r); placeId = num(r.id); count++; added++;
      }
      const code = clip(raw.code, 40), offer = clip(raw.offer, 200);
      if (code || offer) {
        await db().execute(sql`INSERT INTO fbo_offers (fbo_id, place_id, title, code, details, expires_on, active, created_at, updated_at, updated_by)
          VALUES (${id}, ${placeId}, ${clip(offer || "Crew discount", 120)}, ${code}, ${""}, ${isoDate(String(raw.expires || ""))}, 1, ${now()}, ${now()}, ${who(req)})`);
        offers++;
      }
    }
    await event(id, "import", who(req), `${added} added, ${updated} updated, ${skipped} skipped, ${offers} discounts, ${errors.length} errors`); await touch(id);
    res.json({ added, updated, skipped, offers, errors });
  });

  // ---- offers
  const offerFields = async (req: Request, b: any, cur?: any) => {
    let placeId: number | null = b.placeId === undefined ? (cur ? cur.place_id : null) : b.placeId ? Number(b.placeId) : null;
    if (placeId != null && !(await one(sql`SELECT id FROM fbo_places WHERE id = ${placeId} AND fbo_id = ${fid(req)}`))) placeId = null;
    const pick = (k: string, col: string, n: number) => (b[k] != null ? clip(b[k], n) : cur ? cur[col] : "");
    return { placeId, title: pick("title", "title", 120), code: pick("code", "code", 40), details: pick("details", "details", 400),
      expiresOn: b.expiresOn != null ? isoDate(String(b.expiresOn)) : cur ? cur.expires_on : "", active: b.active != null ? (b.active ? 1 : 0) : cur ? num(cur.active) : 1 };
  };
  app.get("/api/fbo/offers", requireFbo, async (req, res) => res.json((await rows(sql`SELECT * FROM fbo_offers WHERE fbo_id = ${fid(req)} ORDER BY active DESC, id DESC`)).map(offerOut)));
  app.post("/api/fbo/offers", requireFbo, writeLimit, async (req, res) => {
    const o = await offerFields(req, req.body || {});
    if (!o.title) return res.status(400).json({ message: "Describe the discount, e.g. \"15% off for crews\"." });
    if (num((await one(sql`SELECT COUNT(*) AS n FROM fbo_offers WHERE fbo_id = ${fid(req)}`))?.n) >= FBO_LIMITS.offers) return res.status(400).json({ message: `Up to ${FBO_LIMITS.offers} discounts during the beta.` });
    const r = await one(sql`INSERT INTO fbo_offers (fbo_id, place_id, title, code, details, expires_on, active, created_at, updated_at, updated_by)
      VALUES (${fid(req)}, ${o.placeId}, ${o.title}, ${o.code}, ${o.details}, ${o.expiresOn}, ${o.active}, ${now()}, ${now()}, ${who(req)}) RETURNING *`);
    await event(fid(req), "edit", who(req), `added discount: ${o.title}`); await touch(fid(req));
    res.json(offerOut(r));
  });
  app.patch("/api/fbo/offers/:id", requireFbo, writeLimit, async (req, res) => {
    const cur = await one(sql`SELECT * FROM fbo_offers WHERE id = ${Number(req.params.id)} AND fbo_id = ${fid(req)}`);
    if (!cur) return res.status(404).json({ message: "Not found" });
    const o = await offerFields(req, req.body || {}, cur);
    if (!o.title) return res.status(400).json({ message: "Describe the discount." });
    const r = await one(sql`UPDATE fbo_offers SET place_id = ${o.placeId}, title = ${o.title}, code = ${o.code}, details = ${o.details}, expires_on = ${o.expiresOn}, active = ${o.active},
      updated_at = ${now()}, updated_by = ${who(req)} WHERE id = ${num(cur.id)} RETURNING *`);
    await event(fid(req), "edit", who(req), `updated discount: ${o.title}`); await touch(fid(req));
    res.json(offerOut(r));
  });
  app.delete("/api/fbo/offers/:id", requireFbo, writeLimit, async (req, res) => {
    const cur = await one(sql`DELETE FROM fbo_offers WHERE id = ${Number(req.params.id)} AND fbo_id = ${fid(req)} RETURNING title`);
    if (cur) await event(fid(req), "edit", who(req), `removed discount: ${cur.title}`);
    res.json({ ok: true });
  });

  // ---- intel
  app.get("/api/fbo/intel", requireFbo, async (req, res) => {
    const out: Record<string, any> = {};
    for (const r of await rows(sql`SELECT * FROM fbo_intel WHERE fbo_id = ${fid(req)}`)) out[r.field] = { value: r.value, updatedAt: num(r.updated_at), updatedBy: r.updated_by };
    res.json(out);
  });
  app.put("/api/fbo/intel", requireFbo, writeLimit, async (req, res) => {
    const b = req.body || {};
    const changed: string[] = [];
    for (const [k, v] of Object.entries(b)) {
      if (!FBO_INTEL_KEYS.has(k)) continue;
      const val = clip(v, FBO_LIMITS.intel);
      const cur = await one(sql`SELECT value FROM fbo_intel WHERE fbo_id = ${fid(req)} AND field = ${k}`);
      if (cur && cur.value === val) continue;
      if (!cur && !val) continue;
      await db().execute(sql`INSERT INTO fbo_intel (fbo_id, field, value, updated_at, updated_by) VALUES (${fid(req)}, ${k}, ${val}, ${now()}, ${who(req)})
        ON CONFLICT (fbo_id, field) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`);
      changed.push(k);
    }
    if (changed.length) { await event(fid(req), "edit", who(req), `intel: ${changed.join(", ")}`); await touch(fid(req)); }
    res.json({ ok: true, changed });
  });

  // ---- ads (text-only, the FBO's own airport only)
  const adFields = (b: any, cur?: any) => ({
    slot: ["top", "inline", "footer"].includes(b.slot) ? b.slot : cur?.slot || "inline",
    headline: b.headline != null ? clip(b.headline, FBO_LIMITS.headline) : cur?.headline || "",
    body: b.body != null ? clip(b.body, FBO_LIMITS.body) : cur?.body || "",
    cta: b.cta != null ? clip(b.cta, FBO_LIMITS.cta) || "Learn more" : cur?.cta || "Learn more",
    url: b.url != null ? cleanUrl(b.url) : cur?.url || "",
    active: b.active != null ? (b.active ? 1 : 0) : cur ? num(cur.active) : 1,
  });
  const activeAds = async (id: number, except = 0) => num((await one(sql`SELECT COUNT(*) AS n FROM ads WHERE fbo_id = ${id} AND active = 1 AND id <> ${except}`))?.n);
  app.get("/api/fbo/ads", requireFbo, async (req, res) => res.json((await rows(sql`SELECT * FROM ads WHERE fbo_id = ${fid(req)} ORDER BY id DESC`)).map(adOut)));
  app.post("/api/fbo/ads", requireFbo, writeLimit, async (req, res) => {
    const a = adFields(req.body || {});
    if (!a.headline) return res.status(400).json({ message: "Add a headline." });
    if (!a.url) return res.status(400).json({ message: "Add the web address crews go to when they tap." });
    const id = fid(req);
    if (num((await one(sql`SELECT COUNT(*) AS n FROM ads WHERE fbo_id = ${id}`))?.n) >= FBO_LIMITS.ads) return res.status(400).json({ message: `Up to ${FBO_LIMITS.ads} ads per account during the beta. Delete an old one first.` });
    if (a.active && (await activeAds(id)) >= FBO_LIMITS.activeAds) return res.status(400).json({ message: `Up to ${FBO_LIMITS.activeAds} ads can run at once. Pause one first.` });
    const f = ctx(req).fbo;
    const r = await one(sql`INSERT INTO ads (slot, advertiser, headline, body, cta, url, target_icao, active, impressions, clicks, fbo_id)
      VALUES (${a.slot}, ${f.name}, ${a.headline}, ${a.body}, ${a.cta}, ${a.url}, ${f.icao}, ${a.active}, 0, 0, ${id}) RETURNING *`);
    bustAds(); await event(id, "ad", who(req), `created ad: ${a.headline}`); await touch(id);
    res.json(adOut(r));
  });
  app.patch("/api/fbo/ads/:id", requireFbo, writeLimit, async (req, res) => {
    const id = fid(req);
    const cur = await one(sql`SELECT * FROM ads WHERE id = ${Number(req.params.id)} AND fbo_id = ${id}`);
    if (!cur) return res.status(404).json({ message: "Not found" });
    const a = adFields(req.body || {}, cur);
    if (!a.headline || !a.url) return res.status(400).json({ message: "Ads need a headline and a web address." });
    if (a.active && !num(cur.active) && (await activeAds(id, num(cur.id))) >= FBO_LIMITS.activeAds) return res.status(400).json({ message: `Up to ${FBO_LIMITS.activeAds} ads can run at once. Pause one first.` });
    const r = await one(sql`UPDATE ads SET slot = ${a.slot}, headline = ${a.headline}, body = ${a.body}, cta = ${a.cta}, url = ${a.url}, active = ${a.active},
      target_icao = ${ctx(req).fbo.icao} WHERE id = ${num(cur.id)} RETURNING *`);
    bustAds(); await event(id, "ad", who(req), `${a.active ? "updated" : "paused"} ad: ${a.headline}`); await touch(id);
    res.json(adOut(r));
  });
  app.delete("/api/fbo/ads/:id", requireFbo, writeLimit, async (req, res) => {
    const cur = await one(sql`DELETE FROM ads WHERE id = ${Number(req.params.id)} AND fbo_id = ${fid(req)} RETURNING headline`);
    bustAds(); if (cur) await event(fid(req), "ad", who(req), `deleted ad: ${cur.headline}`);
    res.json({ ok: true });
  });

  // ---- team (multiple people on one account)
  app.get("/api/fbo/team", requireFbo, async (req, res) => {
    const list = await rows(sql`SELECT id, email, name, role, status, created_at, last_login_at FROM fbo_users WHERE fbo_id = ${fid(req)} AND status <> 'removed' ORDER BY role DESC, id`);
    res.json(list.map((u) => ({ id: num(u.id), email: u.email, name: u.name, role: u.role, status: u.status, createdAt: num(u.created_at), lastLoginAt: u.last_login_at == null ? null : num(u.last_login_at) })));
  });
  app.post("/api/fbo/team", requireFbo, requireOwner, writeLimit, async (req, res) => {
    const email = clip(req.body?.email, 200).toLowerCase();
    const role: FboRole = FBO_ROLES.includes(req.body?.role) ? req.body.role : "editor";
    if (!emailOk(email)) return res.status(400).json({ message: "Enter a valid email address." });
    const recent = num((await one(sql`SELECT COUNT(*) AS n FROM fbo_events WHERE fbo_id = ${fid(req)} AND kind = 'user_invited' AND at > ${now() - DAY}`))?.n);
    if (recent >= 20) return res.status(429).json({ message: "That's a lot of invitations today. Try again tomorrow." });
    try { res.json(await inviteUser(fid(req), email, role, who(req))); }
    catch (e: any) { res.status(e.status || 500).json({ message: e.message }); }
  });
  app.patch("/api/fbo/team/:id", requireFbo, requireOwner, writeLimit, async (req, res) => {
    const uid = Number(req.params.id);
    const role: FboRole = FBO_ROLES.includes(req.body?.role) ? req.body.role : "editor";
    if (uid === ctx(req).user.id && role !== "owner") {
      const owners = num((await one(sql`SELECT COUNT(*) AS n FROM fbo_users WHERE fbo_id = ${fid(req)} AND role = 'owner' AND status = 'active'`))?.n);
      if (owners <= 1) return res.status(400).json({ message: "Make someone else an owner first." });
    }
    await db().execute(sql`UPDATE fbo_users SET role = ${role} WHERE id = ${uid} AND fbo_id = ${fid(req)}`);
    await event(fid(req), "team", who(req), `role changed to ${role} for user ${uid}`);
    res.json({ ok: true });
  });
  app.delete("/api/fbo/team/:id", requireFbo, requireOwner, writeLimit, async (req, res) => {
    const uid = Number(req.params.id);
    if (uid === ctx(req).user.id) return res.status(400).json({ message: "You can't remove yourself. Ask another owner." });
    const u = await one(sql`UPDATE fbo_users SET status = 'removed', password_hash = '' WHERE id = ${uid} AND fbo_id = ${fid(req)} RETURNING email`);
    await db().execute(sql`DELETE FROM fbo_sessions WHERE user_id = ${uid}`);
    await db().execute(sql`UPDATE fbo_tokens SET used_at = ${now()} WHERE user_id = ${uid} AND used_at IS NULL`);
    if (u) { await db().execute(sql`UPDATE fbo_users SET email = ${`removed-${uid}-${u.email}`} WHERE id = ${uid}`); await event(fid(req), "team", who(req), `removed ${u.email}`); }
    res.json({ ok: true });
  });

  // ================================================================ admin: create, watch and pause FBO accounts
  const adminName = (req: Request) => (req as any).adminName || "Admin key";
  app.get("/api/admin/fbo", requireAdmin, async (_req, res) => {
    await ready;
    const d7 = dayKey(now() - 6 * DAY), d30 = dayKey(now() - 29 * DAY);
    const list = await rows(sql`SELECT f.*,
      (SELECT COUNT(*) FROM fbo_users u WHERE u.fbo_id = f.id AND u.status = 'active') AS users_active,
      (SELECT COUNT(*) FROM fbo_users u WHERE u.fbo_id = f.id AND u.status = 'invited') AS users_invited,
      (SELECT MAX(last_login_at) FROM fbo_users u WHERE u.fbo_id = f.id) AS last_login,
      (SELECT COUNT(*) FROM fbo_places p WHERE p.fbo_id = f.id) AS places,
      (SELECT COUNT(*) FROM fbo_places p WHERE p.fbo_id = f.id AND p.favorite = 1) AS favorites,
      (SELECT COUNT(*) FROM fbo_offers o WHERE o.fbo_id = f.id AND o.active = 1) AS offers_active,
      (SELECT COUNT(*) FROM fbo_offers o WHERE o.fbo_id = f.id AND o.active = 1 AND o.expires_on = '') AS offers_open_ended,
      (SELECT COUNT(*) FROM fbo_intel i WHERE i.fbo_id = f.id AND i.value <> '') AS intel,
      (SELECT COUNT(*) FROM ads a WHERE a.fbo_id = f.id) AS ads,
      (SELECT COUNT(*) FROM ads a WHERE a.fbo_id = f.id AND a.active = 1) AS ads_active,
      (SELECT COALESCE(SUM(impressions),0) FROM ads a WHERE a.fbo_id = f.id) AS ad_imp,
      (SELECT COALESCE(SUM(clicks),0) FROM ads a WHERE a.fbo_id = f.id) AS ad_clk,
      (SELECT COALESCE(SUM(n),0) FROM fbo_views v WHERE v.fbo_id = f.id AND v.day >= ${d7}) AS views7,
      (SELECT COALESCE(SUM(n),0) FROM fbo_views v WHERE v.fbo_id = f.id AND v.day >= ${d30}) AS views30,
      (SELECT COALESCE(SUM(n),0) FROM fbo_views v WHERE v.fbo_id = f.id AND v.src = 'qr' AND v.day >= ${d30}) AS qr30,
      (SELECT COUNT(*) FROM fbo_views v WHERE v.fbo_id = f.id AND v.day >= ${d30}) AS devices30,
      (SELECT COUNT(*) FROM fbo_events e WHERE e.fbo_id = f.id AND e.kind IN ('edit','ad','import') AND e.at > ${now() - DAY}) AS edits24,
      (SELECT COUNT(*) FROM fbo_events e WHERE e.fbo_id = f.id AND e.kind = 'print') AS prints,
      (SELECT COUNT(*) FROM fbo_events e WHERE e.fbo_id = f.id AND e.kind = 'import') AS imports
      FROM fbo_accounts f ORDER BY f.id`);
    const adUrls = await rows(sql`SELECT fbo_id, url FROM ads WHERE fbo_id IS NOT NULL AND active = 1`);
    const serving = (await one(sql`SELECT value FROM app_settings WHERE key = 'fbo_ads_serving'`))?.value === "on";
    res.json({
      adsServing: serving, fboUrl: FBO_URL(), limits: FBO_LIMITS,
      accounts: list.map((f) => {
        const flags: string[] = [];
        const site = hostOf(f.website || "");
        const offsite = adUrls.filter((a) => num(a.fbo_id) === num(f.id) && site && hostOf(a.url) && !hostOf(a.url).endsWith(site));
        if (num(f.places) > 150) flags.push(`${num(f.places)} recommendations (heavy list)`);
        if (num(f.ads_active) >= FBO_LIMITS.activeAds) flags.push("Running the maximum ads");
        if (offsite.length) flags.push(`${offsite.length} ad${offsite.length > 1 ? "s link" : " links"} off the FBO's own website`);
        if (num(f.edits24) > 100) flags.push(`${num(f.edits24)} edits in 24 h`);
        if (num(f.users_active) + num(f.users_invited) > 8) flags.push(`${num(f.users_active) + num(f.users_invited)} people on the account`);
        if (num(f.offers_open_ended) > 10) flags.push(`${num(f.offers_open_ended)} discounts with no end date`);
        if (num(f.ad_imp) > 0 && num(f.views30) === 0 && num(f.places) === 0) flags.push("Ads only, no recommendations posted");
        const age = now() - num(f.created_at);
        const idle = age > 14 * DAY && !num(f.last_login);
        return { ...accountOut(f), lastActiveAt: f.last_active_at == null ? null : num(f.last_active_at), lastLoginAt: f.last_login == null ? null : num(f.last_login), createdBy: f.created_by,
          usersActive: num(f.users_active), usersInvited: num(f.users_invited), places: num(f.places), favorites: num(f.favorites), offersActive: num(f.offers_active), intel: num(f.intel),
          ads: num(f.ads), adsActive: num(f.ads_active), adImpressions: num(f.ad_imp), adClicks: num(f.ad_clk), views7: num(f.views7), views30: num(f.views30), qr30: num(f.qr30),
          devices30: num(f.devices30), edits24: num(f.edits24), prints: num(f.prints), imports: num(f.imports), flags, idle };
      }),
    });
  });
  app.post("/api/admin/fbo", requireAdmin, async (req, res) => {
    await ready;
    const name = clip(req.body?.name, FBO_LIMITS.name);
    const icao = clip(req.body?.icao, 4).toUpperCase();
    const email = clip(req.body?.ownerEmail, 200).toLowerCase();
    if (!name) return res.status(400).json({ message: "Add the FBO name." });
    if (!isCode(icao)) return res.status(400).json({ message: "Use a 3–4 character airport code." });
    const ap = refAirport(icao);
    const code = ap?.icao || icao;
    if (!emailOk(email)) return res.status(400).json({ message: "Add the owner's email." });
    if (await one(sql`SELECT id FROM fbo_users WHERE email = ${email}`)) return res.status(409).json({ message: "That email already has FBO access." });
    let slug = clip(req.body?.slug, 40).toLowerCase().replace(/[^a-z0-9-]/g, "") || slugFor(name, code);
    for (let i = 2; await one(sql`SELECT id FROM fbo_accounts WHERE slug = ${slug}`); i++) slug = `${slugFor(name, code)}-${i}`;
    const f = await one(sql`INSERT INTO fbo_accounts (slug, name, icao, created_at, created_by, status) VALUES (${slug}, ${name}, ${code}, ${now()}, ${adminName(req)}, 'active') RETURNING *`);
    const inv = await inviteUser(num(f.id), email, "owner", adminName(req));
    await event(num(f.id), "created", adminName(req), `account created for ${name} (${code})`);
    await logChange({ kind: "admin", actor: adminName(req), action: "fbo_create", entity: "fbo", entityId: num(f.id), summary: `Created FBO beta account ${name} (${code}) for ${email}` });
    res.json({ account: accountOut(f), invite: inv });
  });
  app.get("/api/admin/fbo/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const f = await one(sql`SELECT * FROM fbo_accounts WHERE id = ${id}`);
    if (!f) return res.status(404).json({ message: "Not found" });
    const users = await rows(sql`SELECT id, email, name, role, status, created_at, last_login_at FROM fbo_users WHERE fbo_id = ${id} ORDER BY id`);
    const events = await rows(sql`SELECT at, kind, actor, detail FROM fbo_events WHERE fbo_id = ${id} ORDER BY at DESC LIMIT 300`);
    const ads = await rows(sql`SELECT * FROM ads WHERE fbo_id = ${id} ORDER BY id DESC`);
    const offers = await rows(sql`SELECT * FROM fbo_offers WHERE fbo_id = ${id} ORDER BY id DESC`);
    const places = await rows(sql`SELECT * FROM fbo_places WHERE fbo_id = ${id} ORDER BY category, favorite DESC, lower(name)`);
    const daily = await rows(sql`SELECT day, SUM(n) AS views, SUM(CASE WHEN src = 'qr' THEN n ELSE 0 END) AS qr, COUNT(*) AS devices FROM fbo_views WHERE fbo_id = ${id} AND day >= ${dayKey(now() - 29 * DAY)} GROUP BY day ORDER BY day`);
    res.json({ account: accountOut(f), users: users.map((u) => ({ id: num(u.id), email: u.email, name: u.name, role: u.role, status: u.status, createdAt: num(u.created_at), lastLoginAt: u.last_login_at == null ? null : num(u.last_login_at) })),
      events: events.map((e) => ({ at: num(e.at), kind: e.kind, actor: e.actor, detail: e.detail })), ads: ads.map(adOut), offers: offers.map(offerOut), places: places.map(placeOut),
      daily: daily.map((d) => ({ day: d.day, views: num(d.views), qr: num(d.qr), devices: num(d.devices) })) });
  });
  app.patch("/api/admin/fbo/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const f = await one(sql`SELECT * FROM fbo_accounts WHERE id = ${id}`);
    if (!f) return res.status(404).json({ message: "Not found" });
    const status = req.body?.status === "suspended" ? "suspended" : req.body?.status === "active" ? "active" : f.status;
    const name = req.body?.name != null ? clip(req.body.name, FBO_LIMITS.name) || f.name : f.name;
    await db().execute(sql`UPDATE fbo_accounts SET status = ${status}, name = ${name} WHERE id = ${id}`);
    if (status === "suspended") await db().execute(sql`DELETE FROM fbo_sessions WHERE user_id IN (SELECT id FROM fbo_users WHERE fbo_id = ${id})`);
    bustAds();
    if (status !== f.status) await event(id, status === "suspended" ? "paused" : "resumed", adminName(req), "by Wheelsdown admin");
    await logChange({ kind: "admin", actor: adminName(req), action: status === "suspended" ? "fbo_pause" : "fbo_update", entity: "fbo", entityId: id, summary: `${status === "suspended" ? "Paused" : "Updated"} FBO ${name}` });
    res.json({ ok: true });
  });
  app.post("/api/admin/fbo/:id/invite", requireAdmin, async (req, res) => {
    const email = clip(req.body?.email, 200).toLowerCase();
    const role: FboRole = FBO_ROLES.includes(req.body?.role) ? req.body.role : "owner";
    if (!emailOk(email)) return res.status(400).json({ message: "Enter a valid email address." });
    try { res.json(await inviteUser(Number(req.params.id), email, role, adminName(req))); }
    catch (e: any) { res.status(e.status || 500).json({ message: e.message }); }
  });
  app.post("/api/admin/fbo/:id/ads/:adId", requireAdmin, async (req, res) => {
    const active = req.body?.active ? 1 : 0;
    await db().execute(sql`UPDATE ads SET active = ${active} WHERE id = ${Number(req.params.adId)} AND fbo_id = ${Number(req.params.id)}`);
    bustAds(); await event(Number(req.params.id), "ad", adminName(req), `${active ? "resumed" : "paused"} ad ${req.params.adId} (Wheelsdown admin)`);
    res.json({ ok: true });
  });
  app.delete("/api/admin/fbo/:id", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const f = await one(sql`SELECT name FROM fbo_accounts WHERE id = ${id}`);
    if (!f) return res.status(404).json({ message: "Not found" });
    await db().execute(sql`DELETE FROM fbo_sessions WHERE user_id IN (SELECT id FROM fbo_users WHERE fbo_id = ${id})`);
    for (const t of ["fbo_tokens", "fbo_users", "fbo_places", "fbo_offers", "fbo_intel", "fbo_events", "fbo_views"]) await db().execute(sql.raw(`DELETE FROM ${t} WHERE fbo_id = ${id}`));
    await db().execute(sql`DELETE FROM ads WHERE fbo_id = ${id}`);
    await db().execute(sql`DELETE FROM fbo_accounts WHERE id = ${id}`);
    bustAds();
    await logChange({ kind: "admin", actor: adminName(req), action: "fbo_delete", entity: "fbo", entityId: id, summary: `Deleted FBO beta account ${f.name}` });
    res.json({ ok: true });
  });
  app.put("/api/admin/fbo-settings", requireAdmin, async (req, res) => {
    const v = req.body?.adsServing ? "on" : "off";
    await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('fbo_ads_serving', ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    bustAds();
    await logChange({ kind: "admin", actor: adminName(req), action: "fbo_ads_serving", entity: "setting", entityId: "fbo_ads_serving", summary: `FBO ads in the crew app turned ${v}` });
    res.json({ ok: true, adsServing: v === "on" });
  });

  // ---- FBO app manifest (separate home-screen app). start_url follows the host it was installed from.
  app.get("/fbo.webmanifest", (req, res) => {
    const start = isFboHost(req) ? "/" : "/fbo-portal/";
    res.type("application/manifest+json").setHeader("Cache-Control", "no-cache");
    res.send(JSON.stringify({ name: "Wheelsdown for FBOs", short_name: "WD FBO", id: start, start_url: start, scope: start, display: "standalone",
      background_color: "#0B1222", theme_color: "#0B1222",
      icons: [{ src: "/fbo-icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" }, { src: "/fbo-icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" }, { src: "/fbo-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" }] }));
  });
}
