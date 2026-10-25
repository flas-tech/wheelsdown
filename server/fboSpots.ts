/**
 * FBO recommendations on the shared listings database.
 *
 * There is one spots table. An FBO doesn't keep its own copy of a restaurant: it checks listings that already exist at
 * its airport (fbo_recs links the FBO to the spot with its own note, crew rate and favorite star), and when a place is
 * missing it adds it the same way crews do (map search + AI autofill). Those listings are source = 'fbo', have no crew
 * owner (user_id NULL) and so never earn points or touch the leaderboard. Crews rate them like any other listing.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { findDuplicate } from "./moderator";
import { AI_ENABLED, autofill } from "./ai";
import { geocodeAddress } from "./places";
import { refAirport } from "./airportsData";
import { isValidCost, isPace } from "@shared/cost";
import { FBO_CATEGORIES, FBO_LIMITS, isoDate, nameKey, type FboCategory } from "@shared/fbo";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
const rows = async <T = any>(q: any) => ((await db().execute(q)).rows as T[]);
const one = async <T = any>(q: any) => (await rows<T>(q))[0];
const num = (v: unknown) => (v == null ? 0 : Number(v));
const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);
const now = () => Date.now();

export const FBO_RECS_MIGRATION = `
CREATE TABLE IF NOT EXISTS fbo_recs (id serial PRIMARY KEY, fbo_id integer NOT NULL, spot_id integer NOT NULL,
  notes text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '', crew_rate text NOT NULL DEFAULT '', distance text NOT NULL DEFAULT '',
  favorite integer NOT NULL DEFAULT 0, sort integer NOT NULL DEFAULT 0, hidden integer NOT NULL DEFAULT 0,
  created_at bigint NOT NULL DEFAULT 0, updated_at bigint NOT NULL DEFAULT 0, updated_by text NOT NULL DEFAULT '');
CREATE UNIQUE INDEX IF NOT EXISTS fbo_recs_pair ON fbo_recs (fbo_id, spot_id);
CREATE INDEX IF NOT EXISTS fbo_recs_spot_idx ON fbo_recs (spot_id);
ALTER TABLE spots ADD COLUMN IF NOT EXISTS fbo_id integer;
ALTER TABLE fbo_recs ADD COLUMN IF NOT EXISTS level text NOT NULL DEFAULT 'recommended'
`;

export type SpotHelpers = {
  applyCategoryRules: (rest: any) => string | null;
  ensureAirport: (code: string, city?: string, name?: string) => Promise<string>;
  milesFromAirport: (ap: { lat: number | null; lon: number | null } | undefined, lat?: number | null, lng?: number | null) => number | undefined;
};
export type FboCtx = { fid: (req: Request) => number; who: (req: Request) => string; fbo: (req: Request) => any;
  event: (fboId: number, kind: string, actor: string, detail?: string) => Promise<void>; touch: (fboId: number) => Promise<void> };

const cleanUrl = (v: unknown) => {
  let s = clip(v, 400);
  if (!s) return "";
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try { const u = new URL(s); return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : ""; } catch { return ""; }
};
const tagJson = (tags: unknown) => JSON.stringify((Array.isArray(tags) ? tags : []).map((t) => clip(t, 30)).filter(Boolean).slice(0, 8));

/** Defaults so a bulk row or a quick add is a valid listing; crews' price votes refine cost over time. */
function defaults(cat: FboCategory, costLevel: unknown, pace: unknown) {
  const c = costLevel == null || costLevel === "" ? null : Number(costLevel);
  return {
    costLevel: isValidCost(cat, c) ? c! : cat === "do" ? 0 : 2,
    pace: cat === "eat" ? (isPace(pace) ? pace : "both") : null,
  };
}

