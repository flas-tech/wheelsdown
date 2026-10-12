/**
 * Admin operations log: an error log (server, API, AI and browser errors, grouped by fingerprint) and a change log
 * (every admin change, plus system events such as releases, AI runs and bonus points). Neither touches listings,
 * ratings or points; both are only read by the admin portal.
 */
import type { Express, Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { sql } from "drizzle-orm";
import { db } from "./db";

export type ErrLevel = "error" | "warn";
export type ErrSource = "server" | "api" | "ai" | "client" | "email" | "job";

const rawError = console.error.bind(console);
const SECRET_KEYS = /pass(word)?|token|secret|key|authorization|cookie/i;

/** Strip ids, numbers and quoted values so repeats of the same problem group together. */
function fingerprint(source: string, message: string, path = "") {
  const norm = (s: string) => s.toLowerCase().replace(/[0-9a-f]{8,}/g, "#").replace(/\d+/g, "#").replace(/"[^"]*"|'[^']*'/g, "…").replace(/\s+/g, " ").trim().slice(0, 160);
  return `${source}|${norm(message)}|${norm(path)}`;
}
function clip(v: unknown, n: number) { return String(v ?? "").slice(0, n); }
function scrub(v: any, depth = 0): any {
  if (v == null || depth > 4) return v;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1));
  if (typeof v === "object") return Object.fromEntries(Object.entries(v).slice(0, 60).map(([k, x]) => [k, SECRET_KEYS.test(k) ? "[hidden]" : scrub(x, depth + 1)]));
  if (typeof v === "string") return v.length > 600 ? v.slice(0, 600) + "…" : v;
  return v;
}

// a burst of the same failure shouldn't hammer the database: at most 120 writes a minute
let budget = 120, windowAt = Date.now();
let ready = false;

export async function recordError(e: { level?: ErrLevel; source: ErrSource; message: string; path?: string; method?: string; status?: number; userId?: number | null; detail?: string }) {
  try {
    if (!ready) return;
    if (Date.now() - windowAt > 60_000) { windowAt = Date.now(); budget = 120; }
    if (budget-- <= 0) return;
    const now = Date.now();
    const message = clip(e.message, 500) || "(no message)";
    const fp = fingerprint(e.source, message, e.path?.replace(/\?.*/, ""));
    const hit = await db().execute(sql`UPDATE error_log SET count = count + 1, last_at = ${now}, detail = ${clip(e.detail, 4000)}, status_code = ${e.status ?? null},
      user_id = COALESCE(${e.userId ?? null}, user_id) WHERE fingerprint = ${fp} AND resolved = false RETURNING id`);
    if (hit.rows.length) return;
    await db().execute(sql`INSERT INTO error_log (fingerprint, level, source, message, path, method, status_code, user_id, detail, count, first_at, last_at, resolved)
      VALUES (${fp}, ${e.level || "error"}, ${e.source}, ${message}, ${clip(e.path, 300)}, ${clip(e.method, 10)}, ${e.status ?? null}, ${e.userId ?? null}, ${clip(e.detail, 4000)}, 1, ${now}, ${now}, false)`);
  } catch (err) { rawError("[ops] could not record error:", String((err as any)?.message || err).slice(0, 200)); }
}
export const recordWarn = (source: ErrSource, message: string, detail = "") => recordError({ level: "warn", source, message, detail });

export async function logChange(c: { actor: string; actorId?: number | null; kind?: "admin" | "system" | "release" | "points" | "ai"; action: string; entity?: string; entityId?: number | string | null; summary: string; detail?: unknown }) {
  try {
    if (!ready) return;
    await db().execute(sql`INSERT INTO change_log (at, kind, actor, actor_id, action, entity, entity_id, summary, detail)
      VALUES (${Date.now()}, ${c.kind || "admin"}, ${clip(c.actor, 80)}, ${c.actorId ?? null}, ${clip(c.action, 60)}, ${clip(c.entity, 40)}, ${c.entityId == null ? "" : String(c.entityId)}, ${clip(c.summary, 400)},
        ${c.detail === undefined ? "" : clip(JSON.stringify(scrub(c.detail)), 6000)})`);
  } catch (err) { rawError("[ops] could not log change:", String((err as any)?.message || err).slice(0, 200)); }
}

