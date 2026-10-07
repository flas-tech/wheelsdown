import type { Request } from "express";
import { createHash } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * Advertiser metrics. Only daily aggregate counters are stored (metrics_daily), plus a salted hash of the
 * anonymous device id per day (visitors_daily) so unique visitors can be counted. No IPs, names or paths with ids.
 * Bots, link-preview fetchers, command-line tools, admin requests and smoke tests are never counted.
 */
const SALT = process.env.METRICS_SALT || process.env.ADMIN_KEY || "wheelsdown";
const BOT = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl\/|wget|python-requests|httpx|axios|node-fetch|headless|lighthouse|pingdom|uptime/i;
export const dayKey = (t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(t);

export function untracked(req: Request) {
  const ua = String(req.get("user-agent") || "");
  return !ua || BOT.test(ua) || !!req.get("x-wd-test") || !!req.get("x-admin-key");
}

export async function track(req: Request | null, kind: string, key = "", n = 1) {
  if (req && untracked(req)) return;
  try {
    await db().execute(sql`INSERT INTO metrics_daily (day, kind, key, n) VALUES (${dayKey()}, ${kind}, ${key.slice(0, 40)}, ${n})
      ON CONFLICT (day, kind, key) DO UPDATE SET n = metrics_daily.n + ${n}`);
  } catch { /* metrics must never break a request */ }
}

/** One row per device per day. Device type and home-screen installs are counted once per device per day. */
export async function visit(req: Request, vid: string, signedIn: boolean, installed: boolean) {
  if (untracked(req) || !/^v-[a-z0-9]{6,40}$/.test(vid)) return;
  const h = createHash("sha256").update(SALT + vid).digest("hex").slice(0, 32);
  const day = dayKey();
  try {
    const r = await db().execute(sql`INSERT INTO visitors_daily (day, vid, signed_in) VALUES (${day}, ${h}, ${signedIn ? 1 : 0})
      ON CONFLICT (day, vid) DO UPDATE SET signed_in = GREATEST(visitors_daily.signed_in, EXCLUDED.signed_in) RETURNING (xmax = 0) AS fresh`);
    if ((r.rows[0] as any)?.fresh) {
      const ua = String(req.get("user-agent") || "");
      await track(null, "device", /iPhone|iPad|iPod/.test(ua) ? "iphone_ipad" : /Android/.test(ua) ? "android" : "desktop");
      if (installed) await track(null, "device", "home_screen_app");
    }
  } catch { /* ignore */ }
}

const PAGES = new Set(["home", "spot", "add", "favorites", "brief", "shared_brief", "crew", "crew_profile", "following", "logbook", "legal", "other"]);
export const pageKey = (p: string) => (PAGES.has(p) ? p : "other");
const OUTBOUND = new Set(["website", "map", "phone", "ad"]);
export const outboundKey = (k: string) => (OUTBOUND.has(k) ? k : "other");

export async function report(days: number) {
  const d = db();
  const since = dayKey(Date.now() - (days - 1) * 86400_000);
  const q = async (s: ReturnType<typeof sql>) => (await d.execute(s)).rows as any[];
  const [series, uniq, sums, airports, users] = await Promise.all([
    q(sql`SELECT v.day, COUNT(*)::int AS visitors, SUM(v.signed_in)::int AS crew,
            COALESCE((SELECT SUM(n) FROM metrics_daily m WHERE m.day = v.day AND m.kind = 'pageview'), 0)::int AS pageviews
          FROM visitors_daily v WHERE v.day >= ${since} GROUP BY v.day ORDER BY v.day`),
    q(sql`SELECT COUNT(DISTINCT vid)::int AS visitors, COUNT(DISTINCT vid) FILTER (WHERE signed_in = 1)::int AS crew,
            COUNT(*)::int AS visits FROM visitors_daily WHERE day >= ${since}`),
    q(sql`SELECT kind, key, SUM(n)::int AS n FROM metrics_daily WHERE day >= ${since} GROUP BY kind, key`),
    q(sql`SELECT m.key AS icao, SUM(n) FILTER (WHERE kind = 'search_airport')::int AS searches, SUM(n) FILTER (WHERE kind = 'spot_view')::int AS views
          FROM metrics_daily m WHERE m.day >= ${since} AND m.kind IN ('search_airport','spot_view') GROUP BY m.key ORDER BY SUM(n) DESC LIMIT 15`),
    q(sql`SELECT crew_role, aircraft, home_base, interests, created_at FROM users`),
  ]);
  return { since, series, uniq: uniq[0], sums, airports, users };
}
