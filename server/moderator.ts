// Background AI moderation. New listings, ratings and edits are saved as "checking" and stay unpublished until this
// worker approves them. Held items keep a note for the poster and appear in the admin moderation queue.
import { AI_ENABLED, checkReview, checkSpot, type Verdict } from "./ai";
import { storage } from "./storage";
import { milesBetween } from "@shared/cost";
import { TIERS, tierFor } from "@shared/tiers";
import type { Review, Spot } from "@shared/schema";

const MAX_ATTEMPTS = 3;
const MODERATE_ALL = process.env.MODERATE === "1"; // legacy switch: when on, non-trusted listings still need an admin even after AI approval
let running = false;
let timer: NodeJS.Timeout | null = null;

export const SPOT_EDIT_FIELDS = ["icao", "category", "name", "description", "address", "website", "costLevel", "minutesNeeded", "pace", "milesFromField", "lat", "lng", "placeRef", "crewTip", "tags"] as const;
export type SpotEdit = Partial<Pick<Spot, (typeof SPOT_EDIT_FIELDS)[number]>>;
export type ReviewEdit = { rating: number; comment: string; costLevel: number | null };

async function isTrusted(userId: number | null) {
  if (userId == null) return false;
  const u = (await storage.publicUsers(true)).find((x) => x.id === userId);
  return !!u && tierFor(u.points).index >= TIERS.findIndex((t) => t.id === "commercial");
}

/** Cheap local duplicate check: same airport, near-identical name, or a pin within ~150 ft. */
export function findDuplicate<T extends { id: number; name: string; lat: number | null; lng: number | null }>(s: { name: string; lat?: number | null; lng?: number | null }, others: T[]): T | undefined {
  const norm = (x: string) => x.toLowerCase().replace(/&/g, "and").replace(/\b(the|restaurant|cafe|bar|grill|hotel|inn)\b/g, "").replace(/[^a-z0-9]/g, "");
  const n = norm(s.name);
  return others.find((o) => {
    const on = norm(o.name);
    if (n.length >= 3 && on.length >= 3 && (n === on || (Math.min(n.length, on.length) >= 6 && (n.includes(on) || on.includes(n))))) return true;
    return s.lat != null && s.lng != null && o.lat != null && o.lng != null && norm(o.name).slice(0, 4) === n.slice(0, 4)
      && milesBetween({ lat: s.lat, lon: s.lng }, { lat: o.lat, lon: o.lng }) < 0.03;
  });
}

async function verdictForSpot(s: Spot, edit: SpotEdit | null): Promise<Verdict> {
  const merged = { ...s, ...(edit || {}) } as Spot;
  const airport = await storage.resolveCode(merged.icao);
  const others = await storage.namesAt(merged.icao, s.id);
  const dup = findDuplicate(merged, others);
  const v = await checkSpot(merged, {
    airport: airport ? { name: airport.name, city: airport.city } : null,
    nearbyNames: others.map((o) => `${o.name} (${o.category}${o.address ? ", " + o.address : ""})`),
    isEdit: !!edit, previous: edit ? s : null,
  });
  // the local duplicate check can only escalate an approval to a human look, never publish something the AI held
  if (v.verdict === "approve" && dup && (!edit || dup.name.toLowerCase() !== s.name.toLowerCase())) {
    return { verdict: "review", problem: "duplicate", reason: `This looks like ${dup.name}, which is already listed at ${merged.icao}. Rate that listing instead, or explain the difference in the description.` };
  }
  return v;
}

const spotSig = (s: Spot) => JSON.stringify([s.modState, s.pendingEdit, ...SPOT_EDIT_FIELDS.map((k) => (s as any)[k])]);
const reviewSig = (r: Review) => JSON.stringify([r.modState, r.pendingEdit, r.rating, r.comment, r.costLevel]);
/** Only write a verdict if nothing changed while the check ran (a newer edit or an admin decision wins). */
async function stillSameSpot(s: Spot) { const f = await storage.rawSpot(s.id); return !!f && spotSig(f) === spotSig(s); }
async function stillSameReview(r: Review) { const f = await storage.getReview(r.id); return !!f && reviewSig(f) === reviewSig(r); }

