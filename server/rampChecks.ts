/**
 * Ramp check reports (FBO intel, Oct 2026): crews flag fields where FAA or other federal inspectors are doing ramp
 * checks. Admins first behind app_settings ramp_checks_audience. Members see reports without the reporter's name;
 * admins see it for moderation and can remove any report. Notes must not identify people (stated on the form).
 */
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { logChange } from "./ops";
import type { User } from "@shared/schema";
import { publicName } from "@shared/tiers";
import { RAMP_AGENCIES, RAMP_WHEN, RAMP_ACTIVE_HOURS, RAMP_SHOW_DAYS, RAMP_HOT_DAYS, RAMP_HOT_MIN, type RampAirport } from "@shared/rampChecks";

type Audience = "admins" | "members";
let cur = { at: 0, v: "admins" as Audience };
export async function rampChecksAudience(): Promise<Audience> {
  if (Date.now() - cur.at < 15_000) return cur.v;
  const r = ((await db().execute(sql`SELECT value FROM app_settings WHERE key = 'ramp_checks_audience'`).catch(() => ({ rows: [] }))).rows[0] as any);
  cur = { at: Date.now(), v: r?.value === "members" ? "members" : "admins" };
  return cur.v;
}
const rows = async <T = any>(q: any) => ((await db().execute(q)).rows as T[]);
const num = (v: unknown) => Number(v) || 0;
const ICAO = /^[A-Z0-9]{3,4}$/;
const HOUR = 3600_000, DAY = 24 * HOUR;
const clean = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function registerRampChecks(app: Express, o: {
  userOf: (req: Request) => Promise<User | null | undefined>; isSuperAdmin: (u?: User | null) => boolean;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => any; requireUser: (req: Request, res: Response, next: NextFunction) => any;
  resolveCode: (code: string) => Promise<{ icao: string } | undefined | null>;
}) {
  void (async () => {
    await db().execute(sql`CREATE TABLE IF NOT EXISTS ramp_checks (id serial PRIMARY KEY, icao text NOT NULL, user_id integer NOT NULL, agency text NOT NULL,
      seen_at bigint NOT NULL, location text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'live', created_at bigint NOT NULL)`);
    await db().execute(sql`CREATE INDEX IF NOT EXISTS ramp_checks_field ON ramp_checks (icao, seen_at)`);
    await db().execute(sql`CREATE TABLE IF NOT EXISTS ramp_check_confirms (check_id integer NOT NULL, user_id integer NOT NULL, at bigint NOT NULL, PRIMARY KEY (check_id, user_id))`);
    await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('ramp_checks_audience', 'admins') ON CONFLICT (key) DO NOTHING`);
  })().catch((e) => console.error("ramp_checks setup", e));

  const allowed = async (u?: User | null) => (await rampChecksAudience()) === "members" || (!!u && o.isSuperAdmin(u));

  async function summary(icaos: string[], viewer?: User | null): Promise<RampAirport[]> {
    if (!icaos.length) return [];
    const admin = !!viewer && o.isSuperAdmin(viewer);
    const since = Date.now() - RAMP_HOT_DAYS * DAY;
    const list = await rows(sql`SELECT r.id, r.icao, r.agency, r.seen_at, r.location, r.note, r.user_id, u.display_name, u.handle,
        (SELECT COUNT(*)::int FROM ramp_check_confirms c WHERE c.check_id = r.id) AS confirms,
        EXISTS (SELECT 1 FROM ramp_check_confirms c WHERE c.check_id = r.id AND c.user_id = ${viewer?.id ?? -1}) AS confirmed
      FROM ramp_checks r LEFT JOIN users u ON u.id = r.user_id
      WHERE r.status = 'live' AND r.seen_at >= ${since} AND r.icao IN (${sql.join(icaos.map((x) => sql`${x}`), sql`, `)}) ORDER BY r.seen_at DESC`);
    return icaos.map((icao) => {
      const mine = list.filter((r) => r.icao === icao);
      const last = mine.length ? num(mine[0].seen_at) : null;
      const shown = mine.filter((r) => num(r.seen_at) >= Date.now() - RAMP_SHOW_DAYS * DAY).slice(0, 10);
      return {
        icao, last, recent: mine.length, hot: mine.length >= RAMP_HOT_MIN,
        active: !!last && Date.now() - last < RAMP_ACTIVE_HOURS * HOUR,
        reports: shown.map((r) => ({ id: num(r.id), agency: r.agency, seenAt: num(r.seen_at), where: r.location || "", note: r.note || "",
          confirms: num(r.confirms), mine: !!viewer && num(r.user_id) === viewer.id, confirmed: !!r.confirmed,
          ...(admin ? { by: r.display_name || r.handle || `#${r.user_id}` } : {}) })),
      };
    });
  }

  app.get("/api/ramp-checks", async (req, res) => {
    const u = await o.userOf(req);
    if (!(await allowed(u))) return res.json({ on: false, airports: [] });
    const icaos = String(req.query.icaos || "").toUpperCase().split(/[ ,]+/).filter((x) => ICAO.test(x)).slice(0, 12);
    res.json({ on: true, airports: await summary(Array.from(new Set(icaos)), u) });
  });
  /** Fields with the most reports in the last 30 days, for the FBO intel start screen. */
  app.get("/api/ramp-checks/hot", async (req, res) => {
    const u = await o.userOf(req);
    if (!(await allowed(u))) return res.json({ on: false, fields: [] });
    const since = Date.now() - RAMP_SHOW_DAYS * DAY;
    const r = await rows(sql`SELECT r.icao, a.name, a.city, a.region, COUNT(*)::int AS n, MAX(r.seen_at) AS last FROM ramp_checks r LEFT JOIN airports a ON a.icao = r.icao
      WHERE r.status = 'live' AND r.seen_at >= ${since} GROUP BY r.icao, a.name, a.city, a.region ORDER BY MAX(r.seen_at) DESC LIMIT 8`);
    res.json({ on: true, fields: r.map((x) => ({ icao: x.icao, name: x.name || "", city: [x.city, x.region].filter(Boolean).join(", "), reports: num(x.n), last: num(x.last), active: Date.now() - num(x.last) < RAMP_ACTIVE_HOURS * HOUR })) });
  });
  app.post("/api/ramp-checks", o.requireUser, async (req, res) => {
    const u = (req as any).user as User;
    if (!(await allowed(u))) return res.status(403).json({ message: "Ramp check reports aren't open yet" });
    const ap = await o.resolveCode(clean(req.body?.icao, 4).toUpperCase());
    if (!ap) return res.status(400).json({ message: "Enter the airport" });
    const agency = RAMP_AGENCIES.find((a) => a.id === req.body?.agency)?.id;
    if (!agency) return res.status(400).json({ message: "Pick who was doing the checks" });
    const when = RAMP_WHEN.find((w) => w.id === req.body?.when) || RAMP_WHEN[0];
    const recent = num(((await rows(sql`SELECT COUNT(*)::int AS n FROM ramp_checks WHERE user_id = ${u.id} AND created_at > ${Date.now() - DAY}`))[0])?.n);
    if (recent >= 6) return res.status(429).json({ message: "That's a lot of reports today. Try again tomorrow." });
    const dup = (await rows(sql`SELECT id FROM ramp_checks WHERE user_id = ${u.id} AND icao = ${ap.icao} AND status = 'live' AND created_at > ${Date.now() - 6 * HOUR}`))[0];
    if (dup) return res.status(409).json({ message: "You already reported this field in the last few hours. Tap Seen it too on another crew's report instead." });
    const now = Date.now();
    const r = (await rows(sql`INSERT INTO ramp_checks (icao, user_id, agency, seen_at, location, note, created_at)
      VALUES (${ap.icao}, ${u.id}, ${agency}, ${now - when.hoursAgo * HOUR}, ${clean(req.body?.where, 80)}, ${clean(req.body?.note, 240)}, ${now}) RETURNING id`))[0];
    await logChange({ actor: publicName(u), kind: "system", actorId: u.id, action: "ramp_check_report", entity: "ramp_check", entityId: num(r.id), summary: `Ramp check reported at ${ap.icao} (${agency}, ${when.label.toLowerCase()})` }).catch(() => {});
    res.status(201).json({ id: num(r.id), icao: ap.icao });
  });
  app.post("/api/ramp-checks/:id/confirm", o.requireUser, async (req, res) => {
    const u = (req as any).user as User;
    if (!(await allowed(u))) return res.status(403).json({ message: "Not open yet" });
    const id = num(req.params.id);
    const r = (await rows(sql`SELECT user_id FROM ramp_checks WHERE id = ${id} AND status = 'live'`))[0];
    if (!r) return res.status(404).json({ message: "Not found" });
    if (num(r.user_id) === u.id) return res.status(400).json({ message: "That's your report" });
    const had = (await rows(sql`DELETE FROM ramp_check_confirms WHERE check_id = ${id} AND user_id = ${u.id} RETURNING check_id`)).length;
    if (!had) await db().execute(sql`INSERT INTO ramp_check_confirms (check_id, user_id, at) VALUES (${id}, ${u.id}, ${Date.now()}) ON CONFLICT DO NOTHING`);
    res.json({ confirmed: !had });
  });
  app.delete("/api/ramp-checks/:id", o.requireUser, async (req, res) => {
    const u = (req as any).user as User;
    const id = num(req.params.id);
    const r = (await rows(sql`SELECT user_id, icao FROM ramp_checks WHERE id = ${id} AND status = 'live'`))[0];
    if (!r) return res.status(404).json({ message: "Not found" });
    const admin = o.isSuperAdmin(u);
    if (num(r.user_id) !== u.id && !admin) return res.status(403).json({ message: "Only the reporter or an admin can remove it" });
    await db().execute(sql`UPDATE ramp_checks SET status = 'removed' WHERE id = ${id}`);
    await logChange({ actor: publicName(u), kind: admin ? "admin" : "system", actorId: u.id, action: "ramp_check_remove", entity: "ramp_check", entityId: id, summary: `Ramp check report at ${r.icao} removed` }).catch(() => {});
    res.json({ ok: true });
  });

  app.get("/api/admin/ramp-checks", o.requireAdmin, async (_req, res) => {
    const n = num(((await rows(sql`SELECT COUNT(*)::int AS n FROM ramp_checks WHERE status = 'live' AND seen_at > ${Date.now() - RAMP_SHOW_DAYS * DAY}`).catch(() => [])) [0] as any)?.n);
    res.json({ audience: await rampChecksAudience(), votes: n, people: 0 });
  });
  app.put("/api/admin/ramp-checks", o.requireAdmin, async (req, res) => {
    const v: Audience = req.body?.audience === "members" ? "members" : "admins";
    await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('ramp_checks_audience', ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    cur = { at: Date.now(), v };
    await logChange({ actor: (req as any).adminName || "Admin", kind: "admin", action: "ramp_checks_audience", entity: "settings", entityId: 0, summary: v === "members" ? "Ramp check reports opened to members" : "Ramp check reports back to admins only" });
    res.json({ audience: v });
  });
}
