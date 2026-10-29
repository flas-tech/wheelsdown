/**
 * Private messages: direct messages between crew, and one thread per Crew Up plan (JPJ and Jeff King, Oct 2026).
 *
 * End-to-end encrypted. Every device registers two public keys (ECDH for encryption, ECDSA for signing); the private
 * keys never leave the device. A message is encrypted on the sender's device with a fresh AES key, and that key is
 * wrapped separately for every device of every person in the conversation. This server stores only ciphertext,
 * wrapped keys and who-talked-to-whom-when. It has no way to read a message, and there is no admin view of them.
 * Not moderated (no content checks, no reports). Senders must still be crew with the people they message.
 *
 * Who can use it: app_settings dm_audience = admins (super-admins only) until it's opened to members.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { db } from "./db";
import { storage } from "./storage";
import { logChange } from "./ops";
import { crewIds, areCrew } from "./mycrew";
import { notify } from "./push";
import { TRIP_CHAT, stopNights, addDays } from "@shared/crewNetwork";
import { crewNetwork } from "./switches";
import { DM_RULES, type DmAudience, type DmConversation, type DmDevice, type DmMessage, type DmPerson, type MyDmDevice } from "@shared/dm";
import { meetupViewers, meetupVisibleTo, meetupStart } from "@shared/layover";
import type { User } from "@shared/schema";

type Mw = (req: Request, res: Response, next: NextFunction) => unknown;
const rows = async <T = any>(q: ReturnType<typeof sql>) => (await db().execute(q)).rows as T[];
const num = (v: unknown) => Number(v) || 0;
const DAY = 86400_000;
const inList = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

let audCache = { at: 0, v: "admins" as DmAudience };
export async function dmAudience(): Promise<DmAudience> {
  if (Date.now() - audCache.at < 15_000) return audCache.v;
  const r = (await rows(sql`SELECT value FROM app_settings WHERE key = 'dm_audience'`).catch(() => []))[0];
  audCache = { at: Date.now(), v: r?.value === "members" ? "members" : "admins" };
  return audCache.v;
}

export async function ensureDmTables() {
  await db().execute(sql`CREATE TABLE IF NOT EXISTS dm_devices (id serial PRIMARY KEY, user_id integer NOT NULL, enc_pub text NOT NULL, sig_pub text NOT NULL,
    label text NOT NULL DEFAULT '', created_at bigint NOT NULL DEFAULT 0, last_seen bigint NOT NULL DEFAULT 0, revoked boolean NOT NULL DEFAULT false)`);
  await db().execute(sql`CREATE INDEX IF NOT EXISTS dm_devices_user_idx ON dm_devices (user_id)`);
  await db().execute(sql`CREATE TABLE IF NOT EXISTS dm_conversations (id serial PRIMARY KEY, kind text NOT NULL, meetup_id integer, pair_key text,
    created_at bigint NOT NULL DEFAULT 0, last_at bigint NOT NULL DEFAULT 0, last_from integer)`);
  await db().execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS dm_conv_pair_idx ON dm_conversations (pair_key)`);
  await db().execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS dm_conv_meetup_idx ON dm_conversations (meetup_id)`);
  await db().execute(sql`CREATE TABLE IF NOT EXISTS dm_members (conv_id integer NOT NULL, user_id integer NOT NULL, last_read bigint NOT NULL DEFAULT 0,
    hidden boolean NOT NULL DEFAULT false, joined_at bigint NOT NULL DEFAULT 0, PRIMARY KEY (conv_id, user_id))`);
  await db().execute(sql`CREATE INDEX IF NOT EXISTS dm_members_user_idx ON dm_members (user_id)`);
  await db().execute(sql`CREATE TABLE IF NOT EXISTS dm_messages (id serial PRIMARY KEY, conv_id integer NOT NULL, sender_id integer NOT NULL, sender_device integer NOT NULL,
    ct text NOT NULL, iv text NOT NULL, eph text NOT NULL, sig text NOT NULL, created_at bigint NOT NULL DEFAULT 0)`);
  await db().execute(sql`CREATE INDEX IF NOT EXISTS dm_messages_conv_idx ON dm_messages (conv_id, id)`);
  await db().execute(sql`CREATE TABLE IF NOT EXISTS dm_keys (message_id integer NOT NULL, device_id integer NOT NULL, wrapped text NOT NULL, iv text NOT NULL, PRIMARY KEY (message_id, device_id))`);
  await db().execute(sql`ALTER TABLE dm_members ADD COLUMN IF NOT EXISTS cleared_at bigint NOT NULL DEFAULT 0`);
  // trip crew chat (crew network, Oct 2026): a group from a trip sheet, closed and deleted a few days after the trip
  await db().execute(sql`ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS briefing_id integer`);
  await db().execute(sql`ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS title text`);
  await db().execute(sql`ALTER TABLE dm_conversations ADD COLUMN IF NOT EXISTS expires_at bigint`);
  await db().execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS dm_conv_briefing_idx ON dm_conversations (briefing_id)`);
  await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('dm_audience', 'admins') ON CONFLICT (key) DO NOTHING`);
}

/** Delete a set of conversations and everything in them. */
async function dropConversations(ids: number[]) {
  if (!ids.length) return;
  await db().execute(sql`DELETE FROM dm_keys WHERE message_id IN (SELECT id FROM dm_messages WHERE conv_id IN (${inList(ids)}))`);
  await db().execute(sql`DELETE FROM dm_messages WHERE conv_id IN (${inList(ids)})`);
  await db().execute(sql`DELETE FROM dm_members WHERE conv_id IN (${inList(ids)})`);
  await db().execute(sql`DELETE FROM dm_conversations WHERE id IN (${inList(ids)})`);
}

