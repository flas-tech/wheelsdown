/**
 * My Crew: mutual friends. A crew request, then Accept. Crew see each other's Crew Up plans and whatever each person shares.
 * Launch switch: app_settings experience_audience ("admins" | "members"). Until it is "members", every /api/mycrew route
 * answers 404 to anyone who isn't a super-user account, exactly like the other previews. Nothing here touches points.
 *
 * Also here: member messages (feedback replies, "accepted your crew request"), shown on Logbook > Notifications.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { notify } from "./push";
import { storage } from "./storage";
import { logChange } from "./ops";
import {
  DEFAULT_PRIVACY, MYCREW_LIMITS, crewInviteUrl,
  type CrewPrivacy, type CrewPerson, type CrewMember, type CrewRequest, type MyCrewResp, type CrewFindRow, type CrewShared, type MemberMessage, type CrewRelation,
} from "@shared/mycrew";
import type { User } from "@shared/schema";
import { meetupVisibleTo, meetupStart } from "@shared/layover";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
const rows = async <T = any>(q: ReturnType<typeof sql>) => (await db().execute(q)).rows as T[];
const num = (v: unknown) => Number(v) || 0;
const DAY = 86400_000;
const APP_URL = (process.env.APP_URL || "https://getwheelsdown.com").replace(/\/$/, "");

// ---------------------------------------------------------------- launch switch
export type Audience = "admins" | "members";
let audCache = { at: 0, v: "admins" as Audience };
export async function experienceAudience(): Promise<Audience> {
  if (Date.now() - audCache.at < 15_000) return audCache.v;
  const r = (await rows(sql`SELECT value FROM app_settings WHERE key = 'experience_audience'`).catch(() => []))[0];
  audCache = { at: Date.now(), v: r?.value === "members" ? "members" : "admins" };
  return audCache.v;
}
/** One switch for the whole new experience: landing page, My Crew, Crew Up, Layover Today, Rate a spot and Crew Lounge. */
export async function setLaunchAudience(v: Audience) {
  for (const key of ["experience_audience", "layover_audience", "lounge_audience"])
    await db().execute(sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  audCache = { at: 0, v };
}

export async function ensureMyCrewTables() {
  await db().execute(sql`CREATE TABLE IF NOT EXISTS crew_links (id serial PRIMARY KEY, requester_id integer NOT NULL, addressee_id integer NOT NULL,
    status text NOT NULL DEFAULT 'pending', created_at bigint NOT NULL DEFAULT 0, responded_at bigint)`);
  // one row per pair, whichever direction it started in
  await db().execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS crew_links_pair_idx ON crew_links (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id))`);
  await db().execute(sql`CREATE INDEX IF NOT EXISTS crew_links_addressee_idx ON crew_links (addressee_id, status)`);
  await db().execute(sql`CREATE TABLE IF NOT EXISTS crew_privacy (user_id integer PRIMARY KEY, share_checkins integer NOT NULL DEFAULT 0,
    share_favorites integer NOT NULL DEFAULT 1, allow_requests integer NOT NULL DEFAULT 1, updated_at bigint NOT NULL DEFAULT 0)`);
  await db().execute(sql`CREATE TABLE IF NOT EXISTS member_messages (id serial PRIMARY KEY, user_id integer NOT NULL, kind text NOT NULL DEFAULT 'team',
    title text NOT NULL DEFAULT '', body text NOT NULL DEFAULT '', link text NOT NULL DEFAULT '', created_at bigint NOT NULL DEFAULT 0, read_at bigint)`);
  await db().execute(sql`CREATE INDEX IF NOT EXISTS member_messages_user_idx ON member_messages (user_id, created_at)`);
  await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('experience_audience', 'admins') ON CONFLICT (key) DO NOTHING`);
}

