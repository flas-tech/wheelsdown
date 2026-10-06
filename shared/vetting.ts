import type { Vote, VetInfo, VetLevel } from "./schema";

export const VOTE_WINDOW_MS = 365 * 24 * 3600 * 1000; // votes older than a year stop counting
export const AUTO_HOLD = { minDown: 5, ratio: 0.6 }; // listing pulled for admin review

/** Turn a listing's votes into a trust level. Only votes from the last 12 months count. */
export function computeVet(spotVotes: Vote[], voter = "", now = Date.now()): VetInfo {
  const recent = spotVotes.filter((v) => now - v.createdAt <= VOTE_WINDOW_MS);
  const up = recent.filter((v) => v.value > 0).length;
  const down = recent.filter((v) => v.value < 0).length;
  const total = up + down;
  const reasons: Record<string, number> = {};
  recent.filter((v) => v.value < 0 && v.reason).forEach((v) => (reasons[v.reason!] = (reasons[v.reason!] || 0) + 1));
  let level: VetLevel = "ok";
  if (total < 3) level = "new";
  if (down >= 2 && down / total >= 0.4) level = "needs_check";
  else if (up >= 3 && up / total >= 0.75) level = "vetted";
  const ups = recent.filter((v) => v.value > 0).map((v) => v.createdAt);
  const mine = voter ? spotVotes.find((v) => v.voter === voter) : undefined;
  return { up, down, score: up - down, level, lastUpAt: ups.length ? Math.max(...ups) : null, reasons, myVote: mine?.value ?? 0 };
}

export function shouldAutoHold(v: VetInfo) {
  const total = v.up + v.down;
  return v.down >= AUTO_HOLD.minDown && total > 0 && v.down / total >= AUTO_HOLD.ratio;
}

/** Wilson lower bound — ranks 40 up / 2 down above 3 up / 0 down. */
export function trustScore(v: { up: number; down: number }) {
  const n = v.up + v.down;
  if (!n) return 0;
  const z = 1.96, p = v.up / n;
  return (p + (z * z) / (2 * n) - z * Math.sqrt((p * (1 - p) + (z * z) / (4 * n)) / n)) / (1 + (z * z) / n);
}

/** Deterministic sample votes for seeded listings (demo only). */
export function seedVotesFor(index: number, now = Date.now()) {
  const out: { value: number; reason: string; createdAt: number; voter: string }[] = [];
  const ups = [6, 4, 9, 2, 5, 3, 7, 1, 4, 8][index % 10];
  const downs = index % 9 === 4 ? 4 : index % 7 === 3 ? 3 : index % 5 === 0 ? 1 : 0;
  const reasons = ["outdated", "closed", "not_worth", "location"];
  for (let i = 0; i < ups; i++) out.push({ value: 1, reason: "", createdAt: now - (i * 11 + index * 3 + 2) * 86400_000, voter: `seed-${index}-u${i}` });
  for (let i = 0; i < downs; i++) out.push({ value: -1, reason: reasons[(index + i) % reasons.length], createdAt: now - (i * 9 + 5) * 86400_000, voter: `seed-${index}-d${i}` });
  return out;
}
