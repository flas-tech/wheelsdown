import { sql } from "drizzle-orm";
import { db } from "./db";
import { dayKey } from "./metrics";

/**
 * Records what every AI call actually used, from OpenAI's own usage numbers on each response.
 * Daily totals per purpose only; no content is stored. Prices are OpenAI list prices for gpt-5-mini and can be
 * overridden with AI_PRICE_INPUT / AI_PRICE_CACHED / AI_PRICE_OUTPUT (per 1M tokens) and AI_PRICE_SEARCH (per 1,000 searches).
 */
export const AI_PRICES = {
  input: Number(process.env.AI_PRICE_INPUT || 0.25),
  cached: Number(process.env.AI_PRICE_CACHED || 0.025),
  output: Number(process.env.AI_PRICE_OUTPUT || 2),
  search: Number(process.env.AI_PRICE_SEARCH || 10),
};
export type AiPurpose = "listing" | "rating" | "autofill" | "name" | "bio" | "safety" | "fix";
export type AiUse = { input: number; cached: number; output: number; searches: number; failed?: boolean };

export function usageOf(j: any): AiUse {
  const u = j?.usage || {};
  const searches = (j?.output || []).filter((x: any) => x?.type === "web_search_call").length;
  return { input: Number(u.input_tokens) || 0, cached: Number(u.input_tokens_details?.cached_tokens) || 0, output: Number(u.output_tokens) || 0, searches };
}

let startNoted = false;
/** The moment usage recording began (ms), stored once so earlier checks can be estimated separately. */
export async function trackingStart(): Promise<number | null> {
  const r = (await db().execute(sql`SELECT value FROM app_settings WHERE key = 'ai_usage_since'`)).rows[0] as any;
  return r?.value ? Number(r.value) : null;
}
export async function recordAi(purpose: AiPurpose, u: AiUse) {
  try {
    if (!startNoted) { await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('ai_usage_since', ${String(Date.now())}) ON CONFLICT (key) DO NOTHING`); startNoted = true; }
    await db().execute(sql`INSERT INTO ai_usage_daily (day, purpose, calls, failures, input_tokens, cached_tokens, output_tokens, searches)
      VALUES (${dayKey()}, ${purpose}, 1, ${u.failed ? 1 : 0}, ${u.input}, ${u.cached}, ${u.output}, ${u.searches})
      ON CONFLICT (day, purpose) DO UPDATE SET calls = ai_usage_daily.calls + 1, failures = ai_usage_daily.failures + EXCLUDED.failures,
        input_tokens = ai_usage_daily.input_tokens + EXCLUDED.input_tokens, cached_tokens = ai_usage_daily.cached_tokens + EXCLUDED.cached_tokens,
        output_tokens = ai_usage_daily.output_tokens + EXCLUDED.output_tokens, searches = ai_usage_daily.searches + EXCLUDED.searches`);
  } catch { /* cost tracking must never break moderation */ }
}

export const costOf = (r: { input_tokens: number; cached_tokens: number; output_tokens: number; searches: number }) =>
  ((r.input_tokens - r.cached_tokens) * AI_PRICES.input + r.cached_tokens * AI_PRICES.cached + r.output_tokens * AI_PRICES.output) / 1e6 + (r.searches * AI_PRICES.search) / 1000;

export async function costReport(days: number) {
  const d = db();
  const since = dayKey(Date.now() - (days - 1) * 86400_000);
  const month = dayKey().slice(0, 7);
  const rows = (await d.execute(sql`SELECT day, purpose, calls::int, failures::int, input_tokens::float8 AS input_tokens, cached_tokens::float8 AS cached_tokens,
      output_tokens::float8 AS output_tokens, searches::int FROM ai_usage_daily WHERE day >= ${since} OR day LIKE ${month + "%"} ORDER BY day`)).rows as any[];
  const start = await trackingStart();
  return { since, month, rows, trackingSince: start ? dayKey(start) : null, startMs: start };
}