/** console.error anywhere on the server lands in the error log; a "[tag]" prefix becomes the source. */
function captureConsole() {
  console.error = (...args: any[]) => {
    rawError(...args);
    const text = args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" ");
    const stack = args.find((a) => a instanceof Error)?.stack || "";
    const tag = /^\[([a-z-]+)\]/i.exec(text)?.[1]?.toLowerCase() || "";
    const source: ErrSource = tag.startsWith("ai") || tag === "moderator" ? "ai" : tag === "email" || tag === "mail" ? "email" : tag ? "job" : "server";
    void recordError({ source, message: text, detail: stack });
  };
}

// Admin route → plain-language label for the change log
const LABELS: [RegExp, string, string][] = [
  [/^PATCH \/api\/admin\/spots\/(\d+)$/, "edit", "spot"],
  [/^DELETE \/api\/admin\/spots\/(\d+)$/, "delete", "spot"],
  [/^POST \/api\/admin\/spots\/bulk$/, "bulk edit", "spot"],
  [/^POST \/api\/admin\/spots\/(\d+)\/clear-downvotes$/, "clear downvotes", "spot"],
  [/^POST \/api\/admin\/spots\/(\d+)\/approve$/, "approve", "spot"],
  [/^(PATCH|DELETE) \/api\/admin\/reviews\/(\d+)$/, "edit rating", "review"],
  [/^POST \/api\/admin\/moderation\/(spot|review)\/(\d+)$/, "moderation decision", "moderation"],
  [/^POST \/api\/admin\/moderation\/revert\/(\d+)$/, "undo decision", "moderation"],
  [/^POST \/api\/admin\/moderation\/(spot|review)\/(\d+)\/fix\/apply$/, "apply AI fix", "moderation"],
  [/^POST \/api\/admin\/moderation\/spot\/(\d+)\/ask-owner$/, "ask owner", "moderation"],
  [/^POST \/api\/admin\/moderation\/extras$/, "moderation setting", "setting"],
  [/^POST \/api\/admin\/users\/(\d+)\/bonus$/, "bonus points", "user"],
  [/^(PATCH|POST) \/api\/admin\/users\/(\d+)/, "edit crew member", "user"],
  [/^(PATCH|DELETE) \/api\/admin\/feedback\/(\d+)$/, "feedback", "feedback"],
  [/^POST \/api\/admin\/ads$/, "create ad", "ad"],
  [/^(PATCH|DELETE) \/api\/admin\/ads\/(\d+)$/, "edit ad", "ad"],
  [/^POST \/api\/admin\/import$/, "import", "spot"],
  [/^POST \/api\/admin\/ai-picks\/(\d+)\/hide$/, "hide AI pick", "ai_pick"],
  [/^POST \/api\/admin\/ai-picks\/refresh$/, "refresh AI picks", "ai_pick"],
  [/^POST \/api\/admin\/errors\/resolve$/, "resolve errors", "error"],
];
function describe(req: Request) {
  const path = req.originalUrl.replace(/\?.*/, "");
  const key = `${req.method} ${path}`;
  for (const [re, action, entity] of LABELS) {
    const m = re.exec(key);
    if (m) { const ids = m.slice(1).filter((x) => /^\d+$/.test(x)); return { action: req.method === "DELETE" ? `delete ${entity.replace("_", " ")}` : action, entity, entityId: ids[ids.length - 1] ?? "" }; }
  }
  const seg = path.split("/")[3] || "admin";
  return { action: req.method.toLowerCase(), entity: seg, entityId: /\/(\d+)(\/|$)/.exec(path)?.[1] ?? "" };
}
const ENTITY_NAME: Record<string, string> = { spot: "listing", review: "rating", user: "crew member", feedback: "feedback", ad: "ad", ai_pick: "AI pick", moderation: "item", setting: "setting", error: "error" };
function summarize(action: string, entity: string, id: string, body: any) {
  const b = body && typeof body === "object" ? body : {};
  if (action === "hide AI pick" && b.hidden === false) action = "show AI pick";
  const bits: string[] = [];
  if (b.action) bits.push(String(b.action));
  if (b.status) bits.push(`status → ${b.status}`);
  if (b.delta != null) bits.push(`${Number(b.delta) > 0 ? "+" : ""}${b.delta} points`);
  if (Array.isArray(b.ids)) bits.push(`${b.ids.length} item${b.ids.length === 1 ? "" : "s"}`);
  if (b.value) bits.push(`→ ${b.value}`);
  if (b.icao) bits.push(String(b.icao));
  const fields = Object.keys(b).filter((k) => !["action", "status", "delta", "ids", "value", "icao", "reason", "note", "hidden"].includes(k) && !SECRET_KEYS.test(k));
  if (fields.length && action === "edit") bits.push(`changed ${fields.slice(0, 6).join(", ")}`);
  if (b.reason || b.note) bits.push(`"${clip(b.reason || b.note, 80)}"`);
  const named = action.toLowerCase().includes((ENTITY_NAME[entity] || entity).toLowerCase());
  return `${action[0].toUpperCase()}${action.slice(1)}${id ? (named ? ` #${id}` : ` ${ENTITY_NAME[entity] || entity} #${id}`) : ""}${bits.length ? ` · ${bits.join(" · ")}` : ""}`;
}

