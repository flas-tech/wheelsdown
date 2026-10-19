/**
 * Version 0 previews: Layover Today, Crew meetup and Rate a spot (see shared/layover.ts).
 * Who can use them is decided here on the server: until app_settings layover_audience is "members", every route
 * answers 404 for anyone who isn't a super-user account, exactly like an unknown route. Nothing here touches points.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { z } from "zod";
import tzlookup from "tz-lookup";
import { db } from "./db";
import { storage } from "./storage";
import { refAirport } from "./airportsData";
import { logChange } from "./ops";
import { flagShortText } from "./ai";
import { findTailNumbers } from "@shared/tailNumber";
import { pickable, pickScore } from "@shared/briefing";
import { crewIds, areCrew } from "./mycrew";
import { fillStop, aiPrefOf, programsOf } from "./aiPicks";
import { MEETUP_RULES, meetupNoteProblem, type Metar, type Meetup, type MeetupPerson, type MeetupResp, type RateItem, type TodayPick, type TodayResp, type FlightCat } from "@shared/layover";
import type { SpotWithStats, User, BriefingStop } from "@shared/schema";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
const rows = async <T = any>(q: ReturnType<typeof sql>) => (await db().execute(q)).rows as T[];
const num = (v: unknown) => Number(v) || 0;
const HOUR = 3600_000;

// ---------------------------------------------------------------- audience
let audCache = { at: 0, v: "admins" as "admins" | "members" };
async function audience() {
  if (Date.now() - audCache.at < 30_000) return audCache.v;
  const r = (await rows(sql`SELECT value FROM app_settings WHERE key = 'layover_audience'`).catch(() => []))[0];
  audCache = { at: Date.now(), v: r?.value === "members" ? "members" : "admins" };
  return audCache.v;
}

export async function ensureLayoverTables() {
  await db().execute(sql`CREATE TABLE IF NOT EXISTS meetups (id serial PRIMARY KEY, user_id integer NOT NULL, icao text NOT NULL, note text NOT NULL DEFAULT '',
    spot_id integer, status text NOT NULL DEFAULT 'live', created_at bigint NOT NULL DEFAULT 0, expires_at bigint NOT NULL DEFAULT 0)`);
  await db().execute(sql`CREATE INDEX IF NOT EXISTS meetups_icao_idx ON meetups (icao, expires_at)`);
  await db().execute(sql`CREATE TABLE IF NOT EXISTS meetup_joins (meetup_id integer NOT NULL, user_id integer NOT NULL, created_at bigint NOT NULL DEFAULT 0, PRIMARY KEY (meetup_id, user_id))`);
  await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('layover_audience', 'admins') ON CONFLICT (key) DO NOTHING`);
}

// ---------------------------------------------------------------- sun (NOAA / suncalc formulas, no network)
const RAD = Math.PI / 180, DAY = 86400_000, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009, OBL = RAD * 23.4397;
const toDays = (ms: number) => ms / DAY - 0.5 + J1970 - J2000;
const fromJulian = (j: number) => (j + 0.5 - J1970) * DAY;
function sunTimes(ms: number, lat: number, lng: number): { rise: number | null; set: number | null } {
  const lw = RAD * -lng, phi = RAD * lat, d = toDays(ms);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = RAD * (357.5291 + 0.98560028 * ds);
  const L = M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
  const dec = Math.asin(Math.sin(OBL) * Math.sin(L));
  const noon = J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const cosW = (Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cosW < -1 || cosW > 1) return { rise: null, set: null }; // polar day or night
  const w = Math.acos(cosW);
  const a = J0 + (w + lw) / (2 * Math.PI) + n;
  const set = J2000 + a + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  return { rise: Math.round(fromJulian(noon - (set - noon))), set: Math.round(fromJulian(set)) };
}
/** Today's sunrise and sunset at the field, plus the next sunrise after now. */
function sunFor(lat: number, lon: number, tz: string | null) {
  const now = Date.now();
  // local noon today, so "today" means the field's date, not the server's
  let noon = now;
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", hour: "numeric", hour12: false }).formatToParts(new Date(now));
    const h = Number(parts.find((p) => p.type === "hour")?.value || 12) % 24;
    noon = now + (12 - h) * HOUR;
  } catch { /* UTC */ }
  const t = sunTimes(noon, lat, lon);
  const tomorrow = sunTimes(noon + DAY, lat, lon);
  const nextRise = t.rise && t.rise > now ? t.rise : tomorrow.rise;
  return { rise: t.rise, set: t.set, nextRise };
}

