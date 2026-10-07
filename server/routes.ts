import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import { rateLimit } from "express-rate-limit";
import { timingSafeEqual } from "node:crypto";
import { storage } from "./storage";
import { sendEmail, resetEmail } from "./email";
import {
  insertSpotSchema, insertReviewSchema, insertAdSchema, CATEGORIES, signupSchema, loginSchema, updateMeSchema, forgotSchema, resetSchema, type User,
} from "@shared/schema";
import { tierFor, TIERS, publicName } from "@shared/tiers";
import { buildHighlights } from "@shared/highlights";
import { briefingSchema, type BriefingStop, type Briefing, type SpotWithStats } from "@shared/schema";
import { isValidCost, costOptions, milesBetween, isPace, paceMinutes } from "@shared/cost";
import { suggestPicks } from "@shared/briefing";
import { refAirport, nearestAirports, isCode } from "./airportsData";
import { searchPlaces, nearbyPlaces } from "./places";
import { z } from "zod";

const PROD = process.env.NODE_ENV === "production";
const ADMIN_KEY = process.env.ADMIN_KEY || (PROD ? "" : "wheelsdown-admin");
if (PROD && ADMIN_KEY.length < 24) throw new Error("ADMIN_KEY must be set to a random value of at least 24 characters in production.");
const MODERATE = process.env.MODERATE === "1"; // when on, new submissions land as "pending" (Commercial tier and up skip)
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = String(req.headers["x-admin-key"] || req.query.key || "");
  if (!ADMIN_KEY || !safeEq(key, ADMIN_KEY)) return res.status(401).json({ message: "Admin key required" });
  next();
}

const tokenOf = (req: Request) => String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
async function userOf(req: Request): Promise<User | undefined> {
  if ((req as any)._user !== undefined) return (req as any)._user || undefined;
  const u = await storage.userForToken(tokenOf(req));
  (req as any)._user = u || null;
  return u;
}
const voterOf = async (req: Request) => { const u = await userOf(req); return u ? `u:${u.id}` : ""; };
async function requireUser(req: Request, res: Response, next: NextFunction) {
  const u = await userOf(req);
  if (!u) return res.status(401).json({ message: "Sign in to contribute" });
  (req as any).user = u;
  next();
}
const id = (req: Request) => Number(req.params.id);

// Split "MIA-TEB ASE/KAPA,TJSJ" into codes
function parseRoute(route: string) {
  return route.toUpperCase().split(/[^A-Z0-9]+/).filter((c) => c.length === 3 || c.length === 4).slice(0, 12);
}

// ---- tiny CSV helpers ----
const CSV_COLS = ["id", "icao", "category", "name", "description", "address", "website", "costLevel", "minutesNeeded", "pace", "milesFromField", "lat", "lng", "crewTip", "tags", "submittedBy", "status", "airportCity", "airportName"] as const;
function csvEscape(v: unknown) {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@]/.test(s)) s = "'" + s; // neutralize spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

async function ensureAirport(code: string, city?: string, name?: string) {
  const found = await storage.resolveOrCreate(code);
  if (found) return found.icao;
  // Not in the published list: keep the code as typed (K prefix only for 3-letter US-style codes)
  const icao = /^[A-Z]{3}$/.test(code) ? "K" + code : code;
  await storage.upsertAirport({ icao, iata: /^[A-Z]{3}$/.test(code) ? code : null, name: name || icao, city: city || "Unknown", region: "", country: "" });
  return icao;
}

