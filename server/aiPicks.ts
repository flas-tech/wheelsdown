// AI picks: places suggested by AI where crews haven't listed anything yet. Kept in their own table (ai_picks),
// so they never count as crew listings, never earn points and never touch rankings. Labeled "AI pick" everywhere.
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { AI_ENABLED, suggestAirportPicks } from "./ai";
import { geocodeAddress } from "./places";
import { refAirport } from "./airportsData";
import { milesBetween } from "@shared/cost";
import { similarity } from "@shared/similar";
import { pickable, slotsFor, unmetSlots, slotMatches, type Meal, type Slot } from "@shared/briefing";
import type { LayoverId, SpotWithStats } from "@shared/schema";

type Mw = (req: Request, res: Response, next: NextFunction) => unknown;
export type AiStatus = "ready" | "pending" | "off" | "failed" | "none" | "offer";
export type AiPref = "crew" | "ai";
/** A member's choice: "crew" (default) = AI picks only when asked, "ai" = fill gaps automatically. */
export async function aiPrefOf(userId: number): Promise<AiPref> {
  return (await storage.getSetting(`aipref:${userId}`)) === "ai" ? "ai" : "crew";
}
type Row = {
  id: number; icao: string; category: "eat" | "do" | "stay"; meal: string; name: string; address: string; website: string; description: string;
  cost_level: number | null; pace: string | null; minutes_needed: number | null; tags: string; lat: number | null; lng: number | null; miles: number | null;
  sources: string; status: string; created_at: number;
};
/** An AI pick shaped like a crew listing so cards, maps and the PDF can show it. Negative id = not a crew listing. */
export type AiPickCard = SpotWithStats & { ai: { meal: Meal | null; sources: string[]; createdAt: number; extra?: boolean } };

const FRESH_MS = 120 * 86400_000; // regenerate an airport's picks after ~4 months
const RETRY_MS = 2 * 60_000; // after a failure, a new request may try again shortly
const DAILY_CAP = Number(process.env.AI_PICKS_DAILY || 40); // airports per day
const MAX_MILES = 30;

const running = new Map<string, Promise<void>>();
const queue: string[] = [];
let active = 0;
let day = "", today = 0;

async function runState(icao: string): Promise<{ status: AiStatus; at: number } | null> {
  const v = await storage.getSetting(`aipicks:${icao}`);
  try { return v ? JSON.parse(v) : null; } catch { return null; }
}
const setState = (icao: string, status: AiStatus) => storage.setSetting(`aipicks:${icao}`, JSON.stringify({ status, at: Date.now() }));

export async function rowsFor(icao: string): Promise<Row[]> {
  return (await db().execute(sql`SELECT id, icao, category, meal, name, address, website, description, cost_level, pace, minutes_needed, tags, lat, lng, miles, sources, status, created_at::float8 AS created_at
    FROM ai_picks WHERE icao = ${icao} AND status = 'live' ORDER BY id`)).rows as any;
}

/** Status for an airport, starting a background run if it has never been done (or is stale) and the daily cap allows. */
export async function ensurePicks(icao: string): Promise<AiStatus> {
  if (!AI_ENABLED) return "off";
  if (running.has(icao) || queue.includes(icao) || running.has(icao + "+") || queue.includes(icao + "+")) return "pending";
  const st = await runState(icao);
  if (st?.status === "ready" && Date.now() - st.at < FRESH_MS) return "ready";
  if (st?.status === "failed" && Date.now() - st.at < RETRY_MS) return "failed";
  if (st?.status === "pending" && Date.now() - st.at < 10 * 60_000) return "pending"; // another server instance is on it
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; today = 0; }
  if (today >= DAILY_CAP) return st?.status === "ready" ? "ready" : "none";
  today++;
  await setState(icao, "pending");
  queue.push(icao);
  pump();
  return "pending";
}

