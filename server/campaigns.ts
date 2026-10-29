/**
 * Tracked share links (/go/<code>, see shared/campaigns.ts). Counts are daily aggregates in metrics_daily:
 * campaign_click (link opened, bots filtered), campaign_visit (the app actually loaded in a browser) and
 * campaign_signup. Each sign-up's source is also kept in signup_sources so it can be traced later.
 */
import type { Express } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { track } from "./metrics";
import { CAMPAIGNS, campaignCode } from "@shared/campaigns";

export function registerCampaigns(app: Express) {
  void db().execute(sql`CREATE TABLE IF NOT EXISTS signup_sources (user_id integer PRIMARY KEY, src text NOT NULL, at bigint NOT NULL)`).catch(() => {});
  app.get("/go/:code", async (req, res) => {
    const code = campaignCode(req.params.code);
    res.set("Cache-Control", "no-store");
    if (!code) return res.redirect(302, "/");
    await track(req, "campaign_click", code);
    const ref = CAMPAIGNS[code].ref;
    res.redirect(302, `/?src=${code}${ref ? `&ref=${ref}` : ""}#/`);
  });
}
export async function campaignVisit(req: any, raw: unknown) { const c = campaignCode(raw); if (c) await track(req, "campaign_visit", c); }
export async function campaignSignup(req: any, userId: number, raw: unknown) {
  const c = campaignCode(raw); if (!c) return "";
  await track(req, "campaign_signup", c);
  try { await db().execute(sql`INSERT INTO signup_sources (user_id, src, at) VALUES (${userId}, ${c}, ${Date.now()}) ON CONFLICT (user_id) DO NOTHING`); } catch { /* ignore */ }
  return c;
}
export async function campaignReport(by: (kind: string) => Record<string, number>) {
  const all = ((await db().execute(sql`SELECT src, COUNT(*)::int AS n FROM signup_sources GROUP BY src`).catch(() => ({ rows: [] }))).rows as any[]);
  const total = Object.fromEntries(all.map((r) => [r.src, r.n]));
  const clicks = by("campaign_click"), visits = by("campaign_visit"), signups = by("campaign_signup");
  return Object.entries(CAMPAIGNS).map(([code, c]) => ({ code, label: c.label, link: `/go/${code}`, clicks: clicks[code] || 0, visits: visits[code] || 0, signups: signups[code] || 0, signupsAllTime: total[code] || 0 }));
}
