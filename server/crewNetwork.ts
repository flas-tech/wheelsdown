/**
 * Crew network (Oct 2026): overlap alerts with My Crew from trip sheets (both people opt in), a read-only family link
 * and trip crew chat (an encrypted group conversation from a trip sheet; see dm.ts). Admins first behind
 * crew_network_audience. Overlaps show only airport and dates, never the other person's trip sheet.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import tzlookup from "tz-lookup";
import { db } from "./db";
import type { User } from "@shared/schema";
import { refAirport } from "./airportsData";
import { crewNetwork } from "./switches";
import { crewIds } from "./mycrew";
import { pushTo } from "./push";
import { stopNights, addDays, type Overlap, type CrewNetworkMe, type FamilyStop, type FamilyView } from "@shared/crewNetwork";

const rows = async <T = any>(q: any) => ((await db().execute(q)).rows as T[]);
const num = (v: unknown) => Number(v) || 0;
const DAY = 86_400_000;
const APP_URL = process.env.APP_URL || "https://getwheelsdown.com";
const today = () => new Date().toISOString().slice(0, 10);
const first = (n: string) => String(n || "Crew").trim().split(/\s+/)[0];

type Stop = { userId: number; briefingId: number; title: string; icao: string; from: string; to: string; picks: number[] };
/** Dated trip sheet stops that haven't finished yet, for these people. */
export async function upcomingStops(userIds: number[]): Promise<Stop[]> {
  if (!userIds.length) return [];
  const b = await rows(sql`SELECT id, user_id, title, stops FROM briefings WHERE updated_at > ${Date.now() - 90 * DAY} AND user_id IN (${sql.join(userIds.map((x) => sql`${x}`), sql`, `)})`);
  const out: Stop[] = []; const t = addDays(today(), -1);
  for (const x of b) {
    let stops: any[] = []; try { stops = JSON.parse(x.stops); } catch { continue; }
    for (const s of stops) {
      if (!s?.arriveDate || !/^\d{4}-\d{2}-\d{2}$/.test(s.arriveDate)) continue;
      const to = addDays(s.arriveDate, stopNights(s.layover, s.nights));
      if (to < t) continue;
      out.push({ userId: num(x.user_id), briefingId: num(x.id), title: String(x.title || ""), icao: String(s.icao).toUpperCase(), from: s.arriveDate, to, picks: (s.picks || []).map(num) });
    }
  }
  return out;
}
async function prefsMap(ids: number[]) {
  if (!ids.length) return new Map<number, any>();
  const r = await rows(sql`SELECT * FROM crew_network_prefs WHERE user_id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
  return new Map(r.map((x) => [num(x.user_id), x]));
}
async function names(ids: number[]) {
  if (!ids.length) return new Map<number, string>();
  const r = await rows(sql`SELECT id, display_name FROM users WHERE id IN (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`);
  return new Map(r.map((x) => [num(x.id), String(x.display_name || "Crew")]));
}
const cityOf = async (icao: string) => {
  const a = (await rows(sql`SELECT name, city, region, country, lat, lon FROM airports WHERE icao = ${icao}`))[0] as any;
  const r = a || refAirport(icao);
  return r ? { name: String(r.name || ""), city: [r.city, r.region].filter(Boolean).join(", "), country: String(r.country || ""), lat: r.lat, lon: r.lon } : { name: "", city: "", country: "", lat: null, lon: null };
};

export async function overlapsFor(uid: number): Promise<Overlap[]> {
  const crew = Array.from(await crewIds(uid));
  const pm = await prefsMap([uid, ...crew]);
  if (!pm.get(uid)?.show_overlaps) return [];
  const others = crew.filter((c) => !!pm.get(c)?.show_overlaps);
  if (!others.length) return [];
  const mine = await upcomingStops([uid]), theirs = await upcomingStops(others);
  const nm = await names(others);
  const seen = new Set<string>(), out: Overlap[] = [];
  for (const a of mine) for (const b of theirs) {
    if (a.icao !== b.icao || a.from > b.to || b.from > a.to) continue;
    const from = a.from > b.from ? a.from : b.from, to = a.to < b.to ? a.to : b.to;
    const k = `${b.userId}:${a.icao}:${from}`; if (seen.has(k)) continue; seen.add(k);
    out.push({ personId: b.userId, name: nm.get(b.userId) || "Crew", icao: a.icao, city: (await cityOf(a.icao)).city, from, to });
  }
  return out.sort((x, y) => x.from.localeCompare(y.from));
}

/** Account deletion: their overlap and family-link settings (the family link stops working). */
export async function forgetCrewNetwork(userId: number) {
  await db().execute(sql`DELETE FROM crew_network_prefs WHERE user_id = ${userId}`).catch(() => {});
  await db().execute(sql`DELETE FROM overlap_alerts_sent WHERE user_id = ${userId}`).catch(() => {});
}
export function registerCrewNetwork(app: Express, o: {
  userOf: (req: Request) => Promise<User | null | undefined>; isSuperAdmin: (u?: User | null) => boolean;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => any; requireUser: (req: Request, res: Response, next: NextFunction) => any;
}) {
  void (async () => {
    await db().execute(sql`CREATE TABLE IF NOT EXISTS crew_network_prefs (user_id integer PRIMARY KEY, show_overlaps boolean NOT NULL DEFAULT false,
      family_on boolean NOT NULL DEFAULT false, family_hotel boolean NOT NULL DEFAULT false, family_token text, updated_at bigint NOT NULL DEFAULT 0)`);
    await db().execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crew_network_family_token ON crew_network_prefs (family_token)`);
    await db().execute(sql`CREATE TABLE IF NOT EXISTS overlap_alerts_sent (user_id integer NOT NULL, k text NOT NULL, at bigint NOT NULL, PRIMARY KEY (user_id, k))`);
  })().catch((e) => console.error("crew network setup", e));
  const allowed = async (u?: User | null) => !!u && ((await crewNetwork.audience()) === "members" || o.isSuperAdmin(u));
  crewNetwork.register(app, "/api/admin/crew-network", o.requireAdmin, async () => num((await rows(sql`SELECT COUNT(*)::int AS n FROM crew_network_prefs WHERE show_overlaps OR family_on`))[0]?.n));

  const meOut = async (uid: number): Promise<CrewNetworkMe> => {
    const p = (await prefsMap([uid])).get(uid);
    return { on: true, overlaps: !!p?.show_overlaps, family: { on: !!p?.family_on, showHotel: !!p?.family_hotel, url: p?.family_on && p?.family_token ? `${APP_URL}/#/f/${p.family_token}` : null } };
  };
  app.get("/api/crew-network/me", o.requireUser, async (req, res) => {
    const u = (req as any).user as User;
    if (!(await allowed(u))) return res.json({ on: false, overlaps: false, family: { on: false, showHotel: false, url: null } } satisfies CrewNetworkMe);
    res.json(await meOut(u.id));
  });
  app.put("/api/crew-network/me", o.requireUser, async (req, res) => {
    const u = (req as any).user as User;
    if (!(await allowed(u))) return res.status(403).json({ message: "Not available yet" });
    const b = req.body || {};
    await db().execute(sql`INSERT INTO crew_network_prefs (user_id, updated_at) VALUES (${u.id}, ${Date.now()}) ON CONFLICT (user_id) DO NOTHING`);
    if (typeof b.overlaps === "boolean") await db().execute(sql`UPDATE crew_network_prefs SET show_overlaps = ${b.overlaps}, updated_at = ${Date.now()} WHERE user_id = ${u.id}`);
    if (typeof b.showHotel === "boolean") await db().execute(sql`UPDATE crew_network_prefs SET family_hotel = ${b.showHotel} WHERE user_id = ${u.id}`);
    if (typeof b.family === "boolean") {
      const cur = (await prefsMap([u.id])).get(u.id);
      const tok = b.family ? (cur?.family_token || randomBytes(12).toString("base64url")) : null; // turning it off kills the link for good
      await db().execute(sql`UPDATE crew_network_prefs SET family_on = ${b.family}, family_token = ${tok} WHERE user_id = ${u.id}`);
    }
    if (b.resetFamily) await db().execute(sql`UPDATE crew_network_prefs SET family_token = ${randomBytes(12).toString("base64url")} WHERE user_id = ${u.id} AND family_on`);
    res.json(await meOut(u.id));
  });
  app.get("/api/crew-network/overlaps", o.requireUser, async (req, res) => {
    const u = (req as any).user as User;
    if (!(await allowed(u))) return res.json({ overlaps: [] });
    res.json({ overlaps: await overlapsFor(u.id) });
  });

  /** Public, read-only: where this person is tonight and where they're headed. No login; the token is the key. */
  app.get("/api/family/:token", async (req, res) => {
    const tok = String(req.params.token || "").slice(0, 40);
    const p = tok.length >= 12 ? (await rows(sql`SELECT * FROM crew_network_prefs WHERE family_token = ${tok} AND family_on`))[0] : null;
    if (!p || (await crewNetwork.audience()) !== "members" && !o.isSuperAdmin({ id: num(p.user_id) } as User)) return res.status(404).json({ message: "This link isn't active." });
    const uid = num(p.user_id);
    const nm = (await names([uid])).get(uid) || "Crew";
    const stops = (await upcomingStops([uid])).sort((a, b) => a.from.localeCompare(b.from));
    const hotelName = async (s: Stop) => {
      if (!p.family_hotel || !s.picks.length) return null;
      const h = (await rows(sql`SELECT name FROM spots WHERE id IN (${sql.join(s.picks.filter((x) => x > 0).concat([0]).map((x) => sql`${x}`), sql`, `)}) AND category = 'stay' AND status = 'live' LIMIT 1`))[0];
      return h ? String(h.name) : null;
    };
    const shape = async (s: Stop): Promise<FamilyStop> => { const c = await cityOf(s.icao); let tz: string | null = null; try { if (c.lat != null) tz = tzlookup(Number(c.lat), Number(c.lon)); } catch { tz = null; }
      return { icao: s.icao, name: c.name, city: c.city, country: c.country, tz, from: s.from, to: s.to, hotel: await hotelName(s) }; };
    const t = today();
    const cur = stops.filter((s) => s.from <= t && s.to >= t).pop() || null;
    const ci = (await rows(sql`SELECT icao, created_at FROM checkins WHERE user_id = ${uid} AND created_at > ${Date.now() - 18 * 3600_000} ORDER BY created_at DESC LIMIT 1`))[0];
    let now: FamilyStop | null = cur ? await shape(cur) : null;
    if (ci && (!now || now.icao !== String(ci.icao))) now = await shape({ userId: uid, briefingId: 0, title: "", icao: String(ci.icao), from: t, to: t, picks: cur && cur.icao === String(ci.icao) ? cur.picks : [] });
    const next: FamilyStop[] = [];
    for (const s of stops.filter((s) => s.from > t).slice(0, 4)) next.push(await shape(s));
    res.set("Cache-Control", "no-store").json({ name: first(nm), now, next, checkedInAt: ci ? num(ci.created_at) : null, updatedAt: Date.now() } satisfies FamilyView);
  });

  // hourly: push new overlaps to people who opted in
  const tick = async () => {
    const aud = await crewNetwork.audience();
    const opted = (await rows(sql`SELECT user_id FROM crew_network_prefs WHERE show_overlaps`)).map((r) => num(r.user_id)).filter((id) => aud === "members" || o.isSuperAdmin({ id } as User));
    for (const uid of opted) {
      for (const ov of await overlapsFor(uid)) {
        const k = `${ov.personId}:${ov.icao}:${ov.from}`;
        const ins = await rows(sql`INSERT INTO overlap_alerts_sent (user_id, k, at) VALUES (${uid}, ${k}, ${Date.now()}) ON CONFLICT DO NOTHING RETURNING user_id`).catch(() => []);
        if (!ins.length) continue;
        const d = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
        void pushTo(uid, "overlap", { title: `You and ${first(ov.name)} are both at ${ov.icao}`, body: `${d(ov.from)}${ov.to !== ov.from ? ` to ${d(ov.to)}` : ""}${ov.city ? ` · ${ov.city}` : ""}. Make plans in Crew Up?`, link: `/meetup?icao=${ov.icao}`, tag: `overlap-${ov.icao}` });
      }
    }
    await db().execute(sql`DELETE FROM overlap_alerts_sent WHERE at < ${Date.now() - 60 * DAY}`).catch(() => {});
  };
  if (process.env.NODE_ENV === "production" || process.env.NAS_ALERTS === "1") {
    setTimeout(() => { void tick().catch(() => {}); setInterval(() => void tick().catch((e) => console.error("overlaps", e)), 60 * 60_000); }, 90_000);
  }
}