const MAX_ROWS = 45; // per airport, so "find more" can't grow without limit
const moreFailed = new Map<string, number>();
/** "Find more places": a second AI run that adds new picks without replacing the ones crews may already have added. */
export async function findMore(icao: string): Promise<"pending" | "full" | "busy" | "off"> {
  if (!AI_ENABLED) return "off";
  if (running.has(icao) || queue.includes(icao) || running.has(icao + "+") || queue.includes(icao + "+")) return "pending";
  const n = Number(((await db().execute(sql`SELECT count(*)::int AS n FROM ai_picks WHERE icao = ${icao} AND status = 'live'`)).rows[0] as any)?.n || 0);
  if (n >= MAX_ROWS) return "full";
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; today = 0; }
  if (today >= DAILY_CAP) return "busy";
  today++;
  moreFailed.delete(icao);
  queue.push(icao + "+");
  pump();
  return "pending";
}
export const moreStatus = (icao: string) => (running.has(icao + "+") || queue.includes(icao + "+") ? "pending" : moreFailed.has(icao) ? "failed" : "idle");

function pump() {
  while (active < 2 && queue.length) {
    const key = queue.shift()!;
    const more = key.endsWith("+"), icao = key.replace("+", "");
    active++;
    const p = generate(icao, more).catch(async (e) => {
      console.error(`[ai-picks] ${key}:`, String(e?.message || e).slice(0, 200));
      if (more) moreFailed.set(icao, Date.now()); else await setState(icao, "failed");
    }).finally(() => { active--; running.delete(key); pump(); });
    running.set(key, p);
  }
}

async function generate(icao: string, more = false) {
  // airports from the reference list (no listings yet) aren't in the airports table
  const ap = (await storage.resolveCode(icao)) || refAirport(icao);
  if (!ap) { console.error(`[ai-picks] ${icao}: unknown airport`); await setState(icao, "failed"); return; }
  const crew = await storage.searchSpots([ap.icao]);
  const existing = more ? await rowsFor(ap.icao) : [];
  const avoid = [...crew.map((s) => s.name), ...existing.map((r) => r.name)];
  // the model occasionally returns an empty or thin list; ask once more, a little harder, before giving up
  let drafts = await suggestAirportPicks(ap as any, avoid, "low", more);
  if (drafts.length < 6) {
    console.log(`[ai-picks] ${ap.icao}: only ${drafts.length} on the first try, retrying`);
    const again = await suggestAirportPicks(ap as any, avoid, "medium", more).catch(() => []);
    if (again.length > drafts.length) drafts = again;
  }
  const near = ap.lat != null && ap.lon != null ? { lat: ap.lat, lng: ap.lon } : null;
  const keep: (typeof drafts[number] & { lat: number | null; lng: number | null; miles: number | null })[] = [];
  for (const d of drafts) {
    // drop anything crews already listed, and anything we can't place near the field
    if (crew.some((c) => similarity({ name: d.name }, c) >= 0.8)) continue;
    if (existing.some((r) => similarity({ name: d.name }, { name: r.name, lat: null, lng: null }) >= 0.85)) continue;
    if (keep.some((k) => similarity({ name: d.name }, { name: k.name, lat: null, lng: null }) >= 0.85)) continue;
    let lat: number | null = null, lng: number | null = null, miles: number | null = null;
    if (near) {
      const g = await geocodeAddress(d.address, near, MAX_MILES).catch(() => null);
      if (g) { lat = g.lat; lng = g.lng; miles = Math.round(milesBetween({ lat: near.lat, lon: near.lng }, { lat: g.lat, lon: g.lng }) * 10) / 10; }
    }
    keep.push({ ...d, lat, lng, miles });
  }
  if (more && !keep.length) { moreFailed.set(ap.icao, Date.now()); console.log(`[ai-picks] ${ap.icao}+: nothing new`); return; }
  if (!more) await db().execute(sql`UPDATE ai_picks SET status = 'replaced' WHERE icao = ${ap.icao} AND status = 'live'`);
  const now = Date.now();
  for (const k of keep) {
    await db().execute(sql`INSERT INTO ai_picks (icao, category, meal, name, address, website, description, cost_level, pace, minutes_needed, tags, lat, lng, miles, sources, status, created_at)
      VALUES (${ap.icao}, ${k.category}, ${k.meal === "none" ? "" : k.meal}, ${k.name}, ${k.address}, ${k.website}, ${k.description}, ${k.costLevel}, ${k.pace}, ${k.minutesNeeded},
        ${JSON.stringify(k.tags)}, ${k.lat}, ${k.lng}, ${k.miles}, ${JSON.stringify(k.sources)}, 'live', ${now})`);
  }
  if (!more) await setState(ap.icao, keep.length ? "ready" : "failed");
  console.log(`[ai-picks] ${ap.icao}${more ? "+" : ""}: ${keep.length} of ${drafts.length} kept`);
}

