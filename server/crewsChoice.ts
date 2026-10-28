/**
 * Two member-feedback features (Oct 2026), each behind its own app_settings switch, admins first:
 *
 *  - rank_art_audience: the pelican mascot for each rank and a one-line "what this rank does" on the ladder and the
 *    status card (PJ, feedback #70). Display only; nothing about points or ranks changes.
 *  - crews_choice_audience: Crews' Choice (PJ, feedback #68). Each month every member gets one vote per airport for
 *    the best place to eat there; they can move it until the month ends. The month's leader is that field's Crews'
 *    Choice, and the year's total names the Crews' Choice of the year. Votes are private: only counts are shown.
 *
 * Both switches are enforced here on the server; until one is opened, members get nothing new.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { logChange } from "./ops";
import type { User } from "@shared/schema";

type Audience = "admins" | "members";
const KEYS = { rankArt: "rank_art_audience", choice: "crews_choice_audience" } as const;
type Key = keyof typeof KEYS;
const cache: Record<Key, { at: number; v: Audience }> = { rankArt: { at: 0, v: "admins" }, choice: { at: 0, v: "admins" } };

export async function audience(k: Key): Promise<Audience> {
  if (Date.now() - cache[k].at < 15_000) return cache[k].v;
  const r = ((await db().execute(sql`SELECT value FROM app_settings WHERE key = ${KEYS[k]}`).catch(() => ({ rows: [] }))).rows[0] as any);
  cache[k] = { at: Date.now(), v: r?.value === "members" ? "members" : "admins" };
  return cache[k].v;
}
export const rankArtAudience = () => audience("rankArt");
export const crewsChoiceAudience = () => audience("choice");

const rows = async <T = any>(q: any) => ((await db().execute(q)).rows as T[]);
const num = (v: unknown) => Number(v) || 0;
const ICAO = /^[A-Z0-9]{3,4}$/;

/** Voting month in US Eastern time, like the rest of the app's daily counts: "2026-10". */
export function periodOf(t = Date.now()) {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit" }).formatToParts(new Date(t));
  return `${p.find((x) => x.type === "year")!.value}-${p.find((x) => x.type === "month")!.value}`;
}
const prevPeriod = (p: string) => { const [y, m] = p.split("-").map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`; };

export async function ensureCrewsChoiceTables() {
  await db().execute(sql`CREATE TABLE IF NOT EXISTS crews_choice_votes (id serial PRIMARY KEY, user_id integer NOT NULL, icao text NOT NULL,
    spot_id integer NOT NULL, period text NOT NULL, created_at bigint NOT NULL DEFAULT 0, updated_at bigint NOT NULL DEFAULT 0)`);
  await db().execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crews_choice_one_per_field ON crews_choice_votes (user_id, icao, period)`);
  await db().execute(sql`CREATE INDEX IF NOT EXISTS crews_choice_tally ON crews_choice_votes (icao, period, spot_id)`);
  for (const k of Object.values(KEYS)) await db().execute(sql`INSERT INTO app_settings (key, value) VALUES (${k}, 'admins') ON CONFLICT (key) DO NOTHING`);
}

type Leader = { spotId: number; name: string; votes: number };
async function tally(icao: string, periodLike: string, limit = 5): Promise<Leader[]> {
  // periodLike is "2026-10" for a month or "2026-%" for a year; only live eat listings count
  return (await rows<any>(sql`SELECT v.spot_id, s.name, COUNT(*)::int AS n, MIN(v.created_at) AS first FROM crews_choice_votes v JOIN spots s ON s.id = v.spot_id
    WHERE v.icao = ${icao} AND v.period LIKE ${periodLike} AND s.status = 'live' AND s.category = 'eat'
    GROUP BY v.spot_id, s.name ORDER BY n DESC, first ASC LIMIT ${limit}`)).map((r) => ({ spotId: num(r.spot_id), name: String(r.name).trim(), votes: num(r.n) }));
}

