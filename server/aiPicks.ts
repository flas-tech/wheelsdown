// AI picks: places suggested by AI where crews haven't listed anything yet. Kept in their own table (ai_picks),
// so they never count as crew listings and never touch rankings. Labeled "AI pick" everywhere. The one link to points:
// the first crew member to rate a listing that was added from an AI pick earns a one-time +10 bonus (FIRST_RATE_BONUS).
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
import { CUISINES, cuisineLabel, cuisinesOf } from "@shared/cuisine";
import { PROGRAMS, programLabel, programOf, type ProgramId } from "@shared/loyalty";
import { logChange, recordWarn } from "./ops";

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
  sources: string; status: string; created_at: number; focus?: string; spot_id?: number | null;
};
/** Hotel rewards programs a member collects (Logbook setting); steers hotel picks. */
export async function programsOf(userId: number | null | undefined): Promise<ProgramId[]> {
  if (!userId) return [];
  try { const v = JSON.parse((await storage.getSetting(`programs:${userId}`)) || "[]"); return Array.isArray(v) ? v.filter((x) => PROGRAMS.some((p) => p.id === x)) : []; } catch { return []; }
}
const rowFoods = (r: Row) => Array.from(new Set([...(r.focus && r.focus !== "local" ? [r.focus] : []), ...cuisinesOf({ name: r.name, description: r.description, tags: r.tags })]));

export const FIRST_RATE_BONUS = 10;
/** A new crew listing that matches a live AI pick at the same airport "claims" it (explicitly via aiPickId, or by name). */
export async function claimAiPick(spot: { id: number; icao: string; category: string; name: string }, aiPickId?: number | null) {
  try {
    const rows = (await rowsFor(spot.icao)).filter((r) => r.category === spot.category && !r.spot_id);
    const hit = (aiPickId ? rows.find((r) => r.id === aiPickId && similarity({ name: r.name }, { name: spot.name, lat: null, lng: null }) >= 0.5) : undefined)
      || rows.find((r) => similarity({ name: r.name }, { name: spot.name, lat: null, lng: null }) >= 0.8);
    if (!hit) return;
    await db().execute(sql`UPDATE ai_picks SET spot_id = ${spot.id} WHERE id = ${hit.id} AND spot_id IS NULL`);
    await logChange({ kind: "ai", actor: "System", action: "claim AI pick", entity: "ai_pick", entityId: hit.id, summary: `AI pick "${hit.name}" at ${spot.icao} was added by a crew member as listing #${spot.id}` });
  } catch (e) { console.error("[ai-picks] claim:", String((e as any)?.message || e).slice(0, 200)); }
}
/**
 * Once a listing added from an AI pick is live and has its first live rating, that rater gets the one-time bonus
 * (normally the crew member who added it). Call whenever a listing or rating goes live; it only ever pays once.
 */