export function toCard(r: Row, airport?: any): AiPickCard {
  const parse = (t: string) => { try { return JSON.parse(t); } catch { return []; } };
  return {
    id: -r.id, icao: r.icao, category: r.category, name: r.name, description: r.description, address: r.address, website: r.website,
    costLevel: r.cost_level ?? 1, minutesNeeded: r.minutes_needed ?? (r.category === "stay" ? 720 : 60), milesFromField: r.miles ?? null,
    crewTip: "", tags: r.tags, submittedBy: "AI pick", userId: null, status: "live", createdAt: Number(r.created_at), pace: r.pace, lat: r.lat, lng: r.lng,
    placeRef: null, modState: "", modNote: "", modAttempts: 0, pendingEdit: null,
    avgRating: null, reviewCount: 0, airport, vet: { up: 0, down: 0, score: 0, level: "new", lastUpAt: null, reasons: {}, myVote: 0 },
    cost: r.cost_level, costVotes: 0, goArounds: 0,
    ai: { meal: (r.meal || null) as Meal | null, sources: parse(r.sources), createdAt: Number(r.created_at) },
  } as AiPickCard;
}
const aiMealOf = (r: Row) => ({ category: r.category, name: r.name, description: r.description, tags: r.tags, pace: r.pace, meal: (r.meal || null) as Meal | null });

export type StopFill = { aiPicks: AiPickCard[]; aiStatus: AiStatus; aiSlots: Slot[]; aiMore: AiPickCard[]; aiMoreStatus: "pending" | "failed" | "idle" | "full" };
const CAT_ORDER: Record<string, number> = { eat: 0, do: 1, stay: 2 };
/**
 * AI picks that fill a briefing stop's open slots. A slot is only filled by AI when no crew listing at the airport could
 * fill it (if crews have one and it was removed from the plan, it stays removed). aiAdd are extra AI picks the owner chose
 * with "Pick more"; aiMore lists the other AI picks at the airport they can still add.
 */
export async function fillStop(icao: string, layover: LayoverId, nights: number | undefined, picks: SpotWithStats[], all: SpotWithStats[], airport?: any, useAi = true, aiAdd: number[] = []): Promise<StopFill> {
  const empty = { aiMore: [], aiMoreStatus: "idle" as const };
  const open = unmetSlots(slotsFor(layover, nights), picks);
  const crewOk = all.filter((s) => pickable(s) && (s.milesFromField ?? 0) <= MAX_MILES && !picks.some((p) => p.id === s.id));
  const needAi = open.filter((sl) => !crewOk.some((s) => slotMatches(sl, s)));
  if (!useAi) return { aiPicks: [], aiStatus: needAi.length ? (AI_ENABLED ? "offer" : "off") : "none", aiSlots: needAi, ...empty };
  if (!needAi.length && !aiAdd.length) return { aiPicks: [], aiStatus: "none", aiSlots: [], ...empty };
  const status = await ensurePicks(icao);
  const rows = (await rowsFor(icao)).filter((r) => !all.some((c) => similarity({ name: r.name }, c) >= 0.8));
  // extras the owner added stay put even after the airport's picks are refreshed (unless an admin hid them)
  const added = aiAdd.length ? ((await db().execute(sql`SELECT id, icao, category, meal, name, address, website, description, cost_level, pace, minutes_needed, tags, lat, lng, miles, sources, status, created_at::float8 AS created_at
    FROM ai_picks WHERE id IN (${sql.join(aiAdd.map((x) => sql`${x}`), sql`, `)}) AND icao = ${icao} AND status <> 'hidden'`)).rows as any as Row[]) : [];
  const used = new Set<number>(added.map((r) => r.id)); // extras are on top of the automatic picks, never instead of them
  const out: AiPickCard[] = [];
  const byDistance = (a: Row, b: Row) => (a.miles ?? 99) - (b.miles ?? 99);
  for (const sl of needAi) {
    const r = rows.filter((x) => !used.has(x.id) && slotMatches(sl, aiMealOf(x))).sort((a, b) =>
      // the exact meal first, then the closest
      (sl.meal ? Number(b.meal === sl.meal) - Number(a.meal === sl.meal) : 0) || byDistance(a, b))[0];
    if (r) { used.add(r.id); out.push(toCard(r, airport)); }
  }
  const order = new Map(aiAdd.map((x, k) => [x, k]));
  for (const r of [...added].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))) out.push({ ...toCard(r, airport), ai: { ...toCard(r).ai, extra: true } } as AiPickCard);
  const more = rows.filter((r) => !used.has(r.id)).sort((a, b) => (CAT_ORDER[a.category] - CAT_ORDER[b.category]) || byDistance(a, b)).map((r) => toCard(r, airport));
  const ms = moreStatus(icao);
  return { aiPicks: out, aiStatus: rows.length || added.length ? "ready" : status, aiSlots: needAi, aiMore: more, aiMoreStatus: ms === "idle" && rows.length >= MAX_ROWS ? "full" : ms };
}