/** "listed" (List only) or "recommended" (List and recommend). A favorite star is the top tier of recommended. */
const levelOf = (v: unknown, fallback: string) => (v === "listed" || v === "recommended" ? v : fallback === "listed" ? "listed" : "recommended");
const recFields = (b: any, cur?: any) => {
  const pick = (k: string, col: string, n: number) => (b[k] != null ? clip(b[k], n) : cur ? cur[col] : "");
  let level = levelOf(b.level, cur ? cur.level : "recommended");
  let favorite = b.favorite != null ? (b.favorite ? 1 : 0) : cur ? num(cur.favorite) : 0;
  if (b.favorite && b.level == null) level = "recommended"; // starring implies recommending
  if (level === "listed") favorite = 0; // List only can't be a favorite
  return {
    level,
    notes: pick("notes", "notes", FBO_LIMITS.notes), phone: pick("phone", "phone", 40), crewRate: pick("crewRate", "crew_rate", 80),
    distance: pick("distance", "distance", 40),
    favorite,
    hidden: b.hidden != null ? (b.hidden ? 1 : 0) : cur ? num(cur.hidden) : 0,
  };
};
const recOut = (r: any) => ({ id: num(r.id), notes: r.notes, phone: r.phone, crewRate: r.crew_rate, distance: r.distance, favorite: !!num(r.favorite), level: levelOf(r.level, "recommended"),
  sort: num(r.sort), hidden: !!num(r.hidden), updatedAt: num(r.updated_at), updatedBy: r.updated_by });
/** The flat "place" shape the rest of the portal (print, discounts) uses. */
export const placeOut = (r: any) => ({ ...recOut(r), spotId: num(r.spot_id), category: r.category, name: r.name, address: r.address || "", website: r.website || "" });

/** Recommendations of one FBO joined to their listings. live: only what crews can see. */
export async function recsOf(fboId: number, live = false) {
  return rows(sql`SELECT r.*, s.category, s.name, s.address, s.website, s.status AS spot_status, s.id AS sid,
      (SELECT COUNT(*) FROM reviews v WHERE v.spot_id = s.id AND v.status = 'live' AND v.rating > 0) AS n,
      (SELECT AVG(v.rating) FROM reviews v WHERE v.spot_id = s.id AND v.status = 'live' AND v.rating > 0) AS avg
    FROM fbo_recs r JOIN spots s ON s.id = r.spot_id
    WHERE r.fbo_id = ${fboId} ${live ? sql`AND r.hidden = 0 AND s.status = 'live'` : sql``} AND s.status <> 'rejected'
    ORDER BY s.category, r.favorite DESC, (r.level = 'recommended') DESC, r.sort, lower(s.name)`);
}

/** For crew search results: which listings verified FBOs recommend, so cards can say "FBO recommended". */
export type FboRecSummary = { n: number; names: string[]; rec: number };
export async function fboRecMap(spotIds: number[]): Promise<Map<number, FboRecSummary>> {
  const m = new Map<number, FboRecSummary>();
  if (!spotIds.length) return m;
  const list = await rows(sql`SELECT r.spot_id, r.level, f.name FROM fbo_recs r JOIN fbo_accounts f ON f.id = r.fbo_id
    WHERE r.hidden = 0 AND f.status = 'active' AND f.verified_at IS NOT NULL ORDER BY (r.level = 'recommended') DESC, r.favorite DESC, r.updated_at DESC`).catch(() => [] as any[]);
  const want = new Set(spotIds);
  for (const r of list) {
    const id = num(r.spot_id); if (!want.has(id)) continue;
    const e = m.get(id) || { n: 0, names: [], rec: 0 }; e.n++; if (r.level !== "listed") e.rec++; if (e.names.length < 3) e.names.push(String(r.name)); m.set(id, e);
  }
  return m;
}