export function registerCrewsChoice(app: Express, o: {
  userOf: (req: Request) => Promise<User | null | undefined>; isSuperAdmin: (u?: User | null) => boolean;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => any; requireUser: (req: Request, res: Response, next: NextFunction) => any;
}) {
  void ensureCrewsChoiceTables().catch((e) => console.error("[choice] tables", String(e?.message || e)));
  const openFor = async (u?: User | null) => !!u && (o.isSuperAdmin(u) || (await crewsChoiceAudience()) === "members");
  const gate = async (req: Request, res: Response, next: NextFunction) => {
    const u = await o.userOf(req).catch(() => null);
    if (!(await openFor(u))) return res.status(404).json({ message: "Not found" });
    (req as any).user = u; next();
  };

  /** One field: this month's standings, your vote, last month's and this year's Crews' Choice. */
  app.get("/api/choice", gate, async (req, res) => {
    const u = (req as any).user as User;
    const icao = String(req.query.icao || "").toUpperCase();
    if (!ICAO.test(icao)) return res.status(400).json({ message: "Pick an airport." });
    const period = periodOf(), last = prevPeriod(period), year = period.slice(0, 4);
    const mine = (await rows<any>(sql`SELECT spot_id FROM crews_choice_votes WHERE user_id = ${u.id} AND icao = ${icao} AND period = ${period}`))[0];
    const [month, prev, yr, total] = await Promise.all([
      tally(icao, period), tally(icao, last, 1), tally(icao, `${year}-%`, 3),
      rows<any>(sql`SELECT COUNT(*)::int AS n FROM crews_choice_votes v JOIN spots s ON s.id = v.spot_id AND s.status = 'live' WHERE v.icao = ${icao} AND v.period = ${period}`),
    ]);
    res.set("Cache-Control", "no-store").json({ icao, period, myVote: mine ? num(mine.spot_id) : null, votes: num(total[0]?.n), month, lastMonth: prev[0] ? { period: last, ...prev[0] } : null, year: { year, leaders: yr } });
  });

  /** Vote (or move your vote) for a place to eat. One per member, per field, per month. */
  app.post("/api/choice", gate, async (req, res) => {
    const u = (req as any).user as User;
    const spotId = Number(req.body?.spotId);
    const s = (await rows<any>(sql`SELECT id, icao, category, status, name FROM spots WHERE id = ${Number.isFinite(spotId) ? spotId : -1}`))[0];
    if (!s || s.status !== "live") return res.status(404).json({ message: "That listing isn't available." });
    if (s.category !== "eat") return res.status(400).json({ message: "Crews' Choice is for places to eat." });
    const period = periodOf(), now = Date.now();
    await db().execute(sql`INSERT INTO crews_choice_votes (user_id, icao, spot_id, period, created_at, updated_at) VALUES (${u.id}, ${s.icao}, ${s.id}, ${period}, ${now}, ${now})
      ON CONFLICT (user_id, icao, period) DO UPDATE SET spot_id = EXCLUDED.spot_id, updated_at = EXCLUDED.updated_at`);
    res.json({ ok: true, icao: s.icao, period, myVote: num(s.id) });
  });
  app.delete("/api/choice", gate, async (req, res) => {
    const u = (req as any).user as User;
    const icao = String(req.query.icao || "").toUpperCase();
    if (!ICAO.test(icao)) return res.status(400).json({ message: "Pick an airport." });
    await db().execute(sql`DELETE FROM crews_choice_votes WHERE user_id = ${u.id} AND icao = ${icao} AND period = ${periodOf()}`);
    res.json({ ok: true });
  });

  /** Network view for the Crew page: this month's leader at each field that has votes, most votes first. */
  app.get("/api/choice/top", gate, async (_req, res) => {
    const period = periodOf();
    const r = await rows<any>(sql`WITH t AS (SELECT v.icao, v.spot_id, s.name, COUNT(*)::int AS n, MIN(v.created_at) AS first FROM crews_choice_votes v JOIN spots s ON s.id = v.spot_id
        WHERE v.period = ${period} AND s.status = 'live' AND s.category = 'eat' GROUP BY v.icao, v.spot_id, s.name),
      r AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY icao ORDER BY n DESC, first ASC) AS rk, SUM(n) OVER (PARTITION BY icao) AS total FROM t)
      SELECT icao, spot_id, name, n, total FROM r WHERE rk = 1 ORDER BY total DESC, icao LIMIT 12`);
    res.set("Cache-Control", "no-store").json({ period, fields: r.map((x) => ({ icao: String(x.icao), spotId: num(x.spot_id), name: String(x.name).trim(), votes: num(x.n), total: num(x.total) })) });
  });

  /** Which spots are a field's Crews' Choice (last month's winner, this year's leader). For badges on listings. */
  app.get("/api/choice/badges", gate, async (req, res) => {
    const icao = String(req.query.icao || "").toUpperCase();
    if (!ICAO.test(icao)) return res.json({ badges: {} });
    const period = periodOf(), last = prevPeriod(period);
    const [prev, yr] = await Promise.all([tally(icao, last, 1), tally(icao, `${period.slice(0, 4)}-%`, 1)]);
    const badges: Record<number, string[]> = {};
    if (prev[0]) (badges[prev[0].spotId] ||= []).push(`month:${last}`);
    if (yr[0] && yr[0].votes >= 3) (badges[yr[0].spotId] ||= []).push(`year:${period.slice(0, 4)}`);
    res.set("Cache-Control", "no-store").json({ badges });
  });

  // ---- admin switches ----
  const label = { rankArt: ["Rank mascots and one-liners opened to members", "Rank mascots back to admins only"], choice: ["Crews' Choice voting opened to members", "Crews' Choice back to admins only"] };
  for (const k of ["rankArt", "choice"] as Key[]) {
    const path = k === "rankArt" ? "/api/admin/rank-art" : "/api/admin/crews-choice";
    app.get(path, o.requireAdmin, async (_req, res) => {
      const extra = k === "choice" ? (await rows<any>(sql`SELECT COUNT(*)::int AS votes, COUNT(DISTINCT user_id)::int AS people FROM crews_choice_votes WHERE period = ${periodOf()}`))[0] : {};
      res.json({ audience: await audience(k), votes: num(extra?.votes), people: num(extra?.people) });
    });
    app.put(path, o.requireAdmin, async (req, res) => {
      const v: Audience = req.body?.audience === "members" ? "members" : "admins";
      await db().execute(sql`INSERT INTO app_settings (key, value) VALUES (${KEYS[k]}, ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      cache[k] = { at: Date.now(), v };
      await logChange({ actor: (req as any).adminName || "Admin", kind: "admin", action: KEYS[k], entity: "settings", summary: label[k][v === "members" ? 0 : 1] });
      res.json({ audience: v });
    });
  }
}
