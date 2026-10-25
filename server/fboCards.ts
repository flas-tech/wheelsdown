/**
 * Participating FBOs on trip sheets (briefs) and Crew Up plans.
 *
 * An FBO that has a live Wheelsdown account (fbo_accounts: status active, email confirmed) shows up as a card on every
 * brief stop and Crew Up plan at its airport: name, phone, a few desk/crew intel lines it filled in, its live crew
 * discounts and how many places it recommends, with a link to its crew page (/f/<slug>?s=brief or ?s=crewup, counted
 * in the FBO's page views). Everything shown is what the FBO itself entered in the portal.
 *
 * Who sees it: app_settings fbo_cards_audience = admins (super-admins only) until it's opened to members. A brief's
 * cards follow its owner, so a shared brief link shows them only if the owner would see them.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { logChange } from "./ops";
import { FBO_INTEL_FIELDS } from "@shared/fbo";
import type { User } from "@shared/schema";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
type Audience = "admins" | "members";
const rows = async <T = any>(q: any) => ((await db().execute(q)).rows as T[]);
const num = (v: unknown) => (v == null ? 0 : Number(v));
const todayIso = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Intel lines a crew most wants at a glance, in this order; the card shows up to 4 the FBO filled in. */
const CARD_INTEL = ["hours", "crew_car", "fees", "after_hours", "lounge", "fuel", "fuel_price", "frequency", "transport", "wifi"];
const LABEL = new Map(FBO_INTEL_FIELDS.map((f) => [f.key, f.label]));

export type FboCard = {
  id: number; name: string; icao: string; phone: string; website: string; url: string;
  intel: { label: string; value: string }[]; offers: { title: string; code: string }[]; recommends: number;
};

let audCache = { at: 0, v: "admins" as Audience };
export async function fboCardsAudience(): Promise<Audience> {
  if (Date.now() - audCache.at < 15_000) return audCache.v;
  const r = (await rows(sql`SELECT value FROM app_settings WHERE key = 'fbo_cards_audience'`).catch(() => []))[0];
  audCache = { at: Date.now(), v: r?.value === "members" ? "members" : "admins" };
  return audCache.v;
}
let isSuper: (u?: User | null) => boolean = () => false;
/** Does this crew member (or the owner of a shared brief) see FBO cards? */
export async function fboCardsOpenFor(userId?: number | null) {
  if (!userId) return false;
  if (isSuper({ id: userId } as User)) return true;
  return (await fboCardsAudience()) === "members";
}

/** Live participating FBOs at these airports, keyed by ICAO. */
export async function fbosAt(icaos: string[], src: "brief" | "crewup"): Promise<Map<string, FboCard[]>> {
  const codes = Array.from(new Set(icaos.map((c) => String(c || "").toUpperCase()).filter((c) => /^[A-Z0-9]{3,4}$/.test(c)))).slice(0, 20);
  const out = new Map<string, FboCard[]>();
  if (!codes.length) return out;
  const list = sql.join(codes.map((c) => sql`${c}`), sql`, `);
  const accts = await rows(sql`SELECT id, name, icao, slug, phone, website FROM fbo_accounts
    WHERE status = 'active' AND verified_at IS NOT NULL AND UPPER(icao) IN (${list}) ORDER BY name`).catch(() => []);
  if (!accts.length) return out;
  const ids = sql.join(accts.map((a) => sql`${num(a.id)}`), sql`, `);
  const [intel, offers, recs] = await Promise.all([
    rows(sql`SELECT fbo_id, field, value FROM fbo_intel WHERE fbo_id IN (${ids}) AND value <> ''`).catch(() => []),
    rows(sql`SELECT fbo_id, title, code, expires_on FROM fbo_offers WHERE fbo_id IN (${ids}) AND active = 1 ORDER BY id`).catch(() => []),
    rows(sql`SELECT r.fbo_id, COUNT(*) AS n FROM fbo_recs r JOIN spots s ON s.id = r.spot_id
      WHERE r.fbo_id IN (${ids}) AND r.hidden = 0 AND r.level = 'recommended' AND s.status = 'live' GROUP BY r.fbo_id`).catch(() => []),
  ]);
  const today = todayIso();
  for (const a of accts) {
    const id = num(a.id);
    const mine = new Map(intel.filter((r) => num(r.fbo_id) === id).map((r) => [String(r.field), String(r.value)]));
    const card: FboCard = {
      id, name: a.name, icao: String(a.icao).toUpperCase(), phone: a.phone || "", website: a.website || "",
      url: `/f/${a.slug}?s=${src}`,
      intel: CARD_INTEL.filter((k) => mine.get(k)).slice(0, 4).map((k) => ({ label: LABEL.get(k) || k, value: mine.get(k)!.slice(0, 140) })),
      offers: offers.filter((o) => num(o.fbo_id) === id && (!o.expires_on || o.expires_on >= today)).slice(0, 3).map((o) => ({ title: o.title, code: o.code || "" })),
      recommends: num(recs.find((r) => num(r.fbo_id) === id)?.n),
    };
    out.set(card.icao, [...(out.get(card.icao) || []), card]);
  }
  return out;
}

export function registerFboCards(app: Express, o: { userOf: (req: Request) => Promise<User | undefined | null>; isSuperAdmin: (u?: User | null) => boolean; requireAdmin: Mw }) {
  isSuper = o.isSuperAdmin;
  db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('fbo_cards_audience', 'admins') ON CONFLICT (key) DO NOTHING`).catch(() => {});

  /** Crew Up: participating FBOs at these airports (empty until the switch is open for this member). */
  app.get("/api/fbos-at", async (req, res) => {
    const u = await o.userOf(req).catch(() => null);
    if (!u || !(await fboCardsOpenFor(u.id))) return res.json({ fbos: {} });
    const icaos = String(req.query.icaos || "").split(",");
    const src = req.query.src === "brief" ? "brief" : "crewup";
    res.json({ fbos: Object.fromEntries(await fbosAt(icaos, src)) });
  });

  app.get("/api/admin/fbo-cards", o.requireAdmin, async (_req, res) => {
    const n = (await rows(sql`SELECT COUNT(*) AS n, COUNT(DISTINCT icao) AS a FROM fbo_accounts WHERE status = 'active' AND verified_at IS NOT NULL`).catch(() => []))[0];
    res.json({ audience: await fboCardsAudience(), fbos: num(n?.n), airports: num(n?.a) });
  });
  app.put("/api/admin/fbo-cards", o.requireAdmin, async (req, res) => {
    const v: Audience = req.body?.audience === "members" ? "members" : "admins";
    await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('fbo_cards_audience', ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    audCache = { at: Date.now(), v };
    await logChange({ actor: (req as any).adminName || "Admin", kind: "admin", action: "fbo_cards_audience", entity: "settings",
      summary: v === "members" ? "Participating FBO cards opened to members" : "Participating FBO cards back to admins only" });
    res.json({ audience: v });
  });
}
