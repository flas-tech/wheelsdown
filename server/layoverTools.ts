/**
 * Layover tools (Oct 2026): crew hotel sheet (shuttle call, amenities), TAF + 10-day forecast, abroad card and
 * FAA NAS status with push alerts for trip sheet airports. Admins first behind layover_tools_audience.
 * Outside data: FAA nasstatus.faa.gov (public XML), aviationweather.gov TAF, Open-Meteo forecast (no key).
 */
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import type { User } from "@shared/schema";
import { refAirport } from "./airportsData";
import { layoverTools } from "./switches";
import { pushTo } from "./push";
import { HOTEL_AMENITIES, PHONE_RE, US_LIKE, EMERGENCY, type HotelSheet, type NasEvent, type ForecastDay, type LayoverToolsResp } from "@shared/layoverTools";

const rows = async <T = any>(q: any) => ((await db().execute(q)).rows as T[]);
const num = (v: unknown) => Number(v) || 0;
const ICAO = /^[A-Z0-9]{3,4}$/;
const DAY = 86_400_000;
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const AMEN = new Set<string>(HOTEL_AMENITIES.map((a) => a.id));

// ---------- hotel sheet ----------
export async function hotelSheets(ids: number[]): Promise<Record<number, HotelSheet>> {
  const out: Record<number, HotelSheet> = {};
  const list = Array.from(new Set(ids.filter((x) => x > 0))).slice(0, 60);
  if (!list.length) return out;
  const since = Date.now() - 365 * DAY;
  const r = await rows(sql`SELECT spot_id, user_id, field, value, created_at FROM hotel_facts
    WHERE spot_id IN (${sql.join(list.map((x) => sql`${x}`), sql`, `)}) AND created_at >= ${since} ORDER BY created_at ASC`).catch(() => []);
  const per = new Map<number, { phone: [string, number] | null; note: [string, number] | null; votes: Map<string, Map<number, string>>; at: number; users: Set<number> }>();
  for (const x of r) {
    const id = num(x.spot_id);
    let p = per.get(id);
    if (!p) { p = { phone: null, note: null, votes: new Map(), at: 0, users: new Set() }; per.set(id, p); }
    const at = num(x.created_at);
    p.at = Math.max(p.at, at); p.users.add(num(x.user_id));
    if (x.field === "shuttle_phone") p.phone = [x.value, at];
    else if (x.field === "shuttle_note") p.note = [x.value, at];
    else if (AMEN.has(x.field)) { if (!p.votes.has(x.field)) p.votes.set(x.field, new Map()); p.votes.get(x.field)!.set(num(x.user_id), x.value); }
  }
  for (const [id, p] of Array.from(per.entries())) {
    const amenities: HotelSheet["amenities"] = {};
    for (const [k, v] of Array.from(p.votes.entries())) {
      let yes = 0, no = 0; for (const s of Array.from(v.values())) { if (s === "yes") yes++; else if (s === "no") no++; }
      if (yes || no) (amenities as any)[k] = yes >= no ? "yes" : "no";
    }
    out[id] = { spotId: id, shuttlePhone: p.phone?.[0] || null, shuttleNote: p.note?.[0] || null, amenities, confirmedAt: p.at || null, crews: p.users.size };
  }
  return out;
}