const DAY = 86_400_000;
export async function pruneOps() {
  await db().execute(sql`DELETE FROM error_log WHERE last_at < ${Date.now() - 90 * DAY}`).catch(() => {});
  await db().execute(sql`DELETE FROM change_log WHERE at < ${Date.now() - 400 * DAY}`).catch(() => {});
}

/** Install before routes: console capture, 5xx capture, and the admin-change recorder. */
export function installOps(app: Express) {
  ready = true;
  captureConsole();
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/api/")) return next();
    res.on("finish", () => {
      const u = (req as any)._user || (req as any).user;
      if (res.statusCode >= 500 && !res.locals.errLogged)
        void recordError({ source: "api", message: `${res.statusCode} on ${req.method} ${req.path}`, path: req.path, method: req.method, status: res.statusCode, userId: u?.id ?? null });
      const m = req.method;
      if (req.path.startsWith("/api/admin/") && m !== "GET" && m !== "HEAD" && res.statusCode < 400 && !/\/login$|\/ai-picks\/more$/.test(req.path)
        // moderation decisions, undo and AI fixes are already in the moderation log, which the Change log includes
        && !/^\/api\/admin\/moderation\/((spot|review)\/\d+(\/fix\/apply)?|revert\/\d+)$/.test(req.path)) {
        const d = describe(req);
        void logChange({ kind: "admin", actor: (req as any).adminName || "Admin key", actorId: u?.id ?? null, action: d.action, entity: d.entity, entityId: d.entityId, summary: summarize(d.action, d.entity, d.entityId, req.body), detail: req.body });
      }
    });
    next();
  });
  setTimeout(() => pruneOps(), 30_000).unref();
  setInterval(() => pruneOps(), DAY).unref();
}

/** Server error handler hook: logs the error with its request so the generic 5xx capture doesn't double-count it. */
export function logRequestError(err: any, req: Request, res: Response) {
  res.locals.errLogged = true;
  if ((err?.status || err?.statusCode || 500) < 500) return;
  const u = (req as any)._user || (req as any).user;
  void recordError({ source: "api", message: String(err?.message || err), path: req.path, method: req.method, status: err?.status || err?.statusCode || 500, userId: u?.id ?? null, detail: err?.stack || "" });
}

/** Record the running release once per deploy. */
export async function recordRelease() {
  const sha = (process.env.RENDER_GIT_COMMIT || "").slice(0, 7);
  if (!sha) return;
  const seen = (await db().execute(sql`SELECT 1 FROM change_log WHERE kind = 'release' AND entity_id = ${sha} LIMIT 1`)).rows.length;
  if (!seen) await logChange({ kind: "release", actor: "Render", action: "deploy", entity: "release", entityId: sha, summary: `Release ${sha} went live` });
}

