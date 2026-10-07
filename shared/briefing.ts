// Trip briefing planner: picks crew-rated listings for each stop based on the time on the ground.
import type { SpotWithStats, LayoverId } from "./schema";
import { trustScore } from "./vetting";
import { paceOf, paceMatches } from "./cost";

export const LAYOVER_PLAN: Record<LayoverId, { fbo: number; stay: number; eat: number; do: number; maxDoMin: number; eatPace?: "grab"; maxMiles: number; note: string }> = {
  quick: { fbo: 1, stay: 0, eat: 2, do: 0, maxDoMin: 0, eatPace: "grab", maxMiles: 5, note: "Quick turn: food close to the field and FBO notes." },
  hours: { fbo: 1, stay: 0, eat: 2, do: 1, maxDoMin: 240, maxMiles: 15, note: "A few hours: a real meal and one thing nearby." },
  overnight: { fbo: 1, stay: 1, eat: 3, do: 2, maxDoMin: 480, maxMiles: 25, note: "Overnight: hotel, dinner, breakfast and an evening option." },
  multi: { fbo: 1, stay: 1, eat: 4, do: 4, maxDoMin: 99999, maxMiles: 60, note: "Several days: hotel plus a few days of food and things to do." },
};

export function pickScore(s: SpotWithStats) {
  return trustScore(s.vet) + (s.avgRating ?? 3.5) / 5 + Math.min(s.reviewCount, 10) / 40 - Math.min(s.milesFromField ?? 0, 60) / 120;
}

/** Suggested picks (spot ids) for a stop. */
export function suggestPicks(all: SpotWithStats[], layover: LayoverId): number[] {
  const plan = LAYOVER_PLAN[layover];
  // skip anything crews flag: failing vetting, or mostly "Go around" ratings
  const ok = all.filter((s) => s.status === "live" && s.vet.level !== "needs_check" && !((s.goArounds ?? 0) > 0 && (s.goArounds ?? 0) * 2 >= s.reviewCount));
  const take = (cat: string, n: number, extra: (s: SpotWithStats) => boolean = () => true) =>
    ok.filter((s) => s.category === cat && extra(s)).sort((a, b) => pickScore(b) - pickScore(a)).slice(0, n);
  const near = (s: SpotWithStats) => (s.milesFromField ?? 0) <= plan.maxMiles;
  let eat = take("eat", plan.eat, (s) => near(s) && (!plan.eatPace || paceMatches(paceOf(s), plan.eatPace)));
  if (eat.length < plan.eat) eat = [...eat, ...take("eat", plan.eat, near).filter((s) => !eat.includes(s))].slice(0, plan.eat);
  return [
    ...take("fbo", plan.fbo),
    ...take("stay", plan.stay, near),
    ...eat,
    ...take("do", plan.do, (s) => near(s) && s.minutesNeeded <= plan.maxDoMin),
  ].map((s) => s.id);
}
