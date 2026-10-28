/**
 * Push notifications (Web Push, RFC 8030 + VAPID).
 * - iPhone/iPad: only in the home-screen app (iOS 16.4+). Android and desktop browsers: any tab.
 * - Payloads use Apple's Declarative Web Push format ({ web_push: 8030, notification }) so iOS 18.4+ shows them even if
 *   our service worker isn't running; client/public/sw.js shows the same payload everywhere else.
 * - Every push must show a visible notification (Safari revokes permission otherwise), so there are no silent pushes.
 *   Quiet hours send the notification without sound instead of holding it.
 * - Who can use it: app_settings push_audience = admins (super-admins only, for testing) or members.
 * - VAPID keys: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env if set, otherwise generated once and kept in app_settings.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { z } from "zod";
import webpush from "web-push";
import { db } from "./db";
import { logChange } from "./ops";
import type { User } from "@shared/schema";
import { DEFAULT_NOTIFY_PREFS, PREF_FOR, type NotifyPrefs, type PushAudience, type PushConfig, type PushKind } from "@shared/push";

type Mw = (req: Request, res: Response, next: NextFunction) => unknown;
const rows = async <T = any>(q: ReturnType<typeof sql>) => (await db().execute(q)).rows as T[];
const num = (v: unknown) => Number(v) || 0;
const APP_URL = (process.env.APP_URL || "https://getwheelsdown.com").replace(/\/$/, "");
const SUBJECT = process.env.VAPID_SUBJECT || "mailto:support@getwheelsdown.com";

let isAdmin: (id: number) => boolean = () => false;
let ready: Promise<void> | null = null;
let publicKey = "";

async function ensure() {
  if (ready) return ready;
  ready = (async () => {
    await db().execute(sql`CREATE TABLE IF NOT EXISTS push_subs (id serial PRIMARY KEY, user_id integer NOT NULL, endpoint text NOT NULL UNIQUE, p256dh text NOT NULL, auth text NOT NULL, ua text NOT NULL DEFAULT '', created_at bigint NOT NULL DEFAULT 0, last_ok_at bigint, fails integer NOT NULL DEFAULT 0)`);
    await db().execute(sql`CREATE INDEX IF NOT EXISTS push_subs_user_idx ON push_subs (user_id)`);
    await db().execute(sql`CREATE TABLE IF NOT EXISTS notify_prefs (user_id integer PRIMARY KEY, prefs text NOT NULL DEFAULT '{}', updated_at bigint NOT NULL DEFAULT 0)`);
    await db().execute(sql`CREATE TABLE IF NOT EXISTS push_log (id serial PRIMARY KEY, user_id integer NOT NULL, kind text NOT NULL, title text NOT NULL, sent integer NOT NULL DEFAULT 0, failed integer NOT NULL DEFAULT 0, skipped text NOT NULL DEFAULT '', created_at bigint NOT NULL DEFAULT 0)`);
    await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('push_audience', 'admins') ON CONFLICT (key) DO NOTHING`);
    let pub = process.env.VAPID_PUBLIC_KEY || "", priv = process.env.VAPID_PRIVATE_KEY || "";
    if (!pub || !priv) {
      const r = (await rows(sql`SELECT value FROM app_settings WHERE key = 'vapid_keys'`))[0];
      let k: { publicKey: string; privateKey: string } | null = null;
      try { k = r ? JSON.parse(r.value) : null; } catch { k = null; }
      if (!k?.publicKey || !k?.privateKey) {
        const g = webpush.generateVAPIDKeys();
        await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('vapid_keys', ${JSON.stringify(g)}) ON CONFLICT (key) DO NOTHING`);
        // another instance may have won the race: read back whatever is stored
        const back = (await rows(sql`SELECT value FROM app_settings WHERE key = 'vapid_keys'`))[0];
        k = JSON.parse(back.value);
      }
      pub = k!.publicKey; priv = k!.privateKey;
    }
    webpush.setVapidDetails(SUBJECT, pub, priv);
    publicKey = pub;
  })();
  ready.catch((e) => { console.error("[push] setup failed", String(e?.message || e)); ready = null; });
  return ready;
}

let audCache = { at: 0, v: "admins" as PushAudience };
export async function pushAudience(): Promise<PushAudience> {
  if (Date.now() - audCache.at < 15_000) return audCache.v;
  const r = (await rows(sql`SELECT value FROM app_settings WHERE key = 'push_audience'`).catch(() => []))[0];
  audCache = { at: Date.now(), v: r?.value === "members" ? "members" : "admins" };
  return audCache.v;
}
const allowed = async (userId: number) => isAdmin(userId) || (await pushAudience()) === "members";

export async function prefsOf(userId: number): Promise<NotifyPrefs> {
  const r = (await rows(sql`SELECT prefs FROM notify_prefs WHERE user_id = ${userId}`).catch(() => []))[0];
  let p: Partial<NotifyPrefs> = {};
  try { p = r ? JSON.parse(r.prefs) : {}; } catch { p = {}; }
  return { ...DEFAULT_NOTIFY_PREFS, ...p };
}

/** Hour of day in the member's time zone. */
const localHour = (tz: string) => {
  try { return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date())) % 24; }
  catch { return new Date().getUTCHours(); }
};
export const inQuiet = (p: NotifyPrefs) => {
  if (!p.quiet) return false;
  const h = localHour(p.tz), s = p.quietStart, e = p.quietEnd;
  return s === e ? false : s < e ? h >= s && h < e : h >= s || h < e;
};