const msg = (e: z.ZodError) => e.issues[0]?.message || "Invalid";

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Rate limits: tight on auth, moderate on writes. Keyed by client IP (app sets trust proxy).
  const authLimit = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Too many attempts. Try again in a few minutes." } });
  const writeLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Slow down a little and try again." } });
  const readLimit = rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false });
  app.use("/api", readLimit);

  app.get("/api/health", async (_req, res) => {
    try { await storage.health(); res.json({ ok: true, db: "up", time: new Date().toISOString() }); }
    catch { res.status(503).json({ ok: false, db: "down" }); }
  });
  app.get("/api/config", (_req, res) => res.json({ contactEmail: process.env.CONTACT_EMAIL || "", emailEnabled: !!process.env.RESEND_API_KEY, moderated: MODERATE }));

  // ---------- accounts ----------
  app.post("/api/auth/signup", authLimit, async (req, res) => {
    const p = signupSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    if (PROD && p.data.acceptTerms !== true) return res.status(400).json({ message: "Please accept the Terms and Community Guidelines" });
    try {
      const u = await storage.createUser(p.data);
      res.status(201).json({ token: await storage.createSession(u.id), me: await storage.me(u) });
    } catch (e: any) { res.status(e.status || 500).json({ message: e.message }); }
  });
  app.post("/api/auth/login", authLimit, async (req, res) => {
    const p = loginSchema.safeParse(req.body);
    const r = p.success ? await storage.login(p.data.handle, p.data.password) : undefined;
    if (!r) return res.status(401).json({ message: "Handle or password is wrong" });
    res.json({ token: r.token, me: await storage.me(r.user) });
  });
  app.post("/api/auth/logout", async (req, res) => { await storage.logout(tokenOf(req)); res.json({ ok: true }); });
  app.post("/api/auth/forgot", authLimit, async (req, res) => {
    const p = forgotSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const r = await storage.startPasswordReset(p.data.email);
    if (r) {
      const base = APP_URL || `${req.protocol}://${req.get("host")}`;
      const link = `${base}/#/reset/${r.token}`;
      const { text, html } = resetEmail(r.user.displayName, link);
      await sendEmail(p.data.email, "Reset your Wheelsdown password", text, html);
    }
    // Same answer either way so the endpoint can't be used to discover accounts
    res.json({ ok: true, message: "If that email is on an account, a reset link is on its way." });
  });
  app.post("/api/auth/reset", authLimit, async (req, res) => {
    const p = resetSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const ok = await storage.finishPasswordReset(p.data.token, p.data.password);
    if (!ok) return res.status(400).json({ message: "That reset link has expired or was already used. Request a new one." });
    res.json({ ok: true });
  });
  app.get("/api/me", async (req, res) => { const u = await userOf(req); res.json(u ? await storage.me(u) : null); });
  app.patch("/api/me", requireUser, writeLimit, async (req, res) => {
    const p = updateMeSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    try { res.json(await storage.me(await storage.updateUser((req as any).user.id, p.data))); }
    catch (e: any) { res.status(e.status || 500).json({ message: e.message }); }
  });
  app.delete("/api/me", requireUser, authLimit, async (req, res) => {
    const confirm = String(req.body?.confirm || "");
    const u = (req as any).user as User;
    if (confirm.toLowerCase() !== u.handle) return res.status(400).json({ message: "Type your handle to confirm" });
    await storage.deleteUser(u.id);
    res.json({ ok: true });
  });
  app.get("/api/me/contributions", requireUser, async (req, res) => res.json(await storage.userContributions((req as any).user.id)));
  app.get("/api/crew", async (_req, res) => res.json(await storage.publicUsers()));
  /** Full leaderboard: ?q= name or handle, ?base= home airport (any form), paged with offset/limit. */
  app.get("/api/leaderboard", async (req, res) => res.json(await storage.leaderboard({
    q: String(req.query.q || "").slice(0, 60), base: String(req.query.base || "").slice(0, 4),
    offset: Number(req.query.offset) || 0, limit: Number(req.query.limit) || 50,
  })));
  app.get("/api/leaderboard/bases", async (_req, res) => res.json(await storage.homeBases()));

  // ---------- favorites (private, no points) ----------
  app.get("/api/me/favorites", requireUser, async (req, res) => res.json(await storage.favoriteSpots((req as any).user.id)));
  app.get("/api/me/favorites/ids", requireUser, async (req, res) => res.json(await storage.favoriteIds((req as any).user.id)));
  app.put("/api/spots/:id/favorite", requireUser, writeLimit, async (req, res) => {
    const s = await storage.getSpot(id(req));
    if (!s || s.status === "hidden") return res.status(404).json({ message: "Not found" });
    const on = req.body?.on !== false;
    if (on && (await storage.favoriteIds((req as any).user.id)).length >= 500) return res.status(400).json({ message: "You have 500 favorites. Remove a few first." });
    await storage.setFavorite((req as any).user.id, s.id, on);
    res.json({ ok: true, on });
  });

  // ---------- public ----------
  app.get("/api/airports", async (_req, res) => res.json(await storage.listAirports()));

  app.get("/api/search", async (req, res) => {
    const codes = parseRoute(String(req.query.route || ""));
    const legs = await Promise.all(codes.map(async (code) => {
      const a = await storage.resolveCode(code);
      if (a) return { code, airport: a };
      const ref = refAirport(code); // known airport with no listings yet
      return { code, airport: ref ? { icao: ref.icao, iata: ref.iata, name: ref.name, city: ref.city, region: ref.region, country: ref.country, lat: ref.lat, lon: ref.lon } : null };
    }));
    const icaos = legs.filter((l) => l.airport).map((l) => l.airport!.icao);
    const v = await voterOf(req);
    const results = codes.length ? (icaos.length ? await storage.searchSpots(icaos, false, v) : []) : await storage.searchSpots([], false, v);
    res.json({ legs, spots: results });
  });

  app.get("/api/highlights", async (req, res) => {
    const cat = req.query.category ? String(req.query.category) : null;
    res.json(buildHighlights(await storage.searchSpots([], false, await voterOf(req)), { category: cat }));
  });

  app.get("/api/spots/:id", async (req, res) => {
    const v = await voterOf(req);
    const s = await storage.getSpot(id(req), v);
    if (!s || s.status === "hidden") return res.status(404).json({ message: "Not found" });
    res.json({ spot: s, reviews: await storage.listReviewsWithVotes(s.id, v) });
  });

  // Up/down vote on a listing or review. value: 1, -1, or 0 to clear. One vote per account per target.
  const voteHandler = (type: "spot" | "review") => async (req: Request, res: Response) => {
    const voter = await voterOf(req);
    const value = Number(req.body?.value);
    if (![1, -1, 0].includes(value)) return res.status(400).json({ message: "value must be 1, -1 or 0" });
    await storage.vote(type, id(req), voter, value, String(req.body?.reason || "").slice(0, 40));
    res.json({ ok: true });
  };
  app.post("/api/spots/:id/vote", requireUser, writeLimit, voteHandler("spot"));
  app.post("/api/reviews/:id/vote", requireUser, writeLimit, voteHandler("review"));

  const submitSchema = insertSpotSchema.extend({
    icao: z.string().trim().min(3).max(4),
    airportCity: z.string().max(80).optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
    website: z.union([z.literal(""), z.string().url("Website should start with https://")]).optional(),
  });
  /** Category rules shared by new listings and edits. Returns an error message, or null. */
  function applyCategoryRules(rest: { category: string; costLevel?: number | null; pace?: string | null; minutesNeeded?: number }) {
    if (rest.category === "fbo") rest.costLevel = 0;
    else if (!isValidCost(rest.category as any, rest.costLevel)) return rest.category === "do" ? "Pick a price" : "Pick a price from $ to $$$$";
    if (rest.category === "eat") {
      if (!isPace(rest.pace)) return "Pick Grab & go, Sit-down, or both";
      rest.minutesNeeded = paceMinutes(rest.pace);
    } else rest.pace = null;
    if (rest.category === "stay") rest.minutesNeeded = 720;
    if (rest.category === "fbo") rest.minutesNeeded = 30;
    return null;
  }
  /** Distance is always measured from the listing's airport, never from where the poster is standing. */
  function milesFromAirport(ap: { lat: number | null; lon: number | null } | undefined, lat?: number | null, lng?: number | null) {
    if (lat == null || lng == null || ap?.lat == null || ap?.lon == null) return undefined;
    return Math.round(milesBetween({ lat: ap.lat, lon: ap.lon }, { lat, lon: lng }) * 10) / 10;
  }
  const tagJson = (tags: unknown) => {
    const arr = Array.isArray(tags) ? tags.map(String) : String(tags || "").split(",").map((t) => t.trim()).filter(Boolean);
    return JSON.stringify(arr.slice(0, 8).map((t) => t.slice(0, 30)));
  };

  app.post("/api/spots", requireUser, writeLimit, async (req, res) => {
    const user = (req as any).user as User;
    const p = submitSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const { airportCity, tags, ...rest } = p.data;
    const code = rest.icao.toUpperCase();
    if (!(await storage.resolveCode(code)) && !refAirport(code) && !airportCity) return res.status(400).json({ message: `We don't know ${code} yet — add the city so we can create it.` });
    const err = applyCategoryRules(rest);
    if (err) return res.status(400).json({ message: err });
    const icao = await ensureAirport(code, airportCity);
    const ap = await storage.resolveCode(icao);
    const mi = milesFromAirport(ap, rest.lat, rest.lng);
    if (mi !== undefined) rest.milesFromField = mi;
    const trusted = tierFor((await storage.me(user)).points).index >= TIERS.findIndex((t) => t.id === "commercial");
    const spot = await storage.createSpot({ ...rest, icao, tags: tagJson(tags), submittedBy: publicName(user), userId: user.id, status: MODERATE && !trusted ? "pending" : "live" });
    res.status(201).json(spot);
  });

  /** The original poster can fix their own listing. Points, ratings and votes are unchanged. */
  app.patch("/api/spots/:id", requireUser, writeLimit, async (req, res) => {
    const user = (req as any).user as User;
    const cur = await storage.getSpot(id(req));
    if (!cur || cur.status === "hidden") return res.status(404).json({ message: "Not found" });
    if (cur.userId !== user.id) return res.status(403).json({ message: "Only the crew member who posted this can edit it" });
    const p = submitSchema.safeParse({ ...cur, tags: (() => { try { return JSON.parse(cur.tags); } catch { return []; } })(), ...req.body, icao: req.body?.icao ?? cur.icao });
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const { airportCity, tags, ...rest } = p.data;
    const code = rest.icao.toUpperCase();
    if (!(await storage.resolveCode(code)) && !refAirport(code) && !airportCity) return res.status(400).json({ message: `We don't know ${code} yet — add the city so we can create it.` });
    const err = applyCategoryRules(rest);
    if (err) return res.status(400).json({ message: err });
    const icao = await ensureAirport(code, airportCity);
    const mi = milesFromAirport(await storage.resolveCode(icao), rest.lat, rest.lng);
    if (mi !== undefined) rest.milesFromField = mi;
    const s = await storage.updateSpot(cur.id, {
      icao, category: rest.category, name: rest.name, description: rest.description, address: rest.address, website: rest.website,
      costLevel: rest.costLevel, minutesNeeded: rest.minutesNeeded, pace: rest.pace ?? null, milesFromField: rest.milesFromField,
      lat: rest.lat ?? null, lng: rest.lng ?? null, placeRef: rest.placeRef ?? null, crewTip: rest.crewTip, tags: tagJson(tags),
    });
    res.json(s);
  });

  app.post("/api/spots/:id/reviews", requireUser, writeLimit, async (req, res) => {
    const user = (req as any).user as User;
    const p = insertReviewSchema.safeParse({ ...req.body, spotId: id(req), author: publicName(user), crewRole: user.crewRole, userId: user.id });
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const spot = await storage.getSpot(p.data.spotId);
    if (!spot) return res.status(404).json({ message: "Not found" });
    // a price vote is optional; drop values that don't apply to this category (e.g. "Free" for a restaurant, anything for an FBO)
    const costLevel = p.data.costLevel != null && costOptions(spot.category).includes(p.data.costLevel) ? p.data.costLevel : null;
    if (p.data.rating === 0 && p.data.comment.trim().length < 10) return res.status(400).json({ message: "Tell crews why to go around (a sentence is enough)" });
    res.status(201).json(await storage.createReview({ ...p.data, costLevel }));
  });
  /** The author can fix their own rating, comment or price. */
  app.patch("/api/reviews/:id", requireUser, writeLimit, async (req, res) => {
    const user = (req as any).user as User;
    const r = await storage.getReview(id(req));
    if (!r) return res.status(404).json({ message: "Not found" });
    if (r.userId !== user.id) return res.status(403).json({ message: "Only the author can edit this rating" });
    const spot = await storage.getSpot(r.spotId);
    if (!spot) return res.status(404).json({ message: "Not found" });
    const p = insertReviewSchema.pick({ rating: true, comment: true, costLevel: true }).safeParse({ rating: req.body?.rating ?? r.rating, comment: req.body?.comment ?? r.comment, costLevel: req.body?.costLevel === undefined ? r.costLevel : req.body.costLevel });
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const costLevel = p.data.costLevel != null && costOptions(spot.category).includes(p.data.costLevel) ? p.data.costLevel : null;
    if (p.data.rating === 0 && (p.data.comment || "").trim().length < 10) return res.status(400).json({ message: "Tell crews why to go around (a sentence is enough)" });
    res.json(await storage.updateReview(r.id, { rating: p.data.rating, comment: p.data.comment ?? "", costLevel }));
  });

  // ---------- location & autofill ----------
  const placesLimit = rateLimit({ windowMs: 60_000, limit: 40, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "Autofill is busy. Type the details in, or try again in a minute." } });
  const num = (v: unknown) => (v === undefined || v === "" ? NaN : Number(v));
  app.get("/api/airports/nearest", (req, res) => {
    const lat = num(req.query.lat), lon = num(req.query.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return res.status(400).json({ message: "lat and lon required" });
    res.json(nearestAirports(lat, lon, 3));
  });
  app.get("/api/airports/lookup/:code", async (req, res) => {
    const a = (await storage.resolveCode(req.params.code)) || refAirport(req.params.code);
    a ? res.json(a) : res.status(404).json({ message: "Unknown airport" });
  });
  app.get("/api/places/search", placesLimit, async (req, res) => {
    try { res.json(await searchPlaces(String(req.query.q || ""), num(req.query.lat), num(req.query.lng), String(req.query.cat || ""))); }
    catch { res.status(502).json({ message: "Autofill is unavailable right now. Type the details in." }); }
  });
  app.get("/api/places/nearby", placesLimit, async (req, res) => {
    try { res.json(await nearbyPlaces(num(req.query.lat), num(req.query.lng), String(req.query.cat || ""))); }
    catch { res.status(502).json({ message: "Nearby places are unavailable right now." }); }
  });

  // ---------- crew profiles ----------
  app.get("/api/crew/:id", async (req, res) => {
    const p = await storage.crewProfile(id(req));
    p ? res.json(p) : res.status(404).json({ message: "Not found" });
  });

  // ---------- trip briefings (signed-in crew; no points) ----------
  async function sponsorFor(icao: string) {
    const all = (await storage.listAds()).filter((a) => a.active);
    const ad = all.find((a) => a.targetIcao === icao) || all.find((a) => !a.targetIcao);
    return ad ? { id: ad.id, advertiser: ad.advertiser, headline: ad.headline, url: ad.url } : null;
  }
  /** The briefing owner's favorites always appear first at their airport. */
  const withFavorites = (picks: number[], all: SpotWithStats[], favs: Set<number>) => {
    const favHere = all.filter((s) => favs.has(s.id)).map((s) => s.id);
    return [...favHere.filter((i) => !picks.includes(i)), ...picks];
  };
  async function expandBriefing(b: Briefing, withCandidates: boolean) {
    const stops = JSON.parse(b.stops || "[]") as BriefingStop[];
    const favs = new Set(await storage.favoriteIds(b.userId));
    const out = [];
    for (const st of stops) {
      const airport = (await storage.resolveCode(st.icao)) || (refAirport(st.icao) as any) || null;
      const all = airport?.icao ? await storage.searchSpots([airport.icao]) : [];
      const byId = new Map(all.map((s) => [s.id, s]));
      out.push({
        icao: airport?.icao || st.icao.toUpperCase(), layover: st.layover, nights: st.nights, airport,
        picks: withFavorites(st.picks, all, favs).map((i) => byId.get(i)).filter(Boolean) as SpotWithStats[],
        favoriteIds: all.filter((s) => favs.has(s.id)).map((s) => s.id),
        candidates: withCandidates ? all : undefined,
        sponsor: await sponsorFor(airport?.icao || st.icao.toUpperCase()),
      });
    }
    return { id: b.id, title: b.title, shareToken: b.shareToken, createdAt: b.createdAt, updatedAt: b.updatedAt, stops: out };
  }
  const parseBriefing = (body: unknown) => briefingSchema.safeParse(body);
  /** Suggest picks without saving (used as the planner fills in each stop). */
  app.post("/api/briefings/suggest", requireUser, writeLimit, async (req, res) => {
    const p = parseBriefing(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const stops = [];
    const favs = new Set(await storage.favoriteIds((req as any).user.id));
    for (const st of p.data.stops) {
      const airport = (await storage.resolveCode(st.icao)) || (refAirport(st.icao) as any) || null;
      if (!airport) return res.status(400).json({ message: `Unknown airport ${st.icao.toUpperCase()}. Check the code (KOPF, OPF, X51 and 06FA all work).` });
      const all = await storage.searchSpots([airport.icao]);
      stops.push({ ...st, icao: airport.icao, picks: suggestPicks(all, st.layover).filter((i) => !favs.has(i)) });
    }
    res.json({ title: p.data.title, stops });
  });
  app.get("/api/briefings", requireUser, async (req, res) => {
    const list = await storage.listBriefings((req as any).user.id);
    res.json(list.map((b) => ({ id: b.id, title: b.title, stops: (JSON.parse(b.stops) as BriefingStop[]).map((s) => ({ icao: s.icao, layover: s.layover })), updatedAt: b.updatedAt })));
  });
  app.get("/api/briefings/:id", requireUser, async (req, res) => {
    const b = await storage.getBriefing(id(req));
    if (!b || b.userId !== (req as any).user.id) return res.status(404).json({ message: "Not found" });
    res.json(await expandBriefing(b, true));
  });
  app.post("/api/briefings", requireUser, writeLimit, async (req, res) => {
    const p = parseBriefing(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const stops = [];
    for (const st of p.data.stops) {
      const icao = (await storage.resolveCode(st.icao))?.icao || refAirport(st.icao)?.icao;
      if (!icao) return res.status(400).json({ message: `Unknown airport ${st.icao.toUpperCase()}. Check the code (KOPF, OPF, X51 and 06FA all work).` });
      stops.push({ ...st, icao });
    }
    const user = (req as any).user as User;
    const existing = req.body?.id ? await storage.getBriefing(Number(req.body.id)) : undefined;
    if (req.body?.id && (!existing || existing.userId !== user.id)) return res.status(404).json({ message: "Not found" });
    if (!existing && (await storage.listBriefings(user.id)).length >= 100) return res.status(400).json({ message: "You have 100 saved briefings. Delete a few first." });
    const b = await storage.saveBriefing(user.id, { title: p.data.title, stops }, existing?.id);
    res.status(existing ? 200 : 201).json(await expandBriefing(b, true));
  });
  app.delete("/api/briefings/:id", requireUser, writeLimit, async (req, res) => {
    const b = await storage.getBriefing(id(req));
    if (!b || b.userId !== (req as any).user.id) return res.status(404).json({ message: "Not found" });
    await storage.deleteBriefing((req as any).user.id, id(req));
    res.json({ ok: true });
  });
  /** Read-only shared briefing (link sent to the crew). */
  app.get("/api/shared/briefings/:token", async (req, res) => {
    const b = await storage.getBriefingByToken(String(req.params.token));
    if (!b) return res.status(404).json({ message: "This briefing link is no longer available." });
    res.json(await expandBriefing(b, false));
  });

  app.get("/api/ads", async (req, res) => {
    const icaos = parseRoute(String(req.query.icaos || ""));
    const all = (await storage.listAds()).filter((a) => a.active);
    res.json(all.filter((a) => !a.targetIcao || icaos.includes(a.targetIcao)));
  });
  app.post("/api/ads/:id/:kind", writeLimit, async (req, res) => {
    const kind = req.params.kind === "click" ? "clicks" : "impressions";
    await storage.trackAd(id(req), kind);
    res.json({ ok: true });
  });

  // ---------- admin ----------
  app.post("/api/admin/login", authLimit, requireAdmin, (_req, res) => res.json({ ok: true }));
  app.get("/api/admin/stats", requireAdmin, async (_req, res) => res.json(await storage.stats()));
  app.get("/api/admin/spots", requireAdmin, async (_req, res) => res.json(await storage.searchSpots([], true)));
  app.get("/api/admin/spots/:id/votes", requireAdmin, async (req, res) => res.json(await storage.listSpotVotes(id(req))));
  app.post("/api/admin/spots/:id/clear-downvotes", requireAdmin, async (req, res) => {
    await storage.clearDownvotes(id(req));
    await storage.updateSpot(id(req), { status: "live" });
    res.json({ ok: true });
  });

  app.patch("/api/admin/spots/:id", requireAdmin, async (req, res) => {
    const p = insertSpotSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const s = await storage.updateSpot(id(req), p.data);
    s ? res.json(s) : res.status(404).json({ message: "Not found" });
  });

  app.post("/api/admin/spots/bulk", requireAdmin, async (req, res) => {
    const { ids, action, value } = req.body as { ids: number[]; action: string; value?: string };
    if (!Array.isArray(ids)) return res.status(400).json({ message: "ids required" });
    if (action === "delete") return res.json({ changed: await storage.deleteSpots(ids.map(Number)) });
    if (action === "status" && ["live", "pending", "hidden"].includes(value || "")) {
      for (const i of ids) await storage.updateSpot(Number(i), { status: value });
      return res.json({ changed: ids.length });
    }
    if (action === "category" && (CATEGORIES as readonly string[]).includes(value || "")) {
      for (const i of ids) await storage.updateSpot(Number(i), { category: value as any });
      return res.json({ changed: ids.length });
    }
    res.status(400).json({ message: "Unknown action" });
  });

  app.get("/api/admin/export.csv", requireAdmin, async (_req, res) => {
    const rows = await storage.searchSpots([], true);
    const lines = [CSV_COLS.join(",")];
    for (const r of rows) {
      const tags = (() => { try { return (JSON.parse(r.tags) as string[]).join("; "); } catch { return ""; } })();
      lines.push(CSV_COLS.map((c) =>
        c === "tags" ? csvEscape(tags) : c === "airportCity" ? csvEscape(r.airport?.city) : c === "airportName" ? csvEscape(r.airport?.name) : csvEscape((r as any)[c])
      ).join(","));
    }
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="wheelsdown-spots-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(lines.join("\n"));
  });

  app.post("/api/admin/import", requireAdmin, async (req, res) => {
    const { csv } = req.body as { csv: string };
    if (!csv) return res.status(400).json({ message: "csv required" });
    const rows = parseCsv(csv);
    if (rows.length < 2) return res.status(400).json({ message: "CSV needs a header row and at least one data row" });
    if (rows.length > 5001) return res.status(400).json({ message: "Import up to 5,000 rows at a time" });
    const header = rows[0].map((h) => h.trim());
    let created = 0, updated = 0;
    const errors: string[] = [];
    for (let idx = 0; idx < rows.length - 1; idx++) {
      const cells = rows[idx + 1];
      const o: Record<string, string> = {};
      header.forEach((h, i) => (o[h] = (cells[i] ?? "").trim().replace(/^'(?=[=+\-@])/, "")));
      try {
        if (!o.icao || !o.name || !o.category) throw new Error("icao, name and category are required");
        const icao = await ensureAirport(o.icao.toUpperCase(), o.airportCity, o.airportName);
        const data = insertSpotSchema.parse({
          icao, category: o.category.toLowerCase(), name: o.name, description: o.description || "", address: o.address || "", website: o.website || "",
          costLevel: o.costLevel || 1, minutesNeeded: o.minutesNeeded || 60, milesFromField: o.milesFromField ? Number(o.milesFromField) : 0,
          pace: isPace(o.pace) ? o.pace : null, lat: o.lat ? Number(o.lat) : null, lng: o.lng ? Number(o.lng) : null,
          crewTip: o.crewTip || "", tags: JSON.stringify((o.tags || "").split(/[;|]/).map((t) => t.trim()).filter(Boolean)),
          submittedBy: o.submittedBy || "Admin import", status: ["live", "pending", "hidden"].includes(o.status) ? o.status : "live",
        });
        if (o.id && (await storage.getSpot(Number(o.id)))) { await storage.updateSpot(Number(o.id), data); updated++; }
        else { await storage.createSpot(data); created++; }
      } catch (e: any) {
        errors.push(`Row ${idx + 2}: ${e?.issues?.[0]?.message || e.message}`);
      }
    }
    res.json({ created, updated, errors: errors.slice(0, 50) });
  });

  app.delete("/api/admin/reviews/:id", requireAdmin, async (req, res) => { await storage.deleteReview(id(req)); res.json({ ok: true }); });

  app.get("/api/admin/users", requireAdmin, async (_req, res) => res.json(await storage.publicUsers(true)));
  app.post("/api/admin/users/:id/bonus", requireAdmin, async (req, res) => {
    const delta = Math.trunc(Number(req.body?.delta));
    if (!Number.isFinite(delta) || Math.abs(delta) > 100000) return res.status(400).json({ message: "delta must be a number" });
    await storage.grantBonus(id(req), delta);
    res.json({ ok: true });
  });

  app.get("/api/admin/ads", requireAdmin, async (_req, res) => res.json(await storage.listAds()));
  app.post("/api/admin/ads", requireAdmin, async (req, res) => {
    const p = insertAdSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    res.status(201).json(await storage.createAd({ ...p.data, targetIcao: (p.data.targetIcao || "").toUpperCase() }));
  });
  app.patch("/api/admin/ads/:id", requireAdmin, async (req, res) => {
    const p = insertAdSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    res.json(await storage.updateAd(id(req), p.data));
  });
  app.delete("/api/admin/ads/:id", requireAdmin, async (req, res) => { await storage.deleteAd(id(req)); res.json({ ok: true }); });

  app.post("/api/admin/airports", requireAdmin, async (req, res) => {
    const { icao, iata, name, city, region, country } = req.body;
    if (!icao || !name || !city) return res.status(400).json({ message: "icao, name, city required" });
    res.json(await storage.upsertAirport({ icao: String(icao).toUpperCase(), iata: iata ? String(iata).toUpperCase() : null, name, city, region: region || "", country: country || "US" }));
  });

  return httpServer;
}