// ---------------------------------------------------------------- helpers used elsewhere (Crew Up, sign-up, account deletion)
/** Ids of everyone in this member's crew (accepted, both directions). */
export async function crewIds(userId: number): Promise<Set<number>> {
  const r = await rows(sql`SELECT requester_id, addressee_id FROM crew_links WHERE status = 'accepted' AND (requester_id = ${userId} OR addressee_id = ${userId})`).catch(() => []);
  return new Set(r.map((x) => (num(x.requester_id) === userId ? num(x.addressee_id) : num(x.requester_id))));
}
export async function areCrew(a: number, b: number) {
  if (!a || !b || a === b) return false;
  return !!(await rows(sql`SELECT 1 FROM crew_links WHERE status = 'accepted' AND LEAST(requester_id, addressee_id) = ${Math.min(a, b)} AND GREATEST(requester_id, addressee_id) = ${Math.max(a, b)} LIMIT 1`).catch(() => []))[0];
}
export async function privacyOf(userId: number): Promise<CrewPrivacy> {
  const r = (await rows(sql`SELECT * FROM crew_privacy WHERE user_id = ${userId}`).catch(() => []))[0];
  return r ? { shareCheckins: !!num(r.share_checkins), shareFavorites: !!num(r.share_favorites), allowRequests: !!num(r.allow_requests) } : { ...DEFAULT_PRIVACY };
}
export async function addMessage(userId: number, m: { kind: MemberMessage["kind"]; title: string; body?: string; link?: string }) {
  const r = (await rows(sql`INSERT INTO member_messages (user_id, kind, title, body, link, created_at) VALUES (${userId}, ${m.kind}, ${m.title.slice(0, 160)}, ${(m.body || "").slice(0, 2000)}, ${(m.link || "").slice(0, 200)}, ${Date.now()}) RETURNING id`))[0];
  // the same message on their lock screen, if they turned notifications on
  notify(userId, m.kind === "crew_accepted" ? "crew_accepted" : "team", { title: m.title, body: m.body, link: m.link || "/notifications", tag: `msg-${num(r?.id)}` });
  return num(r?.id);
}
/** A pending crew request from the inviter, made when someone signs up through a crew invite link. They still have to accept. */
export async function requestFromInvite(inviterId: number, newUserId: number) {
  if (!inviterId || !newUserId || inviterId === newUserId) return;
  await db().execute(sql`INSERT INTO crew_links (requester_id, addressee_id, status, created_at) VALUES (${inviterId}, ${newUserId}, 'pending', ${Date.now()}) ON CONFLICT DO NOTHING`).catch(() => {});
}
/** Account deletion: drop every crew link, privacy row and message. */
export async function forgetMember(userId: number) {
  await db().execute(sql`DELETE FROM crew_links WHERE requester_id = ${userId} OR addressee_id = ${userId}`).catch(() => {});
  await db().execute(sql`DELETE FROM crew_privacy WHERE user_id = ${userId}`).catch(() => {});
  await db().execute(sql`DELETE FROM member_messages WHERE user_id = ${userId}`).catch(() => {});
}

/** Inside My Crew people see the real display name: you only get here by both agreeing. */
async function peopleMap(): Promise<Map<number, CrewPerson & { anonymous: boolean }>> {
  const all = await storage.publicUsers(true);
  return new Map(all.map((u) => [u.id, { id: u.id, displayName: u.displayName, handle: u.handle, crewRole: u.crewRole, homeBase: u.homeBase || "", aircraft: u.aircraft || "", tierId: u.tierId, points: u.points, anonymous: u.anonymous }]));
}
const strip = (p: CrewPerson & { anonymous?: boolean }): CrewPerson => ({ id: p.id, displayName: p.displayName, handle: p.handle, crewRole: p.crewRole, homeBase: p.homeBase, aircraft: p.aircraft, tierId: p.tierId, points: p.points });

async function relation(me: number, other: number): Promise<{ relation: CrewRelation; requestId: number | null }> {
  if (me === other) return { relation: "self", requestId: null };
  const r = (await rows(sql`SELECT * FROM crew_links WHERE LEAST(requester_id, addressee_id) = ${Math.min(me, other)} AND GREATEST(requester_id, addressee_id) = ${Math.max(me, other)} LIMIT 1`))[0];
  if (!r || r.status === "declined") return { relation: "none", requestId: null };
  if (r.status === "accepted") return { relation: "crew", requestId: num(r.id) };
  return { relation: num(r.requester_id) === me ? "outgoing" : "incoming", requestId: num(r.id) };
}

