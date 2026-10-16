// AI picks: places suggested by AI where crews haven't listed anything yet. Kept in their own table (ai_picks),
// so they never count as crew listings and never touch rankings. Labeled "AI pick" everywhere. The one link to points:
// the first crew member to rate a listing that was added from an AI pick earns a one-time +10 bonus (FIRST_RATE_BONUS).
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { AI_ENABLED, suggestAirportPicks, rankCandidates, type RankedDraft } from "./ai";
import { osmCandidates, draftDescription, type Candidate, type OsmCat } from "./osm";
import { geocodeAddress } from "./places";
import { refAirport } from "./airportsData";
import { milesBetween } from "@shared/cost";
import { similarity } from "@shared/similar";
import { pickable, slotsFor, unmetSlots, slotMatches, type Meal, type Slot } from "@shared/briefing";
import { isFocus, focusCategory, focusLabel, matchesFocus } from "@shared/focus";
import { activitiesOf, ACTIVITIES } from "@shared/activities";
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
  sources: string; status: string; created_at: number; focus?: string; spot_id?: number | null; draft?: boolean;
};
/** Hotel rewards programs a member collects (Logbook setting); steers hotel picks. */
export async function programsOf(userId: number | null | undefined): Promise<ProgramId[]> {
  if (!userId) return [];
  try { const v = JSON.parse((await storage.getSetting(`programs:${userId}`)) || "[]"); return Array.isArray(v) ? v.filter((x) => PROGRAMS.some((p) => p.id === x)) : []; } catch { return []; }
}
const rowActs = (r: Row) => Array.from(new Set([...(r.focus?.startsWith("act:") ? [r.focus.slice(4)] : []), ...activitiesOf({ name: r.name, description: r.description, tags: r.tags })]));
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
/** slot: the briefing gap an automatic pick fills; focus: what the member asked for when it was found. */
export type AiPickCard = SpotWithStats & { ai: { meal: Meal | null; sources: string[]; createdAt: number; draft?: boolean; extra?: boolean; focus?: string; foods?: string[]; acts?: string[]; bonus?: number; slot?: Slot } };

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
  return (await db().execute(sql`SELECT id, icao, category, meal, name, address, website, description, cost_level, pace, minutes_needed, tags, lat, lng, miles, sources, status, created_at::float8 AS created_at, focus, spot_id, draft
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
  moreFocus.set(icao, { focus: isFocus(focus) ? focus : "", programs });
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

type Want = { eat?: number; do?: number; stay?: number };
/** How many of each category a run asks for. A category or type focus asks for that only. */
function wantFor(more: boolean, f: string, fc: OsmCat | null): Want {
  if (fc === "stay") return { stay: 8 };
  if (fc) return { [fc]: 10 } as Want;
  if (f === "local") return { eat: 8, do: 4 };
  return more ? { eat: 8, do: 4, stay: 1 } : { eat: 8, do: 5, stay: 2 };
}
function askFor(more: boolean, f: string, fc: OsmCat | null, label: string): string {
  if (f === "local") return "The crew asked to be surprised: favor what this area is known for, its signature local dishes and the places famous for them, long-running local institutions and attractions locals are proud of. Say in the description why it is a local favorite. Avoid national chains.";
  if (fc && f !== fc) return `The crew wants ${label}${fc === "eat" ? " food" : ""}: every pick must be ${label}${fc === "eat" ? " food" : ""}. If fewer good ones exist, return fewer rather than off-topic places.`;
  if (fc === "stay") return "The crew wants hotels crews use near the field.";
  if (fc === "do") return "The crew wants things to do: a mix of quick (under 2 hours) and longer options, ideally reachable without a car.";
  if (fc === "eat") return "The crew wants food across breakfast, lunch and dinner.";
  return `Eat: about 2 breakfast, 3 lunch and 3 dinner. Do: parks, museums, historic sites, walks, breweries, local attractions, a mix of quick and longer.${more ? " These are MORE options: the places already listed are known." : ""}`;
}
const draftMeal = (c: Candidate) => /café|bakery|pastry|coffee|donut|bagel|breakfast/i.test(`${c.kind} ${c.cuisine}`) ? "breakfast" : /fast food|sandwich|deli|food court/i.test(c.kind + " " + c.cuisine) ? "lunch" : "dinner";
const draftPace = (c: Candidate) => /fast food|café|ice cream|bakery|food court/i.test(c.kind) ? "grab" : "sit";

async function generate(icao: string, more = false) {
  const t0 = Date.now();
  // airports from the reference list (no listings yet) aren't in the airports table
  const ap = (await storage.resolveCode(icao)) || refAirport(icao);
  if (!ap) { console.error(`[ai-picks] unknown airport ${icao}`); await setState(icao, "failed"); return; }
  const crew = await storage.searchSpots([ap.icao]);
  const existing = more ? await rowsFor(ap.icao) : [];
  const avoid = [...crew.map((s) => s.name), ...existing.map((r) => r.name)];
  const mf = more ? moreFocus.get(icao) : undefined;
  const f = mf?.focus || "";
  const fc = focusCategory(f);
  const focusArg = f === "local" ? { label: "local", local: true } : f ? { label: focusLabel(f), cat: fc, kind: (f === fc ? "category" : fc === "do" ? "activity" : "food") as "category" | "activity" | "food" } : null;
  const progs = (mf?.programs || []).map((p) => programLabel(p as ProgramId)).filter(Boolean);
  const focusTag = (cat: string) => (f && (fc === null || fc === cat) ? f : "");
  const near = ap.lat != null && ap.lon != null ? { lat: ap.lat, lng: ap.lon } : null;
  const known = (name: string, lat: number | null, lng: number | null) =>
    crew.some((c) => similarity({ name, lat, lng }, c) >= 0.8) || existing.some((r) => similarity({ name }, { name: r.name, lat: null, lng: null }) >= 0.85);

  // 1. real places from OpenStreetMap, per category asked for
  const want = wantFor(more, f, fc);
  const cats = (Object.keys(want) as OsmCat[]).filter((c) => (want[c] || 0) > 0);
  let cands: Candidate[] = [];
  if (near) {
    const lists = await osmCandidates({ lat: near.lat, lon: near.lng }, cats.map((c) => ({ category: c, focus: fc === c ? f : "" })), { eat: 40, do: 40, stay: 15 })
      .catch((e) => { console.log(`[ai-picks] ${ap.icao}: OpenStreetMap failed: ${String(e?.message || e).slice(0, 120)}`); return [] as Candidate[]; });
    cands = lists.filter((c) => !known(c.name, c.lat, c.lng));
  }
  console.log(`[ai-picks] ${ap.icao}${more ? "+" : ""}: ${cands.length} OpenStreetMap candidates in ${Date.now() - t0} ms`);

  // 2. show the best few right away as drafts, so the search isn't empty while AI works
  const drafts = new Map<string, number>(); // ref -> ai_picks id
  const now0 = Date.now();
  for (const c of cats) {
    for (const d of cands.filter((x) => x.category === c).slice(0, Math.min(want[c] || 0, c === "stay" ? 3 : 6))) {
      const r = (await db().execute(sql`INSERT INTO ai_picks (icao, category, meal, name, address, website, description, cost_level, pace, minutes_needed, tags, lat, lng, miles, sources, status, created_at, focus, draft)
        VALUES (${ap.icao}, ${c}, ${c === "eat" ? draftMeal(d) : ""}, ${d.name}, ${d.address}, ${d.website}, ${draftDescription(d)}, ${null}, ${c === "eat" ? draftPace(d) : null}, ${c === "do" ? 90 : null},
          ${JSON.stringify(d.cuisine ? [d.cuisine.toLowerCase()] : [])}, ${d.lat}, ${d.lng}, ${d.miles}, ${JSON.stringify([d.osmUrl, ...(d.website ? [d.website] : [])])}, 'live', ${now0}, ${focusTag(c)}, true) RETURNING id`)).rows[0] as any;
      drafts.set(d.ref, Number(r.id));
    }
  }

  // 3. AI picks and describes from the real list; the old web-search-only run is the fallback
  let picks: RankedDraft[] = [];
  const total = cats.reduce((n, c) => n + (want[c] || 0), 0);
  if (cands.length >= Math.min(6, total)) {
    try {
      const sent = cats.flatMap((c) => cands.filter((x) => x.category === c).slice(0, c === "eat" ? 40 : c === "do" ? 30 : 15));
      const list = sent.map(({ ref, category, name, kind, cuisine, miles, address, website, hours, brand, wiki }) => ({ ref, category, name, kind, cuisine, miles, address, website, hours, brand, wiki }));
      const ask = askFor(more, f, fc, focusArg?.label || "");
      picks = await rankCandidates(ap as any, list, want, ask, avoid, progs).catch(() => []);
      if (!picks.length) picks = await rankCandidates(ap as any, list, want, ask, avoid, progs, false); // one quick retry from the list alone
    } catch (e: any) { console.log(`[ai-picks] ${ap.icao}: ranking failed: ${String(e?.message || e).slice(0, 160)}`); }
  }
  if (!picks.length) {
    console.log(`[ai-picks] ${ap.icao}${more ? "+" : ""}: falling back to web search`);
    try { picks = (await suggestAirportPicks(ap as any, avoid, "low", more, focusArg, progs)).map((p) => ({ ...p, ref: "" })); }
    catch (e: any) { console.log(`[ai-picks] ${ap.icao}: web search failed: ${String(e?.message || e).slice(0, 160)}`); }
  }
  if (fc) picks = picks.filter((p) => p.category === fc); // a category or type search returns only that category

  // 4. place each pick: OpenStreetMap coordinates when it came from the list, otherwise look the address up (in parallel)
  type Keep = RankedDraft & { lat: number | null; lng: number | null; miles: number | null; cand?: Candidate };
  const keep: Keep[] = [];
  for (const p of picks) {
    const cand = cands.find((c) => c.ref === p.ref) || cands.find((c) => similarity({ name: p.name }, { name: c.name, lat: null, lng: null }) >= 0.9);
    if (known(p.name, cand?.lat ?? null, cand?.lng ?? null)) continue;
    if (keep.some((k) => (cand && k.cand?.ref === cand.ref) || similarity({ name: p.name }, { name: k.name, lat: null, lng: null }) >= 0.85)) continue;
    if (!cand && !/\d/.test(p.address)) continue; // off-list picks need a real street address
    keep.push({ ...p, ref: cand?.ref || "", address: p.address || cand?.address || "", website: p.website || cand?.website || "",
      sources: Array.from(new Set([...(cand ? [cand.osmUrl] : []), ...p.sources])).slice(0, 5), lat: cand?.lat ?? null, lng: cand?.lng ?? null, miles: cand?.miles ?? null, cand });
  }
  if (near) await Promise.all(keep.filter((k) => k.lat == null).map(async (k) => {
    const g = await geocodeAddress(k.address, near, MAX_MILES).catch(() => null);
    if (g) { k.lat = g.lat; k.lng = g.lng; k.miles = Math.round(milesBetween({ lat: near.lat, lon: near.lng }, { lat: g.lat, lon: g.lng }) * 10) / 10; }
  }));

  // 5. save: AI-checked picks replace drafts; drafts AI didn't choose are dropped (kept only if AI found nothing at all)
  const draftIds = Array.from(drafts.values());
  const notDrafts = draftIds.length ? sql`AND id NOT IN (${sql.join(draftIds.map((i) => sql`${i}`), sql`, `)})` : sql``;
  if (!more && keep.length) await db().execute(sql`UPDATE ai_picks SET status = 'replaced' WHERE icao = ${ap.icao} AND status = 'live' ${notDrafts}`);
  const now = Date.now();
  const used = new Set<number>();
  for (const k of keep) {
    const id = k.ref ? drafts.get(k.ref) : undefined;
    const meal = k.meal === "none" ? "" : k.meal;
    if (id) {
      used.add(id);
      await db().execute(sql`UPDATE ai_picks SET category = ${k.category}, meal = ${meal}, name = ${k.name}, address = ${k.address}, website = ${k.website}, description = ${k.description},
        cost_level = ${k.costLevel}, pace = ${k.pace}, minutes_needed = ${k.minutesNeeded}, tags = ${JSON.stringify(k.tags)}, sources = ${JSON.stringify(k.sources)}, draft = false, created_at = ${now} WHERE id = ${id}`);
    } else {
      await db().execute(sql`INSERT INTO ai_picks (icao, category, meal, name, address, website, description, cost_level, pace, minutes_needed, tags, lat, lng, miles, sources, status, created_at, focus)
        VALUES (${ap.icao}, ${k.category}, ${meal}, ${k.name}, ${k.address}, ${k.website}, ${k.description}, ${k.costLevel}, ${k.pace}, ${k.minutesNeeded},
          ${JSON.stringify(k.tags)}, ${k.lat}, ${k.lng}, ${k.miles}, ${JSON.stringify(k.sources)}, 'live', ${now}, ${focusTag(k.category)})`);
    }
  }
  const unused = draftIds.filter((i) => !used.has(i));
  if (!keep.length && draftIds.length) await db().execute(sql`UPDATE ai_picks SET draft = false WHERE id IN (${sql.join(draftIds.map((i) => sql`${i}`), sql`, `)})`); // AI found nothing: keep the real places, stop showing Checking
  if (keep.length && unused.length) await db().execute(sql`UPDATE ai_picks SET status = 'replaced' WHERE id IN (${sql.join(unused.map((i) => sql`${i}`), sql`, `)})`);
  const found = keep.length || draftIds.length;
  const secs = Math.round((Date.now() - t0) / 1000);
  if (more && !found) { moreFailed.set(ap.icao, Date.now()); console.log(`[ai-picks] ${ap.icao}+: nothing new in ${secs}s`); void recordWarn("ai", `AI picks: find more at ${ap.icao} returned nothing new`); return; }
  if (!more && !found) void recordWarn("ai", `AI picks: no picks found at ${ap.icao}`, `candidates ${cands.length}, AI ${picks.length}`);
  if (!more) await setState(ap.icao, found ? "ready" : "failed");
  console.log(`[ai-picks] ${ap.icao}${more ? "+" : ""}: ${keep.length} kept (${keep.filter((k) => k.cand).length} from OpenStreetMap), ${unused.length && keep.length ? unused.length : 0} drafts dropped, ${secs}s`);
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
    ai: { meal: (r.meal || null) as Meal | null, sources: parse(r.sources), createdAt: Number(r.created_at), focus: r.focus || "", draft: !!r.draft, foods: r.category === "eat" ? rowFoods(r) : [], acts: r.category === "do" ? rowActs(r) : [], bonus: FIRST_RATE_BONUS },
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
export async function fillStop(icao: string, layover: LayoverId, nights: number | undefined, picks: SpotWithStats[], all: SpotWithStats[], airport?: any, useAi = true, aiAdd: number[] = [], programs: ProgramId[] = [], aiHide: number[] = []): Promise<StopFill> {
  const empty = { aiMore: [], aiMoreStatus: "idle" as const };
  const open = unmetSlots(slotsFor(layover, nights), picks);
  const crewOk = all.filter((s) => pickable(s) && (s.milesFromField ?? 0) <= MAX_MILES && !picks.some((p) => p.id === s.id));
  const needAi = open.filter((sl) => !crewOk.some((s) => slotMatches(sl, s)));
  // Prefer crew (AI not switched on for this stop): gaps aren't filled, but the AI places already found here stay
  // browsable in Add places, and any the owner added stay in the plan
  if (!useAi && !aiAdd.length) {
    const offer = needAi.length ? (AI_ENABLED ? "offer" : "off") : "none";
    if (!AI_ENABLED) return { aiPicks: [], aiStatus: offer, aiSlots: needAi, ...empty };
    const have = (await rowsFor(icao)).filter((r) => !all.some((c) => similarity({ name: r.name }, c) >= 0.8));
    const ms = moreStatus(icao);
    return { aiPicks: [], aiStatus: offer, aiSlots: needAi, aiMore: have.sort((a, b) => (CAT_ORDER[a.category] - CAT_ORDER[b.category]) || (a.miles ?? 99) - (b.miles ?? 99)).map((r) => toCard(r, airport)),
      aiMoreStatus: ms === "idle" && have.length >= MAX_ROWS ? "full" : ms };
  }
  if (useAi && !needAi.length && !aiAdd.length) return { aiPicks: [], aiStatus: "none", aiSlots: [], ...empty };
  const status = useAi ? await ensurePicks(icao) : "ready";
  const rows = (await rowsFor(icao)).filter((r) => !all.some((c) => similarity({ name: r.name }, c) >= 0.8));
  // extras the owner added stay put even after the airport's picks are refreshed (unless an admin hid them)
  const added = aiAdd.length ? ((await db().execute(sql`SELECT id, icao, category, meal, name, address, website, description, cost_level, pace, minutes_needed, tags, lat, lng, miles, sources, status, focus, created_at::float8 AS created_at
    FROM ai_picks WHERE id IN (${sql.join(aiAdd.map((x) => sql`${x}`), sql`, `)}) AND icao = ${icao} AND status <> 'hidden'`)).rows as any as Row[]) : [];
  const used = new Set<number>(added.map((r) => r.id)); // extras are on top of the automatic picks, never instead of them
  const out: AiPickCard[] = [];
  const byDistance = (a: Row, b: Row) => (a.miles ?? 99) - (b.miles ?? 99);
  // hotels from the member's rewards programs come first
  const inProg = (r: Row) => (r.category === "stay" && programs.length && programs.includes(programOf(r) as ProgramId) ? 1 : 0);
  // an automatic pick the owner removed leaves its gap open: each removed pick cancels one gap it would have filled
  const hidden = rows.filter((r) => aiHide.includes(r.id));
  for (const sl of useAi ? needAi : []) {
    const h = hidden.findIndex((x) => slotMatches(sl, aiMealOf(x)));
    if (h >= 0) { used.add(hidden[h].id); hidden.splice(h, 1); continue; }
    const r = rows.filter((x) => !used.has(x.id) && slotMatches(sl, aiMealOf(x))).sort((a, b) =>
      // the exact meal first, then the closest
      (sl.meal ? Number(b.meal === sl.meal) - Number(a.meal === sl.meal) : 0) || inProg(b) - inProg(a) || byDistance(a, b))[0];
    if (r) { used.add(r.id); const c = toCard(r, airport); c.ai.slot = sl; out.push(c); }
  }
  // a day reads in order: breakfast, lunch, dinner, then things to do, then the hotel
  const rank = (c: AiPickCard) => ({ breakfast: 0, lunch: 1, dinner: 2 } as Record<string, number>)[c.ai.slot?.meal || ""] ?? (c.category === "eat" ? 3 : c.category === "do" ? 4 : 5);
  out.sort((a, b) => rank(a) - rank(b));
  const order = new Map(aiAdd.map((x, k) => [x, k]));
  for (const r of [...added].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))) out.push({ ...toCard(r, airport), ai: { ...toCard(r).ai, extra: true } } as AiPickCard);
  const more = rows.filter((r) => !used.has(r.id) || (aiHide.includes(r.id) && !added.some((a) => a.id === r.id))).sort((a, b) => (CAT_ORDER[a.category] - CAT_ORDER[b.category]) || inProg(b) - inProg(a) || byDistance(a, b)).map((r) => toCard(r, airport));
  const ms = moreStatus(icao);
  const st: AiStatus = !useAi ? (needAi.length ? "offer" : "none") : rows.length || added.length ? "ready" : status;
  return { aiPicks: out, aiStatus: st, aiSlots: needAi, aiMore: more, aiMoreStatus: ms === "idle" && rows.length >= MAX_ROWS ? "full" : ms };
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
  /** One AI pick, so "Been here? Add it for crews" can fill in the whole listing form. */
  app.get("/api/ai-picks/row/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Bad id" });
    const r = ((await db().execute(sql`SELECT id, icao, category, meal, name, address, website, description, cost_level, pace, minutes_needed, tags, lat, lng, miles, sources, status, focus, created_at::float8 AS created_at
      FROM ai_picks WHERE id = ${id} AND status <> 'hidden'`)).rows as any as Row[])[0];
    if (!r) return res.status(404).json({ message: "That AI pick isn't available anymore" });
    res.json(toCard(r));
  });
  /** Search fallback: AI picks for one airport and category, only when crews have nothing there in that category. */
  app.get("/api/ai-picks", async (req, res) => {
    const code = String(req.query.icao || "");
    const ap = (await storage.resolveCode(code)) || refAirport(code);
    const cat = String(req.query.cat || "");
    if (!ap || !["eat", "do", "stay"].includes(cat)) return res.status(400).json({ message: "icao and cat (eat, do, stay) required" });
    // a food type (eat) or a type of thing to do ("act:golf", do) narrows both crew listings and AI picks
    const raw = String(req.query.food || "");
    const typeQ = raw && isFocus(raw) && focusCategory(raw) === cat ? raw : "";
    // with a type chosen, AI can help when no crew listing of that type exists here
    const listed = (await storage.searchSpots([ap.icao])).filter((s) => s.category === cat);
    const crew = listed.filter((s) => pickable(s) && (!typeQ || matchesFocus(s, typeQ)));
    // all=1: "More places" under crew results, so AI picks show alongside them (never duplicating a crew listing)
    const alongside = req.query.all === "1";
    if (crew.length && !alongside) return res.json({ status: "crew", picks: [] });
    const status = await ensurePicks(ap.icao);
    const progs = await programsOf((await o.userOf(req).catch(() => undefined))?.id);
    const prog = (r: Row) => (cat === "stay" && progs.includes(programOf(r) as ProgramId) ? 1 : 0);
    const all = (await rowsFor(ap.icao)).filter((r) => r.category === cat && !(alongside && listed.some((c) => similarity({ name: r.name }, c) >= 0.8)));
    const picks = all.sort((a, b) => prog(b) - prog(a) || (a.miles ?? 99) - (b.miles ?? 99)).map((r) => toCard(r, ap)).filter((c) => !typeQ || matchesFocus(c, typeQ));
    res.json({ status: status === "pending" || !all.length ? status : "ready", picks, total: all.length, more: moreStatus(ap.icao) });
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
