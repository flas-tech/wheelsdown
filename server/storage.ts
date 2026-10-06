import { airports, spots, reviews, ads, votes, users, sessions, passwordResets } from "@shared/schema";
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
 *  - starter: airports + starter listings credited to "Wheelsdown team", plus the house ad. No fake people or votes. (production default)
 *  - none:    airports only
 */
export async function seedIfEmpty() {
  const d = db();
  const [{ c }] = (await d.execute(sql`SELECT COUNT(*)::int AS c FROM airports`)).rows as any[];
  if (c > 0) return;
  const mode = (process.env.SEED_MODE || (process.env.NODE_ENV === "production" ? "starter" : "demo")) as "demo" | "starter" | "none";
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
  const agg = await d.select({ spotId: reviews.spotId, avg: sql<number>`AVG(${reviews.rating})::float`, n: sql<number>`COUNT(*)::int` })
    .from(reviews).where(inArray(reviews.spotId, ids)).groupBy(reviews.spotId);
  const m = new Map(agg.map((a) => [a.spotId, a]));
  const aps = new Map((await d.select().from(airports).where(inArray(airports.icao, Array.from(new Set(rows.map((r) => r.icao)))))).map((a) => [a.icao, a]));
  const vs = await d.select().from(votes).where(and(eq(votes.targetType, "spot"), inArray(votes.targetId, ids)));
  const byId = new Map<number, Vote[]>();
  vs.forEach((v) => byId.set(v.targetId, [...(byId.get(v.targetId) || []), v]));
  return rows.map((r) => ({ ...r, avgRating: m.get(r.id)?.avg ?? null, reviewCount: m.get(r.id)?.n ?? 0, airport: aps.get(r.icao), vet: computeVet(byId.get(r.id) || [], voter) }));
}

// Leaderboard/points are computed from activity. Cache briefly so /api/crew stays cheap.
let actCache: { at: number; data: Awaited<ReturnType<DatabaseStorage["loadActivity"]>> } | null = null;
const invalidateActivity = () => { actCache = null; };

export class DatabaseStorage {
  async init() { await initDb(); await seedIfEmpty(); }
  async health() { await db().execute(sql`SELECT 1`); return true; }

  // ---- airports ----
  listAirports() { return db().select().from(airports).orderBy(airports.icao); }
  async resolveCode(code: string): Promise<Airport | undefined> {
    const c = code.trim().toUpperCase();
    if (c.length === 4) return (await db().select().from(airports).where(eq(airports.icao, c)))[0];
    if (c.length === 3) {
      return (await db().select().from(airports).where(eq(airports.iata, c)))[0] || (await db().select().from(airports).where(eq(airports.icao, "K" + c)))[0];
    }
    return undefined;
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
  async listReviewsWithVotes(spotId: number, voter = ""): Promise<ReviewWithVotes[]> {
    const rs = await this.listReviews(spotId);
    if (!rs.length) return [];
    const vs = await db().select().from(votes).where(and(eq(votes.targetType, "review"), inArray(votes.targetId, rs.map((r) => r.id))));
    return rs.map((r) => {
      const mine = vs.filter((v) => v.targetId === r.id);
      return { ...r, up: mine.filter((v) => v.value > 0).length, down: mine.filter((v) => v.value < 0).length, myVote: mine.find((v) => v.voter === voter)?.value ?? 0 };
    });
  }
  async createReview(r: InsertReview) { invalidateActivity(); return (await db().insert(reviews).values({ ...r, createdAt: Date.now() }).returning())[0]; }
  async deleteReview(id: number) {
    invalidateActivity();
    await db().delete(votes).where(and(eq(votes.targetType, "review"), eq(votes.targetId, id)));
    await db().delete(reviews).where(eq(reviews.id, id));
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
    return (await d.insert(users).values({
      handle: u.handle, email: u.email || null, displayName: u.displayName, crewRole: u.crewRole || "Pilot", homeBase: u.homeBase || "",
      anonymous: u.anonymous ? 1 : 0, passwordHash: await hashPassword(u.password), createdAt: Date.now(),
    }).returning())[0];
  }
  /** Update profile; re-labels the member's existing posts so the anonymous preference applies everywhere. */
  async updateUser(id: number, patch: { displayName?: string; crewRole?: string; homeBase?: string; anonymous?: boolean; email?: string }) {
    const d = db();
    const set: any = { ...patch };
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
        anonymous: anon, participation: b.participation, points: b.total, tierId: tierFor(b.total).tier.id, createdAt: u.createdAt,
        ...(admin ? { email: u.email } : {}),
      };
    }).sort((a, b) => b.points - a.points);
  }
  async me(u: User): Promise<Me & { email: string }> {
    invalidateActivity();
    const b = computePoints(await this.activity(), u.id, u.bonusPoints);
    return {
      id: u.id, handle: u.handle, email: u.email || "", displayName: u.displayName, crewRole: u.crewRole, homeBase: u.homeBase || "", anonymous: !!u.anonymous,
      participation: b.participation, points: b.total, tierId: tierFor(b.total).tier.id, createdAt: u.createdAt, breakdown: b,
    };
  }
  async userContributions(userId: number) {
    const d = db();
    const mySpots = await withStats(await d.select().from(spots).where(eq(spots.userId, userId)).orderBy(desc(spots.createdAt)));
    const rs = await d.select().from(reviews).where(eq(reviews.userId, userId)).orderBy(desc(reviews.createdAt));
    const names = new Map((rs.length ? await d.select({ id: spots.id, name: spots.name }).from(spots).where(inArray(spots.id, rs.map((r) => r.spotId))) : []).map((s) => [s.id, s.name]));
    return { spots: mySpots, reviews: rs.map((r) => ({ ...r, spotName: names.get(r.spotId) || "" })), activity: recentActivity(await this.loadActivity(), userId) };
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