/** Account deletion: their devices, the messages they sent, and their place in every conversation. */
export async function forgetDm(userId: number) {
  try {
    await db().execute(sql`DELETE FROM dm_keys WHERE message_id IN (SELECT id FROM dm_messages WHERE sender_id = ${userId}) OR device_id IN (SELECT id FROM dm_devices WHERE user_id = ${userId})`);
    await db().execute(sql`DELETE FROM dm_messages WHERE sender_id = ${userId}`);
    await db().execute(sql`DELETE FROM dm_devices WHERE user_id = ${userId}`);
    const direct = await rows(sql`SELECT c.id FROM dm_conversations c JOIN dm_members m ON m.conv_id = c.id WHERE m.user_id = ${userId} AND c.kind = 'direct'`);
    await db().execute(sql`DELETE FROM dm_members WHERE user_id = ${userId}`);
    await dropConversations(direct.map((r) => num(r.id))); // a direct conversation is just the two of you
  } catch (e) { console.error("[dm] forget failed", String((e as any)?.message || e)); }
}

/** Crew Up threads go away a week after their plan ends (or right away if the plan row is gone). */
async function sweep() {
  const old = await rows(sql`SELECT c.id FROM dm_conversations c LEFT JOIN meetups m ON m.id = c.meetup_id
    WHERE c.kind = 'crewup' AND (m.id IS NULL OR m.expires_at < ${Date.now() - DM_RULES.crewUpKeepDays * DAY})`).catch(() => []);
  await dropConversations(old.map((r) => num(r.id)));
  const trips = await rows(sql`SELECT id FROM dm_conversations WHERE kind = 'trip' AND expires_at < ${Date.now()}`).catch(() => []);
  await dropConversations(trips.map((r) => num(r.id)));
}

/** A positive whole-number route id, or 0 (matches nothing) so bad ids are a 404, not a database error. */
const pid = (req: Request, k = "id") => { const n = Number(String(req.params[k])); return Number.isInteger(n) && n > 0 ? n : 0; };