export type PushMsg = { title: string; body?: string; link?: string; tag?: string };

/**
 * Send a notification to every device a member signed up. Never throws; failures are logged in push_log.
 * `force` skips the member's settings (used by Send a test).
 */
export async function pushTo(userId: number, kind: PushKind | "test", m: PushMsg, force = false): Promise<{ sent: number; failed: number; skipped?: string }> {
  try {
    await ensure();
    let skipped = "";
    if (!(await allowed(userId))) skipped = "audience";
    const prefs = await prefsOf(userId);
    if (!skipped && !force && kind !== "test" && !prefs[PREF_FOR[kind]]) skipped = "pref";
    const subs = skipped ? [] : await rows(sql`SELECT id, endpoint, p256dh, auth FROM push_subs WHERE user_id = ${userId}`);
    if (!skipped && !subs.length) skipped = "no_device";
    if (skipped) { if (skipped !== "audience") await log(userId, kind, m.title, 0, 0, skipped); return { sent: 0, failed: 0, skipped }; }
    const path = (m.link || "/").startsWith("/") ? m.link || "/" : "/";
    const navigate = `${APP_URL}/#${path}`;
    const quiet = inQuiet(prefs);
    const payload = JSON.stringify({
      web_push: 8030,
      notification: { title: m.title.slice(0, 120), body: (m.body || "").slice(0, 240), navigate, lang: "en-US", dir: "ltr", silent: quiet, tag: m.tag || kind },
      kind,
    });
    let sent = 0, failed = 0;
    await Promise.all(subs.map(async (s) => {
      try {
        const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
        const opts = { TTL: 6 * 3600, urgency: (quiet ? "low" : "normal") as "low" | "normal", topic: (m.tag || kind).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || undefined };
        try { await webpush.sendNotification(sub, payload, opts); }
        catch (e1: any) {
          // Some push services (Apple) reject topics they don't like; the topic only collapses repeats, so send without it.
          if (num(e1?.statusCode) === 400 && /BadWebPushTopic/i.test(String(e1?.body || ""))) await webpush.sendNotification(sub, payload, { ...opts, topic: undefined });
          else throw e1;
        }
        sent++;
        await db().execute(sql`UPDATE push_subs SET last_ok_at = ${Date.now()}, fails = 0 WHERE id = ${s.id}`);
      } catch (e: any) {
        failed++;
        const code = num(e?.statusCode);
        // 404/410: the device unsubscribed or the app was removed; forget it. Others: give up after 5 in a row.
        if (code === 404 || code === 410) await db().execute(sql`DELETE FROM push_subs WHERE id = ${s.id}`);
        else await db().execute(sql`UPDATE push_subs SET fails = fails + 1 WHERE id = ${s.id}`).then(() => db().execute(sql`DELETE FROM push_subs WHERE id = ${s.id} AND fails >= 5`));
        console.error(`[push] send failed user=${userId} code=${code || "?"}`, String(e?.body || e?.message || e).slice(0, 200));
      }
    }));
    await log(userId, kind, m.title, sent, failed, "");
    return { sent, failed };
  } catch (e: any) {
    console.error("[push] error", String(e?.message || e));
    return { sent: 0, failed: 0, skipped: "error" };
  }
}
const log = (userId: number, kind: string, title: string, sent: number, failed: number, skipped: string) =>
  db().execute(sql`INSERT INTO push_log (user_id, kind, title, sent, failed, skipped, created_at) VALUES (${userId}, ${kind}, ${title.slice(0, 160)}, ${sent}, ${failed}, ${skipped}, ${Date.now()})`).then(() => {}, () => {});

