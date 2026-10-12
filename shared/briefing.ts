// Trip briefing planner: picks crew-rated listings for each stop based on the time on the ground.
import type { SpotWithStats, LayoverId } from "./schema";
import { trustScore } from "./vetting";
import { paceOf, paceMatches } from "./cost";
import { cuisinesOf } from "./cuisine";

export const LAYOVER_PLAN: Record<LayoverId, { fbo: number; stay: number; eat: number; do: number; maxDoMin: number; eatPace?: "grab"; maxMiles: number; note: string }> = {
  quick: { fbo: 1, stay: 0, eat: 2, do: 0, maxDoMin: 0, eatPace: "grab", maxMiles: 5, note: "Quick turn: food close to the field and FBO notes." },
  hours: { fbo: 1, stay: 0, eat: 2, do: 1, maxDoMin: 240, maxMiles: 15, note: "A few hours: a real meal and one thing nearby." },
  overnight: { fbo: 1, stay: 1, eat: 3, do: 2, maxDoMin: 480, maxMiles: 25, note: "Overnight: hotel, dinner, breakfast and an evening option." },
  multi: { fbo: 1, stay: 1, eat: 4, do: 4, maxDoMin: 99999, maxMiles: 60, note: "Several days: hotel plus a few days of food and things to do." },
};

/** Crew listings fit for a briefing: live, not failing vetting, not mostly "Go around". */
export const pickable = (s: SpotWithStats) => s.status === "live" && s.vet.level !== "needs_check" && !((s.goArounds ?? 0) > 0 && (s.goArounds ?? 0) * 2 >= s.reviewCount);

export function pickScore(s: SpotWithStats) {
  return trustScore(s.vet) + (s.avgRating ?? 3.5) / 5 + Math.min(s.reviewCount, 10) / 40 - Math.min(s.milesFromField ?? 0, 60) / 120;
}

/** Suggested picks (spot ids) for a stop. */
export function suggestPicks(all: SpotWithStats[], layover: LayoverId, nights?: number): number[] {
  const plan = LAYOVER_PLAN[layover];
  // skip anything crews flag: failing vetting, or mostly "Go around" ratings
  const ok = all.filter(pickable);
  const take = (cat: string, n: number, extra: (s: SpotWithStats) => boolean = () => true) =>
    ok.filter((s) => s.category === cat && extra(s)).sort((a, b) => pickScore(b) - pickScore(a)).slice(0, n);
  const near = (s: SpotWithStats) => (s.milesFromField ?? 0) <= plan.maxMiles;
  let eat = take("eat", plan.eat, (s) => near(s) && (!plan.eatPace || paceMatches(paceOf(s), plan.eatPace)));
  if (eat.length < plan.eat) eat = [...eat, ...take("eat", plan.eat, near).filter((s) => !eat.includes(s))].slice(0, plan.eat);
  const base = [
    ...take("fbo", plan.fbo),
    ...take("stay", plan.stay, near),
    ...eat,
    ...take("do", plan.do, (s) => near(s) && s.minutesNeeded <= plan.maxDoMin),
  ];
  // then make sure every minimum slot (a meal, a thing to do, a bed) is covered by a crew listing when one exists
  const reach = (s: SpotWithStats) => (s.milesFromField ?? 0) <= Math.max(plan.maxMiles, 30);
  for (const sl of unmetSlots(slotsFor(layover, nights), base)) {
    const extra = ok.filter((s) => !base.includes(s) && reach(s) && slotMatches(sl, s)).sort((a, b) => pickScore(b) - pickScore(a))[0];
    if (extra) base.push(extra);
  }
  return base.map((s) => s.id);
}

// ---------------------------------------------------------------- minimum coverage per stop
// Every stop gets at least one place to eat, one thing to do and one place to stay.
// Overnights also get a place for breakfast, lunch and dinner, and things to do: two for one night, one per night plus one for longer.
export type Meal = "breakfast" | "lunch" | "dinner";
export const MEALS: Meal[] = ["breakfast", "lunch", "dinner"];
export const MEAL_LABEL: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };
export type Slot = { cat: "eat" | "do" | "stay"; meal?: Meal };
export const nightsOf = (layover: LayoverId, nights?: number) => (layover === "overnight" ? 1 : layover === "multi" ? Math.max(2, nights || 2) : 0);

export function slotsFor(layover: LayoverId, nights?: number): Slot[] {
  const n = nightsOf(layover, nights);
  if (!n) return [{ cat: "eat" }, { cat: "do" }, { cat: "stay" }];
  return [...MEALS.map((meal) => ({ cat: "eat" as const, meal })), ...Array.from({ length: Math.min(n + 1, 6) }, () => ({ cat: "do" as const })), { cat: "stay" }];
}

type MealInput = { category: string; name: string; description?: string | null; tags?: string | null; crewTip?: string | null; pace?: string | null; meal?: Meal | null };
/** Which meals a place works for. AI picks say so directly; crew listings are read from their food type and service style. */
export function mealsOf(s: MealInput): Meal[] {
  if (s.category !== "eat") return [];
  if (s.meal) return [s.meal];
  const c = cuisinesOf(s as any);
  const text = [s.name, s.description || "", s.tags || "", s.crewTip || ""].join(" ").toLowerCase();
  const morning = c.includes("breakfast") || c.includes("coffee") || c.includes("bakery") || /breakfast|brunch|morning/.test(text);
  const onlyMorning = morning && c.every((x) => ["breakfast", "coffee", "bakery"].includes(x)) && !/lunch|dinner/.test(text);
  const out: Meal[] = [];
  if (morning) out.push("breakfast");
  if (!onlyMorning || /lunch/.test(text)) out.push("lunch");
  if ((!onlyMorning && s.pace !== "grab") || /dinner|late night|open late/.test(text) || c.includes("bar") || c.includes("steak")) out.push("dinner");
  return out;
}

/** Slots the chosen places don't cover yet. Each place covers at most one slot. */
export function unmetSlots<T extends MealInput>(slots: Slot[], picks: T[]): Slot[] {
  const used = new Set<number>();
  const open: Slot[] = [];
  // most specific first, so a breakfast-only cafe isn't spent on lunch
  const order = [...slots].sort((a, b) => rank(a) - rank(b));
  for (const sl of order) {
    const i = picks.findIndex((p, k) => !used.has(k) && p.category === sl.cat && (!sl.meal || mealsOf(p).includes(sl.meal)));
    if (i >= 0) used.add(i); else open.push(sl);
  }
  return open;
}
const rank = (s: Slot) => (s.meal === "breakfast" ? 0 : s.meal === "dinner" ? 1 : s.meal === "lunch" ? 2 : s.cat === "stay" ? 3 : 4);
export const slotMatches = (sl: Slot, p: MealInput) => p.category === sl.cat && (!sl.meal || mealsOf(p).includes(sl.meal));