// ---------------------------------------------------------------- METAR (aviationweather.gov, public domain)
const metarCache = new Map<string, { at: number; v: Metar | null }>();
const milesBetween = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
  const R = 3958.8, dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
async function awc(qs: string): Promise<any[]> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(`https://aviationweather.gov/api/data/metar?format=json&${qs}`, { headers: { "user-agent": "Wheelsdown/1.0 (getwheelsdown.com)" }, signal: ctl.signal });
    if (r.status === 204) return [];
    if (!r.ok) throw new Error(`aviationweather ${r.status}`);
    const j = await r.json();
    return Array.isArray(j) ? j : [];
  } finally { clearTimeout(t); }
}
const toMetar = (m: any, field: { lat: number; lon: number }): Metar => {
  const clouds = Array.isArray(m.clouds) ? m.clouds as { cover: string; base: number | null }[] : [];
  const ceil = clouds.filter((c) => ["BKN", "OVC", "OVX", "VV"].includes(c.cover) && c.base != null).map((c) => c.base!).sort((a, b) => a - b)[0] ?? null;
  const cat = ["VFR", "MVFR", "IFR", "LIFR"].includes(m.fltCat) ? (m.fltCat as FlightCat) : null;
  return {
    station: String(m.icaoId || ""), stationMiles: m.lat != null && m.lon != null ? Math.round(milesBetween(field, { lat: m.lat, lon: m.lon }) * 10) / 10 : 0,
    raw: String(m.rawOb || ""), observedAt: num(m.obsTime) * 1000, flightCat: cat,
    tempC: m.temp ?? null, dewC: m.dewp ?? null, windDir: m.wdir === "VRB" ? "VRB" : m.wdir ?? null, windKt: m.wspd ?? null, gustKt: m.wgst ?? null,
    visibility: m.visib != null ? String(m.visib) : null, ceilingFt: ceil,
    clouds: clouds.map((c) => `${c.cover}${c.base != null ? String(Math.round(c.base / 100)).padStart(3, "0") : ""}`).join(" "), wx: String(m.wxString || ""),
  };
};
/** The field's own METAR, or the closest station within about 40 miles. Cached 10 minutes. Throws when the service is down. */
async function metarFor(icao: string, field: { lat: number; lon: number }): Promise<Metar | null> {
  const c = metarCache.get(icao);
  if (c && Date.now() - c.at < 10 * 60_000) return c.v;
  let list = /^[A-Z]{4}$/.test(icao) ? await awc(`ids=${icao}`) : [];
  if (!list.length) {
    const d = 0.6;
    list = (await awc(`bbox=${(field.lat - d).toFixed(3)},${(field.lon - d).toFixed(3)},${(field.lat + d).toFixed(3)},${(field.lon + d).toFixed(3)}`))
      .filter((m) => m.lat != null && m.lon != null)
      .sort((a, b) => milesBetween(field, a) - milesBetween(field, b));
  }
  const v = list[0] ? toMetar(list[0], field) : null;
  metarCache.set(icao, { at: Date.now(), v });
  if (metarCache.size > 500) metarCache.delete(metarCache.keys().next().value!);
  return v;
}