// ---------------------------------------------------------------- routes
export function registerMyCrew(app: Express, o: { userOf: (req: Request) => Promise<User | undefined>; isSuperAdmin: (u?: User | null) => boolean; requireAdmin: Mw; requireUser: Mw }) {
  ensureMyCrewTables().catch((e) => console.error("[mycrew] tables failed", String(e?.message || e)));
  const writeLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Slow down a little and try again." } });
  const gate: Mw = async (req, res, next) => {
    const u = await o.userOf(req);
    if (!u || (!o.isSuperAdmin(u) && (await experienceAudience()) !== "members")) return res.status(404).json({ message: "Not found" });
    (req as any).user = u; next();
  };
  const me = (req: Request) => (req as any).user as User;

  /** Public: which parts of the app are open to members. The client uses it to show the new landing page. */
  app.get("/api/features", async (_req, res) => {
    res.set("Cache-Control", "no-store");
    res.json({ experience: await experienceAudience() });
  });

  app.get("/api/mycrew", gate, async (req, res) => {
    const uid = me(req).id;
    const ppl = await peopleMap();
    const links = await rows(sql`SELECT * FROM crew_links WHERE (requester_id = ${uid} OR addressee_id = ${uid}) AND status IN ('pending', 'accepted') ORDER BY created_at DESC`);
    const crewOther = links.filter((l) => l.status === "accepted").map((l) => ({ id: num(num(l.requester_id) === uid ? l.addressee_id : l.requester_id), since: num(l.responded_at || l.created_at) }));
    const privs = crewOther.length ? await rows(sql`SELECT * FROM crew_privacy WHERE user_id IN (${sql.join(crewOther.map((c) => sql`${c.id}`), sql`, `)})`) : [];
    const privBy = new Map(privs.map((p) => [num(p.user_id), p]));
    const now = Date.now();
    // their Crew Up badge: the soonest plan they shared with you (plans can be for later, and for picked crew only)
    const ups = crewOther.length ? await rows(sql`SELECT user_id, icao, starts_at, created_at, viewer_ids FROM meetups WHERE status = 'live' AND expires_at > ${now} AND user_id IN (${sql.join(crewOther.map((c) => sql`${c.id}`), sql`, `)})`).catch(() => []) : [];
    const upBy = new Map<number, string>();
    for (const u of ups.filter((r) => meetupVisibleTo(r, uid)).sort((a, z) => meetupStart(z) - meetupStart(a))) upBy.set(num(u.user_id), String(u.icao));
    const crew: CrewMember[] = crewOther.map((c) => {
      const p = ppl.get(c.id); if (!p) return null;
      const pv = privBy.get(c.id);
      return { ...strip(p), since: c.since, shares: { checkins: pv ? !!num(pv.share_checkins) : DEFAULT_PRIVACY.shareCheckins, favorites: pv ? !!num(pv.share_favorites) : DEFAULT_PRIVACY.shareFavorites }, crewUpAt: upBy.get(c.id) || null };
    }).filter(Boolean).sort((a, b) => a!.displayName.localeCompare(b!.displayName)) as CrewMember[];
    const req_ = (l: any, otherId: number): CrewRequest | null => { const p = ppl.get(otherId); return p ? { id: num(l.id), at: num(l.created_at), person: strip(p) } : null; };
    const incoming = links.filter((l) => l.status === "pending" && num(l.addressee_id) === uid).map((l) => req_(l, num(l.requester_id))).filter(Boolean) as CrewRequest[];
    const outgoing = links.filter((l) => l.status === "pending" && num(l.requester_id) === uid).map((l) => req_(l, num(l.addressee_id))).filter(Boolean) as CrewRequest[];
    const out: MyCrewResp = { crew, incoming, outgoing, privacy: await privacyOf(uid), inviteUrl: crewInviteUrl(APP_URL, uid) };
    res.json(out);
  });

  /** Find crew by name, handle or home base. Anonymous members only turn up when their exact handle is typed. */
  app.get("/api/mycrew/find", gate, async (req, res) => {
    const uid = me(req).id;
    const q = String(req.query.q || "").trim().toLowerCase().replace(/^@/, "").slice(0, 40);
    if (q.length < 2) return res.json([]);
    const ppl = Array.from((await peopleMap()).values());
    const hits = ppl.filter((p) => p.id !== uid && (p.anonymous
      ? p.handle.toLowerCase() === q
      : p.displayName.toLowerCase().includes(q) || p.handle.toLowerCase().includes(q) || (p.homeBase || "").toLowerCase() === q || (p.homeBase || "").toLowerCase() === `k${q}`))
      .slice(0, MYCREW_LIMITS.findResults);
    if (!hits.length) return res.json([]);
    const ids = hits.map((h) => h.id);
    const links = await rows(sql`SELECT * FROM crew_links WHERE (requester_id = ${uid} AND addressee_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})) OR (addressee_id = ${uid} AND requester_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}))`);
    const privs = await rows(sql`SELECT user_id, allow_requests FROM crew_privacy WHERE user_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`);
    const allow = new Map(privs.map((p) => [num(p.user_id), !!num(p.allow_requests)]));
    const out: CrewFindRow[] = hits.map((h) => {
      const l = links.find((x) => num(x.requester_id) === h.id || num(x.addressee_id) === h.id);
      const rel: CrewRelation = !l || l.status === "declined" ? "none" : l.status === "accepted" ? "crew" : num(l.requester_id) === uid ? "outgoing" : "incoming";
      return { ...strip(h), relation: rel, requestId: l && rel !== "none" ? num(l.id) : null, allowsRequests: allow.get(h.id) ?? DEFAULT_PRIVACY.allowRequests };
    });
    res.json(out);
  });

  app.get("/api/mycrew/status/:id", gate, async (req, res) => {
    const other = Number(req.params.id);
    const r = await relation(me(req).id, other);
    res.json({ ...r, allowsRequests: (await privacyOf(other)).allowRequests });
  });

  const reqBody = z.object({ userId: z.coerce.number().int().positive() });
  app.post("/api/mycrew/requests", gate, writeLimit, async (req, res) => {
    const uid = me(req).id;
    const p = reqBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Pick someone to add." });
    const other = p.data.userId;
    if (other === uid) return res.status(400).json({ message: "That's you." });
    const target = (await peopleMap()).get(other);
    if (!target) return res.status(404).json({ message: "That member isn't on Wheelsdown anymore." });
    const r = await relation(uid, other);
    if (r.relation === "crew") return res.json({ relation: "crew", requestId: r.requestId });
    if (r.relation === "outgoing") return res.json({ relation: "outgoing", requestId: r.requestId });
    const now = Date.now();
    if (r.relation === "incoming") {
      // they already asked you: sending one back just accepts it
      await db().execute(sql`UPDATE crew_links SET status = 'accepted', responded_at = ${now} WHERE id = ${r.requestId}`);
      await addMessage(other, { kind: "crew_accepted", title: `${me(req).displayName} is now in your crew`, body: "You can see each other's Crew Up plans and whatever you each share.", link: "/mycrew" });
      return res.json({ relation: "crew", requestId: r.requestId });
    }
    if (!(await privacyOf(other)).allowRequests) return res.status(403).json({ message: `${target.displayName} isn't taking crew requests right now.` });
    const pending = num((await rows(sql`SELECT COUNT(*) AS n FROM crew_links WHERE requester_id = ${uid} AND status = 'pending'`))[0]?.n);
    if (pending >= MYCREW_LIMITS.pendingOut) return res.status(429).json({ message: `You have ${pending} requests waiting. Give people a chance to answer first.` });
    // a declined pair can ask again later: reuse the row so the pair stays unique
    await db().execute(sql`DELETE FROM crew_links WHERE status = 'declined' AND LEAST(requester_id, addressee_id) = ${Math.min(uid, other)} AND GREATEST(requester_id, addressee_id) = ${Math.max(uid, other)}`);
    const row = (await rows(sql`INSERT INTO crew_links (requester_id, addressee_id, status, created_at) VALUES (${uid}, ${other}, 'pending', ${now}) ON CONFLICT DO NOTHING RETURNING id`))[0];
    if (row) notify(other, "crew_request", { title: `${me(req).displayName} wants to add you to their crew`, body: [me(req).crewRole, me(req).homeBase].filter(Boolean).join(" · ") || "Tap to accept or decline.", link: "/mycrew?tab=requests", tag: `crewreq-${uid}` });
    res.status(201).json({ relation: "outgoing", requestId: row ? num(row.id) : null });
  });

  app.post("/api/mycrew/requests/:id/:action", gate, writeLimit, async (req, res) => {
    const uid = me(req).id, id = Number(req.params.id), action = req.params.action;
    if (action !== "accept" && action !== "decline") return res.status(404).json({ message: "Not found" });
    const l = (await rows(sql`SELECT * FROM crew_links WHERE id = ${id} AND addressee_id = ${uid} AND status = 'pending'`))[0];
    if (!l) return res.status(404).json({ message: "That request was already answered or withdrawn." });
    const now = Date.now();
    if (action === "accept") {
      await db().execute(sql`UPDATE crew_links SET status = 'accepted', responded_at = ${now} WHERE id = ${id}`);
      await addMessage(num(l.requester_id), { kind: "crew_accepted", title: `${me(req).displayName} accepted your crew request`, body: "You're in each other's crew now. You can see each other's Crew Up plans and whatever you each share.", link: "/mycrew" });
    } else {
      // quiet decline: the sender just sees the request as still waiting until they cancel it, no message
      await db().execute(sql`UPDATE crew_links SET status = 'declined', responded_at = ${now} WHERE id = ${id}`);
    }
    res.json({ ok: true, relation: action === "accept" ? "crew" : "none" });
  });

  /** Remove someone from your crew, or cancel a request you sent. No message to them. */
  app.delete("/api/mycrew/:userId", gate, writeLimit, async (req, res) => {
    const uid = me(req).id, other = Number(req.params.userId);
    await db().execute(sql`DELETE FROM crew_links WHERE LEAST(requester_id, addressee_id) = ${Math.min(uid, other)} AND GREATEST(requester_id, addressee_id) = ${Math.max(uid, other)} AND (status = 'accepted' OR (status = 'pending' AND requester_id = ${uid}))`);
    // they can no longer see you in a Crew Up you host, or you in theirs
    await db().execute(sql`DELETE FROM meetup_joins WHERE (user_id = ${other} AND meetup_id IN (SELECT id FROM meetups WHERE user_id = ${uid})) OR (user_id = ${uid} AND meetup_id IN (SELECT id FROM meetups WHERE user_id = ${other}))`).catch(() => {});
    res.json({ ok: true, relation: "none" });
  });

  const privBody = z.object({ shareCheckins: z.boolean().optional(), shareFavorites: z.boolean().optional(), allowRequests: z.boolean().optional() });
  app.put("/api/mycrew/privacy", gate, writeLimit, async (req, res) => {
    const uid = me(req).id;
    const p = privBody.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid settings" });
    const next = { ...(await privacyOf(uid)), ...p.data };
    await db().execute(sql`INSERT INTO crew_privacy (user_id, share_checkins, share_favorites, allow_requests, updated_at)
      VALUES (${uid}, ${next.shareCheckins ? 1 : 0}, ${next.shareFavorites ? 1 : 0}, ${next.allowRequests ? 1 : 0}, ${Date.now()})
      ON CONFLICT (user_id) DO UPDATE SET share_checkins = EXCLUDED.share_checkins, share_favorites = EXCLUDED.share_favorites, allow_requests = EXCLUDED.allow_requests, updated_at = EXCLUDED.updated_at`);
    res.json(next);
  });

  /** What a crew member shares with you. Strangers get 404; each part is null when they keep it private. */
  app.get("/api/mycrew/:userId/shared", gate, async (req, res) => {
    const uid = me(req).id, other = Number(req.params.userId);
    if (!(await areCrew(uid, other))) return res.status(404).json({ message: "Not found" });
    const p = (await peopleMap()).get(other);
    if (!p) return res.status(404).json({ message: "Not found" });
    const pv = await privacyOf(other);
    const checkins = pv.shareCheckins ? (await rows(sql`SELECT c.spot_id, c.icao, c.created_at::float8 AS at, s.name, s.category FROM checkins c LEFT JOIN spots s ON s.id = c.spot_id
        WHERE c.user_id = ${other} AND c.created_at > ${Date.now() - 60 * DAY} ORDER BY c.created_at DESC LIMIT 40`)).map((r) => ({ spotId: r.spot_id == null ? null : num(r.spot_id), name: String(r.name || r.icao), icao: String(r.icao), category: r.category || null, at: num(r.at) })) : null;
    const favorites = pv.shareFavorites ? (await storage.favoriteSpots(other)).filter((s: any) => s.status === "live").slice(0, 60).map((s: any) => ({ id: s.id, name: s.name, icao: s.icao, category: s.category })) : null;
    const out: CrewShared = { person: strip(p), checkins, favorites };
    res.json(out);
  });

  // ---------------------------------------------------------------- member messages (not gated: feedback replies go to everyone)
  app.get("/api/me/messages", o.requireUser, async (req, res) => {
    const uid = ((req as any).user as User).id;
    const r = await rows(sql`SELECT id, kind, title, body, link, created_at::float8 AS at, read_at FROM member_messages WHERE user_id = ${uid} ORDER BY created_at DESC LIMIT 50`).catch(() => []);
    const items: MemberMessage[] = r.map((m) => ({ id: num(m.id), kind: m.kind, title: m.title, body: m.body, link: m.link, createdAt: num(m.at), unread: m.read_at == null }));
    res.json({ unread: items.filter((i) => i.unread).length, items });
  });
  app.post("/api/me/messages/seen", o.requireUser, async (req, res) => {
    await db().execute(sql`UPDATE member_messages SET read_at = ${Date.now()} WHERE user_id = ${((req as any).user as User).id} AND read_at IS NULL`);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- admin: launch switch and feedback replies
  app.get("/api/admin/launch", o.requireAdmin, async (_req, res) => res.json({ audience: await experienceAudience() }));
  app.put("/api/admin/launch", o.requireAdmin, async (req, res) => {
    const v = req.body?.audience === "members" ? "members" : "admins";
    await setLaunchAudience(v);
    await logChange({ actor: (req as any).adminName || "Admin", kind: "admin", action: "launch_audience", entity: "settings", summary: v === "members" ? "New landing page, My Crew, Crew Up and Crew Lounge opened to members" : "New landing page and its features switched back to admins only (members see the classic app)" });
    res.json({ audience: v });
  });
  /** Tell the member who sent feedback that it's handled. Lands in their Notifications and marks the feedback Done. */
  app.post("/api/admin/feedback/:id/notify", o.requireAdmin, async (req, res) => {
    const f = (await rows(sql`SELECT * FROM feedback WHERE id = ${Number(req.params.id)}`))[0];
    if (!f) return res.status(404).json({ message: "Not found" });
    if (f.user_id == null) return res.status(400).json({ message: "This was sent without signing in, so there's no account to notify. Reply by email instead." });
    const body = String(req.body?.message || "").trim().slice(0, 2000);
    if (body.length < 5) return res.status(400).json({ message: "Write a short note for them." });
    const id = await addMessage(num(f.user_id), { kind: "feedback_reply", title: String(req.body?.title || "About your feedback").slice(0, 160), body, link: String(req.body?.link || "").slice(0, 200) });
    const now = Date.now();
    await db().execute(sql`UPDATE feedback SET status = 'done', admin_note = ${`Replied in app: ${body}`.slice(0, 1000)}, updated_at = ${now} WHERE id = ${num(f.id)}`);
    await logChange({ actor: (req as any).adminName || "Admin", kind: "admin", action: "feedback_reply", entity: "feedback", entityId: num(f.id), summary: `Replied to feedback #${num(f.id)} in the member's Notifications` });
    res.json({ ok: true, messageId: id });
  });
}
