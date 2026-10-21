/**
 * Trip workflow preview (Oct 2026 crew feedback): the four-tab bar (Home, Briefs, Spots, Crew), the Home trip card
 * (plan → find → add → rate), Crew Up from a briefing stop, and AI picks kept in a saved briefing becoming
 * "AI added" listings that show on the map, in search and in other briefings.
 *
 * Who sees it: app_settings trip_audience = admins (super-admins only) until it's switched to members from the admin
 * console. AI-added listings follow the same switch, on the server: until it's open, searches only include them for
 * super-admins, and only super-admins' saved briefings turn AI picks into listings.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import tzlookup from "tz-lookup";
import { db } from "./db";
import { storage } from "./storage";
import { logChange } from "./ops";
import { refAirport } from "./airportsData";
import type { Briefing, BriefingStop, User } from "@shared/schema";

type Audience = "admins" | "members";
let cache = { at: 0, v: "admins" as Audience };
export async function tripAudience(): Promise<Audience> {
  if (Date.now() - cache.at < 15_000) return cache.v;
  const r = ((await db().execute(sql`SELECT value FROM app_settings WHERE key = 'trip_audience'`).catch(() => ({ rows: [] }))).rows[0] as any);
  cache = { at: Date.now(), v: r?.value === "members" ? "members" : "admins" };
  return cache.v;
}

let isSuper: (u?: User | null) => boolean = () => false;
let userOfFn: (req: Request) => Promise<User | null | undefined> = async () => null;

/** Can this account see the preview, including AI-added listings? */
export async function tripOpenFor(u?: User | null) {
  if (u && isSuper(u)) return true;
  return !!u && (await tripAudience()) === "members";
}
/** For searches: include AI-added listings for this request? (Guests see them too once the preview is open.) */
export async function aiSpotsFor(req: Request) {
  if ((await tripAudience()) === "members") return true;
  try { return isSuper(await userOfFn(req)); } catch { return false; }
}
export async function aiSpotsForUser(userId: number) {
  if ((await tripAudience()) === "members") return true;
  return isSuper({ id: userId } as User);
}

const num = (v: unknown) => Number(v) || 0;

/**
 * After a briefing is saved: every AI pick shown in it (automatic or added by the owner, not quick drafts) becomes an
 * "AI added" listing, and the stop keeps it as a normal pick. Returns how many were added. Never throws.
 */
export async function promoteBriefAiPicks(b: Briefing, expanded: { stops: { aiPicks?: { id: number; ai?: { draft?: boolean } }[] }[] }) {
  try {
    if (!(await aiSpotsForUser(b.userId))) return 0;
    const stops = JSON.parse(b.stops || "[]") as BriefingStop[];
    let changed = 0;
    for (let i = 0; i < stops.length; i++) {
      const st = stops[i];
      const cards = (expanded.stops[i]?.aiPicks || []).filter((c) => c.id < 0 && !c.ai?.draft);
      for (const c of cards) {
        if ((st.picks || []).length >= 20) break;
        const pickId = -c.id;
        const row = (await db().execute(sql`SELECT * FROM ai_picks WHERE id = ${pickId}`)).rows[0] as any;
        if (!row || row.status === "hidden") continue;
        let spotId = num(row.spot_id);
        if (!spotId) {
          const s = await storage.createAiSpot({
            icao: row.icao, category: row.category, name: row.name, description: row.description || "", address: row.address || "", website: row.website || "",
            costLevel: row.cost_level ?? 1, minutesNeeded: row.minutes_needed ?? (row.category === "stay" ? 720 : 60), milesFromField: row.miles ?? 0,
            crewTip: "", tags: row.tags || "[]", submittedBy: "AI pick", userId: null, status: "live", pace: row.pace ?? null, lat: row.lat ?? null, lng: row.lng ?? null, placeRef: null,
          } as any);
          spotId = s.id;
          await db().execute(sql`UPDATE ai_picks SET spot_id = ${spotId}, status = 'claimed' WHERE id = ${pickId} AND spot_id IS NULL`);
          await logChange({ kind: "ai", actor: "System", action: "AI pick kept in a briefing", entity: "spot", entityId: spotId,
            summary: `AI pick "${row.name}" at ${row.icao} became AI-added listing #${spotId} (briefing #${b.id})` });
        }
        st.picks = Array.from(new Set([...(st.picks || []), spotId]));
        if (st.aiAdd) st.aiAdd = st.aiAdd.filter((x) => x !== pickId);
        if (st.order) st.order = st.order.map((x) => (x === -pickId ? spotId : x));
        changed++;
      }
    }
    if (changed) await storage.saveBriefing(b.userId, { title: b.title, stops }, b.id);
    return changed;
  } catch (e) {
    console.error("[trip] promote AI picks:", String((e as any)?.message || e).slice(0, 200));
    return 0;
  }
}