export function registerAiPicks(app: Express, o: { requireAdmin: Mw; requireUser: Mw }) {
  app.get("/api/me/ai-pref", o.requireUser, async (req, res) => res.json({ pref: await aiPrefOf((req as any).user.id) }));
  app.put("/api/me/ai-pref", o.requireUser, async (req, res) => {
    const pref: AiPref = req.body?.pref === "ai" ? "ai" : "crew";
    await storage.setSetting(`aipref:${(req as any).user.id}`, pref);
    res.json({ pref });
  });
  /** Search fallback: AI picks for one airport and category, only when crews have nothing there in that category. */
  app.get("/api/ai-picks", async (req, res) => {
    const code = String(req.query.icao || "");
    const ap = (await storage.resolveCode(code)) || refAirport(code);
    const cat = String(req.query.cat || "");
    if (!ap || !["eat", "do", "stay"].includes(cat)) return res.status(400).json({ message: "icao and cat (eat, do, stay) required" });
    const crew = (await storage.searchSpots([ap.icao])).filter((s) => s.category === cat && pickable(s));
    if (crew.length) return res.json({ status: "crew", picks: [] });
    const status = await ensurePicks(ap.icao);
    const picks = (await rowsFor(ap.icao)).filter((r) => r.category === cat).sort((a, b) => (a.miles ?? 99) - (b.miles ?? 99)).map((r) => toCard(r, ap));
    res.json({ status: picks.length ? "ready" : status, picks });
  });

  /** Brief owners: ask AI for more places at an airport (added alongside, nothing replaced). */
  app.post("/api/ai-picks/more", o.requireUser, async (req, res) => {
    const code = String(req.body?.icao || "");
    const ap = (await storage.resolveCode(code)) || refAirport(code);
    if (!ap) return res.status(400).json({ message: "Unknown airport" });
    res.json({ status: await findMore(ap.icao) });
  });

  // ---------- admin ----------
  app.get("/api/admin/ai-picks", o.requireAdmin, async (_req, res) => {
    const rows = (await db().execute(sql`SELECT id, icao, category, meal, name, address, website, miles, status, created_at::float8 AS "createdAt"
      FROM ai_picks WHERE status IN ('live', 'hidden') ORDER BY icao, category, id LIMIT 600`)).rows;
    res.json({ enabled: AI_ENABLED, rows });
  });
  app.post("/api/admin/ai-picks/:id/hide", o.requireAdmin, async (req, res) => {
    const hide = req.body?.hidden !== false;
    await db().execute(sql`UPDATE ai_picks SET status = ${hide ? "hidden" : "live"} WHERE id = ${Number(req.params.id)}`);
    res.json({ ok: true });
  });
  app.post("/api/admin/ai-picks/refresh", o.requireAdmin, async (req, res) => {
    const code = String(req.body?.icao || "");
    const ap = (await storage.resolveCode(code)) || refAirport(code);
    if (!ap) return res.status(400).json({ message: "Unknown airport" });
    await storage.setSetting(`aipicks:${ap.icao}`, "");
    res.json({ status: await ensurePicks(ap.icao) });
  });
}