/** Fire-and-forget version for request handlers: never slows down or breaks the request. */
export const notify = (userId: number, kind: PushKind, m: PushMsg) => { void pushTo(userId, kind, m); };

/** Account deletion. */
export async function forgetPush(userId: number) {
  await db().execute(sql`DELETE FROM push_subs WHERE user_id = ${userId}`).catch(() => {});
  await db().execute(sql`DELETE FROM notify_prefs WHERE user_id = ${userId}`).catch(() => {});
  await db().execute(sql`DELETE FROM push_log WHERE user_id = ${userId}`).catch(() => {});
}

// ---------------------------------------------------------------- routes
export function registerPush(app: Express, o: { userOf: (req: Request) => Promise<User | undefined>; isSuperAdmin: (u?: User | null) => boolean; requireAdmin: Mw; requireUser: Mw }) {
  isAdmin = (id) => o.isSuperAdmin({ id } as User);
  ensure().catch(() => {});
  const limit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Slow down a little and try again." } });
  const me = async (req: Request) => (await o.userOf(req))!;

  app.get("/api/push/config", o.requireUser, async (req, res) => {
    await ensure();
    const u = await me(req);
    const devices = num((await rows(sql`SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ${u.id}`))[0]?.n);
    const out: PushConfig = { available: await allowed(u.id), opened: (await pushAudience()) === "members", publicKey, prefs: await prefsOf(u.id), devices };
    res.set("Cache-Control", "no-store").json(out);
  });

  const subBody = z.object({
    endpoint: z.string().url().max(1000).refine((s) => s.startsWith("https://"), "bad endpoint"),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
    tz: z.string().max(60).optional(),
  });
  app.post("/api/push/subscribe", o.requireUser, limit, async (req, res) => {
    await ensure();
    const u = await me(req);
    if (!(await allowed(u.id))) return res.status(403).json({ message: "Notifications aren't open yet." });
    const p = subBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "That device couldn't be signed up for notifications." });
    const now = Date.now(), ua = String(req.headers["user-agent"] || "").slice(0, 300);
    // an endpoint belongs to one browser; if someone else signs in there, it moves to them
    await db().execute(sql`INSERT INTO push_subs (user_id, endpoint, p256dh, auth, ua, created_at) VALUES (${u.id}, ${p.data.endpoint}, ${p.data.keys.p256dh}, ${p.data.keys.auth}, ${ua}, ${now})
      ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, ua = EXCLUDED.ua, fails = 0`);
    const c = await db().execute(sql`SELECT COUNT(*) AS n FROM push_subs WHERE user_id = ${u.id}`);
    // keep the 8 most recent devices
    await db().execute(sql`DELETE FROM push_subs WHERE user_id = ${u.id} AND id NOT IN (SELECT id FROM push_subs WHERE user_id = ${u.id} ORDER BY created_at DESC LIMIT 8)`);
    if (p.data.tz) {
      const cur = await prefsOf(u.id);
      if (cur.tz !== p.data.tz && isZone(p.data.tz)) await savePrefs(u.id, { ...cur, tz: p.data.tz });
    }
    res.status(201).json({ ok: true, devices: Math.min(8, num((c.rows as any[])[0]?.n)) });
  });

  app.post("/api/push/unsubscribe", o.requireUser, async (req, res) => {
    await ensure();
    const u = await me(req);
    const ep = String(req.body?.endpoint || "");
    if (ep) await db().execute(sql`DELETE FROM push_subs WHERE user_id = ${u.id} AND endpoint = ${ep}`);
    res.json({ ok: true });
  });

  const prefsBody = z.object({
    crewRequests: z.boolean(), crewUp: z.boolean(), crewUpJoins: z.boolean(), messages: z.boolean(), team: z.boolean(), quiet: z.boolean(),
    quietStart: z.number().int().min(0).max(23), quietEnd: z.number().int().min(0).max(23), tz: z.string().max(60),
  }).partial();
  app.put("/api/push/prefs", o.requireUser, limit, async (req, res) => {
    await ensure();
    const u = await me(req);
    const p = prefsBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Check the settings." });
    const next = { ...(await prefsOf(u.id)), ...p.data };
    if (!isZone(next.tz)) next.tz = DEFAULT_NOTIFY_PREFS.tz;
    await savePrefs(u.id, next);
    res.json({ prefs: next });
  });

  app.post("/api/push/test", o.requireUser, limit, async (req, res) => {
    const u = await me(req);
    if (!(await allowed(u.id))) return res.status(403).json({ message: "Notifications aren't open yet." });
    const r = await pushTo(u.id, "test", { title: "Wheelsdown notifications are on", body: "This is a test. Crew requests and Crew Up plans will show up like this.", link: "/settings", tag: "test" }, true);
    if (r.skipped === "no_device") return res.status(400).json({ message: "This account has no devices signed up yet. Turn notifications on first." });
    res.json(r);
  });

  app.get("/api/admin/push", o.requireAdmin, async (_req, res) => {
    await ensure();
    const subs = await rows(sql`SELECT COUNT(*) AS n, COUNT(DISTINCT user_id) AS users FROM push_subs`);
    const day = Date.now() - 86_400_000;
    const sent = await rows(sql`SELECT kind, SUM(sent) AS sent, SUM(failed) AS failed, COUNT(*) AS n FROM push_log WHERE created_at > ${day} GROUP BY kind`);
    res.json({ audience: await pushAudience(), devices: num(subs[0]?.n), members: num(subs[0]?.users), last24h: sent.map((r) => ({ kind: r.kind, sent: num(r.sent), failed: num(r.failed), events: num(r.n) })) });
  });
  app.put("/api/admin/push", o.requireAdmin, async (req, res) => {
    await ensure();
    const v = req.body?.audience === "members" ? "members" : "admins";
    await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('push_audience', ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    audCache = { at: Date.now(), v };
    await logChange({ actor: (req as any).adminName || "Admin", kind: "admin", action: "push_audience", entity: "settings", summary: v === "members" ? "Push notifications opened to members" : "Push notifications back to admins only" });
    res.json({ audience: v });
  });
}

const isZone = (tz: string) => { try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; } };
const savePrefs = (userId: number, p: NotifyPrefs) =>
  db().execute(sql`INSERT INTO notify_prefs (user_id, prefs, updated_at) VALUES (${userId}, ${JSON.stringify(p)}, ${Date.now()}) ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = EXCLUDED.updated_at`);
