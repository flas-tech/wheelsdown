import { airports, spots, reviews, ads } from "@shared/schema";
import type { Airport, InsertAirport, Spot, InsertSpot, Review, InsertReview, Ad, InsertAd, SpotWithStats } from "@shared/schema";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, inArray, desc, sql } from "drizzle-orm";
import { seedAirports, seedSpots, seedReviews, seedAds } from "@shared/seed";

const sqlite = new Database(process.env.DB_PATH || "data.db");
sqlite.pragma("journal_mode = WAL");

sqlite.exec(`
CREATE TABLE IF NOT EXISTS airports (icao TEXT PRIMARY KEY, iata TEXT, name TEXT NOT NULL, city TEXT NOT NULL, region TEXT, country TEXT NOT NULL DEFAULT 'US');
CREATE TABLE IF NOT EXISTS spots (id INTEGER PRIMARY KEY AUTOINCREMENT, icao TEXT NOT NULL, category TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', address TEXT DEFAULT '', website TEXT DEFAULT '', cost_level INTEGER NOT NULL DEFAULT 1,
  minutes_needed INTEGER NOT NULL DEFAULT 60, miles_from_field REAL DEFAULT 0, crew_tip TEXT DEFAULT '', tags TEXT NOT NULL DEFAULT '[]',
  submitted_by TEXT DEFAULT 'Anonymous crew', status TEXT NOT NULL DEFAULT 'live', created_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS spots_icao ON spots(icao);
CREATE TABLE IF NOT EXISTS reviews (id INTEGER PRIMARY KEY AUTOINCREMENT, spot_id INTEGER NOT NULL, rating INTEGER NOT NULL, comment TEXT NOT NULL DEFAULT '',
  author TEXT DEFAULT 'Anonymous crew', crew_role TEXT DEFAULT 'Crew', created_at INTEGER NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS reviews_spot ON reviews(spot_id);
CREATE TABLE IF NOT EXISTS ads (id INTEGER PRIMARY KEY AUTOINCREMENT, slot TEXT NOT NULL DEFAULT 'inline', advertiser TEXT NOT NULL, headline TEXT NOT NULL,
  body TEXT DEFAULT '', cta TEXT DEFAULT 'Learn more', url TEXT DEFAULT '', target_icao TEXT DEFAULT '', active INTEGER NOT NULL DEFAULT 1,
  impressions INTEGER NOT NULL DEFAULT 0, clicks INTEGER NOT NULL DEFAULT 0);
`);

export const db = drizzle(sqlite);

// ---- one-time seed ----
const count = (sqlite.prepare("SELECT COUNT(*) c FROM airports").get() as any).c;
if (count === 0) {
  const now = Date.now();
  const insA = sqlite.prepare("INSERT INTO airports (icao, iata, name, city, region, country) VALUES (?,?,?,?,?,?)");
  seedAirports.forEach((a) => insA.run(...a));
  const ids: Record<string, number> = {};
  seedSpots.forEach((s, i) => {
    const r = db.insert(spots).values({ ...s, tags: JSON.stringify(s.tags), submittedBy: "Wheelsdown team", status: "live", createdAt: now - i * 3600_000 }).returning().get();
    ids[s.name] = r.id;
  });
  seedReviews.forEach((r, i) => {
    if (ids[r.spot]) db.insert(reviews).values({ spotId: ids[r.spot], rating: r.rating, comment: r.comment, author: r.author, crewRole: r.crewRole, createdAt: now - i * 7200_000 }).run();
  });
  seedAds.forEach((a) => db.insert(ads).values(a).run());
}

export interface IStorage {
  listAirports(): Airport[];
  resolveCode(code: string): Airport | undefined;
  upsertAirport(a: InsertAirport): Airport;
  searchSpots(icaos: string[], includeAll?: boolean): SpotWithStats[];
  getSpot(id: number): SpotWithStats | undefined;
  createSpot(s: InsertSpot): Spot;
  updateSpot(id: number, s: Partial<InsertSpot>): Spot | undefined;
  deleteSpots(ids: number[]): number;
  listReviews(spotId: number): Review[];
  createReview(r: InsertReview): Review;
  deleteReview(id: number): void;
  listAds(): Ad[];
  createAd(a: InsertAd): Ad;
  updateAd(id: number, a: Partial<InsertAd>): Ad | undefined;
  deleteAd(id: number): void;
  trackAd(id: number, kind: "impressions" | "clicks"): void;
  stats(): Record<string, number>;
}