async function processSpot(s: Spot) {
  let edit: SpotEdit | null = null;
  try { edit = s.pendingEdit ? JSON.parse(s.pendingEdit) : null; } catch { edit = null; }
  let v: Verdict;
  try { v = await verdictForSpot(s, edit); }
  catch (e) { if (await stillSameSpot(s)) await failed("spot", s.id, s.userId, s.modAttempts, String((e as Error).message || e), !!edit); return; }
  if (!(await stillSameSpot(s))) { console.log(`[moderation] spot ${s.id} changed during check; will re-run`); return; }
  if (v.verdict === "approve") {
    if (edit) { await storage.updateSpot(s.id, edit as any); await storage.setSpotMod(s.id, { pendingEdit: null, modState: "approved", modNote: "", modAttempts: 0 }); }
    else {
      const needsAdmin = MODERATE_ALL && !(await isTrusted(s.userId));
      await storage.setSpotMod(s.id, { status: needsAdmin ? "pending" : "live", modState: needsAdmin ? "flagged" : "approved", modNote: needsAdmin ? "Passed the automatic check. Waiting for a moderator." : "", modAttempts: 0 });
    }
  } else {
    // held: a new listing stays unpublished; a held edit leaves the live version exactly as it was
    await storage.setSpotMod(s.id, { modState: "flagged", modNote: `[${v.problem}] ${v.reason}`, modAttempts: 0, ...(edit ? {} : { status: "pending" }) });
  }
  console.log(`[moderation] spot ${s.id}${edit ? " (edit)" : ""}: ${v.verdict} ${v.problem}`);
}

async function processReview(r: Review) {
  let edit: ReviewEdit | null = null;
  try { edit = r.pendingEdit ? JSON.parse(r.pendingEdit) : null; } catch { edit = null; }
  const spot = await storage.rawSpot(r.spotId);
  if (!spot) { await storage.setReviewMod(r.id, { modState: "flagged", modNote: "Listing no longer exists" }); return; }
  let v: Verdict;
  try { v = await checkReview(edit || r, spot); }
  catch (e) { if (await stillSameReview(r)) await failed("review", r.id, r.userId, r.modAttempts, String((e as Error).message || e), !!edit); return; }
  if (!(await stillSameReview(r))) { console.log(`[moderation] review ${r.id} changed during check; will re-run`); return; }
  if (v.verdict === "approve") {
    if (edit) await storage.setReviewMod(r.id, { ...edit, pendingEdit: null, modState: "approved", modNote: "", modAttempts: 0 });
    else await storage.setReviewMod(r.id, { status: "live", modState: "approved", modNote: "", modAttempts: 0 });
  } else {
    await storage.setReviewMod(r.id, { modState: "flagged", modNote: `[${v.problem}] ${v.reason}`, modAttempts: 0, ...(edit ? {} : { status: "pending" }) });
  }
  console.log(`[moderation] review ${r.id}${edit ? " (edit)" : ""}: ${v.verdict} ${v.problem}`);
}

/** AI errors: retry, then hold for a person. Nothing is published without a check. */
async function failed(kind: "spot" | "review", id: number, _userId: number | null, attempts: number, err: string, isEdit: boolean) {
  console.warn(`[moderation] ${kind} ${id} check failed (${attempts + 1}/${MAX_ATTEMPTS}): ${err.slice(0, 160)}`);
  const set = kind === "spot" ? storage.setSpotMod.bind(storage) : storage.setReviewMod.bind(storage);
  if (attempts + 1 < MAX_ATTEMPTS) { await set(id, { modAttempts: attempts + 1 }); return; }
  await set(id, { modState: "flagged", modAttempts: attempts + 1, modNote: "[unavailable] The automatic check couldn't run, so a moderator will review this shortly.", ...(isEdit ? {} : { status: "pending" }) });
}

async function tick() {
  if (running) return;
  running = true;
  try {
    for (let round = 0; round < 5; round++) {
      const q = await storage.modQueue(3);
      if (!q.spots.length && !q.reviews.length) break;
      // ratings are quick; listings use web search. Run a few at a time.
      await Promise.all([...q.reviews.map(processReview), ...q.spots.map(processSpot)]);
    }
  } catch (e) { console.warn("[moderation] tick error", (e as Error).message); }
  finally { running = false; }
}

export function startModerator() {
  if (!AI_ENABLED || timer) return;
  timer = setInterval(tick, 5000);
  setTimeout(tick, 1500);
  console.log("[moderation] AI moderation on");
}
/** Run the queue now (called right after a submission so the wait is just the check itself). */
export function kickModerator() { if (AI_ENABLED) setTimeout(tick, 50); }