// ---------- outside data, cached ----------
type Cache<T> = Map<string, { at: number; v: T }>;
const taf: Cache<LayoverToolsResp["taf"]> = new Map(), fc: Cache<ForecastDay[] | null> = new Map();
let nas = { at: 0, updated: null as number | null, events: [] as NasEvent[] };
const fetchText = async (url: string, ms = 8000) => {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal, headers: { "user-agent": "Wheelsdown crew app (getwheelsdown.com)" } }); if (!r.ok) throw new Error(String(r.status)); return await r.text(); }
  finally { clearTimeout(t); }
};
const tag = (s: string, t: string) => (s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`)) || [])[1]?.trim() || "";
const lidToIcao = (lid: string) => (lid.length === 3 ? (refAirport("K" + lid) ? "K" + lid : refAirport(lid)?.icao || "K" + lid) : lid);

export function parseNas(xml: string): { updated: number | null; events: NasEvent[] } {
  const out: NasEvent[] = [];
  const upd = Date.parse(tag(xml, "Update_Time").replace(" GMT", "Z").replace(/^\w+ /, ""));
  for (const block of xml.split("<Delay_type>").slice(1)) {
    const name = tag(block, "Name");
    const kind: NasEvent["kind"] = /ground stop/i.test(name) ? "ground_stop" : /ground delay/i.test(name) ? "gdp" : /closure/i.test(name) ? "closure" : /arrival\/departure|delay/i.test(name) ? "delay" : "other";
    const items = block.split(/<(?:Ground_Delay|Delay|Airport|Program)>/).slice(1);
    for (const it of items) {
      const arpt = tag(it, "ARPT"); if (!arpt) continue;
      const reason = tag(it, "Reason");
      let title = name, detail = "";
      if (kind === "ground_stop") { title = "Ground stop"; detail = tag(it, "End_Time") ? `Until ${tag(it, "End_Time")}` : ""; }
      else if (kind === "gdp") { title = "Ground delay program"; detail = [tag(it, "Avg") && `Average ${tag(it, "Avg")}`, tag(it, "Max") && `max ${tag(it, "Max")}`].filter(Boolean).join(", "); }
      else if (kind === "delay") { const dir = (it.match(/Type="(\w+)"/) || [])[1] || ""; title = `${dir || "Arrival/departure"} delays`; detail = [tag(it, "Min"), tag(it, "Max")].filter(Boolean).join(" to ") + (tag(it, "Trend") ? `, ${tag(it, "Trend").toLowerCase()}` : ""); }
      else if (kind === "closure") {
        const ppr = /NON SKED TRANSIENT GA/i.test(reason);
        title = ppr ? "Closed to transient GA without PPR" : "Airport closure";
        detail = [tag(it, "Start") && `From ${tag(it, "Start").replace(/\.$/, "")}`, tag(it, "Reopen") && `reopens ${tag(it, "Reopen").replace(/\.$/, "")}`].filter(Boolean).join(", ");
      }
      out.push({ arpt, icao: lidToIcao(arpt), kind, title, detail, reason: reason.replace(/^VOL:|^WX:|^RWY:|^EQ:/, "").slice(0, 300) });
    }
  }
  return { updated: Number.isFinite(upd) ? upd : null, events: out };
}
async function nasNow() {
  if (Date.now() - nas.at < 3 * 60_000) return nas;
  try { const p = parseNas(await fetchText("https://nasstatus.faa.gov/api/airport-status-information")); nas = { at: Date.now(), ...p }; }
  catch { nas.at = Date.now() - 2 * 60_000; } // retry in a minute, keep the last good copy
  return nas;
}
async function tafFor(icao: string) {
  const c = taf.get(icao); if (c && Date.now() - c.at < 20 * 60_000) return c.v;
  let v: LayoverToolsResp["taf"] = null;
  try { const j = JSON.parse(await fetchText(`https://aviationweather.gov/api/data/taf?ids=${icao}&format=json`)); if (Array.isArray(j) && j[0]?.rawTAF) v = { raw: String(j[0].rawTAF), issued: j[0].issueTime || null }; }
  catch { if (c) return c.v; }
  taf.set(icao, { at: Date.now(), v }); return v;
}
async function forecastFor(icao: string, lat: number, lon: number) {
  const c = fc.get(icao); if (c && Date.now() - c.at < 60 * 60_000) return c.v;
  let v: ForecastDay[] | null = null;
  try {
    const j = JSON.parse(await fetchText(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=10&timezone=auto`));
    const d = j.daily; const f = (c: number) => Math.round(c * 9 / 5 + 32);
    if (d?.time?.length) v = d.time.map((t: string, i: number) => ({ date: t, hiC: Math.round(d.temperature_2m_max[i]), loC: Math.round(d.temperature_2m_min[i]), hiF: f(d.temperature_2m_max[i]), loF: f(d.temperature_2m_min[i]), code: num(d.weather_code[i]), pop: d.precipitation_probability_max?.[i] ?? null }));
  } catch { if (c) return c.v; }
  fc.set(icao, { at: Date.now(), v }); return v;
}

export function registerLayoverTools(app: Express, o: {
  userOf: (req: Request) => Promise<User | null | undefined>; isSuperAdmin: (u?: User | null) => boolean;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => any; requireUser: (req: Request, res: Response, next: NextFunction) => any;
}) {
  void (async () => {
    await db().execute(sql`CREATE TABLE IF NOT EXISTS hotel_facts (id serial PRIMARY KEY, spot_id integer NOT NULL, user_id integer NOT NULL, field text NOT NULL, value text NOT NULL, created_at bigint NOT NULL)`);
    await db().execute(sql`CREATE INDEX IF NOT EXISTS hotel_facts_spot ON hotel_facts (spot_id, created_at)`);
    await db().execute(sql`CREATE TABLE IF NOT EXISTS nas_alerts_sent (user_id integer NOT NULL, event_key text NOT NULL, at bigint NOT NULL, PRIMARY KEY (user_id, event_key))`);
  })().catch((e) => console.error("layover tools setup", e));
  const allowed = async (u?: User | null) => (await layoverTools.audience()) === "members" || (!!u && o.isSuperAdmin(u));
  layoverTools.register(app, "/api/admin/layover-tools", o.requireAdmin, async () => num((await rows(sql`SELECT COUNT(DISTINCT spot_id)::int AS n FROM hotel_facts`))[0]?.n));

  app.get("/api/layover-tools/:icao", async (req, res) => {
    const u = await o.userOf(req);
    const icao = clean(req.params.icao, 4).toUpperCase();
    if (!(await allowed(u)) || !ICAO.test(icao)) return res.json({ on: false, icao, nas: [], nasUpdated: null, taf: null, forecast: null, abroad: null } satisfies LayoverToolsResp);
    const ap = (await rows(sql`SELECT icao, country, lat, lon FROM airports WHERE icao = ${icao}`))[0] as any;
    const ref = refAirport(icao);
    const lat = ap?.lat ?? ref?.lat, lon = ap?.lon ?? ref?.lon, country = String(ap?.country || ref?.country || "US").toUpperCase();
    const [n, t, f] = await Promise.all([nasNow(), tafFor(icao), lat != null && lon != null ? forecastFor(icao, Number(lat), Number(lon)) : Promise.resolve(null)]);
    let abroad: LayoverToolsResp["abroad"] = null;
    if (!US_LIKE.has(country)) {
      const e = EMERGENCY[country];
      let countryName = e?.name || country;
      try { if (!e) countryName = new Intl.DisplayNames(["en"], { type: "region" }).of(country) || country; } catch { /* keep code */ }
      abroad = { country, countryName, police: e?.police || null, fire: e?.fire || null, ambulance: e?.ambulance || null, note: e?.note || null };
    }
    res.json({ on: true, icao, nas: n.events.filter((x) => x.icao === icao), nasUpdated: n.updated, taf: t, forecast: f, abroad } satisfies LayoverToolsResp);
  });

  app.get("/api/hotel-sheet", async (req, res) => {
    const u = await o.userOf(req);
    if (!(await allowed(u))) return res.json({ on: false, sheets: {} });
    const ids = String(req.query.ids || "").split(",").map(num).filter(Boolean);
    res.json({ on: true, sheets: await hotelSheets(ids) });
  });

  app.post("/api/hotel-sheet/:spotId", o.requireUser, async (req, res) => {
    const u = (req as any).user as User;
    if (!(await allowed(u))) return res.status(403).json({ message: "Not available yet" });
    const id = num(req.params.spotId);
    const s = (await rows(sql`SELECT id, category FROM spots WHERE id = ${id} AND status = 'live'`))[0];
    if (!s || s.category !== "stay") return res.status(404).json({ message: "Hotel not found" });
    const today = num((await rows(sql`SELECT COUNT(*)::int AS n FROM hotel_facts WHERE user_id = ${u.id} AND created_at > ${Date.now() - DAY}`))[0]?.n);
    if (today > 120) return res.status(429).json({ message: "That's a lot of updates today. Try again tomorrow." });
    const b = req.body || {}, now = Date.now(), add: [string, string][] = [];
    if (b.shuttlePhone !== undefined) {
      const p = clean(b.shuttlePhone, 24);
      if (p && !PHONE_RE.test(p)) return res.status(400).json({ message: "Check the shuttle phone number" });
      add.push(["shuttle_phone", p]);
    }
    if (b.shuttleNote !== undefined) add.push(["shuttle_note", clean(b.shuttleNote, 200)]);
    if (b.amenities && typeof b.amenities === "object") for (const [k, v] of Object.entries(b.amenities)) if (AMEN.has(k) && (v === "yes" || v === "no" || v === "")) add.push([k, String(v)]);
    if (b.confirm) add.push(["_confirm", "ok"]);
    if (!add.length) return res.status(400).json({ message: "Nothing to save" });
    for (const [f, v] of add) await db().execute(sql`INSERT INTO hotel_facts (spot_id, user_id, field, value, created_at) VALUES (${id}, ${u.id}, ${f}, ${v}, ${now})`);
    res.json({ sheet: (await hotelSheets([id]))[id] });
  });

  // ---------- delay alerts: every 10 minutes, push new NAS events at airports on members' trip sheets for today/tomorrow ----------
  const tick = async () => {
    const aud = await layoverTools.audience();
    const n = await nasNow(); if (!n.events.length) return;
    const byIcao = new Map<string, NasEvent[]>(); for (const e of n.events) { if (!byIcao.has(e.icao)) byIcao.set(e.icao, []); byIcao.get(e.icao)!.push(e); }
    const b = await rows(sql`SELECT id, user_id, title, stops FROM briefings WHERE updated_at > ${Date.now() - 45 * DAY}`);
    const day = (d: number) => new Date(d).toISOString().slice(0, 10);
    const near = new Set([day(Date.now() - DAY), day(Date.now()), day(Date.now() + DAY)]);
    for (const x of b) {
      const uid = num(x.user_id);
      if (aud !== "members" && !o.isSuperAdmin({ id: uid } as User)) continue;
      let stops: any[] = []; try { stops = JSON.parse(x.stops); } catch { continue; }
      for (const st of stops) {
        const evs = byIcao.get(String(st.icao || "").toUpperCase()); if (!evs || !st.arriveDate || !near.has(String(st.arriveDate))) continue;
        for (const e of evs) {
          const key = `${e.icao}:${e.kind}:${e.reason.slice(0, 60)}:${st.arriveDate}`;
          const ins = await rows(sql`INSERT INTO nas_alerts_sent (user_id, event_key, at) VALUES (${uid}, ${key}, ${Date.now()}) ON CONFLICT DO NOTHING RETURNING user_id`).catch(() => []);
          if (!ins.length) continue;
          void pushTo(uid, "delay_alert", { title: `${e.title} at ${e.icao}`, body: [e.detail, e.reason && e.kind !== "closure" ? `Reason: ${e.reason}` : "", `On your trip sheet${x.title ? ` "${x.title}"` : ""}.`].filter(Boolean).join(" · ").slice(0, 180), link: `/today?icao=${e.icao}`, tag: `nas-${e.icao}` });
        }
      }
    }
    await db().execute(sql`DELETE FROM nas_alerts_sent WHERE at < ${Date.now() - 14 * DAY}`).catch(() => {});
  };
  if (process.env.NODE_ENV === "production" || process.env.NAS_ALERTS === "1") {
    setTimeout(() => { void tick().catch(() => {}); setInterval(() => void tick().catch((e) => console.error("nas alerts", e)), 10 * 60_000); }, 60_000);
  }
}