/** For the crew app's listing page: every active FBO that recommends this spot, with its note and live discounts. */
export async function fboRecsForSpot(spotId: number, appUrl: string) {
  const list = await rows(sql`SELECT r.id, r.notes, r.crew_rate, r.favorite, r.level, r.updated_at, f.id AS fbo_id, f.name, f.slug, f.icao
    FROM fbo_recs r JOIN fbo_accounts f ON f.id = r.fbo_id
    WHERE r.spot_id = ${spotId} AND r.hidden = 0 AND f.status = 'active' AND f.verified_at IS NOT NULL ORDER BY (r.level = 'recommended') DESC, r.favorite DESC, r.updated_at DESC LIMIT 10`).catch(() => [] as any[]);
  if (!list.length) return [];
  const today = new Date().toISOString().slice(0, 10);
  const offers = await rows(sql`SELECT * FROM fbo_offers WHERE place_id IN (${sql.join(list.map((r) => sql`${num(r.id)}`), sql`, `)}) AND active = 1`).catch(() => [] as any[]);
  return list.map((r) => ({
    fbo: r.name, icao: r.icao, url: `${appUrl}/f/${r.slug}`, note: r.notes || "", crewRate: r.crew_rate || "", favorite: !!num(r.favorite), level: levelOf(r.level, "recommended"), updatedAt: num(r.updated_at),
    offers: offers.filter((o) => num(o.place_id) === num(r.id) && (!o.expires_on || o.expires_on >= today)).map((o) => ({ title: o.title, code: o.code, details: o.details, expiresOn: o.expires_on })),
  }));
}

/** Publish an FBO's held listings once its email is confirmed. */
export async function publishHeldSpots(fboId: number) {
  return db().execute(sql`UPDATE spots SET status = 'live', mod_note = 'Added by an FBO (portal)' WHERE fbo_id = ${fboId} AND source = 'fbo' AND status = 'pending'`);
}