export function registerOps(app: Express, o: { requireAdmin: any; userOf: (req: Request) => Promise<any> }) {
  // browser errors (window.onerror, unhandled promise rejections, failed API calls) from the web app
  const clientLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { ok: false } });
  app.post("/api/client-errors", clientLimit, async (req, res) => {
    const b = req.body || {};
    const u = await o.userOf(req).catch(() => undefined);
    const message = clip(b.message, 500).trim();
    if (!message) return res.status(400).json({ ok: false });
    // noise from browser extensions and aborted navigations isn't actionable
    if (/ResizeObserver loop|chrome-extension:|moz-extension:|Script error\.?$|AbortError|Load failed$/i.test(message)) return res.json({ ok: true });
    await recordError({ level: b.level === "warn" ? "warn" : "error", source: "client", message, path: clip(b.page, 300), method: clip(b.kind, 10), status: Number(b.status) || undefined, userId: u?.id ?? null,
      detail: [clip(b.stack, 3000), b.ua ? `UA: ${clip(b.ua, 300)}` : ""].filter(Boolean).join("\n") });
    res.json({ ok: true });
  });

  app.get("/api/admin/errors", o.requireAdmin, async (req, res) => {
    const q = req.query as Record<string, string>;
    const days = Math.min(Math.max(Number(q.days) || 7, 1), 90);
    const since = Date.now() - days * DAY;
    const limit = Math.min(Number(q.limit) || 50, 200), offset = Math.max(Number(q.offset) || 0, 0);
    const where = [sql`last_at >= ${since}`];
    if (q.source && q.source !== "all") where.push(sql`source = ${q.source}`);
    if (q.level && q.level !== "all") where.push(sql`level = ${q.level}`);
    if (!q.status || q.status === "open") where.push(sql`resolved = false`);
    else if (q.status === "resolved") where.push(sql`resolved = true`);
    if (q.q) { const t = `%${q.q.toLowerCase()}%`; where.push(sql`(lower(message) LIKE ${t} OR lower(path) LIKE ${t} OR lower(detail) LIKE ${t})`); }
    const w = sql.join(where, sql` AND `);
    const rows = (await db().execute(sql`SELECT id, level, source, message, path, method, status_code, user_id, detail, count, first_at::float8 AS first_at, last_at::float8 AS last_at, resolved, resolved_by, resolved_at::float8 AS resolved_at
      FROM error_log WHERE ${w} ORDER BY last_at DESC LIMIT ${limit} OFFSET ${offset}`)).rows;
    const total = Number(((await db().execute(sql`SELECT count(*)::int AS n FROM error_log WHERE ${w}`)).rows[0] as any).n);
    const facet = async (col: "source" | "level") => Object.fromEntries(((await db().execute(sql`SELECT ${sql.raw(col)} AS k, sum(count)::int AS n FROM error_log WHERE last_at >= ${since} AND resolved = false GROUP BY 1`)).rows as any[]).map((r) => [r.k, r.n]));
    const day = Number(((await db().execute(sql`SELECT coalesce(sum(count), 0)::int AS n FROM error_log WHERE last_at >= ${Date.now() - DAY} AND resolved = false`)).rows[0] as any).n);
    const trend = ((await db().execute(sql`SELECT to_char(to_timestamp(last_at / 1000) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d, sum(count)::int AS n FROM error_log WHERE last_at >= ${since} GROUP BY 1 ORDER BY 1`)).rows as any[]).map((r) => [r.d, r.n]);
    res.json({ rows, total, facets: { source: await facet("source"), level: await facet("level") }, last24h: day, trend });
  });
  app.post("/api/admin/errors/resolve", o.requireAdmin, async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number).filter((x: number) => x > 0).slice(0, 500);
    const reopen = !!req.body?.reopen;
    const who = (req as any).adminName || "Admin key";
    if (!ids.length) return res.status(400).json({ message: "Pick at least one error" });
    const r = await db().execute(sql`UPDATE error_log SET resolved = ${!reopen}, resolved_by = ${reopen ? "" : who}, resolved_at = ${reopen ? null : Date.now()} WHERE id IN (${sql.join(ids.map((x: number) => sql`${x}`), sql`, `)}) RETURNING id`);
    res.json({ updated: r.rows.length });
  });

  /** Overview tab: one call with the numbers an admin checks first. */
  app.get("/api/admin/overview", o.requireAdmin, async (_req, res) => {
    const n = async (q: any) => Number(((await db().execute(q)).rows[0] as any)?.n || 0);
    const day = Date.now() - DAY, week = Date.now() - 7 * DAY;
    const today = new Date().toISOString().slice(0, 10);
    const [listings, pending, users, newUsers, reviews, reviewsWeek, feedbackNew, errorsOpen, errors24, aiAirports, aiRows, aiClaimed, aiBonus, changesWeek] = await Promise.all([
      n(sql`SELECT count(*)::int n FROM spots WHERE status = 'live'`), n(sql`SELECT count(*)::int n FROM spots WHERE status = 'pending'`),
      n(sql`SELECT count(*)::int n FROM users`), n(sql`SELECT count(*)::int n FROM users WHERE created_at >= ${week}`),
      n(sql`SELECT count(*)::int n FROM reviews WHERE status = 'live'`), n(sql`SELECT count(*)::int n FROM reviews WHERE created_at >= ${week}`),
      n(sql`SELECT count(*)::int n FROM feedback WHERE status = 'new'`),
      n(sql`SELECT count(*)::int n FROM error_log WHERE resolved = false`), n(sql`SELECT coalesce(sum(count), 0)::int n FROM error_log WHERE last_at >= ${day}`),
      n(sql`SELECT count(DISTINCT icao)::int n FROM ai_picks WHERE status = 'live'`), n(sql`SELECT count(*)::int n FROM ai_picks WHERE status = 'live'`),
      n(sql`SELECT count(*)::int n FROM ai_picks WHERE spot_id IS NOT NULL`), n(sql`SELECT count(*)::int n FROM ai_picks WHERE bonus_user_id IS NOT NULL`),
      n(sql`SELECT count(*)::int n FROM change_log WHERE at >= ${week}`),
    ]);
    const ai = (await db().execute(sql`SELECT coalesce(sum(calls), 0)::int AS calls, coalesce(sum(failures), 0)::int AS failures FROM ai_usage_daily WHERE day = ${today}`).catch(() => ({ rows: [{}] }))).rows[0] as any;
    const release = (await db().execute(sql`SELECT entity_id, at::float8 AS at FROM change_log WHERE kind = 'release' ORDER BY at DESC LIMIT 1`)).rows[0] as any;
    const recentErrors = (await db().execute(sql`SELECT id, level, source, message, count, last_at::float8 AS last_at FROM error_log WHERE resolved = false ORDER BY last_at DESC LIMIT 5`)).rows;
    const recentChanges = (await db().execute(sql`SELECT id, kind, actor, summary, at::float8 AS at FROM change_log ORDER BY at DESC LIMIT 6`)).rows;
    res.json({ listings, pending, users, newUsers, reviews, reviewsWeek, feedbackNew, errorsOpen, errors24, aiAirports, aiRows, aiClaimed, aiBonus, changesWeek,
      aiCallsToday: ai?.calls || 0, aiFailuresToday: ai?.failures || 0, release: release ? { sha: release.entity_id, at: release.at } : null, recentErrors, recentChanges });
  });

  app.get("/api/admin/changes", o.requireAdmin, async (req, res) => {
    const q = req.query as Record<string, string>;
    const days = Math.min(Math.max(Number(q.days) || 30, 1), 400);
    const since = Date.now() - days * DAY;
    const limit = Math.min(Number(q.limit) || 50, 200), offset = Math.max(Number(q.offset) || 0, 0);
    // admin and system changes, plus the moderation decision log (AI, admins and owners) in one timeline
    const base = sql`(SELECT 'c' || id AS key, at::float8 AS at, kind, actor, action, entity, entity_id, summary, detail FROM change_log
      UNION ALL SELECT 'm' || id, created_at::float8, 'moderation', CASE actor WHEN 'ai' THEN 'AI moderator' WHEN 'owner' THEN 'Owner' WHEN 'system' THEN 'System' WHEN 'admin' THEN coalesce(substring(reason from '\(by ([^)]+)\)$'), substring(reason from '^By (.+)$'), 'Admin') ELSE actor END, action, kind, target_id::text,
        initcap(action) || ' ' || kind || ' #' || target_id || CASE WHEN coalesce(reason, '') <> '' THEN ' · ' || left(reason, 160) ELSE '' END,
        CASE WHEN before IS NULL AND after IS NULL THEN '' ELSE json_build_object('before', before, 'after', after)::text END FROM mod_log) t`;
    const where = [sql`at >= ${since}`];
    if (q.kind && q.kind !== "all") where.push(sql`kind = ${q.kind}`);
    if (q.entity && q.entity !== "all") where.push(sql`entity = ${q.entity}`);
    if (q.actor && q.actor !== "all") where.push(sql`actor = ${q.actor}`);
    if (q.q) { const t = `%${q.q.toLowerCase()}%`; where.push(sql`(lower(summary) LIKE ${t} OR lower(actor) LIKE ${t} OR entity_id = ${q.q.replace(/^#/, "")})`); }
    const w = sql.join(where, sql` AND `);
    const rows = (await db().execute(sql`SELECT * FROM ${base} WHERE ${w} ORDER BY at DESC LIMIT ${limit} OFFSET ${offset}`)).rows;
    const total = Number(((await db().execute(sql`SELECT count(*)::int AS n FROM ${base} WHERE ${w}`)).rows[0] as any).n);
    const facet = async (col: string) => Object.fromEntries(((await db().execute(sql`SELECT ${sql.raw(col)} AS k, count(*)::int AS n FROM ${base} WHERE at >= ${since} GROUP BY 1 ORDER BY 2 DESC LIMIT 30`)).rows as any[]).map((r) => [r.k, r.n]));
    res.json({ rows, total, facets: { kind: await facet("kind"), entity: await facet("entity"), actor: await facet("actor") } });
  });
}
