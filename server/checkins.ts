import type { Express, Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { storage } from "./storage";
import { refAirport } from "./airportsData";
import { CHECKIN_RULES, type MapDot } from "@shared/checkins";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
const miles = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 3958.8, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const body = z.object({
  spotId: z.number().int().positive().optional(), icao: z.string().trim().max(4).optional(),
  lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), accuracy: z.number().min(0).max(100_000).optional().default(0),
}).refine((b) => !!b.spotId !== !!b.icao, "Check in at a spot or an airport");

/**
 * Check-ins: "I've been here", verified against the phone's location at that moment.
 * The member's own coordinates are never stored, only what they checked in at and when. Private to the member; no points.
 */
export function registerCheckins(app: Express, opts: { requireUser: Mw; userOf: (req: Request) => Promise<{ id: number } | undefined> }) {
  const limit = rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Slow down a little and try again." } });

  app.post("/api/checkins", opts.requireUser, limit, async (req, res) => {
    const me = (req as any).user as { id: number };
    const p = body.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message || "Invalid check-in" });
    const { lat, lng, accuracy } = p.data;
    const accMi = accuracy / 1609.34;
    if (accMi > CHECKIN_RULES.maxAccuracyMiles) return res.status(400).json({ message: "Your location is too rough to verify. Step outside or turn on precise location, then try again." });
    const here = { lat, lng };
    let target: { spotId: number | null; icao: string; lat: number; lng: number; radius: number; name: string };
    if (p.data.spotId) {
      const s = await storage.getSpot(p.data.spotId);
      if (!s || s.status !== "live") return res.status(404).json({ message: "Not found" });
      const ap = (await storage.resolveCode(s.icao)) || (refAirport(s.icao) as any);
      if (s.lat != null && s.lng != null) target = { spotId: s.id, icao: s.icao, lat: s.lat, lng: s.lng, radius: CHECKIN_RULES.spotMiles, name: s.name };
      else if (ap?.lat != null) target = { spotId: s.id, icao: s.icao, lat: ap.lat, lng: ap.lon, radius: (s.milesFromField || 0) + CHECKIN_RULES.unpinnedSlackMiles, name: s.name };
      else return res.status(400).json({ message: "This listing has no location to check against yet." });
    } else {
      const ap = (await storage.resolveCode(p.data.icao!)) || (refAirport(p.data.icao!) as any);
      if (ap?.lat == null) return res.status(404).json({ message: "Unknown airport" });
      target = { spotId: null, icao: ap.icao, lat: ap.lat, lng: ap.lon, radius: CHECKIN_RULES.airportMiles, name: ap.icao };
    }
    const d = miles(here, target);
    if (d - Math.min(accMi, 0.25) > target.radius) {
      return res.status(400).json({ message: `You're about ${d < 10 ? d.toFixed(1) : Math.round(d)} miles from ${target.name}. Check in when you're there.`, distance: Math.round(d * 10) / 10 });
    }
    // one check-in per place per day; a second tap just confirms the first
    const since = Date.now() - 20 * 3600_000;
    const prior = (await db().execute(sql`SELECT id, created_at::float8 AS at FROM checkins WHERE user_id = ${me.id} AND icao = ${target.icao}
        AND ${target.spotId === null ? sql`spot_id IS NULL` : sql`spot_id = ${target.spotId}`} AND created_at > ${since} ORDER BY id DESC LIMIT 1`)).rows[0] as any;
    if (prior) return res.json({ ok: true, id: prior.id, already: true, createdAt: prior.at });
    const now = Date.now();
    const row = (await db().execute(sql`INSERT INTO checkins (user_id, spot_id, icao, lat, lng, created_at) VALUES (${me.id}, ${target.spotId}, ${target.icao}, ${target.lat}, ${target.lng}, ${now}) RETURNING id`)).rows[0] as any;
    res.status(201).json({ ok: true, id: row.id, already: false, createdAt: now });
  });

  app.get("/api/me/checkins", opts.requireUser, async (req, res) => {
    const me = (req as any).user as { id: number };
    const rows = (await db().execute(sql`SELECT c.id, c.spot_id AS "spotId", c.icao, c.lat, c.lng, c.created_at::float8 AS "createdAt", s.name AS "spotName", s.category
      FROM checkins c LEFT JOIN spots s ON s.id = c.spot_id WHERE c.user_id = ${me.id} ORDER BY c.created_at DESC LIMIT 1000`)).rows;
    res.json(rows);
  });
  app.delete("/api/checkins/:id", opts.requireUser, async (req, res) => {
    const me = (req as any).user as { id: number };
    await db().execute(sql`DELETE FROM checkins WHERE id = ${Number(req.params.id)} AND user_id = ${me.id}`);
    res.json({ ok: true });
  });

  /** Map dots: listings someone added (public), plus their own check-ins when it's their map. */
  async function addedDots(userId: number): Promise<MapDot[]> {
    const rows = (await db().execute(sql`SELECT s.id, s.name, s.icao, s.category, s.lat, s.lng, a.lat AS alat, a.lon AS alon
      FROM spots s LEFT JOIN airports a ON a.icao = s.icao WHERE s.user_id = ${userId} AND s.status = 'live'`)).rows as any[];
    return rows.map((r) => ({ kind: "added" as const, spotId: r.id, name: r.name, icao: r.icao, category: r.category, lat: r.lat ?? r.alat, lng: r.lng ?? r.alon }))
      .filter((d) => d.lat != null && d.lng != null);
  }
  app.get("/api/me/map", opts.requireUser, async (req, res) => {
    const me = (req as any).user as { id: number };
    const added = await addedDots(me.id);
    const ck = (await db().execute(sql`SELECT DISTINCT ON (COALESCE(c.spot_id, 0), c.icao) c.spot_id AS "spotId", c.icao, c.lat, c.lng, s.name, s.category
      FROM checkins c LEFT JOIN spots s ON s.id = c.spot_id WHERE c.user_id = ${me.id} ORDER BY COALESCE(c.spot_id, 0), c.icao, c.created_at DESC`)).rows as any[];
    const checkins: MapDot[] = ck.map((r) => ({ kind: r.spotId ? "checkin" : "airport", spotId: r.spotId, name: r.name || r.icao, icao: r.icao, category: r.category || null, lat: r.lat, lng: r.lng }));
    res.json({ added, checkins });
  });
  app.get("/api/crew/:id/map", async (req, res) => {
    const id = Number(req.params.id);
    const pub = (await storage.publicUsers()).find((u) => u.id === id);
    if (!pub || pub.anonymous) return res.json({ added: [], checkins: [] });
    res.json({ added: await addedDots(id), checkins: [] }); // check-ins stay private
  });
}
