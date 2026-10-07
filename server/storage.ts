import { airports, spots, reviews, ads, votes, users, sessions, passwordResets, briefings, favorites, modLog, appSettings, follows } from "@shared/schema";
import { parseInterests } from "@shared/interests";
import { WRIGHT_SEATS, isTestSignup } from "@shared/club";
import { achievementProgress, type AchStats } from "@shared/achievements";
import type { Briefing, BriefingStop } from "@shared/schema";
import { crewCost } from "@shared/cost";
import { refAirport, isCode } from "./airportsData";
import type { User, Vote, ReviewWithVotes, Airport, InsertAirport, Spot, InsertSpot, Review, InsertReview, Ad, InsertAd, SpotWithStats } from "@shared/schema";
import { computePoints, recentActivity, publicName, tierFor, SEED_USERS, SEED_PASSWORD, type PublicUser, type Me } from "@shared/tiers";
import { computeVet, seedVotesFor, shouldAutoHold } from "@shared/vetting";
import { seedAirports, seedSpots, seedReviews, seedAds } from "@shared/seed";
import { eq, inArray, desc, sql, and, lt, or, isNull } from "drizzle-orm";
import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { db, initDb } from "./db";

const scrypt = promisify(_scrypt) as (pw: string, salt: string, len: number) => Promise<Buffer>;
const SESSION_DAYS = Number(process.env.SESSION_DAYS || 90);
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hashPassword(pw: string) {
  const salt = randomBytes(16).toString("hex");
  return `scrypt:${salt}:${(await scrypt(pw, salt, 64)).toString("hex")}`;
}
async function checkPassword(pw: string, stored: string) {
  const [, salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, "hex"), b = await scrypt(pw, salt, 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Seed modes:
 *  - demo:    sample crew, votes, reviews and sample ads (local dev / demos only)
 *  - starter: airports + starter listings credited to "Wheelsdown team", plus the house ad. No fake people or votes. (opt-in)
 *  - none:    airports only (production default)
 */
export async function seedIfEmpty() {
  const d = db();
  const [{ c }] = (await d.execute(sql`SELECT COUNT(*)::int AS c FROM airports`)).rows as any[];
  if (c > 0) return;
  const mode = (process.env.SEED_MODE || (process.env.NODE_ENV === "production" ? "none" : "demo")) as "demo" | "starter" | "none";
  const now = Date.now();
  await d.insert(airports).values(seedAirports.map(([icao, iata, name, city, region, country]) => ({ icao, iata, name, city, region, country })));
  if (mode === "none") return console.log("[seed] airports only");
  const contact = process.env.CONTACT_EMAIL ? `mailto:${process.env.CONTACT_EMAIL}?subject=Advertising%20on%20Wheelsdown` : "#/about";
  const house = { ...seedAds[0], url: contact };
  let owners: User[] = [];
  if (mode === "demo") {
    const pw = await hashPassword(SEED_PASSWORD);
    owners = await d.insert(users).values(SEED_USERS.map((u, i) => ({
      handle: u.handle, displayName: u.displayName, crewRole: u.crewRole, homeBase: u.homeBase, passwordHash: pw, bonusPoints: u.bonus, createdAt: now - (400 - i * 50) * 86400_000,
    }))).returning();
  }
  const ids: Record<string, number> = {};
  for (let i = 0; i < seedSpots.length; i++) {
    const s = seedSpots[i];
    const owner = owners.length ? owners[i % owners.length] : undefined;
    const [r] = await d.insert(spots).values({ ...s, tags: JSON.stringify(s.tags), submittedBy: owner?.displayName ?? "Wheelsdown team", userId: owner?.id ?? null, status: "live", createdAt: now - i * 3600_000 }).returning();
    ids[s.name] = r.id;
    if (mode === "demo") {
      const vs = seedVotesFor(i, now);
      if (vs.length) await d.insert(votes).values(vs.map((v) => ({ targetType: "spot", targetId: r.id, ...v })));
    }
  }
  if (mode === "demo") {
    for (let i = 0; i < seedReviews.length; i++) {
      const r = seedReviews[i];
      const u = owners.find((x) => x.displayName === r.author);
      if (ids[r.spot]) await d.insert(reviews).values({ spotId: ids[r.spot], rating: r.rating, comment: r.comment, author: r.author, crewRole: r.crewRole, userId: u?.id ?? null, createdAt: now - i * 7200_000 });
    }
    await d.insert(ads).values([house, ...seedAds.slice(1)]);
  } else {
    await d.insert(ads).values([house]);
  }
  console.log(`[seed] ${mode}: ${seedAirports.length} airports, ${seedSpots.length} listings`);
}

async function withStats(rows: Spot[], voter = ""): Promise<SpotWithStats[]> {
  if (!rows.length) return [];
  const d = db();
  const ids = rows.map((r) => r.id);
  const agg = await d.select({ spotId: reviews.spotId, avg: sql<number>`AVG(${reviews.rating})::float`, n: sql<number>`COUNT(*)::int`, go: sql<number>`(COUNT(*) FILTER (WHERE ${reviews.rating} = 0))::int`,
    costs: sql<(number | null)[]>`array_agg(${reviews.costLevel})` })
    .from(reviews).where(and(inArray(reviews.spotId, ids), eq(reviews.status, "live"))).groupBy(reviews.spotId);
  const m = new Map(agg.map((a) => [a.spotId, a]));
  const aps = new Map((await d.select().from(airports).where(inArray(airports.icao, Array.from(new Set(rows.map((r) => r.icao)))))).map((a) => [a.icao, a]));
  const vs = await d.select().from(votes).where(and(eq(votes.targetType, "spot"), inArray(votes.targetId, ids)));
  const byId = new Map<number, Vote[]>();
  vs.forEach((v) => byId.set(v.targetId, [...(byId.get(v.targetId) || []), v]));
  // moderation details (held edits, notes) never leave the server through public listing data
  return rows.map((r) => ({
    ...r, pendingEdit: null, modNote: "", modAttempts: 0, avgRating: m.get(r.id)?.avg ?? null, reviewCount: m.get(r.id)?.n ?? 0, airport: aps.get(r.icao), vet: computeVet(byId.get(r.id) || [], voter),
    goArounds: m.get(r.id)?.go ?? 0,
    ...crewCost(r.category, r.costLevel, m.get(r.id)?.costs || []),
  }));
}

// Leaderboard/points are computed from activity. Cache briefly so /api/crew stays cheap.
let actCache: { at: number; data: Awaited<ReturnType<DatabaseStorage["loadActivity"]>> } | null = null;
const invalidateActivity = () => { actCache = null; };

export class DatabaseStorage {
  async init() { await initDb(); await seedIfEmpty(); await this.fixLegacyCodes(); await this.backfillAirportCoords(); }
  /**
   * Airports created before digit codes were supported were stored as "K" + code (K1B9 for 1B9).
   * Move them, with their listings, to the published code. Listings, ratings and points are untouched apart from the airport code.
   */
  async fixLegacyCodes() {
    const d = db();
    for (const a of await d.select().from(airports)) {
      const ref = refAirport(a.icao);
      // only the K-prefixed digit codes (K1B9 -> 1B9); renamed airports (e.g. KPBI listed as KDJT) keep the code crews already use
      if (!ref || ref.icao === a.icao || !/^K[0-9A-Z]{3}$/.test(a.icao) || ref.icao !== a.icao.slice(1) || !/[0-9]/.test(ref.icao)) continue;
      if ((await d.select({ icao: airports.icao }).from(airports).where(eq(airports.icao, ref.icao)))[0]) continue; // both exist: leave for the admin
      await d.transaction(async (tx) => {
        await tx.insert(airports).values({ icao: ref.icao, iata: ref.iata || (/^[A-Z]{3}$/.test(a.iata || "") && a.iata !== ref.icao ? a.iata : null), name: ref.name, city: ref.city || a.city, region: ref.region || a.region, country: ref.country || a.country, lat: ref.lat, lon: ref.lon });
        await tx.update(spots).set({ icao: ref.icao }).where(eq(spots.icao, a.icao));
        await tx.update(ads).set({ targetIcao: ref.icao }).where(eq(ads.targetIcao, a.icao));
        await tx.execute(sql`UPDATE briefings SET stops = REPLACE(stops, ${'"icao":"' + a.icao + '"'}, ${'"icao":"' + ref.icao + '"'}) WHERE stops LIKE ${'%"icao":"' + a.icao + '"%'}`);
        await tx.delete(airports).where(eq(airports.icao, a.icao));
      });
      console.log(`[airports] ${a.icao} is now ${ref.icao}`);
    }
  }
  /** Fill in airport coordinates from the reference dataset (only where missing). */
  async backfillAirportCoords() {
    const d = db();
    const missing = await d.select().from(airports).where(isNull(airports.lat));
    let n = 0;
    for (const a of missing) {
      const ref = refAirport(a.icao);
      if (ref) { await d.update(airports).set({ lat: ref.lat, lon: ref.lon }).where(eq(airports.icao, a.icao)); n++; }
    }
    if (n) console.log(`[airports] coordinates filled for ${n}`);
    // Airports added with only a code as their name get the published name (labels only; spots untouched).
    const all = await d.select().from(airports);
    let fixed = 0;
    for (const a of all) {
      const ref = refAirport(a.icao);
      if (!ref || !ref.name) continue;
      const set: Partial<typeof airports.$inferInsert> = {};
      if (!a.name || a.name.trim().toUpperCase() === a.icao) set.name = ref.name;
      if (!a.city && ref.city) set.city = ref.city;
      if (!a.iata && ref.iata) set.iata = ref.iata;
      if (Object.keys(set).length) { await d.update(airports).set(set).where(eq(airports.icao, a.icao)); fixed++; }
    }
    if (fixed) console.log(`[airports] names filled for ${fixed}`);
  }
  async health() { await db().execute(sql`SELECT 1`); return true; }

  // ---- airports ----
  listAirports() { return db().select().from(airports).orderBy(airports.icao); }
  /** Saved airport for what a pilot typed: KOPF, OPF, X51, KX51, 06FA. */
  async resolveCode(code: string): Promise<Airport | undefined> {
    const c = code.trim().toUpperCase();
    if (!isCode(c)) return undefined;
    const d = db();
    const exact = (await d.select().from(airports).where(eq(airports.icao, c)))[0];
    if (exact) return exact;
    if (/^[A-Z]{3}$/.test(c)) {
      const byIata = (await d.select().from(airports).where(eq(airports.iata, c)))[0];
      if (byIata) return byIata;
    }
    const ref = refAirport(c);
    if (ref) {
      // the same field may be stored under its published code or a former one (KDJT / KPBI)
      const codes = Array.from(new Set([ref.icao, ...ref.aliases.filter(isCode)])).filter((x) => x !== c);
      if (codes.length) {
        const hits = await d.select().from(airports).where(inArray(airports.icao, codes));
        const hit = hits.find((h) => h.icao === ref.icao) || hits[0];
        if (hit) return hit;
      }
    }
    if (c.length === 3) return (await d.select().from(airports).where(eq(airports.icao, "K" + c)))[0];
    return undefined;
  }
  /** Known airport, or one created from the reference dataset (name, city, coordinates). */
  async resolveOrCreate(code: string): Promise<Airport | undefined> {
    const hit = await this.resolveCode(code);
    if (hit) return hit;
    const ref = refAirport(code);
    if (!ref) return undefined;
    return this.upsertAirport({ icao: ref.icao, iata: ref.iata || null, name: ref.name, city: ref.city || ref.name, region: ref.region, country: ref.country, lat: ref.lat, lon: ref.lon });
  }
  async upsertAirport(a: InsertAirport) {
    return (await db().insert(airports).values(a).onConflictDoUpdate({ target: airports.icao, set: a }).returning())[0];
  }

  // ---- spots ----
  async searchSpots(icaos: string[], includeAll = false, voter = "") {
    const where = icaos.length ? (includeAll ? inArray(spots.icao, icaos) : and(inArray(spots.icao, icaos), eq(spots.status, "live")))
      : includeAll ? undefined : eq(spots.status, "live");
    const rows = await db().select().from(spots).where(where).orderBy(desc(spots.createdAt));
    return withStats(rows, voter);
  }
  async getSpot(id: number, voter = "") {
    if (!Number.isFinite(id)) return undefined;
    const r = (await db().select().from(spots).where(eq(spots.id, id)))[0];
    return r ? (await withStats([r], voter))[0] : undefined;
  }
  async createSpot(s: InsertSpot) { invalidateActivity(); return (await db().insert(spots).values({ ...s, createdAt: Date.now() }).returning())[0]; }
  async updateSpot(id: number, s: Partial<InsertSpot>) { invalidateActivity(); return (await db().update(spots).set(s).where(eq(spots.id, id)).returning())[0]; }
  async deleteSpots(ids: number[]) {
    if (!ids.length) return 0;
    invalidateActivity();
    const d = db();
    const revIds = (await d.select({ id: reviews.id }).from(reviews).where(inArray(reviews.spotId, ids))).map((r) => r.id);
    if (revIds.length) await d.delete(votes).where(and(eq(votes.targetType, "review"), inArray(votes.targetId, revIds)));
    await d.delete(reviews).where(inArray(reviews.spotId, ids));
    await d.delete(votes).where(and(eq(votes.targetType, "spot"), inArray(votes.targetId, ids)));
    await d.delete(favorites).where(inArray(favorites.spotId, ids));
    return (await d.delete(spots).where(inArray(spots.id, ids)).returning({ id: spots.id })).length;
  }

  // ---- votes ----
  async vote(targetType: "spot" | "review", targetId: number, voter: string, value: number, reason = "") {
    invalidateActivity();
    const d = db();
    await d.delete(votes).where(and(eq(votes.targetType, targetType), eq(votes.targetId, targetId), eq(votes.voter, voter)));
    if (value !== 0) await d.insert(votes).values({ targetType, targetId, voter, value: value > 0 ? 1 : -1, reason: value < 0 ? reason : "", createdAt: Date.now() });
    if (targetType === "spot") {
      const s = await this.getSpot(targetId);
      if (s && s.status === "live" && shouldAutoHold(s.vet)) await this.updateSpot(targetId, { status: "pending" });
    }
  }
  listSpotVotes(spotId: number) {
    return db().select().from(votes).where(and(eq(votes.targetType, "spot"), eq(votes.targetId, spotId))).orderBy(desc(votes.createdAt));
  }
  async clearDownvotes(spotId: number) {
    invalidateActivity();
    await db().delete(votes).where(and(eq(votes.targetType, "spot"), eq(votes.targetId, spotId), lt(votes.value, 0)));
  }

  // ---- reviews ----
  listReviews(spotId: number) { return db().select().from(reviews).where(eq(reviews.spotId, spotId)).orderBy(desc(reviews.createdAt)); }
  /** Live ratings for everyone; the author also sees their own ratings that are still being checked or were held. */
  async listReviewsWithVotes(spotId: number, voter = ""): Promise<ReviewWithVotes[]> {
    const viewer = /^u:(\d+)$/.exec(voter)?.[1];
    const rs = (await this.listReviews(spotId)).filter((r) => r.status === "live" || (viewer && r.userId === Number(viewer)))
      .map((r) => (viewer && r.userId === Number(viewer) ? { ...r, modNote: r.modNote.replace(/^\[[a-z_]+\]\s*/, "") } : { ...r, pendingEdit: null, modNote: "", modAttempts: 0 }));
    if (!rs.length) return [];
    const vs = await db().select().from(votes).where(and(eq(votes.targetType, "review"), inArray(votes.targetId, rs.map((r) => r.id))));
    const uids = Array.from(new Set(rs.map((r) => r.userId).filter((x): x is number => x != null)));
    const named = new Set((uids.length ? await db().select({ id: users.id, anonymous: users.anonymous }).from(users).where(inArray(users.id, uids)) : []).filter((u) => !u.anonymous).map((u) => u.id));
    return rs.map((r) => {
      const mine = vs.filter((v) => v.targetId === r.id);
      return { ...r, authorId: r.userId != null && named.has(r.userId) ? r.userId : null, up: mine.filter((v) => v.value > 0).length, down: mine.filter((v) => v.value < 0).length, myVote: mine.find((v) => v.voter === voter)?.value ?? 0 };
    });
  }
  /** AI moderation decisions logged before a time (for estimating spend before usage was recorded). */
  async aiChecksBefore(t: number) {
    const rows = (await db().execute(sql`SELECT kind, COUNT(*)::int AS n FROM mod_log WHERE actor = 'ai' AND created_at < ${t} GROUP BY kind`)).rows as any[];
    return { spot: rows.find((r) => r.kind === "spot")?.n || 0, review: rows.find((r) => r.kind === "review")?.n || 0 };
  }
  /** True when the person who posted the listing also rated it "Go around" (they added it as a warning). */
  async ownerWarns(spotId: number, userId: number | null) {
    if (userId == null) return false;
    return !!(await db().select({ id: reviews.id }).from(reviews).where(and(eq(reviews.spotId, spotId), eq(reviews.userId, userId), eq(reviews.rating, 0))))[0];
  }
  async getReview(id: number) { return Number.isFinite(id) ? (await db().select().from(reviews).where(eq(reviews.id, id)))[0] : undefined; }
  async updateReview(id: number, patch: { rating?: number; comment?: string; costLevel?: number | null }) {
    invalidateActivity();
    return (await db().update(reviews).set(patch).where(eq(reviews.id, id)).returning())[0];
  }
  async createReview(r: InsertReview) { invalidateActivity(); return (await db().insert(reviews).values({ ...r, createdAt: Date.now() }).returning())[0]; }
  async deleteReview(id: number) {
    invalidateActivity();
    await db().delete(votes).where(and(eq(votes.targetType, "review"), eq(votes.targetId, id)));
    await db().delete(reviews).where(eq(reviews.id, id));
  }

  // ---- moderation ----
  async rawSpot(id: number) { return Number.isFinite(id) ? (await db().select().from(spots).where(eq(spots.id, id)))[0] : undefined; }
  async setSpotMod(id: number, patch: Partial<Pick<Spot, "status" | "modState" | "modNote" | "modAttempts" | "pendingEdit">>) {
    invalidateActivity(); return (await db().update(spots).set(patch).where(eq(spots.id, id)).returning())[0];
  }
  async setReviewMod(id: number, patch: Partial<Pick<Review, "status" | "modState" | "modNote" | "modAttempts" | "pendingEdit" | "rating" | "comment" | "costLevel">>) {
    invalidateActivity(); return (await db().update(reviews).set(patch).where(eq(reviews.id, id)).returning())[0];
  }
  /** Work queue for the background checker (oldest first). */
  async modQueue(limit = 4) {
    const d = db();
    const [s, r] = await Promise.all([
      d.select().from(spots).where(eq(spots.modState, "checking")).orderBy(spots.createdAt).limit(limit),
      d.select().from(reviews).where(eq(reviews.modState, "checking")).orderBy(reviews.createdAt).limit(limit),
    ]);
    return { spots: s, reviews: r };
  }
  /** Everything a person should look at: held or checking items and edits. */
  async modReviewList() {
    const d = db();
    const s = await d.select().from(spots).where(or(eq(spots.status, "pending"), inArray(spots.modState, ["checking", "flagged", "awaiting"]), sql`${spots.pendingEdit} IS NOT NULL`)).orderBy(desc(spots.createdAt)).limit(200);
    const r = await d.select().from(reviews).where(or(sql`${reviews.status} <> 'live'`, inArray(reviews.modState, ["checking", "flagged", "awaiting"]), sql`${reviews.pendingEdit} IS NOT NULL`)).orderBy(desc(reviews.createdAt)).limit(200);
    const names = new Map((r.length ? await d.select({ id: spots.id, name: spots.name, icao: spots.icao }).from(spots).where(inArray(spots.id, r.map((x) => x.spotId))) : []).map((x) => [x.id, x]));
    return { spots: s, reviews: r.map((x) => ({ ...x, spotName: names.get(x.spotId)?.name || "", icao: names.get(x.spotId)?.icao || "" })) };
  }
  async logMod(e: { kind: "spot" | "review"; targetId: number; actor: "ai" | "admin" | "system"; action: string; problem?: string; reason?: string; isEdit?: boolean; before?: unknown; after?: unknown }) {
    await db().insert(modLog).values({ kind: e.kind, targetId: e.targetId, actor: e.actor, action: e.action, problem: e.problem || "", reason: (e.reason || "").slice(0, 600),
      isEdit: e.isEdit ? 1 : 0, before: e.before === undefined ? null : JSON.stringify(e.before), after: e.after === undefined ? null : JSON.stringify(e.after), createdAt: Date.now() });
  }
  async getModLog(id: number) { return Number.isFinite(id) ? (await db().select().from(modLog).where(eq(modLog.id, id)))[0] : undefined; }
  /** Recent decisions with each item's current state, so the admin can see and override what the AI did. */
  async listModLog(limit = 150) {
    const d = db();
    const rows = await d.select().from(modLog).orderBy(desc(modLog.createdAt)).limit(limit);
    const sIds = Array.from(new Set(rows.filter((r) => r.kind === "spot").map((r) => r.targetId)));
    const rIds = Array.from(new Set(rows.filter((r) => r.kind === "review").map((r) => r.targetId)));
    const ss = sIds.length ? await d.select({ id: spots.id, name: spots.name, icao: spots.icao, status: spots.status, modState: spots.modState, pendingEdit: spots.pendingEdit, by: spots.submittedBy }).from(spots).where(inArray(spots.id, sIds)) : [];
    const rs = rIds.length ? await d.select({ id: reviews.id, spotId: reviews.spotId, status: reviews.status, modState: reviews.modState, pendingEdit: reviews.pendingEdit, by: reviews.author, rating: reviews.rating }).from(reviews).where(inArray(reviews.id, rIds)) : [];
    const rSpots = rs.length ? await d.select({ id: spots.id, name: spots.name, icao: spots.icao }).from(spots).where(inArray(spots.id, Array.from(new Set(rs.map((r) => r.spotId))))) : [];
    const sm = new Map(ss.map((x) => [x.id, x])), rm = new Map(rs.map((x) => [x.id, x])), rsm = new Map(rSpots.map((x) => [x.id, x]));
    // the newest log row per item is the one whose buttons act on the item; older rows are history
    const latest = new Set<string>(); const seen = new Set<string>();
    for (const r of rows) { const k = `${r.kind}:${r.targetId}`; if (!seen.has(k)) { seen.add(k); latest.add(String(r.id)); } }
    return rows.map((r) => {
      const t = r.kind === "spot" ? sm.get(r.targetId) : rm.get(r.targetId);
      const sp = r.kind === "spot" ? sm.get(r.targetId) : rsm.get((t as any)?.spotId);
      return { ...r, latest: latest.has(String(r.id)), exists: !!t, name: sp?.name || "(deleted)", icao: sp?.icao || "", spotId: r.kind === "spot" ? r.targetId : (t as any)?.spotId ?? null,
        by: t?.by || "", status: t?.status || "deleted", modState: t?.modState || "", hasPendingEdit: !!t?.pendingEdit };
    });
  }
  async modStats() {
    const q = async (s: string) => Number(((await db().execute(sql.raw(s))).rows[0] as any).c);
    const day = Date.now() - 86400_000;
    const [checking, held, ai24, held24, err24, admin24] = await Promise.all([
      q("SELECT (SELECT COUNT(*) FROM spots WHERE mod_state='checking') + (SELECT COUNT(*) FROM reviews WHERE mod_state='checking') c"),
      q("SELECT (SELECT COUNT(*) FROM spots WHERE mod_state IN ('flagged','awaiting') AND (status='pending' OR pending_edit IS NOT NULL)) + (SELECT COUNT(*) FROM reviews WHERE mod_state IN ('flagged','awaiting') AND (status='pending' OR pending_edit IS NOT NULL)) c"),
      q(`SELECT COUNT(*) c FROM mod_log WHERE actor='ai' AND action='approve' AND created_at > ${day}`),
      q(`SELECT COUNT(*) c FROM mod_log WHERE actor='ai' AND action='hold' AND created_at > ${day}`),
      q(`SELECT COUNT(*) c FROM mod_log WHERE actor='ai' AND action='error' AND created_at > ${day}`),
      q(`SELECT COUNT(*) c FROM mod_log WHERE actor='admin' AND created_at > ${day}`),
    ]);
    return { checking, held, approved24h: ai24, held24h: held24, errors24h: err24, overrides24h: admin24 };
  }
  async getSetting(key: string) { return (await db().select().from(appSettings).where(eq(appSettings.key, key)))[0]?.value; }
  async setSetting(key: string, value: string) {
    await db().insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } });
  }

  /** Other listings at the same airport, for duplicate checks. */
  async namesAt(icao: string, exceptId?: number) {
    const rows = await db().select({ id: spots.id, name: spots.name, category: spots.category, address: spots.address, lat: spots.lat, lng: spots.lng, status: spots.status })
      .from(spots).where(and(eq(spots.icao, icao), sql`${spots.status} <> 'rejected'`));
    return rows.filter((r) => r.id !== exceptId);
  }

  // ---- ads ----
  listAds() { return db().select().from(ads).orderBy(ads.id); }
  async createAd(a: InsertAd) { return (await db().insert(ads).values(a).returning())[0]; }
  async updateAd(id: number, a: Partial<InsertAd>) { return (await db().update(ads).set(a).where(eq(ads.id, id)).returning())[0]; }
  async deleteAd(id: number) { await db().delete(ads).where(eq(ads.id, id)); }
  async trackAd(id: number, kind: "impressions" | "clicks") {
    if (!Number.isFinite(id)) return;
    await db().update(ads).set({ [kind]: sql`${ads[kind]} + 1` }).where(eq(ads.id, id));
  }

  // ---- accounts ----
  async createUser(u: { handle: string; password: string; displayName: string; crewRole: string; homeBase?: string; anonymous?: boolean; email?: string }) {
    const d = db();
    if ((await d.select({ id: users.id }).from(users).where(eq(users.handle, u.handle)))[0]) throw Object.assign(new Error("That handle is taken"), { status: 409 });
    if (u.email && (await d.select({ id: users.id }).from(users).where(eq(users.email, u.email)))[0]) throw Object.assign(new Error("That email already has an account"), { status: 409 });
    invalidateActivity();
    const created = (await d.insert(users).values({
      handle: u.handle, email: u.email || null, displayName: u.displayName, crewRole: u.crewRole || "Pilot", homeBase: u.homeBase || "",
      anonymous: u.anonymous ? 1 : 0, passwordHash: await hashPassword(u.password), createdAt: Date.now(),
    }).returning())[0];
    if (isTestSignup(created.handle, created.email)) return created;
    // atomic seat counter: two simultaneous sign-ups can't get the same number, and a deleted account's seat isn't reissued
    const seat = await d.execute(sql`UPDATE app_settings SET value = (value::int + 1)::text WHERE key = 'wright_seats_taken' AND value::int < ${WRIGHT_SEATS} RETURNING value`);
    const no = Number((seat.rows[0] as any)?.value);
    if (!no) return created;
    return (await d.update(users).set({ wrightNo: no }).where(eq(users.id, created.id)).returning())[0];
  }
  /** Update profile; re-labels the member's existing posts so the anonymous preference applies everywhere. */
  async updateUser(id: number, patch: { displayName?: string; crewRole?: string; homeBase?: string; anonymous?: boolean; email?: string; aircraft?: string; bio?: string; interests?: string[] }) {
    const d = db();
    const set: any = { ...patch };
    if (patch.interests !== undefined) set.interests = JSON.stringify(Array.from(new Set(patch.interests)));
    if (patch.anonymous !== undefined) set.anonymous = patch.anonymous ? 1 : 0;
    if (patch.email !== undefined) {
      set.email = patch.email || null;
      if (patch.email) {
        const other = (await d.select({ id: users.id }).from(users).where(eq(users.email, patch.email)))[0];
        if (other && other.id !== id) throw Object.assign(new Error("That email already has an account"), { status: 409 });
      }
    }
    invalidateActivity();
    const [u] = await d.update(users).set(set).where(eq(users.id, id)).returning();
    const label = publicName(u);
    await d.update(spots).set({ submittedBy: label }).where(eq(spots.userId, id));
    await d.update(reviews).set({ author: label, crewRole: u.crewRole }).where(eq(reviews.userId, id));
    return u;
  }
  /** Account deletion (App Store guideline 5.1.1(v)): removes the account, sessions, votes and reviews; listings stay as community content without attribution. */
  async deleteUser(id: number) {
    const d = db();
    invalidateActivity();
    const revIds = (await d.select({ id: reviews.id }).from(reviews).where(eq(reviews.userId, id))).map((r) => r.id);
    if (revIds.length) await d.delete(votes).where(and(eq(votes.targetType, "review"), inArray(votes.targetId, revIds)));
    await d.delete(reviews).where(eq(reviews.userId, id));
    await d.delete(votes).where(eq(votes.voter, `u:${id}`));
    await d.update(spots).set({ userId: null, submittedBy: "Former crew member" }).where(eq(spots.userId, id));
    await d.delete(briefings).where(eq(briefings.userId, id));
    await d.delete(favorites).where(eq(favorites.userId, id));
    await d.delete(follows).where(or(eq(follows.followerId, id), eq(follows.followeeId, id)));
    await d.delete(sessions).where(eq(sessions.userId, id));
    await d.delete(passwordResets).where(eq(passwordResets.userId, id));
    await d.delete(users).where(eq(users.id, id));
  }
  async login(handleOrEmail: string, password: string) {
    const h = handleOrEmail.trim().toLowerCase();
    const u = (await db().select().from(users).where(h.includes("@") ? eq(users.email, h) : eq(users.handle, h)))[0];
    if (!u || !(await checkPassword(password, u.passwordHash))) return undefined;
    return { token: await this.createSession(u.id), user: u };
  }
  async createSession(userId: number) {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    await db().insert(sessions).values({ token: sha256(token), userId, createdAt: now, expiresAt: now + SESSION_DAYS * 86400_000 });
    return token;
  }
  async userForToken(token: string): Promise<User | undefined> {
    if (!token || token.length < 20) return undefined;
    const s = (await db().select().from(sessions).where(eq(sessions.token, sha256(token))))[0];
    if (!s || (s.expiresAt && s.expiresAt < Date.now())) return undefined;
    return (await db().select().from(users).where(eq(users.id, s.userId)))[0];
  }
  async logout(token: string) { if (token) await db().delete(sessions).where(eq(sessions.token, sha256(token))); }
  async pruneSessions() {
    const now = Date.now();
    await db().delete(sessions).where(and(lt(sessions.expiresAt, now), sql`${sessions.expiresAt} > 0`));
    await db().delete(passwordResets).where(or(lt(passwordResets.expiresAt, now), sql`${passwordResets.usedAt} IS NOT NULL`));
  }

  // ---- password reset ----
  async startPasswordReset(email: string) {
    const u = (await db().select().from(users).where(eq(users.email, email.toLowerCase())))[0];
    if (!u) return undefined;
    const token = randomBytes(32).toString("hex");
    await db().insert(passwordResets).values({ tokenHash: sha256(token), userId: u.id, expiresAt: Date.now() + 60 * 60_000 });
    return { user: u, token };
  }
  async finishPasswordReset(token: string, password: string) {
    const d = db();
    const r = (await d.select().from(passwordResets).where(and(eq(passwordResets.tokenHash, sha256(token)), isNull(passwordResets.usedAt))))[0];
    if (!r || r.expiresAt < Date.now()) return false;
    await d.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, r.userId));
    await d.update(passwordResets).set({ usedAt: Date.now() }).where(eq(passwordResets.tokenHash, r.tokenHash));
    await d.delete(sessions).where(eq(sessions.userId, r.userId)); // sign out everywhere
    return true;
  }

  // ---- points / leaderboard ----
  async loadActivity() {
    const d = db();
    const [s, r, v, u] = await Promise.all([d.select().from(spots), d.select().from(reviews), d.select().from(votes), d.select().from(users)]);
    return { spots: s, reviews: r, votes: v, users: u };
  }
  // NOTE: computed in memory with a 30-second cache. Comfortable into the tens of thousands of rows; move to SQL rollups beyond that.
  private async activity() {
    if (actCache && Date.now() - actCache.at < 30_000) return actCache.data;
    actCache = { at: Date.now(), data: await this.loadActivity() };
    return actCache.data;
  }
  /** Public list masks anonymous members (name and handle); the admin list shows everything. */
  async publicUsers(admin = false): Promise<(PublicUser & { email?: string | null })[]> {
    const act = await this.activity();
    return act.users.map((u) => {
      const b = computePoints(act, u.id, u.bonusPoints);
      const anon = !!u.anonymous;
      return {
        id: u.id, handle: anon && !admin ? "" : u.handle, displayName: admin ? u.displayName : publicName(u), crewRole: u.crewRole, homeBase: u.homeBase || "",
        anonymous: anon, participation: b.participation, points: b.total, tierId: tierFor(b.total).tier.id, createdAt: u.createdAt, aircraft: u.aircraft || "",
        bio: anon && !admin ? "" : u.bio || "", interests: anon && !admin ? [] : parseInterests(u.interests), wrightNo: admin ? u.wrightNo ?? null : null, // not on lists or the leaderboard; the Logbook and crew profile show it
        ...(admin ? { email: u.email } : {}),
      };
    }).sort((a, b) => b.points - a.points);
  }
  /**
   * Full leaderboard with search. Rank is the overall position (ties share a rank), so a filtered
   * list still shows where each person stands. q matches name or handle; base matches the home
   * airport however it was typed (OPF, KOPF).
   */
  async leaderboard(opts: { q?: string; base?: string; offset?: number; limit?: number; around?: number }) {
    const all = await this.publicUsers();
    let rank = 0, prev = -1;
    const ranked = all.map((u, i) => { if (u.points !== prev) { rank = i + 1; prev = u.points; } return { ...u, rank }; });
    const q = (opts.q || "").trim().toLowerCase();
    const canon = (b: string) => { const c = b.trim().toUpperCase(); return refAirport(c)?.icao || c; };
    const base = (opts.base || "").trim() ? canon(opts.base!) : "";
    const rows = ranked.filter((u) =>
      (!q || u.displayName.toLowerCase().includes(q) || (!!u.handle && u.handle.toLowerCase().includes(q.replace(/^@/, "")))) &&
      (!base || (!!u.homeBase && canon(u.homeBase) === base)));
    // around: the member's spot on the full board plus a few crews either side, kept below the top rows already shown
    let around: { rows: typeof ranked; position: number } | null = null;
    if (opts.around && !q && !base) {
      const pos = ranked.findIndex((u) => u.id === opts.around);
      const top = Math.max(0, opts.limit || 0);
      if (pos >= top && top > 0) { const from = Math.max(top, pos - 3); around = { rows: ranked.slice(from, pos + 4), position: pos + 1 }; }
    }
    const offset = Math.max(0, opts.offset || 0), limit = Math.min(1000, Math.max(1, opts.limit || 50));
    return { total: rows.length, crewTotal: all.length, base: base || null, rows: rows.slice(offset, offset + limit), offset, limit, around };
  }
  /** Home bases people have set, most common first (used for type-ahead, not as preset filters). */
  async homeBases() {
    const counts = new Map<string, number>();
    for (const u of await this.publicUsers()) if (u.homeBase) { const c = refAirport(u.homeBase)?.icao || u.homeBase.toUpperCase(); counts.set(c, (counts.get(c) || 0) + 1); }
    return Array.from(counts, ([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n);
  }

  // ---- favorites (no points; private to the crew member) ----
  async favoriteIds(userId: number) { return (await db().select({ id: favorites.spotId }).from(favorites).where(eq(favorites.userId, userId))).map((f) => f.id); }
  async setFavorite(userId: number, spotId: number, on: boolean) {
    const d = db();
    if (on) await d.insert(favorites).values({ userId, spotId, createdAt: Date.now() }).onConflictDoNothing();
    else await d.delete(favorites).where(and(eq(favorites.userId, userId), eq(favorites.spotId, spotId)));
  }
  async favoriteSpots(userId: number) {
    const rows = await db().select({ spotId: favorites.spotId, at: favorites.createdAt }).from(favorites).where(eq(favorites.userId, userId)).orderBy(desc(favorites.createdAt));
    if (!rows.length) return [];
    const list = await withStats(await db().select().from(spots).where(and(inArray(spots.id, rows.map((r) => r.spotId)), eq(spots.status, "live"))));
    const order = new Map(rows.map((r, i) => [r.spotId, i]));
    return list.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  }

  async me(u: User): Promise<Me & { email: string }> {
    invalidateActivity();
    const b = computePoints(await this.activity(), u.id, u.bonusPoints);
    return {
      id: u.id, handle: u.handle, email: u.email || "", displayName: u.displayName, crewRole: u.crewRole, homeBase: u.homeBase || "", anonymous: !!u.anonymous,
      participation: b.participation, points: b.total, tierId: tierFor(b.total).tier.id, createdAt: u.createdAt, aircraft: u.aircraft || "", breakdown: b,
      bio: u.bio || "", interests: parseInterests(u.interests), follows: await this.followCounts(u.id), wrightNo: u.wrightNo ?? null,
      achievements: achievementProgress(await this.achievementStats(u.id)),
    };
  }
  async userContributions(userId: number) {
    const d = db();
    const raw = await d.select().from(spots).where(eq(spots.userId, userId)).orderBy(desc(spots.createdAt));
    const modOf = new Map(raw.map((r) => [r.id, { state: r.modState, note: r.modNote.replace(/^\[[a-z_]+\]\s*/, ""), editPending: !!r.pendingEdit }]));
    const mySpots = (await withStats(raw)).map((x) => ({ ...x, mod: modOf.get(x.id) }));
    const rs = await d.select().from(reviews).where(eq(reviews.userId, userId)).orderBy(desc(reviews.createdAt));
    const names = new Map((rs.length ? await d.select({ id: spots.id, name: spots.name }).from(spots).where(inArray(spots.id, rs.map((r) => r.spotId))) : []).map((s) => [s.id, s.name]));
    return { spots: mySpots, reviews: rs.map((r) => ({ ...r, modNote: r.modNote.replace(/^\[[a-z_]+\]\s*/, ""), spotName: names.get(r.spotId) || "" })), activity: recentActivity(await this.loadActivity(), userId) };
  }
  /** Public crew profile. Anonymous members show stats only, so their posts cannot be traced back to them. */
  async crewProfile(userId: number, viewerId?: number) {
    const pub = (await this.publicUsers()).find((u) => u.id === userId);
    if (!pub) return undefined;
    const rank = (await this.publicUsers()).findIndex((u) => u.id === userId) + 1;
    const u = (await db().select().from(users).where(eq(users.id, userId)))[0];
    const c = await this.userContributions(userId);
    const counts = { listings: c.spots.filter((s) => s.status === "live").length, reviews: c.reviews.filter((r) => r.status === "live").length };
    // anonymous members can't be followed, so their follower counts aren't shown either
    const follow = u?.anonymous ? null : { ...(await this.followCounts(userId)), isFollowing: viewerId ? await this.isFollowing(viewerId, userId) : false };
    if (u?.anonymous) return { user: pub, rank, counts, follow, spots: [], reviews: [], hidden: true, wrightNo: null, badges: [] };
    // founding-club seat and earned badges show on the public profile (never on the leaderboard)
    const badges = achievementProgress(await this.achievementStats(userId)).filter((b) => b.earned).map((b) => b.id);
    const live = new Set(c.spots.filter((s) => s.status === "live").map((s) => s.id));
    const liveIds = (await db().select({ id: spots.id }).from(spots).where(eq(spots.status, "live"))).map((x) => x.id);
    const liveAll = new Set(liveIds);
    return {
      user: pub, rank, counts, follow, hidden: false, wrightNo: u?.wrightNo ?? null, badges,
      spots: c.spots.filter((s) => live.has(s.id)).map(({ mod: _m, ...s }) => s),
      reviews: c.reviews.filter((r) => liveAll.has(r.spotId) && r.status === "live").map(({ userId: _u, pendingEdit: _p, modNote: _n, ...r }) => r),
    };
  }

  // ---- earned badges (cosmetic; no points) ----
  async achievementStats(userId: number): Promise<AchStats> {
    const q = async (s: ReturnType<typeof sql>) => ((await db().execute(s)).rows[0] as any) || {};
    const [sp, rv, fav, five, br, first] = await Promise.all([
      q(sql`SELECT COUNT(*)::int AS listings, COUNT(DISTINCT icao)::int AS airports,
              COUNT(*) FILTER (WHERE category = 'eat')::int AS eat, COUNT(*) FILTER (WHERE category = 'do')::int AS "do",
              COUNT(*) FILTER (WHERE category = 'stay')::int AS stay, COUNT(*) FILTER (WHERE category = 'fbo')::int AS fbo
            FROM spots WHERE user_id = ${userId} AND status = 'live'`),
      q(sql`SELECT COUNT(*)::int AS ratings, COUNT(*) FILTER (WHERE length(trim(comment)) >= 40)::int AS detailed,
              COUNT(*) FILTER (WHERE rating = 0)::int AS go_arounds
            FROM reviews r JOIN spots s ON s.id = r.spot_id AND s.status = 'live' WHERE r.user_id = ${userId} AND r.status = 'live'`),
      q(sql`SELECT COUNT(*)::int AS n FROM favorites f JOIN spots s ON s.id = f.spot_id AND s.status = 'live' WHERE s.user_id = ${userId} AND f.user_id <> ${userId}`),
      q(sql`SELECT COUNT(*)::int AS n FROM (SELECT s.id FROM spots s JOIN reviews r ON r.spot_id = s.id AND r.status = 'live'
              WHERE s.user_id = ${userId} AND s.status = 'live' GROUP BY s.id HAVING COUNT(*) >= 3 AND AVG(r.rating) >= 4.5) x`),
      q(sql`SELECT COUNT(*)::int AS n FROM briefings WHERE user_id = ${userId}`),
      q(sql`SELECT COUNT(*)::int AS n FROM (SELECT DISTINCT ON (icao) icao, user_id FROM spots WHERE status = 'live' ORDER BY icao, created_at, id) x WHERE x.user_id = ${userId}`),
    ]);
    const followers = (await this.followCounts(userId)).followers;
    return { listings: sp.listings || 0, airports: sp.airports || 0, eat: sp.eat || 0, do: sp.do || 0, stay: sp.stay || 0, fbo: sp.fbo || 0,
      ratings: rv.ratings || 0, detailed: rv.detailed || 0, goArounds: rv.go_arounds || 0, favoritedByOthers: fav.n || 0, fiveStarFinds: five.n || 0,
      briefings: br.n || 0, firstAtAirport: first.n || 0, followers };
  }

  // ---- founding club ----
  async wrightClub() {
    const taken = Number((await this.getSetting("wright_seats_taken")) || 0);
    return { seats: WRIGHT_SEATS, taken, left: Math.max(0, WRIGHT_SEATS - taken) };
  }

  // ---- following ----
  async followCounts(userId: number) {
    const anon = new Set((await db().select({ id: users.id }).from(users).where(eq(users.anonymous, 1))).map((x) => x.id));
    const ers = await db().select({ id: follows.followerId }).from(follows).where(eq(follows.followeeId, userId));
    const ing = await db().select({ id: follows.followeeId }).from(follows).where(eq(follows.followerId, userId));
    return { followers: ers.length, following: ing.filter((x) => !anon.has(x.id)).length };
  }
  async isFollowing(followerId: number, followeeId: number) {
    return !!(await db().select().from(follows).where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId))))[0];
  }
  async setFollow(followerId: number, followeeId: number, on: boolean) {
    if (on) await db().insert(follows).values({ followerId, followeeId, createdAt: Date.now() }).onConflictDoNothing();
    else await db().delete(follows).where(and(eq(follows.followerId, followerId), eq(follows.followeeId, followeeId)));
  }
  /** People you follow (or who follow you). Anonymous members are left out of both lists. */
  async followList(userId: number, which: "following" | "followers") {
    const rows = which === "following"
      ? await db().select({ id: follows.followeeId, at: follows.createdAt }).from(follows).where(eq(follows.followerId, userId))
      : await db().select({ id: follows.followerId, at: follows.createdAt }).from(follows).where(eq(follows.followeeId, userId));
    const at = new Map(rows.map((r) => [r.id, r.at]));
    return (await this.publicUsers()).filter((u) => at.has(u.id) && !u.anonymous).sort((a, b) => (at.get(b.id) || 0) - (at.get(a.id) || 0));
  }
  /** New live listings and ratings from people you follow, newest first. */
  async followFeed(userId: number, limit = 40) {
    const d = db();
    const ids = (await this.followList(userId, "following")).map((u) => u.id);
    if (!ids.length) return [];
    const ppl = new Map((await this.publicUsers()).map((u) => [u.id, u]));
    const ss = await d.select().from(spots).where(and(inArray(spots.userId, ids), eq(spots.status, "live"))).orderBy(desc(spots.createdAt)).limit(limit);
    const rs = await d.select().from(reviews).where(and(inArray(reviews.userId, ids), eq(reviews.status, "live"))).orderBy(desc(reviews.createdAt)).limit(limit);
    const rSpots = rs.length ? await d.select({ id: spots.id, name: spots.name, icao: spots.icao, category: spots.category, status: spots.status }).from(spots).where(inArray(spots.id, Array.from(new Set(rs.map((r) => r.spotId))))) : [];
    const sm = new Map(rSpots.map((x) => [x.id, x]));
    const who = (id: number | null) => { const u = id ? ppl.get(id) : undefined; return u ? { id: u.id, displayName: u.displayName, aircraft: u.aircraft, tierId: u.tierId } : null; };
    const items = [
      ...ss.map((s) => ({ kind: "spot" as const, at: s.createdAt, user: who(s.userId), spot: { id: s.id, name: s.name, icao: s.icao, category: s.category }, description: s.description.slice(0, 200) })),
      ...rs.filter((r) => sm.get(r.spotId)?.status === "live").map((r) => { const sp = sm.get(r.spotId)!; return { kind: "review" as const, at: r.createdAt, user: who(r.userId), spot: { id: sp.id, name: sp.name, icao: sp.icao, category: sp.category }, rating: r.rating, comment: r.comment.slice(0, 280) }; }),
    ].filter((x) => x.user);
    return items.sort((a, b) => b.at - a.at).slice(0, limit);
  }

  // ---- trip briefings ----
  listBriefings(userId: number) { return db().select().from(briefings).where(eq(briefings.userId, userId)).orderBy(desc(briefings.updatedAt)); }
  async getBriefing(id: number) { return Number.isFinite(id) ? (await db().select().from(briefings).where(eq(briefings.id, id)))[0] : undefined; }
  async getBriefingByToken(t: string) { return t && t.length >= 16 ? (await db().select().from(briefings).where(eq(briefings.shareToken, t)))[0] : undefined; }
  async saveBriefing(userId: number, b: { title: string; stops: BriefingStop[] }, id?: number): Promise<Briefing> {
    const now = Date.now();
    const d = db();
    if (id) return (await d.update(briefings).set({ title: b.title, stops: JSON.stringify(b.stops), updatedAt: now }).where(and(eq(briefings.id, id), eq(briefings.userId, userId))).returning())[0];
    return (await d.insert(briefings).values({ userId, title: b.title, stops: JSON.stringify(b.stops), shareToken: randomBytes(12).toString("base64url"), createdAt: now, updatedAt: now }).returning())[0];
  }
  async deleteBriefing(userId: number, id: number) { await db().delete(briefings).where(and(eq(briefings.id, id), eq(briefings.userId, userId))); }
  async spotsByIds(ids: number[]) {
    if (!ids.length) return [];
    return withStats(await db().select().from(spots).where(and(inArray(spots.id, ids), eq(spots.status, "live"))));
  }

  async grantBonus(userId: number, delta: number) {
    invalidateActivity();
    await db().update(users).set({ bonusPoints: sql`GREATEST(0, ${users.bonusPoints} + ${delta})` }).where(eq(users.id, userId));
  }

  async stats() {
    const q = async (s: string) => Number(((await db().execute(sql.raw(s))).rows[0] as any).c);
    const [live, pending, rv, vt, us, ap, imp, clk] = await Promise.all([
      q("SELECT COUNT(*) c FROM spots WHERE status='live'"), q("SELECT COUNT(*) c FROM spots WHERE status='pending'"),
      q("SELECT COUNT(*) c FROM reviews"), q("SELECT COUNT(*) c FROM votes WHERE target_type='spot'"), q("SELECT COUNT(*) c FROM users"),
      q("SELECT COUNT(DISTINCT icao) c FROM spots"), q("SELECT COALESCE(SUM(impressions),0) c FROM ads"), q("SELECT COALESCE(SUM(clicks),0) c FROM ads"),
    ]);
    return { spots: live, pending, reviews: rv, votes: vt, users: us, airports: ap, impressions: imp, clicks: clk };
  }
}

export const storage = new DatabaseStorage();