function withStats(rows: Spot[]): SpotWithStats[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const agg = sqlite
    .prepare(`SELECT spot_id, AVG(rating) avg, COUNT(*) n FROM reviews WHERE spot_id IN (${ids.map(() => "?").join(",")}) GROUP BY spot_id`)
    .all(...ids) as { spot_id: number; avg: number; n: number }[];
  const m = new Map(agg.map((a) => [a.spot_id, a]));
  const aps = new Map(db.select().from(airports).where(inArray(airports.icao, Array.from(new Set(rows.map((r) => r.icao))))).all().map((a) => [a.icao, a]));
  return rows.map((r) => ({ ...r, avgRating: m.get(r.id)?.avg ?? null, reviewCount: m.get(r.id)?.n ?? 0, airport: aps.get(r.icao) }));
}

export class DatabaseStorage implements IStorage {
  listAirports() {
    return db.select().from(airports).orderBy(airports.icao).all();
  }
  resolveCode(code: string) {
    const c = code.trim().toUpperCase();
    if (!c) return undefined;
    if (c.length === 4) return db.select().from(airports).where(eq(airports.icao, c)).get();
    if (c.length === 3) {
      return (
        db.select().from(airports).where(eq(airports.iata, c)).get() ||
        db.select().from(airports).where(eq(airports.icao, "K" + c)).get()
      );
    }
    return undefined;
  }
  upsertAirport(a: InsertAirport) {
    return db.insert(airports).values(a).onConflictDoUpdate({ target: airports.icao, set: a }).returning().get();
  }
  searchSpots(icaos: string[], includeAll = false) {
    let rows = icaos.length
      ? db.select().from(spots).where(inArray(spots.icao, icaos)).all()
      : db.select().from(spots).orderBy(desc(spots.createdAt)).all();
    if (!includeAll) rows = rows.filter((r) => r.status === "live");
    return withStats(rows);
  }
  getSpot(id: number) {
    const r = db.select().from(spots).where(eq(spots.id, id)).get();
    return r ? withStats([r])[0] : undefined;
  }
  createSpot(s: InsertSpot) {
    return db.insert(spots).values({ ...s, createdAt: Date.now() }).returning().get();
  }
  updateSpot(id: number, s: Partial<InsertSpot>) {
    return db.update(spots).set(s).where(eq(spots.id, id)).returning().get();
  }
  deleteSpots(ids: number[]) {
    if (!ids.length) return 0;
    db.delete(reviews).where(inArray(reviews.spotId, ids)).run();
    return db.delete(spots).where(inArray(spots.id, ids)).run().changes;
  }
  listReviews(spotId: number) {
    return db.select().from(reviews).where(eq(reviews.spotId, spotId)).orderBy(desc(reviews.createdAt)).all();
  }
  createReview(r: InsertReview) {
    return db.insert(reviews).values({ ...r, createdAt: Date.now() }).returning().get();
  }
  deleteReview(id: number) {
    db.delete(reviews).where(eq(reviews.id, id)).run();
  }
  listAds() {
    return db.select().from(ads).all();
  }
  createAd(a: InsertAd) {
    return db.insert(ads).values(a).returning().get();
  }
  updateAd(id: number, a: Partial<InsertAd>) {
    return db.update(ads).set(a).where(eq(ads.id, id)).returning().get();
  }
  deleteAd(id: number) {
    db.delete(ads).where(eq(ads.id, id)).run();
  }
  trackAd(id: number, kind: "impressions" | "clicks") {
    db.update(ads).set({ [kind]: sql`${ads[kind]} + 1` }).where(eq(ads.id, id)).run();
  }
  stats() {
    const q = (s: string) => (sqlite.prepare(s).get() as any).c as number;
    return {
      spots: q("SELECT COUNT(*) c FROM spots WHERE status='live'"),
      pending: q("SELECT COUNT(*) c FROM spots WHERE status='pending'"),
      reviews: q("SELECT COUNT(*) c FROM reviews"),
      airports: q("SELECT COUNT(DISTINCT icao) c FROM spots"),
      impressions: q("SELECT COALESCE(SUM(impressions),0) c FROM ads"),
      clicks: q("SELECT COALESCE(SUM(clicks),0) c FROM ads"),
    };
  }
}

export const storage = new DatabaseStorage();
