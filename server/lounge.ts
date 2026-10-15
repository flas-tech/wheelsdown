/**
 * Crew Lounge (Phase 0: admins only).
 * Who can see it is decided here on the server, not just hidden in the app: until app_settings lounge_audience is "members",
 * every /api/lounge route answers 404 to anyone who isn't a signed-in super-user admin, as if it didn't exist.
 * Points: only Helpful votes from other members earn anything (2 each), and they join the status ladder only once the
 * audience is "members" (see loungeHelpfulForPoints), so leaderboards don't move during the admin-only build.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { logChange } from "./ops";
import { storage } from "./storage";
import { refAirport, isCode } from "./airportsData";
import { publicName } from "@shared/tiers";
import { POINTS } from "@shared/tiers";
import { findTailNumbers, TAIL_RULE } from "@shared/tailNumber";
import {
  LOUNGE_CATEGORIES, LOUNGE_LIMITS, LOUNGE_REPORT_REASONS, LOUNGE_SEED, HOUSE_AUTHOR, isLoungeCategory,
  type LoungeAuthor, type LoungeThread, type LoungePost, type LoungeReport,
} from "@shared/lounge";
import type { User } from "@shared/schema";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
export type LoungeAudience = "admins" | "members";

const num = (v: unknown) => (v == null ? 0 : Number(v));
const rows = async <T = any>(q: any) => ((await db().execute(q)).rows as T[]);

let audienceCache: { at: number; v: LoungeAudience } | null = null;
export async function loungeAudience(): Promise<LoungeAudience> {
  if (audienceCache && Date.now() - audienceCache.at < 30_000) return audienceCache.v;
  const r = (await rows(sql`SELECT value FROM app_settings WHERE key = 'lounge_audience'`))[0];
  const v: LoungeAudience = r?.value === "members" ? "members" : "admins";
  audienceCache = { at: Date.now(), v };
  return v;
}

/** Helpful votes each member has received from others, for the status ladder. Empty until Crew Lounge opens to members. */
export async function loungeHelpfulForPoints(): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  try {
    if ((await loungeAudience()) !== "members") return out;
    const r = await rows(sql`
      SELECT author_id, COUNT(*) AS n FROM (
        SELECT t.user_id AS author_id, v.voter_id FROM lounge_votes v JOIN lounge_threads t ON v.target_type = 'thread' AND t.id = v.target_id WHERE t.status = 'live'
        UNION ALL
        SELECT p.user_id AS author_id, v.voter_id FROM lounge_votes v JOIN lounge_posts p ON v.target_type = 'post' AND p.id = v.target_id WHERE p.status = 'live'
      ) x WHERE author_id IS NOT NULL AND author_id <> voter_id GROUP BY author_id`);
    for (const x of r) out.set(num(x.author_id), num(x.n));
  } catch { /* tables not created yet */ }
  return out;
}

