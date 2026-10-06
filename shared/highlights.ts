import type { SpotWithStats } from "./schema";
import { trustScore } from "./vetting";

export type Highlights = { top: SpotWithStats[]; newest: SpotWithStats[]; totals: { spots: number; fields: number } };

/** Home-page highlights: a few top-rated/most-trusted picks and the newest additions, never the whole catalog. */
export function buildHighlights(all: SpotWithStats[], opts: { category?: string | null; limit?: number } = {}): Highlights {
  const limit = opts.limit ?? 6;
  const pool = all.filter((s) => !opts.category || s.category === opts.category);
  const top = pool
    .filter((s) => s.vet.level !== "needs_check")
    .sort((a, b) => trustScore(b.vet) + (b.avgRating ?? 0) / 50 - (trustScore(a.vet) + (a.avgRating ?? 0) / 50))
    .slice(0, limit);
  const topIds = new Set(top.map((s) => s.id));
  const newest = [...pool].sort((a, b) => b.createdAt - a.createdAt).filter((s) => !topIds.has(s.id)).slice(0, limit);
  return { top, newest, totals: { spots: all.length, fields: new Set(all.map((s) => s.icao)).size } };
}