export function registerFboSpots(app: Express, o: { requireFbo: Mw; writeLimit: Mw; h: SpotHelpers; c: FboCtx }) {
  const { requireFbo, writeLimit, h, c } = o;
  const aiLimit = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { message: "AI lookup is busy. Try again in a few minutes, or type the details in." } });

  const recCount = async (fboId: number) => num((await one(sql`SELECT COUNT(*) AS n FROM fbo_recs WHERE fbo_id = ${fboId}`))?.n);
  const airportOf = async (icao: string) => (await storage.resolveCode(icao)) || (refAirport(icao) as any) || undefined;
  const verified = (req: Request) => !!c.fbo(req).verified_at;

  /** Create a listing on behalf of the FBO, exactly like a crew listing but with no owner. Returns the spot row. */
  async function createSpot(req: Request, b: any, geocode = true) {
    const f = c.fbo(req);
    const cat = (FBO_CATEGORIES as readonly string[]).includes(b.category) ? (b.category as FboCategory) : null;
    if (!cat) throw Object.assign(new Error("Pick restaurant, hotel or thing to do."), { status: 400 });
    const name = clip(b.name, 120);
    if (name.length < 2) throw Object.assign(new Error("Add the business name."), { status: 400 });
    const icao = await h.ensureAirport(f.icao);
    const ap = await airportOf(icao);
    const d = defaults(cat, b.costLevel, b.pace);
    const rest: any = {
      icao, category: cat, name, description: clip(b.description, 400), address: clip(b.address, 200), website: cleanUrl(b.website),
      crewTip: clip(b.crewTip, 300), tags: tagJson(b.tags), costLevel: d.costLevel, pace: d.pace, minutesNeeded: 60,
      lat: Number.isFinite(b.lat) ? Number(b.lat) : null, lng: Number.isFinite(b.lng) ? Number(b.lng) : null, placeRef: clip(b.placeRef, 40) || null,
    };
    const err = h.applyCategoryRules(rest);
    if (err) throw Object.assign(new Error(err), { status: 400 });
    if (geocode && (rest.lat == null || rest.lng == null) && /\d+\s+\w/.test(rest.address) && ap?.lat != null && ap?.lon != null) {
      const g = await geocodeAddress(rest.address, { lat: ap.lat, lng: ap.lon }).catch(() => null);
      if (g) { rest.lat = g.lat; rest.lng = g.lng; }
    }
    const mi = h.milesFromAirport(ap, rest.lat, rest.lng);
    if (mi !== undefined) rest.milesFromField = mi;
    const live = verified(req);
    const s = await storage.createSpot({ ...rest, submittedBy: f.name, userId: null, status: live ? "live" : "pending",
      source: "fbo", modState: "approved", modNote: live ? "Added by an FBO (portal)" : "Waiting for the FBO to confirm its email" } as any);
    await db().execute(sql`UPDATE spots SET fbo_id = ${num(f.id)} WHERE id = ${s.id}`);
    return s;
  }
  async function addRec(req: Request, spotId: number, b: any) {
    const id = c.fid(req);
    const cur = await one(sql`SELECT * FROM fbo_recs WHERE fbo_id = ${id} AND spot_id = ${spotId}`);
    const r = recFields(b, cur);
    if (cur) {
      return one(sql`UPDATE fbo_recs SET notes = ${r.notes}, phone = ${r.phone}, crew_rate = ${r.crewRate}, distance = ${r.distance}, favorite = ${r.favorite}, level = ${r.level},
        hidden = ${r.hidden}, updated_at = ${now()}, updated_by = ${c.who(req)} WHERE id = ${num(cur.id)} RETURNING *`);
    }
    const n = await recCount(id);
    if (n >= FBO_LIMITS.places) throw Object.assign(new Error(`Accounts hold up to ${FBO_LIMITS.places} recommendations during the beta.`), { status: 400 });
    return one(sql`INSERT INTO fbo_recs (fbo_id, spot_id, notes, phone, crew_rate, distance, favorite, level, hidden, sort, created_at, updated_at, updated_by)
      VALUES (${id}, ${spotId}, ${r.notes}, ${r.phone}, ${r.crewRate}, ${r.distance}, ${r.favorite}, ${r.level}, ${r.hidden}, ${n}, ${now()}, ${now()}, ${c.who(req)}) RETURNING *`);
  }
  /** Live listings at the FBO's airport (and its own held ones) that it may recommend. */
  const candidates = async (req: Request) => {
    const f = c.fbo(req);
    const ap = await airportOf(f.icao);
    const icao = ap?.icao || f.icao;
    return rows(sql`SELECT id, name, category, address, lat, lng, status FROM spots WHERE icao = ${icao} AND category IN ('eat','stay','do') AND source <> 'ai'
      AND (status = 'live' OR (status = 'pending' AND fbo_id = ${num(f.id)}))`);
  };
  const fail = (res: Response, e: any) => res.status(e?.status || 500).json({ message: e?.message || "Something went wrong" });

  // ---- the checklist: every listing at the airport, with this FBO's recommendation if any
  app.get("/api/fbo/spots", requireFbo, async (req, res) => {
    const f = c.fbo(req); const id = num(f.id);
    const ap = await airportOf(f.icao);
    const icao = ap?.icao || f.icao;
    const list = await rows(sql`SELECT s.id, s.category, s.name, s.address, s.website, s.description, s.cost_level, s.pace, s.miles_from_field, s.status, s.source, s.fbo_id,
        (SELECT COUNT(*) FROM reviews v WHERE v.spot_id = s.id AND v.status = 'live' AND v.rating > 0) AS n,
        (SELECT AVG(v.rating) FROM reviews v WHERE v.spot_id = s.id AND v.status = 'live' AND v.rating > 0) AS avg,
        (SELECT COUNT(*) FROM reviews v WHERE v.spot_id = s.id AND v.status = 'live' AND v.rating = 0) AS ga,
        (SELECT COUNT(*) FROM fbo_recs x WHERE x.spot_id = s.id AND x.fbo_id <> ${id}) AS others
      FROM spots s WHERE s.category IN ('eat','stay','do') AND s.source <> 'ai'
        AND ((s.icao = ${icao} AND s.status = 'live') OR (s.fbo_id = ${id} AND s.status = 'pending') OR s.id IN (SELECT spot_id FROM fbo_recs WHERE fbo_id = ${id}))
        AND s.status <> 'rejected'`);
    const recs = new Map((await rows(sql`SELECT * FROM fbo_recs WHERE fbo_id = ${id}`)).map((r) => [num(r.spot_id), r]));
    const out = list.map((s) => {
      const r = recs.get(num(s.id));
      const mine = s.source === "fbo" && num(s.fbo_id) === id;
      return {
        spotId: num(s.id), category: s.category, name: s.name, address: s.address || "", website: s.website || "", description: s.description || "",
        costLevel: s.cost_level == null ? null : num(s.cost_level), pace: s.pace, miles: s.miles_from_field == null ? null : Number(s.miles_from_field), status: s.status,
        crew: { ratings: num(s.n), avg: s.avg == null ? null : Math.round(Number(s.avg) * 10) / 10, goArounds: num(s.ga) },
        addedBy: mine ? "you" : s.source === "fbo" ? "fbo" : "crew", otherFbos: num(s.others), canEdit: mine,
        rec: r ? recOut(r) : null,
      };
    }).sort((a, b) => Number(!!b.rec) - Number(!!a.rec) || b.crew.ratings - a.crew.ratings || a.name.localeCompare(b.name));
    res.json({ icao, airport: ap ? `${ap.name}${ap.city ? ", " + ap.city : ""}` : "", lat: ap?.lat ?? null, lng: ap?.lon ?? null, verified: verified(req), aiEnabled: AI_ENABLED, spots: out });
  });

  // flat list of recommendations (print, discounts)
  app.get("/api/fbo/places", requireFbo, async (req, res) => res.json((await recsOf(c.fid(req))).map(placeOut)));

  // check a listing
  app.post("/api/fbo/recs", requireFbo, writeLimit, async (req, res) => {
    try {
      const spotId = Number(req.body?.spotId);
      const ok = (await candidates(req)).some((s) => num(s.id) === spotId);
      if (!ok) return res.status(404).json({ message: "That listing isn't at your airport." });
      const r = await addRec(req, spotId, req.body || {});
      const s = await one(sql`SELECT name FROM spots WHERE id = ${spotId}`);
      await c.event(c.fid(req), "edit", c.who(req), `${r.level === "listed" ? "listed" : "recommended"} ${s?.name}`); await c.touch(c.fid(req));
      res.json(recOut(r));
    } catch (e) { fail(res, e); }
  });
  app.patch("/api/fbo/recs/:id", requireFbo, writeLimit, async (req, res) => {
    const cur = await one(sql`SELECT * FROM fbo_recs WHERE id = ${Number(req.params.id)} AND fbo_id = ${c.fid(req)}`);
    if (!cur) return res.status(404).json({ message: "Not found" });
    const r = recFields(req.body || {}, cur);
    const out = await one(sql`UPDATE fbo_recs SET notes = ${r.notes}, phone = ${r.phone}, crew_rate = ${r.crewRate}, distance = ${r.distance}, favorite = ${r.favorite}, level = ${r.level},
      hidden = ${r.hidden}, updated_at = ${now()}, updated_by = ${c.who(req)} WHERE id = ${num(cur.id)} RETURNING *`);
    await c.event(c.fid(req), "edit", c.who(req), r.level !== cur.level ? `changed #${num(cur.spot_id)} to ${r.level === "listed" ? "List only" : "List and recommend"}` : `updated recommendation #${num(cur.spot_id)}`); await c.touch(c.fid(req));
    res.json(recOut(out));
  });
  // uncheck. A listing this FBO added that nobody else uses is withdrawn; anything crews rated stays for crews.
  app.delete("/api/fbo/recs/:id", requireFbo, writeLimit, async (req, res) => {
    const id = c.fid(req);
    const cur = await one(sql`DELETE FROM fbo_recs WHERE id = ${Number(req.params.id)} AND fbo_id = ${id} RETURNING spot_id`);
    if (cur) {
      const spotId = num(cur.spot_id);
      await db().execute(sql`UPDATE fbo_offers SET place_id = NULL WHERE place_id = ${Number(req.params.id)} AND fbo_id = ${id}`);
      const s = await one(sql`SELECT name, source, fbo_id FROM spots WHERE id = ${spotId}`);
      let withdrawn = false;
      if (s?.source === "fbo" && num(s.fbo_id) === id) {
        const used = await one(sql`SELECT (SELECT COUNT(*) FROM reviews WHERE spot_id = ${spotId}) + (SELECT COUNT(*) FROM fbo_recs WHERE spot_id = ${spotId}) AS n`);
        if (!num(used?.n)) { await db().execute(sql`UPDATE spots SET status = 'hidden', mod_note = 'Withdrawn by the FBO that added it' WHERE id = ${spotId}`); withdrawn = true; }
      }
      await c.event(id, "edit", c.who(req), `stopped recommending ${s?.name || "#" + spotId}${withdrawn ? " (listing withdrawn)" : ""}`); await c.touch(id);
    }
    res.json({ ok: true });
  });

  // add a missing place (same fields crews fill in), recommended right away
  app.post("/api/fbo/spots", requireFbo, writeLimit, async (req, res) => {
    try {
      const b = req.body || {};
      if (!b.force) {
        const dup = findDuplicate({ name: clip(b.name, 120), lat: b.lat ?? null, lng: b.lng ?? null }, (await candidates(req)) as any[]);
        if (dup) return res.status(409).json({ message: `${dup.name} is already on Wheelsdown at your airport.`, duplicate: { spotId: num(dup.id), name: dup.name, address: dup.address || "" } });
      }
      if ((await recCount(c.fid(req))) >= FBO_LIMITS.places) return res.status(400).json({ message: `Accounts hold up to ${FBO_LIMITS.places} recommendations during the beta.` });
      const s = await createSpot(req, b);
      const r = await addRec(req, s.id, b.rec || {});
      await c.event(c.fid(req), "edit", c.who(req), `added listing ${s.name} (${s.category})`); await c.touch(c.fid(req));
      res.json({ spotId: s.id, status: s.status, rec: recOut(r) });
    } catch (e) { fail(res, e); }
  });
  // fix a listing this FBO added (crews' listings are theirs to edit)
  app.patch("/api/fbo/spots/:spotId", requireFbo, writeLimit, async (req, res) => {
    const id = c.fid(req);
    const s = await one(sql`SELECT * FROM spots WHERE id = ${Number(req.params.spotId)} AND source = 'fbo' AND fbo_id = ${id}`);
    if (!s) return res.status(403).json({ message: "Only listings your FBO added can be edited here. Crews keep their own listings up to date." });
    const b = req.body || {};
    const cat = (FBO_CATEGORIES as readonly string[]).includes(b.category) ? b.category : s.category;
    const d = defaults(cat, b.costLevel ?? s.cost_level, b.pace ?? s.pace);
    const rest: any = { category: cat, costLevel: d.costLevel, pace: d.pace, minutesNeeded: num(s.minutes_needed) || 60 };
    const err = h.applyCategoryRules(rest);
    if (err) return res.status(400).json({ message: err });
    const name = b.name != null ? clip(b.name, 120) : s.name;
    if (name.length < 2) return res.status(400).json({ message: "Add the business name." });
    const address = b.address != null ? clip(b.address, 200) : s.address;
    let lat = s.lat, lng = s.lng, miles = s.miles_from_field;
    if (address !== s.address) {
      const ap = await airportOf(s.icao);
      lat = null; lng = null;
      if (/\d+\s+\w/.test(address) && ap?.lat != null && ap?.lon != null) { const g = await geocodeAddress(address, { lat: ap.lat, lng: ap.lon }).catch(() => null); if (g) { lat = g.lat; lng = g.lng; } }
      miles = h.milesFromAirport(ap, lat, lng) ?? miles;
    }
    await db().execute(sql`UPDATE spots SET name = ${name}, category = ${cat}, address = ${address}, website = ${b.website != null ? cleanUrl(b.website) : s.website},
      description = ${b.description != null ? clip(b.description, 400) : s.description}, cost_level = ${rest.costLevel}, pace = ${rest.pace}, minutes_needed = ${rest.minutesNeeded},
      lat = ${lat}, lng = ${lng}, miles_from_field = ${miles} WHERE id = ${num(s.id)}`);
    await c.event(id, "edit", c.who(req), `edited listing ${name}`); await c.touch(id);
    res.json({ ok: true });
  });

  // AI lookup, same as crews' autofill
  app.post("/api/fbo/autofill", requireFbo, aiLimit, async (req, res) => {
    if (!AI_ENABLED) return res.status(503).json({ message: "AI lookup isn't switched on. Type the details in." });
    const b = req.body || {};
    const cat = (FBO_CATEGORIES as readonly string[]).includes(b.category) ? b.category : "eat";
    const name = clip(b.name, 120);
    if (name.length < 2) return res.status(400).json({ message: "Type the business name first." });
    const f = c.fbo(req);
    const ap = await airportOf(f.icao);
    const icao = ap?.icao || f.icao;
    const lat = Number.isFinite(b.lat) ? Number(b.lat) : null, lng = Number.isFinite(b.lng) ? Number(b.lng) : null;
    const dup = findDuplicate({ name, lat, lng }, (await candidates(req)) as any[]);
    try {
      const r = await autofill({ icao, category: cat, name, address: clip(b.address, 300), website: clip(b.website, 300), placeRef: clip(b.placeRef, 40) || null, lat, lng,
        airport: ap ? { name: ap.name, city: ap.city, lat: ap.lat, lon: ap.lon } : null, milesFromField: h.milesFromAirport(ap, lat, lng) ?? null });
      await c.event(num(f.id), "ai_lookup", c.who(req), name);
      res.json({ ...r, duplicate: dup ? { spotId: num(dup.id), name: dup.name } : null });
    } catch (e) {
      res.status(502).json({ message: "AI lookup couldn't finish. Type the details in, or try again.", duplicate: dup ? { spotId: num(dup.id), name: dup.name } : null });
    }
  });

  /**
   * Bulk upload. Each row is matched to a listing already at the airport (recommend it), else to one of the FBO's own
   * recommendations (skip or update the note), else a new listing is added. dryRun returns the plan without saving.
   */
  app.post("/api/fbo/recs/bulk", requireFbo, writeLimit, async (req, res) => {
    const list: any[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    const mode = req.body?.mode === "update" ? "update" : "skip";
    const defLevel = req.body?.level === "listed" ? "listed" : "recommended";
    const lv = (raw: any) => (raw.level === "listed" || raw.level === "recommended" ? raw.level : raw.favorite ? "recommended" : defLevel);
    const dry = !!req.body?.dryRun;
    if (!list.length) return res.status(400).json({ message: "Nothing to import." });
    if (list.length > FBO_LIMITS.bulkRows) return res.status(400).json({ message: `Import up to ${FBO_LIMITS.bulkRows} rows at a time.` });
    const id = c.fid(req);
    const pool = (await candidates(req)) as any[];
    const mine = new Map((await rows(sql`SELECT * FROM fbo_recs WHERE fbo_id = ${id}`)).map((r) => [num(r.spot_id), r]));
    let count = mine.size, added = 0, linked = 0, updated = 0, skipped = 0, offers = 0;
    const plan: { row: number; action: "new" | "link" | "update" | "skip" | "error"; name: string; match?: string; message?: string }[] = [];
    const created: number[] = [];
    for (let i = 0; i < list.length; i++) {
      const raw = list[i] || {};
      const name = clip(raw.name, 120);
      if (name.length < 2) { plan.push({ row: i + 1, action: "error", name, message: "No name" }); continue; }
      if (!(FBO_CATEGORIES as readonly string[]).includes(raw.category)) { plan.push({ row: i + 1, action: "error", name, message: "Type must be restaurant, hotel or thing to do" }); continue; }
      const sameCat = pool.filter((p) => p.category === raw.category);
      const dup = findDuplicate({ name }, sameCat) || sameCat.find((p) => nameKey(p.name) === nameKey(name));
      const already = dup ? mine.get(num(dup.id)) : undefined;
      if (already) {
        if (mode === "skip") { plan.push({ row: i + 1, action: "skip", name, match: dup!.name }); skipped++; continue; }
        plan.push({ row: i + 1, action: "update", name, match: dup!.name });
        if (!dry) await addRec(req, num(dup!.id), { ...Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== "" && v != null)), favorite: raw.favorite ? true : !!num(already.favorite), level: raw.level || (raw.favorite ? "recommended" : undefined) });
        updated++;
      } else {
        if (count >= FBO_LIMITS.places) { plan.push({ row: i + 1, action: "error", name, message: `Over the ${FBO_LIMITS.places}-recommendation limit` }); continue; }
        let spotId: number;
        if (dup) { plan.push({ row: i + 1, action: "link", name, match: dup.name }); spotId = num(dup.id); linked++; }
        else {
          plan.push({ row: i + 1, action: "new", name }); added++;
          if (dry) { pool.push({ id: -1 - i, name, category: raw.category, lat: null, lng: null }); count++; continue; }
          try { const s = await createSpot(req, { ...raw, name }, false); spotId = s.id; created.push(s.id); pool.push({ id: s.id, name: s.name, category: s.category, address: s.address, lat: null, lng: null }); }
          catch (e: any) { plan[plan.length - 1] = { row: i + 1, action: "error", name, message: e?.message || "Couldn't add" }; added--; continue; }
        }
        count++;
        if (dry) continue;
        const r = await addRec(req, spotId, { ...raw, level: lv(raw) });
        mine.set(spotId, r);
      }
      const code = clip(raw.code, 40), offer = clip(raw.offer, 200);
      if (!dry && (code || offer)) {
        const rec = mine.get(num(dup?.id ?? created[created.length - 1]));
        await db().execute(sql`INSERT INTO fbo_offers (fbo_id, place_id, title, code, details, expires_on, active, created_at, updated_at, updated_by)
          VALUES (${id}, ${rec ? num(rec.id) : null}, ${clip(offer || "Crew discount", 120)}, ${code}, ${""}, ${isoDate(String(raw.expires || ""))}, 1, ${now()}, ${now()}, ${c.who(req)})`);
        offers++;
      }
    }
    if (!dry) {
      await c.event(id, "import", c.who(req), `${added} new listings, ${linked} existing listings recommended, ${updated} updated, ${skipped} skipped, ${offers} discounts, ${plan.filter((p) => p.action === "error").length} errors`);
      await c.touch(id);
      // pins and distances for new listings, in the background (the geocoder allows about one lookup a second)
      void (async () => {
        const ap = await airportOf(c.fbo(req).icao);
        if (ap?.lat == null || ap?.lon == null) return;
        for (const sid of created) {
          const s = await one(sql`SELECT address FROM spots WHERE id = ${sid}`);
          if (!s?.address || !/\d+\s+\w/.test(s.address)) continue;
          const g = await geocodeAddress(s.address, { lat: ap.lat, lng: ap.lon }).catch(() => null);
          if (g) await db().execute(sql`UPDATE spots SET lat = ${g.lat}, lng = ${g.lng}, miles_from_field = ${h.milesFromAirport(ap, g.lat, g.lng) ?? 0} WHERE id = ${sid}`);
        }
      })().catch(() => {});
    }
    res.json({ dryRun: dry, added, linked, updated, skipped, offers, errors: plan.filter((p) => p.action === "error").map((p) => ({ row: p.row, message: p.message })), plan });
  });
}