/** Starter threads, once. Deleting them later doesn't bring them back. */
async function seedLounge() {
  const done = (await rows(sql`SELECT value FROM app_settings WHERE key = 'lounge_seeded'`))[0];
  if (done) return;
  const existing = num((await rows(sql`SELECT COUNT(*) AS n FROM lounge_threads`))[0]?.n);
  if (!existing) {
    const now = Date.now();
    // newest first in the list: give each seed a slightly older timestamp; the pinned welcome stays on top either way
    for (let i = 0; i < LOUNGE_SEED.length; i++) {
      const s = LOUNGE_SEED[i];
      const at = now - i * 37 * 60_000;
      await db().execute(sql`INSERT INTO lounge_threads (category, title, body, airports, user_id, anonymous, pinned, locked, status, reply_count, created_at, last_activity_at)
        VALUES (${s.category}, ${s.title}, ${s.body}, ${JSON.stringify(s.airports || [])}, NULL, 0, ${s.pinned ? 1 : 0}, ${s.locked ? 1 : 0}, 'live', 0, ${at}, ${at})`);
    }
    await logChange({ actor: "System", kind: "system", action: "lounge_seed", entity: "lounge", summary: `Crew Lounge (admin only): added ${LOUNGE_SEED.length} starter threads` });
  }
  await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('lounge_seeded', ${String(Date.now())}) ON CONFLICT (key) DO NOTHING`);
}

function parseAirports(v: unknown): { ok: string[]; bad: string[] } {
  const list = (Array.isArray(v) ? v.join(" ") : String(v || "")).toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean);
  const ok: string[] = [], bad: string[] = [];
  for (const c of list) {
    const r = isCode(c) ? refAirport(c) : undefined;
    if (r) { if (!ok.includes(r.icao)) ok.push(r.icao); } else bad.push(c);
  }
  return { ok: ok.slice(0, LOUNGE_LIMITS.airports), bad };
}

/** 422 with the offending text when a tail number is in any field. */
function tailCheck(res: Response, ...fields: string[]) {
  const hits = Array.from(new Set(fields.flatMap((f) => findTailNumbers(f)).map((h) => h.text)));
  if (!hits.length) return false;
  res.status(422).json({ message: `${TAIL_RULE} Remove ${hits.map((h) => `"${h}"`).join(", ")} to post.`, tails: hits, code: "tail_number" });
  return true;
}

export function registerLounge(app: Express, o: { userOf: (req: Request) => Promise<User | undefined>; isSuperAdmin: (u?: User | null) => boolean }) {
  const writeLimit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Slow down a little and try again." } });
  seedLounge().catch((e) => console.error("[lounge] seed failed", String(e?.message || e)));

  /** Hidden until it opens: anyone without access gets the same 404 as an unknown route. */
  const requireLounge: Mw = async (req, res, next) => {
    const u = await o.userOf(req);
    const mod = o.isSuperAdmin(u);
    if (!u || (!mod && (await loungeAudience()) !== "members")) return res.status(404).json({ message: "Not found" });
    (req as any).user = u; (req as any).loungeMod = mod;
    next();
  };
  const me = (req: Request) => (req as any).user as User;
  const isMod = (req: Request) => !!(req as any).loungeMod;

  // ---- shaping ----
  async function authorsFor(ids: number[], viewerMod: boolean) {
    const pub = await storage.publicUsers(true);
    const byId = new Map(pub.map((u) => [u.id, u]));
    return (id: number | null, anonymous: boolean): LoungeAuthor => {
      if (id == null) return { id: null, name: HOUSE_AUTHOR, crewRole: "Team", tierId: null, aircraft: "", anonymous: false, house: true };
      const u = byId.get(id);
      if (!u) return { id: null, name: "Former member", crewRole: "Crew", tierId: null, aircraft: "", anonymous: true, house: false };
      const anon = anonymous;
      return {
        id: anon ? null : u.id, name: anon ? publicName({ displayName: u.displayName, crewRole: u.crewRole, anonymous: 1 }) : u.displayName,
        crewRole: u.crewRole, tierId: u.tierId, aircraft: anon ? "" : u.aircraft, anonymous: anon, house: false,
        ...(viewerMod && anon ? { realName: u.displayName } : {}),
      };
    };
  }
  async function helpfulCounts(type: "thread" | "post", ids: number[], viewer: number) {
    const counts = new Map<number, number>(), mine = new Set<number>();
    if (!ids.length) return { counts, mine };
    const r = await rows(sql`SELECT target_id, voter_id FROM lounge_votes WHERE target_type = ${type} AND target_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    for (const x of r) { const t = num(x.target_id); counts.set(t, (counts.get(t) || 0) + 1); if (num(x.voter_id) === viewer) mine.add(t); }
    return { counts, mine };
  }
  async function openReports(type: "thread" | "post", ids: number[]) {
    const m = new Map<number, number>();
    if (!ids.length) return m;
    const r = await rows(sql`SELECT target_id, COUNT(*) AS n FROM lounge_reports WHERE status = 'open' AND target_type = ${type} AND target_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) GROUP BY target_id`);
    for (const x of r) m.set(num(x.target_id), num(x.n));
    return m;
  }
  async function shapeThreads(raw: any[], req: Request): Promise<LoungeThread[]> {
    const viewer = me(req).id, mod = isMod(req);
    const author = await authorsFor([], mod);
    const ids = raw.map((t) => num(t.id));
    const { counts, mine } = await helpfulCounts("thread", ids, viewer);
    const reps = mod ? await openReports("thread", ids) : new Map();
    return raw.map((t) => ({
      id: num(t.id), category: t.category, title: t.title, body: t.body, airports: safeJson(t.airports), author: author(t.user_id == null ? null : num(t.user_id), !!num(t.anonymous)),
      mine: t.user_id != null && num(t.user_id) === viewer, pinned: !!num(t.pinned), locked: !!num(t.locked), status: t.status, replyCount: num(t.reply_count),
      helpful: counts.get(num(t.id)) || 0, votedHelpful: mine.has(num(t.id)), createdAt: num(t.created_at), editedAt: t.edited_at == null ? null : num(t.edited_at),
      lastActivityAt: num(t.last_activity_at), ...(mod ? { openReports: reps.get(num(t.id)) || 0 } : {}),
    }));
  }
  const safeJson = (s: string) => { try { const v = JSON.parse(s || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

  /** Helpful votes this member has received from others (shown in Crew Lounge now; joins status points at launch). */
  async function myHelpful(userId: number) {
    const r = await rows(sql`
      SELECT COUNT(*) AS n FROM (
        SELECT v.voter_id FROM lounge_votes v JOIN lounge_threads t ON v.target_type = 'thread' AND t.id = v.target_id WHERE t.status = 'live' AND t.user_id = ${userId}
        UNION ALL
        SELECT v.voter_id FROM lounge_votes v JOIN lounge_posts p ON v.target_type = 'post' AND p.id = v.target_id WHERE p.status = 'live' AND p.user_id = ${userId}
      ) x WHERE voter_id <> ${userId}`);
    return num(r[0]?.n);
  }

  // ---- read ----
  app.get("/api/lounge", requireLounge, async (req, res) => {
    const cat = String(req.query.category || "");
    const q = String(req.query.q || "").trim().slice(0, 80);
    const ap = parseAirports(req.query.airport).ok[0] || "";
    const sort = req.query.sort === "new" ? "new" : req.query.sort === "top" ? "top" : "active";
    const mod = isMod(req);
    const where = [mod ? sql`t.status <> 'deleted'` : sql`t.status = 'live'`];
    if (isLoungeCategory(cat)) where.push(sql`t.category = ${cat}`);
    if (q) where.push(sql`(t.title ILIKE ${"%" + q + "%"} OR t.body ILIKE ${"%" + q + "%"})`);
    if (ap) where.push(sql`t.airports LIKE ${'%"' + ap + '"%'}`);
    const order = sort === "new" ? sql`t.pinned DESC, t.created_at DESC`
      : sort === "top" ? sql`t.pinned DESC, (SELECT COUNT(*) FROM lounge_votes v WHERE v.target_type = 'thread' AND v.target_id = t.id) DESC, t.last_activity_at DESC`
      : sql`t.pinned DESC, t.last_activity_at DESC`;
    const raw = await rows(sql`SELECT t.* FROM lounge_threads t WHERE ${sql.join(where, sql` AND `)} ORDER BY ${order} LIMIT 60`);
    const counts = await rows(sql`SELECT category, COUNT(*) AS n FROM lounge_threads WHERE status = 'live' GROUP BY category`);
    const helpful = await myHelpful(me(req).id);
    const audience = await loungeAudience();
    res.json({
      audience, moderator: mod, threads: await shapeThreads(raw, req),
      categories: LOUNGE_CATEGORIES.map((c) => ({ ...c, count: num(counts.find((x) => x.category === c.id)?.n) })),
      me: { anonymous: !!me(req).anonymous, helpful, points: helpful * POINTS.loungeHelpful, countsTowardStatus: audience === "members" },
      reports: mod ? num((await rows(sql`SELECT COUNT(*) AS n FROM lounge_reports WHERE status = 'open'`))[0]?.n) : 0,
    });
  });

  app.get("/api/lounge/threads/:id", requireLounge, async (req, res) => {
    const mod = isMod(req);
    const t = (await rows(sql`SELECT * FROM lounge_threads WHERE id = ${Number(req.params.id)}`))[0];
    if (!t || t.status === "deleted" || (t.status !== "live" && !mod)) return res.status(404).json({ message: "That thread isn't here anymore." });
    const [thread] = await shapeThreads([t], req);
    const raw = await rows(sql`SELECT * FROM lounge_posts WHERE thread_id = ${thread.id} AND ${mod ? sql`status <> 'deleted'` : sql`status = 'live'`} ORDER BY created_at ASC LIMIT 500`);
    const author = await authorsFor([], mod);
    const ids = raw.map((p) => num(p.id));
    const { counts, mine } = await helpfulCounts("post", ids, me(req).id);
    const reps = mod ? await openReports("post", ids) : new Map();
    const posts: LoungePost[] = raw.map((p) => ({
      id: num(p.id), threadId: thread.id, body: p.body, author: author(p.user_id == null ? null : num(p.user_id), !!num(p.anonymous)), mine: p.user_id != null && num(p.user_id) === me(req).id,
      status: p.status, helpful: counts.get(num(p.id)) || 0, votedHelpful: mine.has(num(p.id)), createdAt: num(p.created_at), editedAt: p.edited_at == null ? null : num(p.edited_at),
      ...(mod ? { openReports: reps.get(num(p.id)) || 0 } : {}),
    }));
    res.json({ thread, posts, moderator: mod });
  });

  // ---- write ----
  app.post("/api/lounge/threads", requireLounge, writeLimit, async (req, res) => {
    const b = req.body || {};
    const title = String(b.title || "").trim(), body = String(b.body || "").trim();
    if (!isLoungeCategory(b.category)) return res.status(400).json({ message: "Pick a category." });
    if (title.length < LOUNGE_LIMITS.title[0] || title.length > LOUNGE_LIMITS.title[1]) return res.status(400).json({ message: `Titles are ${LOUNGE_LIMITS.title[0]} to ${LOUNGE_LIMITS.title[1]} characters.` });
    if (body.length < LOUNGE_LIMITS.body[0] || body.length > LOUNGE_LIMITS.body[1]) return res.status(400).json({ message: `Posts are up to ${LOUNGE_LIMITS.body[1]} characters.` });
    const aps = parseAirports(b.airports);
    if (aps.bad.length) return res.status(400).json({ message: `Unknown airport code: ${aps.bad.join(", ")}` });
    if (tailCheck(res, title, body)) return;
    const now = Date.now();
    const anon = b.anonymous === undefined ? !!me(req).anonymous : !!b.anonymous;
    const r = await rows(sql`INSERT INTO lounge_threads (category, title, body, airports, user_id, anonymous, status, created_at, last_activity_at)
      VALUES (${b.category}, ${title}, ${body}, ${JSON.stringify(aps.ok)}, ${me(req).id}, ${anon ? 1 : 0}, 'live', ${now}, ${now}) RETURNING id`);
    res.json({ id: num(r[0].id) });
  });

  app.post("/api/lounge/threads/:id/posts", requireLounge, writeLimit, async (req, res) => {
    const t = (await rows(sql`SELECT * FROM lounge_threads WHERE id = ${Number(req.params.id)}`))[0];
    if (!t || t.status !== "live") return res.status(404).json({ message: "That thread isn't here anymore." });
    if (num(t.locked) && !isMod(req)) return res.status(403).json({ message: "This thread is locked." });
    const body = String(req.body?.body || "").trim();
    if (body.length < LOUNGE_LIMITS.reply[0] || body.length > LOUNGE_LIMITS.reply[1]) return res.status(400).json({ message: `Replies are up to ${LOUNGE_LIMITS.reply[1]} characters.` });
    if (tailCheck(res, body)) return;
    const now = Date.now();
    const anon = req.body?.anonymous === undefined ? !!me(req).anonymous : !!req.body.anonymous;
    const r = await rows(sql`INSERT INTO lounge_posts (thread_id, user_id, body, anonymous, status, created_at) VALUES (${num(t.id)}, ${me(req).id}, ${body}, ${anon ? 1 : 0}, 'live', ${now}) RETURNING id`);
    await db().execute(sql`UPDATE lounge_threads SET reply_count = (SELECT COUNT(*) FROM lounge_posts WHERE thread_id = ${num(t.id)} AND status = 'live'), last_activity_at = ${now} WHERE id = ${num(t.id)}`);
    res.json({ id: num(r[0].id) });
  });

  /** Authors edit their own words; moderators also pin, lock, hide or restore. */
  app.patch("/api/lounge/threads/:id", requireLounge, writeLimit, async (req, res) => {
    const t = (await rows(sql`SELECT * FROM lounge_threads WHERE id = ${Number(req.params.id)}`))[0];
    if (!t || t.status === "deleted") return res.status(404).json({ message: "Not found" });
    const b = req.body || {}, mod = isMod(req), mine = t.user_id != null && num(t.user_id) === me(req).id;
    const sets: any[] = [];
    if (b.title !== undefined || b.body !== undefined || b.airports !== undefined || b.category !== undefined) {
      if (!mine && !mod) return res.status(403).json({ message: "Only the author can edit this." });
      const title = b.title === undefined ? t.title : String(b.title).trim();
      const body = b.body === undefined ? t.body : String(b.body).trim();
      if (title.length < LOUNGE_LIMITS.title[0] || title.length > LOUNGE_LIMITS.title[1]) return res.status(400).json({ message: `Titles are ${LOUNGE_LIMITS.title[0]} to ${LOUNGE_LIMITS.title[1]} characters.` });
      if (!body || body.length > LOUNGE_LIMITS.body[1]) return res.status(400).json({ message: `Posts are up to ${LOUNGE_LIMITS.body[1]} characters.` });
      if (b.category !== undefined && !isLoungeCategory(b.category)) return res.status(400).json({ message: "Pick a category." });
      if (tailCheck(res, title, body)) return;
      sets.push(sql`title = ${title}`, sql`body = ${body}`, sql`edited_at = ${Date.now()}`);
      if (b.category !== undefined) sets.push(sql`category = ${b.category}`);
      if (b.airports !== undefined) { const aps = parseAirports(b.airports); if (aps.bad.length) return res.status(400).json({ message: `Unknown airport code: ${aps.bad.join(", ")}` }); sets.push(sql`airports = ${JSON.stringify(aps.ok)}`); }
    }
    if (b.delete === true) { if (!mine && !mod) return res.status(403).json({ message: "Only the author can delete this." }); sets.push(sql`status = 'deleted'`); }
    const modActs: string[] = [];
    if (b.pinned !== undefined || b.locked !== undefined || b.status !== undefined) {
      if (!mod) return res.status(403).json({ message: "Moderators only." });
      if (b.pinned !== undefined) { sets.push(sql`pinned = ${b.pinned ? 1 : 0}`); modActs.push(b.pinned ? "pinned" : "unpinned"); }
      if (b.locked !== undefined) { sets.push(sql`locked = ${b.locked ? 1 : 0}`); modActs.push(b.locked ? "locked" : "unlocked"); }
      if (b.status === "hidden" || b.status === "live") { sets.push(sql`status = ${b.status}`); modActs.push(b.status === "hidden" ? "hid" : "restored"); }
    }
    if (!sets.length) return res.json({ ok: true });
    await db().execute(sql`UPDATE lounge_threads SET ${sql.join(sets, sql`, `)} WHERE id = ${num(t.id)}`);
    if (modActs.length || (b.delete && !mine)) await logChange({ actor: me(req).displayName, actorId: me(req).id, action: "lounge_thread", entity: "lounge_thread", entityId: num(t.id), summary: `Crew Lounge: ${[...modActs, ...(b.delete && !mine ? ["deleted"] : [])].join(", ")} "${String(t.title).slice(0, 80)}"` });
    res.json({ ok: true });
  });

  app.patch("/api/lounge/posts/:id", requireLounge, writeLimit, async (req, res) => {
    const p = (await rows(sql`SELECT * FROM lounge_posts WHERE id = ${Number(req.params.id)}`))[0];
    if (!p || p.status === "deleted") return res.status(404).json({ message: "Not found" });
    const b = req.body || {}, mod = isMod(req), mine = p.user_id != null && num(p.user_id) === me(req).id;
    const sets: any[] = [];
    let act = "";
    if (b.body !== undefined) {
      if (!mine && !mod) return res.status(403).json({ message: "Only the author can edit this." });
      const body = String(b.body).trim();
      if (!body || body.length > LOUNGE_LIMITS.reply[1]) return res.status(400).json({ message: `Replies are up to ${LOUNGE_LIMITS.reply[1]} characters.` });
      if (tailCheck(res, body)) return;
      sets.push(sql`body = ${body}`, sql`edited_at = ${Date.now()}`);
    }
    if (b.delete === true) { if (!mine && !mod) return res.status(403).json({ message: "Only the author can delete this." }); sets.push(sql`status = 'deleted'`); if (!mine) act = "deleted"; }
    if (b.status === "hidden" || b.status === "live") { if (!mod) return res.status(403).json({ message: "Moderators only." }); sets.push(sql`status = ${b.status}`); act = b.status === "hidden" ? "hid" : "restored"; }
    if (!sets.length) return res.json({ ok: true });
    await db().execute(sql`UPDATE lounge_posts SET ${sql.join(sets, sql`, `)} WHERE id = ${num(p.id)}`);
    await db().execute(sql`UPDATE lounge_threads SET reply_count = (SELECT COUNT(*) FROM lounge_posts WHERE thread_id = ${num(p.thread_id)} AND status = 'live') WHERE id = ${num(p.thread_id)}`);
    if (act) await logChange({ actor: me(req).displayName, actorId: me(req).id, action: "lounge_post", entity: "lounge_post", entityId: num(p.id), summary: `Crew Lounge: ${act} a reply in thread #${num(p.thread_id)}` });
    res.json({ ok: true });
  });

  /** Helpful: one per member per thread or reply, never on your own. */
  app.post("/api/lounge/:type/:id/helpful", requireLounge, writeLimit, async (req, res) => {
    if (req.params.type !== "thread" && req.params.type !== "post") return res.status(404).json({ message: "Not found" });
    const type = req.params.type as "thread" | "post", tid = Number(req.params.id), on = req.body?.on !== false;
    const target = (await rows(type === "thread" ? sql`SELECT user_id, status FROM lounge_threads WHERE id = ${tid}` : sql`SELECT user_id, status FROM lounge_posts WHERE id = ${tid}`))[0];
    if (!target || target.status !== "live") return res.status(404).json({ message: "Not found" });
    if (target.user_id != null && num(target.user_id) === me(req).id) return res.status(400).json({ message: "You can't mark your own post helpful." });
    if (on) await db().execute(sql`INSERT INTO lounge_votes (target_type, target_id, voter_id, created_at) VALUES (${type}, ${tid}, ${me(req).id}, ${Date.now()}) ON CONFLICT DO NOTHING`);
    else await db().execute(sql`DELETE FROM lounge_votes WHERE target_type = ${type} AND target_id = ${tid} AND voter_id = ${me(req).id}`);
    const n = num((await rows(sql`SELECT COUNT(*) AS n FROM lounge_votes WHERE target_type = ${type} AND target_id = ${tid}`))[0]?.n);
    res.json({ helpful: n, votedHelpful: on });
  });

  app.post("/api/lounge/:type/:id/report", requireLounge, writeLimit, async (req, res) => {
    if (req.params.type !== "thread" && req.params.type !== "post") return res.status(404).json({ message: "Not found" });
    const type = req.params.type as "thread" | "post", tid = Number(req.params.id);
    const reason = String(req.body?.reason || "");
    if (!(LOUNGE_REPORT_REASONS as readonly string[]).includes(reason)) return res.status(400).json({ message: "Pick a reason." });
    const target = (await rows(type === "thread" ? sql`SELECT id FROM lounge_threads WHERE id = ${tid}` : sql`SELECT id FROM lounge_posts WHERE id = ${tid}`))[0];
    if (!target) return res.status(404).json({ message: "Not found" });
    const dup = (await rows(sql`SELECT id FROM lounge_reports WHERE target_type = ${type} AND target_id = ${tid} AND reporter_id = ${me(req).id} AND status = 'open'`))[0];
    if (!dup) await db().execute(sql`INSERT INTO lounge_reports (target_type, target_id, reporter_id, reason, note, status, created_at) VALUES (${type}, ${tid}, ${me(req).id}, ${reason}, ${String(req.body?.note || "").slice(0, 300)}, 'open', ${Date.now()})`);
    res.json({ ok: true });
  });

  // ---- moderation (super-user admins) ----
  const requireMod: Mw = (req, res, next) => (isMod(req) ? next() : res.status(404).json({ message: "Not found" }));
  app.get("/api/lounge/reports", requireLounge, requireMod, async (_req, res) => {
    const r = await rows(sql`
      SELECT r.*, u.display_name AS reporter, COALESCE(t.title, pt.title) AS thread_title, COALESCE(t.id, p.thread_id) AS thread_id, COALESCE(t.body, p.body) AS excerpt
      FROM lounge_reports r LEFT JOIN users u ON u.id = r.reporter_id
      LEFT JOIN lounge_threads t ON r.target_type = 'thread' AND t.id = r.target_id
      LEFT JOIN lounge_posts p ON r.target_type = 'post' AND p.id = r.target_id
      LEFT JOIN lounge_threads pt ON pt.id = p.thread_id
      WHERE r.status = 'open' ORDER BY r.created_at DESC LIMIT 100`);
    const out: (LoungeReport & { threadTitle: string })[] = r.map((x) => ({
      id: num(x.id), targetType: x.target_type, targetId: num(x.target_id), threadId: num(x.thread_id), reason: x.reason, note: x.note || "", reporter: x.reporter || "Member",
      excerpt: String(x.excerpt || "").slice(0, 240), createdAt: num(x.created_at), threadTitle: x.thread_title || "",
    }));
    res.json(out);
  });
  app.post("/api/lounge/reports/:id/resolve", requireLounge, requireMod, async (req, res) => {
    await db().execute(sql`UPDATE lounge_reports SET status = 'resolved', resolved_at = ${Date.now()}, resolved_by = ${me(req).displayName} WHERE id = ${Number(req.params.id)}`);
    res.json({ ok: true });
  });
}
