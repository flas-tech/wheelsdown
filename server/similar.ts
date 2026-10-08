import type { Express, Request } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { findDuplicate } from "./moderator";
import { similarity, squash } from "@shared/similar";

/** While someone types a new listing: anything already listed at that airport that looks like the same place. */
export function registerSimilar(app: Express, o: { userOf: (req: Request) => Promise<{ id: number } | undefined> }) {
  app.get("/api/spots/similar", async (req, res) => {
    const code = String(req.query.icao || "").toUpperCase().slice(0, 4);
    const name = String(req.query.name || "").slice(0, 120);
    if (code.length < 3 || squash(name).length < 3) return res.json([]);
    const ap = await storage.resolveCode(code);
    const icao = ap?.icao || code;
    const lat = req.query.lat != null && req.query.lat !== "" ? Number(req.query.lat) : null;
    const lng = req.query.lng != null && req.query.lng !== "" ? Number(req.query.lng) : null;
    const placeRef = String(req.query.placeRef || "") || null;
    const others = (await db().execute(sql`SELECT id, name, category, address, lat, lng, place_ref AS "placeRef" FROM spots WHERE icao = ${icao} AND status = 'live'`)).rows as any[];
    const me = await o.userOf(req);
    const strong = findDuplicate({ name, lat, lng }, others);
    const ranked = others.map((x) => ({ x, s: Math.max(similarity({ name, lat, lng, placeRef }, x), strong?.id === x.id ? 0.9 : 0) }))
      .filter((r) => r.s >= 0.6).sort((a, b) => b.s - a.s).slice(0, 3);
    const out = await Promise.all(ranked.map(async ({ x, s }) => {
      const st = (await db().execute(sql`SELECT count(*)::int AS n, avg(rating)::float8 AS avg, bool_or(user_id = ${me?.id ?? -1}) AS mine FROM reviews WHERE spot_id = ${x.id} AND status = 'live'`)).rows[0] as any;
      return { id: x.id, name: x.name, category: x.category, address: x.address || "", reviewCount: st.n, avgRating: st.avg, mine: !!st.mine, score: Math.round(s * 100) / 100 };
    }));
    res.json(out);
  });
}