export function registerDm(app: Express, o: { userOf: (req: Request) => Promise<User | undefined>; isSuperAdmin: (u?: User | null) => boolean; requireAdmin: Mw }) {
  ensureDmTables().then(sweep).catch((e) => console.error("[dm] tables failed", String(e?.message || e)));
  setInterval(() => { void sweep().catch(() => {}); }, 3600_000).unref?.();
  const sendLimit = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Slow down a little and try again." } });
  const writeLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Slow down a little and try again." } });
  const openFor = async (u?: User | null) => !!u && (o.isSuperAdmin(u) || (await dmAudience()) === "members");
  const gate: Mw = async (req, res, next) => {
    const u = await o.userOf(req);
    if (!u || !(await openFor(u))) return res.status(404).json({ message: "Not found" });
    (req as any).user = u; next();
  };
  const me = (req: Request) => (req as any).user as User;

  async function people(ids: number[]): Promise<Map<number, DmPerson>> {
    const want = new Set(ids), m = new Map<number, DmPerson>();
    if (!ids.length) return m;
    // messages are between people who chose to be crew, so they show display names like Crew Up does
    for (const p of await storage.publicUsers(true)) if (want.has(p.id)) m.set(p.id, { id: p.id, name: p.displayName, crewRole: p.crewRole });
    return m;
  }
  async function devicesOf(userIds: number[]): Promise<DmDevice[]> {
    if (!userIds.length) return [];
    return (await rows(sql`SELECT id, user_id, enc_pub, sig_pub FROM dm_devices WHERE revoked = false AND user_id IN (${inList(userIds)}) ORDER BY id`))
      .map((r) => ({ id: num(r.id), userId: num(r.user_id), encPub: String(r.enc_pub), sigPub: String(r.sig_pub) }));
  }
  async function memberIds(convId: number) { return (await rows(sql`SELECT user_id FROM dm_members WHERE conv_id = ${convId}`)).map((r) => num(r.user_id)); }
  async function myConv(convId: number, uid: number) {
    return (await rows(sql`SELECT c.*, m.last_read, m.hidden, m.cleared_at FROM dm_conversations c JOIN dm_members m ON m.conv_id = c.id AND m.user_id = ${uid} WHERE c.id = ${convId}`))[0];
  }
  async function canSend(c: any, uid: number, others: number[]) {
    if (c.kind === "direct") return others.length === 1 && (await areCrew(uid, others[0]));
    if (c.kind === "trip") return Date.now() < num(c.expires_at) - (TRIP_CHAT.keepDaysAfter - 1) * DAY; // open until a day after the trip
    const mt = (await rows(sql`SELECT expires_at FROM meetups WHERE id = ${num(c.meetup_id)}`))[0];
    return !!mt && num(mt.expires_at) > Date.now() - DM_RULES.crewUpKeepDays * DAY;
  }
  async function shapeConvs(list: any[], uid: number): Promise<DmConversation[]> {
    if (!list.length) return [];
    const ids = list.map((c) => num(c.id));
    const mem = await rows(sql`SELECT conv_id, user_id FROM dm_members WHERE conv_id IN (${inList(ids)})`);
    const allIds = Array.from(new Set(mem.map((r) => num(r.user_id))));
    const ppl = await people(allIds);
    const withDevice = new Set((await devicesOf(allIds)).map((d) => d.userId));
    const mIds = list.map((c) => c.meetup_id).filter((x) => x != null).map(num);
    const mts = mIds.length ? await rows(sql`SELECT id, icao, user_id, starts_at, created_at, expires_at FROM meetups WHERE id IN (${inList(mIds)})`) : [];
    const mtBy = new Map(mts.map((m) => [num(m.id), m]));
    const out: DmConversation[] = [];
    for (const c of list) {
      const others = mem.filter((r) => num(r.conv_id) === num(c.id) && num(r.user_id) !== uid).map((r) => num(r.user_id));
      const mt = c.meetup_id != null ? mtBy.get(num(c.meetup_id)) : null;
      out.push({
        id: num(c.id), kind: c.kind === "crewup" ? "crewup" : c.kind === "trip" ? "trip" : "direct",
        trip: c.kind === "trip" ? { briefingId: num(c.briefing_id), title: String(c.title || "Trip"), endsAt: num(c.expires_at) - TRIP_CHAT.keepDaysAfter * DAY } : null,
        meetup: mt ? { id: num(mt.id), icao: String(mt.icao), hostId: num(mt.user_id), startsAt: meetupStart(mt), ended: num(mt.expires_at) < Date.now() } : null,
        people: others.map((id) => ppl.get(id)).filter(Boolean) as DmPerson[],
        lastAt: num(c.last_at), lastFrom: c.last_from == null ? null : num(c.last_from),
        unread: num(c.last_at) > num(c.last_read) && c.last_from != null && num(c.last_from) !== uid,
        canSend: await canSend(c, uid, others),
        noDevice: others.filter((id) => !withDevice.has(id)),
      });
    }
    return out;
  }

  // ---- switch and config
  app.get("/api/dm/config", async (req, res) => {
    const u = await o.userOf(req);
    res.set("Cache-Control", "no-store").json({ available: await openFor(u), opened: (await dmAudience()) === "members" });
  });
  app.get("/api/admin/dm", o.requireAdmin, async (_req, res) => {
    // counts only; there is nothing readable to show
    const n = (await rows(sql`SELECT (SELECT COUNT(*)::int FROM dm_messages) AS msgs, (SELECT COUNT(*)::int FROM dm_conversations) AS convs, (SELECT COUNT(DISTINCT user_id)::int FROM dm_devices WHERE revoked = false) AS people`))[0] || {};
    res.json({ audience: await dmAudience(), messages: num(n.msgs), conversations: num(n.convs), people: num(n.people) });
  });
  app.put("/api/admin/dm", o.requireAdmin, async (req, res) => {
    const v: DmAudience = req.body?.audience === "members" ? "members" : "admins";
    await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('dm_audience', ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    audCache = { at: Date.now(), v };
    await logChange({ actor: (req as any).adminName || "Admin", kind: "admin", action: "dm_audience", entity: "settings",
      summary: v === "members" ? "Private messages opened to members" : "Private messages back to admins only" });
    res.json({ audience: v });
  });

  // ---- devices (public keys only)
  const keyStr = z.string().min(40).max(400).regex(/^[A-Za-z0-9+/=_-]+$/);
  app.post("/api/dm/devices", gate, writeLimit, async (req, res) => {
    const u = me(req);
    const p = z.object({ encPub: keyStr, sigPub: keyStr, label: z.string().trim().max(60).default("") }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "That key doesn't look right." });
    const now = Date.now();
    const live = await rows(sql`SELECT id FROM dm_devices WHERE user_id = ${u.id} AND revoked = false ORDER BY last_seen ASC`);
    // too many: retire the one used longest ago (it can no longer read new messages)
    if (live.length >= DM_RULES.devicesMax) await db().execute(sql`UPDATE dm_devices SET revoked = true WHERE id = ${num(live[0].id)}`);
    const r = (await rows(sql`INSERT INTO dm_devices (user_id, enc_pub, sig_pub, label, created_at, last_seen) VALUES (${u.id}, ${p.data.encPub}, ${p.data.sigPub}, ${p.data.label}, ${now}, ${now}) RETURNING id`))[0];
    res.status(201).json({ id: num(r.id) });
  });
  app.get("/api/dm/devices", gate, async (req, res) => {
    const u = me(req), cur = num(req.query.current);
    const list: MyDmDevice[] = (await rows(sql`SELECT id, label, created_at, last_seen FROM dm_devices WHERE user_id = ${u.id} AND revoked = false ORDER BY last_seen DESC`))
      .map((r) => ({ id: num(r.id), label: String(r.label || ""), createdAt: num(r.created_at), lastSeen: num(r.last_seen), current: num(r.id) === cur }));
    // tells the client whether its saved device id is still live (it registers again if not)
    if (cur) await db().execute(sql`UPDATE dm_devices SET last_seen = ${Date.now()} WHERE id = ${cur} AND user_id = ${u.id} AND revoked = false`);
    res.set("Cache-Control", "no-store").json({ devices: list });
  });
  app.delete("/api/dm/devices/:id", gate, async (req, res) => {
    await db().execute(sql`UPDATE dm_devices SET revoked = true WHERE id = ${pid(req)} AND user_id = ${me(req).id}`);
    await db().execute(sql`DELETE FROM dm_keys WHERE device_id = ${pid(req)} AND device_id IN (SELECT id FROM dm_devices WHERE user_id = ${me(req).id})`);
    res.json({ ok: true });
  });

  // ---- conversations
  app.get("/api/dm/conversations", gate, async (req, res) => {
    const u = me(req);
    const list = await rows(sql`SELECT c.*, m.last_read, m.hidden FROM dm_conversations c JOIN dm_members m ON m.conv_id = c.id AND m.user_id = ${u.id}
      WHERE (m.hidden = false OR c.last_at > m.last_read) AND (c.last_at > 0 OR c.kind = 'crewup') ORDER BY c.last_at DESC, c.id DESC LIMIT 100`);
    res.set("Cache-Control", "no-store").json({ conversations: await shapeConvs(list, u.id) });
  });
  app.get("/api/dm/unread", gate, async (req, res) => {
    const u = me(req);
    const r = (await rows(sql`SELECT COUNT(*)::int AS n FROM dm_conversations c JOIN dm_members m ON m.conv_id = c.id AND m.user_id = ${u.id}
      WHERE c.last_at > m.last_read AND c.last_from IS NOT NULL AND c.last_from <> ${u.id}`))[0];
    res.set("Cache-Control", "no-store").json({ unread: num(r?.n) });
  });
  /** Start (or reopen) a direct conversation with someone in your crew. */
  app.post("/api/dm/direct", gate, writeLimit, async (req, res) => {
    const u = me(req), other = num(req.body?.userId);
    if (!other || other === u.id) return res.status(400).json({ message: "Pick someone to message." });
    if (!(await areCrew(u.id, other))) return res.status(403).json({ message: "You can message people in your crew. Add them to My Crew first." });
    const key = `${Math.min(u.id, other)}:${Math.max(u.id, other)}`, now = Date.now();
    let c = (await rows(sql`SELECT id FROM dm_conversations WHERE pair_key = ${key}`))[0];
    if (!c) {
      c = (await rows(sql`INSERT INTO dm_conversations (kind, pair_key, created_at, last_at) VALUES ('direct', ${key}, ${now}, 0) ON CONFLICT (pair_key) DO UPDATE SET pair_key = EXCLUDED.pair_key RETURNING id`))[0];
    }
    const id = num(c.id);
    await db().execute(sql`INSERT INTO dm_members (conv_id, user_id, joined_at) VALUES (${id}, ${u.id}, ${now}), (${id}, ${other}, ${now}) ON CONFLICT DO NOTHING`);
    await db().execute(sql`UPDATE dm_members SET hidden = false WHERE conv_id = ${id} AND user_id = ${u.id}`);
    res.json({ id });
  });
  /** The thread on a Crew Up plan: the host plus everyone it's shared with. Opening it adds you if you can see the plan. */
  app.post("/api/dm/crewup/:meetupId", gate, writeLimit, async (req, res) => {
    const u = me(req), mid = pid(req, "meetupId"), now = Date.now();
    if (!Number.isInteger(mid) || mid <= 0) return res.status(404).json({ message: "That plan has ended." });
    const mt = (await rows(sql`SELECT * FROM meetups WHERE id = ${mid}`))[0];
    if (!mt || num(mt.expires_at) < now - DM_RULES.crewUpKeepDays * DAY) return res.status(404).json({ message: "That plan has ended." });
    const host = num(mt.user_id);
    if (host !== u.id && (!(await areCrew(u.id, host)) || !meetupVisibleTo(mt, u.id))) return res.status(404).json({ message: "That plan has ended." });
    let c = (await rows(sql`SELECT id FROM dm_conversations WHERE meetup_id = ${mid}`))[0];
    if (!c) {
      c = (await rows(sql`INSERT INTO dm_conversations (kind, meetup_id, created_at, last_at) VALUES ('crewup', ${mid}, ${now}, 0) ON CONFLICT (meetup_id) DO UPDATE SET meetup_id = EXCLUDED.meetup_id RETURNING id`))[0];
    }
    const id = num(c.id);
    // everyone who can see the plan is in from the start, so they can read the whole thread (picked crew, or all crew)
    const seeIt = meetupViewers(mt.viewer_ids) || Array.from(await crewIds(host));
    const want = Array.from(new Set([host, u.id, ...seeIt])).slice(0, DM_RULES.crewUpMembersMax);
    await db().execute(sql`INSERT INTO dm_members (conv_id, user_id, joined_at) SELECT ${id}, x, ${now} FROM unnest(${`{${want.join(",")}}`}::int[]) AS x ON CONFLICT DO NOTHING`);
    await db().execute(sql`UPDATE dm_members SET hidden = false WHERE conv_id = ${id} AND user_id = ${u.id}`);
    res.json({ id });
  });
  /** Trip crew chat: the trip sheet's owner picks people from My Crew. One group per trip sheet; adding people later adds them. */
  app.post("/api/dm/trip/:briefingId", gate, writeLimit, async (req, res) => {
    const u = me(req), bid = pid(req, "briefingId"), now = Date.now();
    if (!((await crewNetwork.audience()) === "members" || o.isSuperAdmin(u))) return res.status(404).json({ message: "Not found" });
    const b = (await rows(sql`SELECT id, user_id, title, stops FROM briefings WHERE id = ${bid}`))[0];
    const existing = (await rows(sql`SELECT id FROM dm_conversations WHERE briefing_id = ${bid}`))[0];
    if (!b) return res.status(404).json({ message: "Trip sheet not found" });
    const owner = num(b.user_id);
    if (owner !== u.id) {
      // anyone already in the group can open it; only the owner creates it or adds people
      if (existing && (await myConv(num(existing.id), u.id))) return res.json({ id: num(existing.id) });
      return res.status(403).json({ message: "Only the trip sheet's owner can start its crew chat." });
    }
    const crew = await crewIds(u.id);
    const want: number[] = Array.from(new Set(((req.body?.userIds || []) as unknown[]).map(num))).filter((x) => x && x !== u.id);
    if (want.some((x) => !crew.has(x))) return res.status(403).json({ message: "You can add people in your crew. Add them to My Crew first." });
    let end = now + TRIP_CHAT.defaultDays * DAY;
    try { const st = JSON.parse(b.stops) as any[]; const last = st.filter((s) => s.arriveDate).map((s) => addDays(s.arriveDate, stopNights(s.layover, s.nights))).sort().pop();
      if (last) end = Math.max(now + DAY, Date.parse(last + "T23:59:00Z")); } catch { /* default */ }
    const exp = end + TRIP_CHAT.keepDaysAfter * DAY;
    let id = existing ? num(existing.id) : 0;
    if (!id) id = num((await rows(sql`INSERT INTO dm_conversations (kind, briefing_id, title, expires_at, created_at, last_at) VALUES ('trip', ${bid}, ${String(b.title || "Trip").slice(0, 80)}, ${exp}, ${now}, 0)
      ON CONFLICT (briefing_id) DO UPDATE SET briefing_id = EXCLUDED.briefing_id RETURNING id`))[0].id);
    else await db().execute(sql`UPDATE dm_conversations SET expires_at = GREATEST(expires_at, ${exp}), title = ${String(b.title || "Trip").slice(0, 80)} WHERE id = ${id}`);
    const have = await memberIds(id);
    const all = Array.from(new Set([...have, u.id, ...want])).slice(0, TRIP_CHAT.maxPeople);
    await db().execute(sql`INSERT INTO dm_members (conv_id, user_id, joined_at) SELECT ${id}, x, ${now} FROM unnest(${`{${all.join(",")}}`}::int[]) AS x ON CONFLICT DO NOTHING`);
    await db().execute(sql`UPDATE dm_members SET hidden = false WHERE conv_id = ${id} AND user_id = ${u.id}`);
    for (const x of all.filter((x) => !have.includes(x) && x !== u.id)) notify(x, "message", { title: `${u.displayName} added you to the crew chat for ${String(b.title || "a trip")}`, body: "Open Wheelsdown to see it.", link: `/messages/${id}`, tag: `dm-${id}` });
    res.json({ id });
  });
  /** Messages in a conversation, each with this device's copy of its key; plus every device to encrypt a reply for. */
  app.get("/api/dm/conversations/:id", gate, async (req, res) => {
    const u = me(req), id = pid(req), dev = num(req.query.device), before = num(req.query.before);
    const c = await myConv(id, u.id);
    if (!c) return res.status(404).json({ message: "Not found" });
    const lim = DM_RULES.pageSize;
    const msgs = await rows(sql`SELECT * FROM dm_messages WHERE conv_id = ${id} AND created_at > ${num(c.cleared_at)} ${before ? sql`AND id < ${before}` : sql``} ORDER BY id DESC LIMIT ${lim + 1}`);
    const more = msgs.length > lim; const page = msgs.slice(0, lim).reverse();
    const keys = page.length && dev ? await rows(sql`SELECT message_id, wrapped, iv FROM dm_keys WHERE device_id = ${dev} AND message_id IN (${inList(page.map((m) => num(m.id)))})
      AND device_id IN (SELECT id FROM dm_devices WHERE user_id = ${u.id})`) : [];
    const kBy = new Map(keys.map((k) => [num(k.message_id), { wrapped: String(k.wrapped), iv: String(k.iv) }]));
    const messages: DmMessage[] = page.map((m) => ({ id: num(m.id), senderId: num(m.sender_id), senderDevice: num(m.sender_device), createdAt: num(m.created_at),
      ct: String(m.ct), iv: String(m.iv), eph: String(m.eph), sig: String(m.sig), key: kBy.get(num(m.id)) || null }));
    const mem = await memberIds(id);
    // senders' devices (even retired ones) so signatures can be checked, plus live devices to encrypt for
    const senderDevs = Array.from(new Set(messages.map((m) => m.senderDevice)));
    const live = await devicesOf(mem);
    const extra = senderDevs.filter((d) => !live.some((x) => x.id === d));
    const old = extra.length ? (await rows(sql`SELECT id, user_id, enc_pub, sig_pub FROM dm_devices WHERE id IN (${inList(extra)})`)).map((r) => ({ id: num(r.id), userId: num(r.user_id), encPub: String(r.enc_pub), sigPub: String(r.sig_pub), retired: true })) : [];
    res.set("Cache-Control", "no-store").json({ conversation: (await shapeConvs([c], u.id))[0], messages, devices: [...live, ...old], more });
  });
  const sendBody = z.object({
    deviceId: z.number().int().positive(),
    ct: z.string().min(1).max(DM_RULES.ctMax), iv: z.string().min(8).max(40), eph: z.string().min(40).max(400), sig: z.string().min(40).max(400),
    keys: z.array(z.object({ deviceId: z.number().int().positive(), wrapped: z.string().min(20).max(200), iv: z.string().min(8).max(40) })).min(1).max(DM_RULES.crewUpMembersMax * DM_RULES.devicesMax),
  });
  app.post("/api/dm/conversations/:id/messages", gate, sendLimit, async (req, res) => {
    const u = me(req), id = pid(req), now = Date.now();
    const p = sendBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "That message couldn't be sent." });
    const c = await myConv(id, u.id);
    if (!c) return res.status(404).json({ message: "Not found" });
    const mem = await memberIds(id);
    const others = mem.filter((x) => x !== u.id);
    if (!(await canSend(c, u.id, others))) return res.status(403).json({ message: c.kind === "direct" ? "You're no longer crew, so you can't send new messages here." : "This plan has ended, so the thread is closed." });
    const sender = (await rows(sql`SELECT id FROM dm_devices WHERE id = ${p.data.deviceId} AND user_id = ${u.id} AND revoked = false`))[0];
    if (!sender) return res.status(409).json({ message: "This device needs to be set up again.", code: "device" });
    // the key copies have to match exactly the live devices of the people in it, so nobody is left out or added
    const want = (await devicesOf(mem)).map((d) => d.id).sort((a, b) => a - b);
    const got = Array.from(new Set(p.data.keys.map((k) => k.deviceId))).sort((a, b) => a - b);
    if (got.length !== p.data.keys.length || want.join(",") !== got.join(",")) return res.status(409).json({ message: "Someone's devices changed. Sending again.", code: "devices", devices: await devicesOf(mem) });
    const r = (await rows(sql`INSERT INTO dm_messages (conv_id, sender_id, sender_device, ct, iv, eph, sig, created_at)
      VALUES (${id}, ${u.id}, ${p.data.deviceId}, ${p.data.ct}, ${p.data.iv}, ${p.data.eph}, ${p.data.sig}, ${now}) RETURNING id`))[0];
    const mid = num(r.id);
    await db().execute(sql`INSERT INTO dm_keys (message_id, device_id, wrapped, iv) VALUES ${sql.join(p.data.keys.map((k) => sql`(${mid}, ${k.deviceId}, ${k.wrapped}, ${k.iv})`), sql`, `)}`);
    await db().execute(sql`UPDATE dm_conversations SET last_at = ${now}, last_from = ${u.id} WHERE id = ${id}`);
    await db().execute(sql`UPDATE dm_members SET last_read = ${now}, hidden = false WHERE conv_id = ${id} AND user_id = ${u.id}`);
    await db().execute(sql`UPDATE dm_members SET hidden = false WHERE conv_id = ${id} AND user_id <> ${u.id} AND hidden = true`); // a new message brings it back for anyone who deleted it
    await db().execute(sql`UPDATE dm_devices SET last_seen = ${now} WHERE id = ${p.data.deviceId}`);
    res.status(201).json({ id: mid, createdAt: now });
    // a heads-up with no message text (the server doesn't have it)
    const mt = c.kind === "crewup" ? (await rows(sql`SELECT icao FROM meetups WHERE id = ${num(c.meetup_id)}`))[0] : null;
    const title = mt ? `${u.displayName} in Crew Up at ${mt.icao}` : c.kind === "trip" ? `${u.displayName} in ${String(c.title || "trip")} crew chat` : `Message from ${u.displayName}`;
    for (const to of others) notify(to, "message", { title, body: "Open Wheelsdown to read it.", link: `/messages/${id}`, tag: `dm-${id}` });
  });
  app.post("/api/dm/conversations/:id/read", gate, async (req, res) => {
    await db().execute(sql`UPDATE dm_members SET last_read = GREATEST(last_read, ${Date.now()}) WHERE conv_id = ${pid(req)} AND user_id = ${me(req).id}`);
    res.json({ ok: true });
  });
  /** Delete it for you: off your list, and its history is gone for you (your devices' keys are dropped). Others keep their copy.
   *  If someone writes again it comes back with only the new messages. Messages everyone has deleted are removed for good. */
  app.post("/api/dm/conversations/:id/delete", gate, writeLimit, async (req, res) => {
    const u = me(req), id = pid(req), now = Date.now();
    const c = await myConv(id, u.id);
    if (!c) return res.status(404).json({ message: "Not found" });
    await db().execute(sql`UPDATE dm_members SET hidden = true, cleared_at = ${now}, last_read = GREATEST(last_read, ${now}) WHERE conv_id = ${id} AND user_id = ${u.id}`);
    await db().execute(sql`DELETE FROM dm_keys WHERE device_id IN (SELECT id FROM dm_devices WHERE user_id = ${u.id})
      AND message_id IN (SELECT id FROM dm_messages WHERE conv_id = ${id} AND created_at <= ${now})`);
    const floor = num((await rows(sql`SELECT MIN(cleared_at) AS f FROM dm_members WHERE conv_id = ${id}`))[0]?.f);
    if (floor > 0) {
      await db().execute(sql`DELETE FROM dm_keys WHERE message_id IN (SELECT id FROM dm_messages WHERE conv_id = ${id} AND created_at <= ${floor})`);
      await db().execute(sql`DELETE FROM dm_messages WHERE conv_id = ${id} AND created_at <= ${floor}`);
    }
    res.json({ ok: true });
  });
  /** Hide it from your list until someone writes again. */
  app.post("/api/dm/conversations/:id/hide", gate, async (req, res) => {
    await db().execute(sql`UPDATE dm_members SET hidden = true, last_read = GREATEST(last_read, ${Date.now()}) WHERE conv_id = ${pid(req)} AND user_id = ${me(req).id}`);
    res.json({ ok: true });
  });
}