export async function checkFirstRate(spotId: number) {
  try {
    const pick = (await db().execute(sql`SELECT id, name, icao FROM ai_picks WHERE spot_id = ${spotId} AND bonus_user_id IS NULL LIMIT 1`)).rows[0] as any;
    if (!pick) return;
    const spot = await storage.getSpot(spotId);
    if (!spot || spot.status !== "live") return;
    await db().execute(sql`UPDATE ai_picks SET status = 'claimed' WHERE id = ${pick.id} AND status = 'live'`);
    const first = (await db().execute(sql`SELECT user_id FROM reviews WHERE spot_id = ${spotId} AND status = 'live' AND user_id IS NOT NULL ORDER BY created_at, id LIMIT 1`)).rows[0] as any;
    if (!first?.user_id) return;
    const won = (await db().execute(sql`UPDATE ai_picks SET bonus_user_id = ${first.user_id} WHERE id = ${pick.id} AND bonus_user_id IS NULL RETURNING id`)).rows.length;
    if (!won) return;
    await storage.grantBonus(first.user_id, FIRST_RATE_BONUS);
    await logChange({ kind: "points", actor: "System", actorId: first.user_id, action: "first-to-rate bonus", entity: "user", entityId: first.user_id,
      summary: `+${FIRST_RATE_BONUS} points to user #${first.user_id}: first to rate "${pick.name}" at ${pick.icao} (added from an AI pick, listing #${spotId})` });
  } catch (e) { console.error("[ai-picks] first-rate bonus:", String((e as any)?.message || e).slice(0, 200)); }
}
/** An AI pick shaped like a crew listing so cards, maps and the PDF can show it. Negative id = not a crew listing. */
export type AiPickCard = SpotWithStats & { ai: { meal: Meal | null; sources: string[]; createdAt: number; extra?: boolean; focus?: string; foods?: string[]; bonus?: number } };

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
  return (await db().execute(sql`SELECT id, icao, category, meal, name, address, website, description, cost_level, pace, minutes_needed, tags, lat, lng, miles, sources, status, created_at::float8 AS created_at, focus, spot_id
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
export type Focus = string; // "" (any), "local" (Surprise me: what the area is known for), or a food type id from shared/cuisine
const moreFocus = new Map<string, { focus: Focus; programs: string[] }>();
export async function findMore(icao: string, focus: Focus = "", programs: string[] = []): Promise<"pending" | "full" | "busy" | "off"> {
  if (!AI_ENABLED) return "off";
  if (running.has(icao) || queue.includes(icao) || running.has(icao + "+") || queue.includes(icao + "+")) return "pending";
  const n = Number(((await db().execute(sql`SELECT count(*)::int AS n FROM ai_picks WHERE icao = ${icao} AND status = 'live'`)).rows[0] as any)?.n || 0);
  if (n >= MAX_ROWS) return "full";
  const d = new Date().toISOString().slice(0, 10);
  if (d !== day) { day = d; today = 0; }
  if (today >= DAILY_CAP) return "busy";
  today++;
  moreFailed.delete(icao);
  moreFocus.set(icao, { focus: focus === "local" || CUISINES.some((c) => c.id === focus) ? focus : "", programs });
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
  if (!ap) { console.error(`[ai-picks] unknown airport ${icao}`); await setState(icao, "failed"); return; }
  const crew = await storage.searchSpots([ap.icao]);
  const existing = more ? await rowsFor(ap.icao) : [];
  const avoid = [...crew.map((s) => s.name), ...existing.map((r) => r.name)];
  // the model occasionally returns an empty or thin list; ask once more, a little harder, before giving up
  const mf = more ? moreFocus.get(icao) : undefined;
  const focusArg = mf?.focus === "local" ? { label: "local", local: true } : mf?.focus ? { label: cuisineLabel(mf.focus) } : null;
  const progs = (mf?.programs || []).map((p) => programLabel(p as ProgramId)).filter(Boolean);
  let drafts = await suggestAirportPicks(ap as any, avoid, "low", more, focusArg, progs);
  if (drafts.length < 6) {
    console.log(`[ai-picks] ${ap.icao}: only ${drafts.length} on the first try, retrying`);
    const again = await suggestAirportPicks(ap as any, avoid, "medium", more, focusArg, progs).catch(() => []);
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
  if (more && !keep.length) { moreFailed.set(ap.icao, Date.now()); console.log(`[ai-picks] ${ap.icao}+: nothing new`); void recordWarn("ai", `AI picks: find more at ${ap.icao} returned nothing new`); return; }
  if (!more && !keep.length) void recordWarn("ai", `AI picks: no picks found at ${ap.icao}`, `model returned ${drafts.length}`);
  if (!more) await db().execute(sql`UPDATE ai_picks SET status = 'replaced' WHERE icao = ${ap.icao} AND status = 'live'`);
  const now = Date.now();
  for (const k of keep) {
    await db().execute(sql`INSERT INTO ai_picks (icao, category, meal, name, address, website, description, cost_level, pace, minutes_needed, tags, lat, lng, miles, sources, status, created_at, focus)
      VALUES (${ap.icao}, ${k.category}, ${k.meal === "none" ? "" : k.meal}, ${k.name}, ${k.address}, ${k.website}, ${k.description}, ${k.costLevel}, ${k.pace}, ${k.minutesNeeded},
        ${JSON.stringify(k.tags)}, ${k.lat}, ${k.lng}, ${k.miles}, ${JSON.stringify(k.sources)}, 'live', ${now}, ${k.category === "eat" ? mf?.focus || "" : ""})`);
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
    ai: { meal: (r.meal || null) as Meal | null, sources: parse(r.sources), createdAt: Number(r.created_at), focus: r.focus || "", foods: r.category === "eat" ? rowFoods(r) : [], bonus: FIRST_RATE_BONUS },
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
export async function fillStop(icao: string, layover: LayoverId, nights: number | undefined, picks: SpotWithStats[], all: SpotWithStats[], airport?: any, useAi = true, aiAdd: number[] = [], programs: ProgramId[] = []): Promise<StopFill> {
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
  // hotels from the member's rewards programs come first
  const inProg = (r: Row) => (r.category === "stay" && programs.length && programs.includes(programOf(r) as ProgramId) ? 1 : 0);
  for (const sl of needAi) {
    const r = rows.filter((x) => !used.has(x.id) && slotMatches(sl, aiMealOf(x))).sort((a, b) =>
      // the exact meal first, then the closest
      (sl.meal ? Number(b.meal === sl.meal) - Number(a.meal === sl.meal) : 0) || inProg(b) - inProg(a) || byDistance(a, b))[0];
    if (r) { used.add(r.id); out.push(toCard(r, airport)); }
  }
  const order = new Map(aiAdd.map((x, k) => [x, k]));
  for (const r of [...added].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))) out.push({ ...toCard(r, airport), ai: { ...toCard(r).ai, extra: true } } as AiPickCard);
  const more = rows.filter((r) => !used.has(r.id)).sort((a, b) => (CAT_ORDER[a.category] - CAT_ORDER[b.category]) || inProg(b) - inProg(a) || byDistance(a, b)).map((r) => toCard(r, airport));
  const ms = moreStatus(icao);
  return { aiPicks: out, aiStatus: rows.length || added.length ? "ready" : status, aiSlots: needAi, aiMore: more, aiMoreStatus: ms === "idle" && rows.length >= MAX_ROWS ? "full" : ms };
}

export function registerAiPicks(app: Express, o: { requireAdmin: Mw; requireUser: Mw; userOf: (req: Request) => Promise<any> }) {
  storage.liveHooks.push((spotId) => { void checkFirstRate(spotId); });
  app.get("/api/me/programs", o.requireUser, async (req, res) => res.json({ programs: await programsOf((req as any).user.id) }));
  app.put("/api/me/programs", o.requireUser, async (req, res) => {
    const list = (Array.isArray(req.body?.programs) ? req.body.programs : []).filter((x: string) => PROGRAMS.some((p) => p.id === x));
    await storage.setSetting(`programs:${(req as any).user.id}`, JSON.stringify(Array.from(new Set(list))));
    res.json({ programs: list });
  });
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
    const foodQ = cat === "eat" ? String(req.query.food || "") : "";
    // with a food type chosen, AI can help when no crew listing of that type exists here
    const crew = (await storage.searchSpots([ap.icao])).filter((s) => s.category === cat && pickable(s) && (!foodQ || cuisinesOf(s).includes(foodQ)));
    if (crew.length) return res.json({ status: "crew", picks: [] });
    const status = await ensurePicks(ap.icao);
    const food = String(req.query.food || "");
    const progs = await programsOf((await o.userOf(req).catch(() => undefined))?.id);
    const prog = (r: Row) => (cat === "stay" && progs.includes(programOf(r) as ProgramId) ? 1 : 0);
    const all = (await rowsFor(ap.icao)).filter((r) => r.category === cat);
    const picks = all.filter((r) => !food || rowFoods(r).includes(food)).sort((a, b) => prog(b) - prog(a) || (a.miles ?? 99) - (b.miles ?? 99)).map((r) => toCard(r, ap));
    res.json({ status: all.length ? "ready" : status, picks, total: all.length, more: moreStatus(ap.icao) });
  });

  /** Brief owners: ask AI for more places at an airport (added alongside, nothing replaced). */
  app.post("/api/ai-picks/more", o.requireUser, async (req, res) => {
    const code = String(req.body?.icao || "");
    const ap = (await storage.resolveCode(code)) || refAirport(code);
    if (!ap) return res.status(400).json({ message: "Unknown airport" });
    const focus = String(req.body?.focus || "");
    res.json({ status: await findMore(ap.icao, focus, await programsOf((req as any).user.id)) });
  });

  // ---------- admin ----------
  app.get("/api/admin/ai-picks", o.requireAdmin, async (_req, res) => {
    const rows = (await db().execute(sql`SELECT id, icao, category, meal, name, address, website, description, miles, status, focus, spot_id AS "spotId", bonus_user_id AS "bonusUserId", created_at::float8 AS "createdAt"
      FROM ai_picks WHERE status IN ('live', 'hidden', 'claimed') ORDER BY icao, category, id LIMIT 2000`)).rows;
    const states = Object.fromEntries(((await db().execute(sql`SELECT key, value FROM app_settings WHERE key LIKE 'aipicks:%'`)).rows as any[]).map((r) => { try { return [r.key.slice(8), JSON.parse(r.value)]; } catch { return [r.key.slice(8), null]; } }));
    res.json({ enabled: AI_ENABLED, rows, states, cap: DAILY_CAP, usedToday: day === new Date().toISOString().slice(0, 10) ? today : 0 });
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