const tzOf = (icao: string) => { const a = refAirport(icao) as any; try { return a?.lat != null ? tzlookup(a.lat, a.lon) : null; } catch { return null; } };
const localDay = (tz: string | null, t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: tz || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);
const lastDay = (st: BriefingStop) => {
  if (!st.arriveDate) return null;
  const n = st.layover === "multi" ? Math.max(1, st.nights || 2) : st.layover === "overnight" ? 1 : 0;
  const d = new Date(`${st.arriveDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export type TripStop = {
  briefId: number; title: string; stopIndex: number; icao: string; place: string; arriveDate: string | null; arriveTime: string | null;
  layover: string; nights: number | null; when: "upcoming" | "now" | "past" | "undated";
  steps: { picks: number; aiOn: boolean; added: boolean; rated: number; toRate: number[] };
};

export function registerTrip(app: Express, o: { userOf: (req: Request) => Promise<User | null | undefined>; isSuperAdmin: (u?: User | null) => boolean; requireAdmin: (req: Request, res: Response, next: NextFunction) => any; requireUser: (req: Request, res: Response, next: NextFunction) => any }) {
  isSuper = o.isSuperAdmin; userOfFn = o.userOf;
  void db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('trip_audience', 'admins') ON CONFLICT (key) DO NOTHING`).catch(() => {});

  /** Home trip card: your next layover from your briefings, where you are in plan → find → add → rate, and the last trip to rate. */
  app.get("/api/preview/trip", o.requireUser, async (req, res) => {
    const u = (req as any).user as User;
    if (!(await tripOpenFor(u))) return res.status(404).json({ message: "Not found" });
    const briefs = await storage.listBriefings(u.id);
    const all: TripStop[] = [];
    const reviewed = new Set(((await db().execute(sql`SELECT spot_id FROM reviews WHERE user_id = ${u.id}`)).rows as any[]).map((r) => num(r.spot_id)));
    const mineAt = new Set(((await db().execute(sql`SELECT DISTINCT icao FROM spots WHERE user_id = ${u.id} AND status = 'live'`)).rows as any[]).map((r) => String(r.icao)));
    for (const b of briefs) {
      const stops = JSON.parse(b.stops || "[]") as BriefingStop[];
      stops.forEach((st, i) => {
        const tz = tzOf(st.icao), today = localDay(tz);
        const end = lastDay(st);
        const when: TripStop["when"] = !st.arriveDate ? "undated" : st.arriveDate > today ? "upcoming" : end && end >= today ? "now" : "past";
        const ap = refAirport(st.icao) as any;
        const picks = st.picks || [];
        all.push({
          briefId: b.id, title: b.title || "", stopIndex: i, icao: st.icao, place: ap ? `${ap.city || ap.name}${ap.region ? `, ${ap.region}` : ""}` : st.icao,
          arriveDate: st.arriveDate || null, arriveTime: st.arriveTime || null, layover: st.layover, nights: st.nights ?? null, when,
          steps: { picks: picks.length + (st.aiAdd?.length || 0), aiOn: !!st.ai, added: mineAt.has(st.icao), rated: picks.filter((p) => reviewed.has(p)).length, toRate: picks.filter((p) => !reviewed.has(p)) },
        });
      });
    }
    // Coming up: on now, then dated stops by date, then stops without a date in the order they were planned (oldest brief first, stop order)
    const rank = (x: TripStop) => (x.when === "now" ? 0 : x.when === "upcoming" ? 1 : 2);
    const order = new Map(briefs.map((b) => [b.id, b.createdAt]));
    const coming = all.filter((x) => x.when !== "past").sort((a, z) => rank(a) - rank(z)
      || (a.arriveDate && z.arriveDate ? a.arriveDate.localeCompare(z.arriveDate) : 0)
      || num(order.get(a.briefId)) - num(order.get(z.briefId)) || a.stopIndex - z.stopIndex).slice(0, 12);
    // to rate: the most recent finished trip in the last 3 weeks with places you haven't rated
    const cutoff = new Date(Date.now() - 21 * 86400_000).toISOString().slice(0, 10);
    const rate = all.filter((s) => s.when === "past" && s.arriveDate! >= cutoff && s.steps.toRate.length).sort((a, z) => z.arriveDate!.localeCompare(a.arriveDate!))[0] || null;
    res.set("Cache-Control", "no-store").json({ coming, rate, briefCount: briefs.length });
  });

  app.get("/api/admin/trip", o.requireAdmin, async (_req, res) => {
    const n = (await db().execute(sql`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE id IN (SELECT spot_id FROM reviews WHERE status = 'live'))::int AS rated FROM spots WHERE source = 'ai' AND status = 'live'`)).rows[0] as any;
    res.json({ audience: await tripAudience(), aiSpots: num(n?.n), aiRated: num(n?.rated) });
  });
  app.put("/api/admin/trip", o.requireAdmin, async (req, res) => {
    const v: Audience = req.body?.audience === "members" ? "members" : "admins";
    await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('trip_audience', ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    cache = { at: Date.now(), v };
    await logChange({ actor: (req as any).adminName || "Admin", kind: "admin", action: "trip_audience", entity: "settings",
      summary: v === "members" ? "New navigation, Home trip card and AI-added listings opened to members" : "New navigation and AI-added listings back to admins only" });
    res.json({ audience: v });
  });
}
