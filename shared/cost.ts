// Crew pricing and restaurant pace helpers, shared by server, client and demo.
import type { Category } from "./schema";

export const COST_LABELS = ["Free", "$", "$$", "$$$", "$$$$"];

/**
 * What each price level means in dollars (labels only; listings store the 0-4 level, so nothing is re-priced).
 * Eat is per person for one meal: $ is a fast-food meal, $$$$ is fine dining. Stay is per night; Do is per person.
 */
export const COST_RANGES: Record<string, string[]> = {
  eat: ["", "Under $15", "$15–30", "$30–60", "$60+"],
  stay: ["", "Under $125", "$125–200", "$200–325", "$325+"],
  do: ["Free", "Under $20", "$20–50", "$50–100", "$100+"],
};
export const COST_EXAMPLES: Record<string, string[]> = {
  eat: ["", "Fast food", "Casual", "Nice dinner", "Fine dining"],
  stay: ["", "Budget", "Mid-range", "Upscale", "Luxury"],
  do: ["Free", "Cheap", "Moderate", "Pricey", "Splurge"],
};
export const costRange = (category: string, level: number | null | undefined) => (level == null ? "" : COST_RANGES[category]?.[level] || "");
export const costExample = (category: string, level: number | null | undefined) => (level == null ? "" : COST_EXAMPLES[category]?.[level] || "");
export const costUnit = (category: string) => (category === "stay" ? "per night" : category === "eat" ? "per person, one meal" : "per person");
/** "$$ · $15–30" for compact displays. */
export const costWithRange = (category: string, level: number | null | undefined) =>
  level == null ? "" : level === 0 ? "Free" : `${COST_LABELS[level]} · ${costRange(category, level)}`;

/** Which price levels a category may use. FBO listings have no price. */
export function costOptions(category: string): number[] {
  if (category === "fbo") return [];
  if (category === "do") return [0, 1, 2, 3, 4];
  return [1, 2, 3, 4]; // eat, stay
}
export const hasCost = (category: string) => category !== "fbo";
export const isValidCost = (category: string, c: number | null | undefined) =>
  c != null && costOptions(category).includes(c);

/** Median of valid price votes (lower-middle on ties so one outlier cannot push the price up). */
export function crewCost(category: string, submitter: number | null | undefined, votes: (number | null | undefined)[]) {
  const all = [submitter, ...votes].filter((c): c is number => isValidCost(category, c));
  if (!all.length) return { cost: null as number | null, costVotes: 0 };
  const sorted = [...all].sort((a, b) => a - b);
  return { cost: sorted[Math.floor((sorted.length - 1) / 2)], costVotes: all.length };
}

export function costText(s: { category: string; cost: number | null }) {
  if (!hasCost(s.category)) return "";
  return s.cost == null ? "–" : COST_LABELS[s.cost];
}

export const PACES = [
  { id: "grab", label: "Grab & go" },
  { id: "sit", label: "Sit-down" },
] as const;
export type PaceId = (typeof PACES)[number]["id"];
/** Restaurant pace: stored tag, or derived from the legacy minutes field for older listings. */
export function paceOf(s: { category: string; pace?: string | null; minutesNeeded: number }): PaceId | null {
  if (s.category !== "eat") return null;
  if (s.pace === "grab" || s.pace === "sit") return s.pace;
  return s.minutesNeeded <= 45 ? "grab" : "sit";
}
export const paceLabel = (p: PaceId | null) => PACES.find((x) => x.id === p)?.label ?? "";
export const usesTime = (category: Category | string) => category === "do";

/** Great-circle distance in statute miles. */
export function milesBetween(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 3958.8, toR = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toR, dLon = (b.lon - a.lon) * toR;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * toR) * Math.cos(b.lat * toR) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