// ---------------------------------------------------------------- helpers
async function airportOf(code: string) {
  const a = (await storage.resolveCode(code)) as any;
  const ref = refAirport(code);
  const lat = a?.lat ?? ref?.lat, lon = a?.lon ?? ref?.lon;
  if (lat == null || lon == null) return null;
  const icao = a?.icao || ref!.icao;
  return { icao, name: a?.name || ref?.name || icao, city: a?.city || ref?.city || "", region: a?.region || ref?.region || "", country: a?.country || ref?.country || "", lat, lon };
}
const tzOf = (lat: number, lon: number) => { try { return tzlookup(lat, lon); } catch { return null; } };
const myReviewed = async (uid: number) => new Set((await rows(sql`SELECT spot_id FROM reviews WHERE user_id = ${uid}`)).map((r) => num(r.spot_id)));
const pick = (s: SpotWithStats, rated: Set<number>): TodayPick => ({ id: s.id, name: s.name, category: s.category, milesFromField: s.milesFromField ?? 0, avgRating: s.avgRating ?? null, reviewCount: s.reviewCount, rated: rated.has(s.id), icao: s.icao, address: s.address || null, lat: s.lat ?? null, lng: s.lng ?? null });
const stopsOf = (raw: string): BriefingStop[] => { try { const v = JSON.parse(raw || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const hasCheckin = async (uid: number, icao: string) =>
  !!(await rows(sql`SELECT 1 FROM checkins WHERE user_id = ${uid} AND icao = ${icao} AND created_at > ${Date.now() - MEETUP_RULES.checkinWindowHours * HOUR} LIMIT 1`))[0];

/** Spots the member has been to (check-ins), planned (briefings) or saved (favorites) and hasn't rated yet. */
async function rateQueue(uid: number, visits: { id: number; at: number }[] = []): Promise<RateItem[]> {
  const rated = await myReviewed(uid);
  const out = new Map<number, Omit<RateItem, "name" | "icao" | "category" | "avgRating" | "reviewCount">>();
  // "Did you go?" reminders kept on the phone (directions, website or phone opened); sent along by the Rate tab
  for (const v of visits) if (v.id > 0) out.set(v.id, { id: v.id, reason: "visit", detail: "You looked up directions or the website", at: v.at });
  for (const c of await rows(sql`SELECT spot_id, MAX(created_at)::float8 AS at FROM checkins WHERE user_id = ${uid} AND spot_id IS NOT NULL AND created_at > ${Date.now() - 60 * DAY} GROUP BY spot_id`))
    out.set(num(c.spot_id), { id: num(c.spot_id), reason: "checkin", detail: "You checked in", at: num(c.at) }); // a check-in outranks a reminder
  for (const b of await rows(sql`SELECT title, stops, updated_at::float8 AS at FROM briefings WHERE user_id = ${uid} ORDER BY updated_at DESC LIMIT 30`))
    for (const st of stopsOf(b.stops)) for (const id of st.picks || []) if (id > 0 && !out.has(id)) out.set(id, { id, reason: "briefing", detail: b.title ? `In your briefing ${b.title}` : `In your briefing for ${st.icao}`, at: num(b.at) });
  for (const f of await rows(sql`SELECT spot_id, created_at::float8 AS at FROM favorites WHERE user_id = ${uid}`))
    if (!out.has(num(f.spot_id))) out.set(num(f.spot_id), { id: num(f.spot_id), reason: "favorite", detail: "In your favorites", at: num(f.at) });
  const ids = Array.from(out.keys()).filter((id) => !rated.has(id));
  if (!ids.length) return [];
  const spots = (await storage.searchSpots([], false, "")).filter((s) => ids.includes(s.id) && s.status === "live" && s.userId !== uid);
  const order = { checkin: 0, visit: 1, briefing: 2, favorite: 3 } as const;
  return spots.map((s) => ({ ...out.get(s.id)!, name: s.name, icao: s.icao, category: s.category, avgRating: s.avgRating ?? null, reviewCount: s.reviewCount }))
    .sort((a, b) => order[a.reason] - order[b.reason] || b.at - a.at).slice(0, 60);
}

// ---------------------------------------------------------------- routes
export function registerLayover(app: Express, o: { userOf: (req: Request) => Promise<User | undefined>; isSuperAdmin: (u?: User | null) => boolean }) {
  ensureLayoverTables().catch((e) => console.error("[layover] tables failed", String(e?.message || e)));
  const writeLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Slow down a little and try again." } });
  const gate: Mw = async (req, res, next) => {
    const u = await o.userOf(req);
    if (!u || (!o.isSuperAdmin(u) && (await audience()) !== "members")) return res.status(404).json({ message: "Not found" });
    (req as any).user = u; next();
  };
  const me = (req: Request) => (req as any).user as User;

  // ---- Layover Today
  app.get("/api/preview/today", gate, async (req, res) => {
    const u = me(req);
    const recentCk = await rows(sql`SELECT icao, MAX(created_at)::float8 AS at FROM checkins WHERE user_id = ${u.id} GROUP BY icao ORDER BY MAX(created_at) DESC LIMIT 6`);
    const briefs = await rows(sql`SELECT id, title, stops, updated_at::float8 AS at FROM briefings WHERE user_id = ${u.id} ORDER BY updated_at DESC LIMIT 10`);
    const recent = Array.from(new Set([...recentCk.map((r) => String(r.icao)), ...briefs.flatMap((b) => stopsOf(b.stops).map((s) => s.icao))])).slice(0, 8);

    let icao: string | null = null, source: TodayResp["source"] = null, checkedInAt: number | null = null;
    const q = String(req.query.icao || "").trim().toUpperCase();
    if (q) { icao = q; source = "query"; }
    else if (recentCk[0] && Date.now() - num(recentCk[0].at) < MEETUP_RULES.checkinWindowHours * HOUR) { icao = String(recentCk[0].icao); source = "checkin"; checkedInAt = num(recentCk[0].at); }
    else { const s = briefs.flatMap((b) => stopsOf(b.stops))[0]; if (s) { icao = s.icao; source = "briefing"; } }

    const empty: TodayResp = { icao: null, source: null, checkedInAt: null, airport: null, tz: null, sun: null, metar: null, metarError: false, briefing: null, crewPicks: { eat: [], do: [] }, favorites: [], meetup: { mine: false, others: null }, toRate: 0, recent };
    if (!icao) return res.json(empty);
    const ap = await airportOf(icao as string);
    if (!ap) return res.status(404).json({ message: `We don't know the airport ${icao}. Check the code.` });
    const code: string = ap.icao; icao = code;
    if (source !== "query" && !checkedInAt) { const c = recentCk.find((r) => r.icao === icao); if (c && Date.now() - num(c.at) < MEETUP_RULES.checkinWindowHours * HOUR) checkedInAt = num(c.at); }
    const tz = tzOf(ap.lat, ap.lon);

    const [metarR, spots, rated, favRows, queue] = await Promise.all([
      metarFor(icao, ap).then((v) => ({ v, err: false })).catch(() => ({ v: null, err: true })),
      storage.searchSpots([icao], false, ""), myReviewed(u.id),
      rows(sql`SELECT spot_id FROM favorites WHERE user_id = ${u.id}`), rateQueue(u.id),
    ]);
    const byId = new Map(spots.map((s) => [s.id, s]));
    const b = briefs.find((x) => stopsOf(x.stops).some((s) => s.icao === icao));
    const st = b ? stopsOf(b.stops).find((s) => s.icao === icao)! : null;
    const crewInBrief = st ? (st.picks || []).map((id) => byId.get(id)).filter(Boolean) as SpotWithStats[] : [];
    let briefPicks: TodayPick[] = crewInBrief.map((s) => pick(s, rated));
    // AI picks in the briefing (open slots AI filled, plus ones the owner added): at airports where crews haven't
    // listed things to do yet these are the whole "do" part of the plan, so they belong here too (Joe, KMMU, Oct 19).
    // Same fill as the briefing page; it only reads saved AI picks, and gives up after a few seconds rather than hold the page.
    if (st) {
      const [pref, programs] = await Promise.all([aiPrefOf(u.id), programsOf(u.id)]);
      const fill = await Promise.race([
        fillStop(icao, st.layover, st.nights, crewInBrief, spots, undefined, st.ai ?? pref === "ai", st.aiAdd || [], programs, st.aiHide || []).catch(() => null),
        new Promise<null>((r) => setTimeout(() => r(null), 4000)),
      ]);
      const aiRows: TodayPick[] = (fill?.aiPicks || []).map((c) => ({ id: c.id, name: c.name, category: c.category, milesFromField: c.milesFromField ?? 0, avgRating: null, reviewCount: 0, rated: false,
        icao, address: c.address || null, lat: c.lat ?? null, lng: c.lng ?? null, ai: true }));
      briefPicks = [...briefPicks, ...aiRows];
      // the order the owner set in the briefing (crew ids positive, AI picks negative); anything unlisted keeps its place after
      if (st.order?.length) { const at = new Map(st.order.map((id, k) => [id, k])); briefPicks.sort((a, z) => (at.get(a.id) ?? 999) - (at.get(z.id) ?? 999)); }
    }
    const inBrief = new Set(briefPicks.map((p) => p.id));
    const top = (cat: string) => spots.filter((s) => s.category === cat && pickable(s) && !inBrief.has(s.id)).sort((a, z) => pickScore(z) - pickScore(a)).slice(0, 3).map((s) => pick(s, rated));
    const favIds = new Set(favRows.map((r) => num(r.spot_id)));

    const now = Date.now();
    const mineM = (await rows(sql`SELECT 1 FROM meetups WHERE user_id = ${u.id} AND icao = ${icao} AND status = 'live' AND expires_at > ${now} LIMIT 1`))[0];
    // Crew Up is crew-only: count plans here from people in your crew
    const myCrew = Array.from(await crewIds(u.id));
    const others = myCrew.length ? num((await rows(sql`SELECT COUNT(*) AS n FROM meetups WHERE icao = ${icao} AND status = 'live' AND expires_at > ${now} AND user_id IN (${sql.join(myCrew.map((i) => sql`${i}`), sql`, `)})`))[0]?.n) : 0;

    const out: TodayResp = {
      icao, source, checkedInAt, airport: ap, tz, sun: sunFor(ap.lat, ap.lon, tz), metar: metarR.v, metarError: metarR.err,
      briefing: b && st ? { id: num(b.id), title: String(b.title || ""), layover: st.layover, nights: st.nights ?? null, picks: briefPicks } : null,
      crewPicks: { eat: top("eat"), do: top("do") },
      favorites: spots.filter((s) => favIds.has(s.id)).map((s) => pick(s, rated)),
      meetup: { mine: !!mineM, others }, toRate: queue.filter((x) => x.icao === icao).length, recent,
    };
    res.json(out);
  });

  // ---- Rate a spot
  app.get("/api/preview/rate-queue", gate, async (req, res) => {
    const visits = String(req.query.visits || "").split(",").slice(0, 20).map((x) => { const [id, at] = x.split(":").map(Number); return { id, at }; })
      .filter((v) => Number.isInteger(v.id) && v.id > 0 && Number.isFinite(v.at) && v.at > 0);
    res.json(await rateQueue(me(req).id, visits));
  });

  // ---- Crew Up (was Crew meetup): plans are seen only by people in each other's crew
  async function people(ids: number[], icao: string): Promise<Map<number, MeetupPerson>> {
    const pub = await storage.publicUsers(true);
    const want = new Set(ids);
    const ck = ids.length ? await rows(sql`SELECT DISTINCT user_id FROM checkins WHERE icao = ${icao} AND created_at > ${Date.now() - MEETUP_RULES.checkinWindowHours * HOUR}`) : [];
    const verified = new Set(ck.map((r) => num(r.user_id)));
    const m = new Map<number, MeetupPerson>();
    // meetups are opt-in, so they show the member's display name even when they post anonymously elsewhere
    for (const p of pub) if (want.has(p.id)) m.set(p.id, { id: p.id, name: p.displayName, crewRole: p.crewRole, aircraft: p.aircraft || "", tierId: p.tierId, verified: verified.has(p.id) });
    return m;
  }
  async function shape(list: any[], viewer: number, icao: string): Promise<Meetup[]> {
    if (!list.length) return [];
    const ids = list.map((r) => num(r.id));
    const joins = await rows(sql`SELECT meetup_id, user_id FROM meetup_joins WHERE meetup_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    const spotIds = list.map((r) => r.spot_id).filter((x) => x != null).map(num);
    const spots = spotIds.length ? await rows(sql`SELECT id, name, category FROM spots WHERE id IN (${sql.join(spotIds.map((i) => sql`${i}`), sql`, `)}) AND status = 'live'`) : [];
    const spotBy = new Map(spots.map((s) => [num(s.id), { id: num(s.id), name: String(s.name), category: String(s.category) }]));
    const ppl = await people(Array.from(new Set([...list.map((r) => num(r.user_id)), ...joins.map((j) => num(j.user_id))])), icao);
    return list.map((r) => {
      const mine = num(r.user_id) === viewer;
      const js = joins.filter((j) => num(j.meetup_id) === num(r.id));
      return {
        id: num(r.id), icao: String(r.icao), note: String(r.note || ""), spot: r.spot_id != null ? spotBy.get(num(r.spot_id)) || null : null,
        createdAt: num(r.created_at), expiresAt: num(r.expires_at), host: ppl.get(num(r.user_id)) || { id: 0, name: "Former member", crewRole: "Crew", aircraft: "", tierId: "", verified: false },
        mine, joined: js.some((j) => num(j.user_id) === viewer), joins: js.length,
        // the host sees who's in; everyone else sees a count, plus themselves
        attendees: mine ? js.map((j) => ppl.get(num(j.user_id))).filter(Boolean) as MeetupPerson[] : [],
      };
    }).filter((m) => m.host.id);
  }

  app.get("/api/preview/meetups", gate, async (req, res) => {
    const u = me(req), now = Date.now();
    const mineAll = await rows(sql`SELECT * FROM meetups WHERE user_id = ${u.id} AND status = 'live' AND expires_at > ${now} ORDER BY created_at DESC`);
    const myAirports = Array.from(new Set(mineAll.map((r) => String(r.icao))));
    const q = String(req.query.icao || "").trim().toUpperCase();
    const lastCk = !q && !myAirports[0] ? (await rows(sql`SELECT icao FROM checkins WHERE user_id = ${u.id} AND created_at > ${now - MEETUP_RULES.checkinWindowHours * HOUR} ORDER BY created_at DESC LIMIT 1`))[0] : null;
    const start = q || myAirports[0] || (lastCk ? String(lastCk.icao) : "");
    const ap = start ? await airportOf(start) : null;
    if (q && !ap) return res.status(404).json({ message: `We don't know the airport ${q}. Check the code.` });
    const icao = ap?.icao || null;
    const mineRow = icao ? mineAll.find((r) => r.icao === icao) : undefined;
    // crew-only: you see plans from people in your crew (both of you agreed), never from strangers
    const myCrew = Array.from(await crewIds(u.id));
    const crewRows = myCrew.length ? await rows(sql`SELECT * FROM meetups WHERE status = 'live' AND expires_at > ${now} AND user_id IN (${sql.join(myCrew.map((i) => sql`${i}`), sql`, `)}) ORDER BY created_at DESC LIMIT 100`) : [];
    const othersRows = icao ? crewRows.filter((r) => r.icao === icao) : [];
    const elsewhere: any[] = [];
    for (const code of Array.from(new Set(crewRows.filter((r) => r.icao !== icao).map((r) => String(r.icao))))) elsewhere.push(...(await shape(crewRows.filter((r) => r.icao === code), u.id, code)));
    const [mine] = mineRow && icao ? await shape([mineRow], u.id, icao) : [null];
    const out: MeetupResp = {
      icao, mine: mine || null, others: icao ? await shape(othersRows, u.id, icao) : [], crewElsewhere: elsewhere, crewCount: myCrew.length, myAirports,
      requireCheckin: MEETUP_RULES.requireCheckin, verifiedHere: icao ? await hasCheckin(u.id, icao) : false,
    };
    res.json(out);
  });

  const postBody = z.object({
    icao: z.string().trim().toUpperCase().min(3).max(4),
    note: z.string().trim().max(MEETUP_RULES.noteMax, `Keep it under ${MEETUP_RULES.noteMax} characters`).default(""),
    hours: z.coerce.number().refine((h) => (MEETUP_RULES.hours as readonly number[]).includes(h), "Pick how long you're around").default(MEETUP_RULES.defaultHours),
    spotId: z.coerce.number().int().positive().nullable().optional(),
  });
  app.post("/api/preview/meetups", gate, writeLimit, async (req, res) => {
    const u = me(req);
    const p = postBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message || "Check the details" });
    const ap = await airportOf(p.data.icao);
    if (!ap) return res.status(400).json({ message: `We don't know the airport ${p.data.icao}. Check the code.` });
    const note = p.data.note;
    if (findTailNumbers(note).length) return res.status(400).json({ message: "Tail numbers aren't allowed. Describe the aircraft by type instead (a CJ3, a G550)." });
    const priv = meetupNoteProblem(note);
    if (priv) return res.status(400).json({ message: priv });
    if (note && await flagShortText(note)) return res.status(400).json({ message: "That note can't be posted. Keep it friendly and about meeting up." });
    if (MEETUP_RULES.requireCheckin && !(await hasCheckin(u.id, ap.icao))) return res.status(400).json({ message: `Check in at ${ap.icao} first, so crews know you're really here.` });
    let spotId: number | null = null;
    if (p.data.spotId) {
      const s = await storage.getSpot(p.data.spotId);
      if (!s || s.status !== "live" || s.icao !== ap.icao) return res.status(400).json({ message: "Pick a place at this airport." });
      if (s.category === "stay") return res.status(400).json({ message: "Pick a public place to meet, not a hotel." });
      spotId = s.id;
    }
    const now = Date.now();
    // one at a time: a new post replaces the old one
    await db().execute(sql`UPDATE meetups SET status = 'ended' WHERE user_id = ${u.id} AND status = 'live'`);
    const r = (await rows(sql`INSERT INTO meetups (user_id, icao, note, spot_id, status, created_at, expires_at) VALUES (${u.id}, ${ap.icao}, ${note}, ${spotId}, 'live', ${now}, ${now + p.data.hours * HOUR}) RETURNING id`))[0];
    await db().execute(sql`DELETE FROM meetup_joins WHERE meetup_id IN (SELECT id FROM meetups WHERE status <> 'live' OR expires_at < ${now - 7 * DAY})`);
    await db().execute(sql`DELETE FROM meetups WHERE expires_at < ${now - 7 * DAY}`);
    res.status(201).json({ ok: true, id: num(r.id) });
  });
  app.delete("/api/preview/meetups/:id", gate, async (req, res) => {
    const u = me(req);
    await db().execute(sql`UPDATE meetups SET status = 'ended' WHERE id = ${Number(req.params.id)} AND user_id = ${u.id}`);
    res.json({ ok: true });
  });
  app.post("/api/preview/meetups/:id/join", gate, writeLimit, async (req, res) => {
    const u = me(req), id = Number(req.params.id), now = Date.now();
    const m = (await rows(sql`SELECT * FROM meetups WHERE id = ${id} AND status = 'live' AND expires_at > ${now}`))[0];
    if (!m) return res.status(404).json({ message: "Those plans have ended." });
    if (num(m.user_id) === u.id) return res.status(400).json({ message: "That's yours." });
    if (!(await areCrew(u.id, num(m.user_id)))) return res.status(404).json({ message: "Those plans have ended." });
    await db().execute(sql`INSERT INTO meetup_joins (meetup_id, user_id, created_at) VALUES (${id}, ${u.id}, ${now}) ON CONFLICT DO NOTHING`);
    res.json({ ok: true });
  });
  app.delete("/api/preview/meetups/:id/join", gate, async (req, res) => {
    await db().execute(sql`DELETE FROM meetup_joins WHERE meetup_id = ${Number(req.params.id)} AND user_id = ${me(req).id}`);
    res.json({ ok: true });
  });
  app.post("/api/preview/meetups/:id/report", gate, writeLimit, async (req, res) => {
    const u = me(req), id = Number(req.params.id);
    const m = (await rows(sql`SELECT id, user_id, icao, note FROM meetups WHERE id = ${id}`))[0];
    if (!m) return res.status(404).json({ message: "Not found" });
    logChange({ actor: `@${u.handle}`, actorId: u.id, kind: "system", action: "meetup_report", entity: "meetup", entityId: id,
      summary: `Crew Up #${id} at ${m.icao} reported by @${u.handle}`, detail: { note: m.note, hostId: num(m.user_id), reason: String(req.body?.reason || "").slice(0, 200) } });
    res.json({ ok: true });
  });
}
