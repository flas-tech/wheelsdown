import type { SpotWithStats } from "./schema";
import { trustScore } from "./vetting";

export type Highlights = { top: SpotWithStats[]; newest: SpotWithStats[]; visited: SpotWithStats[]; totals: { spots: number; fields: number } };

/** Home-page highlights: a few top-rated/most-trusted picks and the newest additions, never the whole catalog. */
export function buildHighlights(all: SpotWithStats[], opts: { category?: string | null; limit?: number; visits?: Map<number, number> } = {}): Highlights {
  const limit = opts.limit ?? 6;
  const pool = all.filter((s) => !opts.category || s.category === opts.category);
  const top = pool
    .filter((s) => s.vet.level !== "needs_check")
    .sort((a, b) => trustScore(b.vet) + (b.avgRating ?? 0) / 50 - (trustScore(a.vet) + (a.avgRating ?? 0) / 50))
    .slice(0, limit);
  // each list stands on its own (the home page switches between them)
  const newest = [...pool].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  const visits = (s: SpotWithStats) => (s.reviewCount || 0) + (opts.visits?.get(s.id) || 0);
  const visited = pool.filter((s) => visits(s) > 0 && s.vet.level !== "needs_check").sort((a, b) => visits(b) - visits(a) || (b.avgRating ?? 0) - (a.avgRating ?? 0)).slice(0, limit);
  return { top, newest, visited, totals: { spots: all.length, fields: new Set(all.map((s) => s.icao)).size } };
}
