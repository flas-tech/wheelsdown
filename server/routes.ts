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
import { AI_ENABLED, autofill, checkName, checkBio } from "./ai";
import { isTestSignup } from "@shared/club";
import { track, visit, pageKey, outboundKey, report, untracked } from "./metrics";
import { INTERESTS, parseInterests } from "@shared/interests";
import { aircraftById } from "@shared/aircraft";
import { startModerator, kickModerator, findDuplicate, SPOT_EDIT_FIELDS, manualReview, setManualReview, modStatus } from "./moderator";
import { z } from "zod";

const PROD = process.env.NODE_ENV === "production";
const ADMIN_KEY = process.env.ADMIN_KEY || (PROD ? "" : "wheelsdown-admin");
if (PROD && ADMIN_KEY.length < 24) throw new Error("ADMIN_KEY must be set to a random value of at least 24 characters in production.");
const MODERATE = process.env.MODERATE === "1"; // when on, new submissions land as "pending" (Commercial tier and up skip)
const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");

const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
/** Super-user admins: these accounts reach the admin console with their normal sign-in, no key needed.
 *  Fixed account ids (5 = m_gravalec, 6 = jpj); override with SUPER_ADMIN_IDS="5,6" on the server. */
const SUPER_ADMIN_IDS = new Set((process.env.SUPER_ADMIN_IDS || "5,6").split(",").map((x) => Number(x.trim())).filter((n) => Number.isInteger(n) && n > 0));
/** "by <name>" for decisions made through a super-user account (key sign-ins stay unnamed). */
const byAdmin = (req: Request, reason: string) => { const n = (req as any).adminName; return n ? (reason ? `${reason} (by ${n})` : `By ${n}`) : reason; };
export const isSuperAdmin = (u?: User | null) => !!u && SUPER_ADMIN_IDS.has(u.id);
async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = String(req.headers["x-admin-key"] || req.query.key || "");
  if (ADMIN_KEY && key && safeEq(key, ADMIN_KEY)) return next();
  try { const u = await userOf(req); if (isSuperAdmin(u)) { (req as any).adminName = u!.displayName; return next(); } } catch { /* fall through */ }
  return res.status(401).json({ message: "Admin key required" });
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
  app.get("/api/config", (_req, res) => res.json({ contactEmail: process.env.CONTACT_EMAIL || "", emailEnabled: !!process.env.RESEND_API_KEY, moderated: MODERATE || AI_ENABLED, ai: AI_ENABLED }));

  // ---------- accounts ----------
  app.post("/api/auth/signup", authLimit, async (req, res) => {
    const p = signupSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    if (PROD && p.data.acceptTerms !== true) return res.status(400).json({ message: "Please accept the Terms and Community Guidelines" });
    const bad = await checkName(`${p.data.displayName} (@${p.data.handle})`);
    if (bad) return res.status(400).json({ message: bad });
    try {
      const u = await storage.createUser(p.data);
      if (!isTestSignup(u.handle, u.email)) track(req, "signup");
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
  app.get("/api/me", async (req, res) => { const u = await userOf(req); res.json(u ? { ...(await storage.me(u)), isAdmin: isSuperAdmin(u) } : null); });
  app.patch("/api/me", requireUser, writeLimit, async (req, res) => {
    const p = updateMeSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    if (p.data.displayName && p.data.displayName !== (req as any).user.displayName) {
      const bad = await checkName(p.data.displayName);
      if (bad) return res.status(400).json({ message: bad });
    }
    if (p.data.bio && p.data.bio !== (req as any).user.bio) {
      const bad = await checkBio(p.data.bio);
      if (bad) return res.status(400).json({ message: bad });
    }
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
  app.get("/api/club", async (_req, res) => res.json(await storage.wrightClub()));
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
    if (codes.length) { track(req, "search"); for (const i of Array.from(new Set(icaos))) track(req, "search_airport", i); }
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
    const viewer = await userOf(req);
    const mine = !!viewer && s.userId === viewer.id;
    if (s.status !== "live" && !mine) return res.status(404).json({ message: "Not found" });
    if (!mine) track(req, "spot_view", s.icao);
    let mod: any = null;
    if (mine) {
      const raw = await storage.rawSpot(s.id);
      let edit = null; try { edit = raw?.pendingEdit ? JSON.parse(raw.pendingEdit) : null; } catch { /* ignore */ }
      mod = { status: s.status, state: raw?.modState || "", note: (raw?.modNote || "").replace(/^\[[a-z_]+\]\s*/, ""), pendingEdit: edit };
    }
    res.json({ spot: s, reviews: await storage.listReviewsWithVotes(s.id, v), mod });
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
    if (AI_ENABLED) {
      // saved unpublished; the background check publishes it (usually within a minute) or holds it with a note
      const spot = await storage.createSpot({ ...rest, icao, tags: tagJson(tags), submittedBy: publicName(user), userId: user.id, status: "pending" });
      await storage.setSpotMod(spot.id, { modState: "checking", modNote: "" });
      kickModerator();
      return res.status(201).json({ ...spot, modState: "checking" });
    }
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
    const patch = {
      icao, category: rest.category, name: rest.name, description: rest.description, address: rest.address, website: rest.website,
      costLevel: rest.costLevel, minutesNeeded: rest.minutesNeeded, pace: rest.pace ?? null, milesFromField: rest.milesFromField,
      lat: rest.lat ?? null, lng: rest.lng ?? null, placeRef: rest.placeRef ?? null, crewTip: rest.crewTip, tags: tagJson(tags),
    };
    if (AI_ENABLED) {
      if (cur.status === "live") {
        // the live listing stays exactly as it is until the edit passes the check
        const held = Object.fromEntries(SPOT_EDIT_FIELDS.map((k) => [k, (patch as any)[k]]));
        await storage.setSpotMod(cur.id, { pendingEdit: JSON.stringify(held), modState: "checking", modNote: "", modAttempts: 0 });
        kickModerator();
        return res.json({ ...cur, modState: "checking", editPending: true });
      }
      // not published yet (being checked or held): apply the fix and check again
      const s = await storage.updateSpot(cur.id, patch);
      await storage.setSpotMod(cur.id, { status: "pending", pendingEdit: null, modState: "checking", modNote: "", modAttempts: 0 });
      kickModerator();
      return res.json({ ...s, status: "pending", modState: "checking" });
    }
    const s = await storage.updateSpot(cur.id, patch);
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
    const r = await storage.createReview({ ...p.data, costLevel });
    if (AI_ENABLED) {
      await storage.setReviewMod(r.id, { status: "pending", modState: "checking" });
      kickModerator();
      return res.status(201).json({ ...r, status: "pending", modState: "checking" });
    }
    res.status(201).json(r);
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
    const next = { rating: p.data.rating, comment: p.data.comment ?? "", costLevel };
    if (AI_ENABLED) {
      if (r.status === "live") {
        await storage.setReviewMod(r.id, { pendingEdit: JSON.stringify(next), modState: "checking", modNote: "", modAttempts: 0 });
        kickModerator();
        return res.json({ ...r, modState: "checking", editPending: true });
      }
      const u = await storage.setReviewMod(r.id, { ...next, status: "pending", pendingEdit: null, modState: "checking", modNote: "", modAttempts: 0 });
      kickModerator();
      return res.json(u);
    }
    res.json(await storage.updateReview(r.id, next));
  });

  // ---------- AI autofill ----------
  const aiLimit = rateLimit({ windowMs: 10 * 60_000, limit: 15, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "AI autofill is busy. Try again in a few minutes, or type the details in." } });
  const autofillSchema = z.object({
    icao: z.string().trim().min(3).max(4), category: z.enum(CATEGORIES), name: z.string().trim().min(2).max(120),
    address: z.string().max(300).optional(), website: z.string().max(300).optional(), placeRef: z.string().max(40).nullable().optional(),
    lat: z.number().min(-90).max(90).nullable().optional(), lng: z.number().min(-180).max(180).nullable().optional(), excludeId: z.number().int().optional(),
  });
  app.post("/api/ai/autofill", requireUser, aiLimit, async (req, res) => {
    if (!AI_ENABLED) return res.status(503).json({ message: "AI autofill isn't switched on yet" });
    const p = autofillSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const ap = await storage.resolveCode(p.data.icao.toUpperCase());
    const icao = ap?.icao || p.data.icao.toUpperCase();
    const others = await storage.namesAt(icao, p.data.excludeId);
    const dup = findDuplicate(p.data, others);
    const mi = milesFromAirport(ap, p.data.lat, p.data.lng);
    try {
      const r = await autofill({ ...p.data, icao, airport: ap ? { name: ap.name, city: ap.city, lat: ap.lat, lon: ap.lon } : null, milesFromField: mi ?? null });
      res.json({ ...r, duplicate: dup && dup.status === "live" ? { id: dup.id, name: dup.name } : null });
    } catch (e) {
      console.warn("[ai] autofill failed", (e as Error).message);
      res.status(502).json({ message: "AI autofill couldn't finish. Type the details in, or try again.", duplicate: dup && dup.status === "live" ? { id: dup.id, name: dup.name } : null });
    }
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
    const viewer = await userOf(req);
    const p = await storage.crewProfile(id(req), viewer?.id);
    p ? res.json(p) : res.status(404).json({ message: "Not found" });
  });
  // ---------- following (no points; anonymous members can't be followed) ----------
  const followLimit = rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false, message: { message: "Too many follow changes. Try again in a minute." } });
  app.post("/api/crew/:id/follow", requireUser, followLimit, async (req, res) => {
    const me = (req as any).user as User, target = id(req);
    if (target === me.id) return res.status(400).json({ message: "You can't follow yourself" });
    const t = (await storage.publicUsers()).find((u) => u.id === target);
    if (!t) return res.status(404).json({ message: "Not found" });
    if (t.anonymous) return res.status(400).json({ message: "This member posts anonymously, so they can't be followed" });
    await storage.setFollow(me.id, target, true);
    res.json({ isFollowing: true, ...(await storage.followCounts(target)) });
  });
  app.delete("/api/crew/:id/follow", requireUser, followLimit, async (req, res) => {
    const me = (req as any).user as User;
    await storage.setFollow(me.id, id(req), false);
    res.json({ isFollowing: false, ...(await storage.followCounts(id(req))) });
  });
  app.get("/api/me/following", requireUser, async (req, res) => res.json(await storage.followList((req as any).user.id, "following")));
  app.get("/api/me/followers", requireUser, async (req, res) => res.json(await storage.followList((req as any).user.id, "followers")));
  app.get("/api/me/feed", requireUser, async (req, res) => res.json(await storage.followFeed((req as any).user.id)));

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
    if (!existing) track(req, "briefing");
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
    if (!untracked(req)) await storage.trackAd(id(req), kind);
    track(req, kind === "clicks" ? "ad_click" : "ad_impression", String(id(req)));
    res.json({ ok: true });
  });

  // ---------- anonymous usage counts (see server/metrics.ts) ----------
  const tLimit = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false, message: { ok: false } });
  app.post("/api/t", tLimit, async (req, res) => {
    const b = req.body || {};
    const signedIn = !!(await userOf(req));
    if (b.vid) await visit(req, String(b.vid), signedIn, !!b.installed);
    if (b.page) await track(req, "pageview", pageKey(String(b.page)));
    if (b.out) await track(req, "outbound", outboundKey(String(b.out)));
    if (b.share) await track(req, "share", b.share === "spot" ? "spot" : "site");
    res.json({ ok: true });
  });

  // ---------- admin ----------
  app.get("/api/admin/advertisers", requireAdmin, async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const r = await report(days);
    const sum = (kind: string, key?: string) => r.sums.filter((x: any) => x.kind === kind && (key === undefined || x.key === key)).reduce((a: number, x: any) => a + x.n, 0);
    const by = (kind: string) => Object.fromEntries(r.sums.filter((x: any) => x.kind === kind).map((x: any) => [x.key, x.n]));
    const tally = (vals: string[]) => Object.entries(vals.reduce((m: Record<string, number>, v) => { if (v) m[v] = (m[v] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
    const real = r.users;
    const sinceMs = Date.now() - days * 86400_000;
    const ads = await storage.listAds();
    const adImp = by("ad_impression"), adClk = by("ad_click");
    const live = (await storage.searchSpots([], false)).filter((s) => s.status === "live");
    const names = new Map((await Promise.all(r.airports.map(async (a: any) => [a.icao, (await storage.resolveCode(a.icao)) || refAirport(a.icao)] as const))).map(([k, v]) => [k, v ? `${(v as any).name}${(v as any).city ? `, ${(v as any).city}` : ""}` : ""]));
    res.json({
      days, since: r.since,
      traffic: { visitors: r.uniq?.visitors || 0, crewActive: r.uniq?.crew || 0, visits: r.uniq?.visits || 0, pageviews: sum("pageview"), searches: sum("search"), spotViews: sum("spot_view"), outbound: sum("outbound"), shares: sum("share"), signups: sum("signup") },
      series: r.series, pages: by("pageview"), outbound: by("outbound"), devices: by("device"),
      airports: r.airports.map((a: any) => ({ icao: a.icao, name: names.get(a.icao) || "", searches: a.searches || 0, views: a.views || 0 })),
      ads: ads.map((a) => ({ id: a.id, advertiser: a.advertiser, headline: a.headline, targetIcao: a.targetIcao || "", active: !!a.active, impressions: adImp[String(a.id)] || 0, clicks: adClk[String(a.id)] || 0, lifetimeImpressions: a.impressions, lifetimeClicks: a.clicks })),
      audience: {
        crew: real.length, newCrew: real.filter((u: any) => Number(u.created_at) >= sinceMs).length,
        roles: tally(real.map((u: any) => u.crew_role)),
        aircraft: tally(real.map((u: any) => aircraftById(u.aircraft)?.label || "")),
        homeBases: tally(real.map((u: any) => String(u.home_base || "").toUpperCase())).slice(0, 12),
        interests: tally(real.flatMap((u: any) => parseInterests(u.interests).map((i) => INTERESTS[i]))).slice(0, 12),
      },
      content: { listings: live.length, airports: new Set(live.map((s) => s.icao)).size, eat: live.filter((s) => s.category === "eat").length, do: live.filter((s) => s.category === "do").length, stay: live.filter((s) => s.category === "stay").length, fbo: live.filter((s) => s.category === "fbo").length, ratings: live.reduce((a, s) => a + (s.reviewCount || 0), 0) },
    });
  });
  app.post("/api/admin/login", authLimit, requireAdmin, (_req, res) => res.json({ ok: true }));
  app.get("/api/admin/moderation", requireAdmin, async (_req, res) => {
    const [queue, log, stats, manual] = await Promise.all([storage.modReviewList(), storage.listModLog(150), storage.modStats(), manualReview()]);
    res.json({ ai: AI_ENABLED, manual, status: { ...modStatus, ...stats }, ...queue, log });
  });
  app.put("/api/admin/moderation/settings", requireAdmin, async (req, res) => {
    await setManualReview(!!req.body?.manual);
    res.json({ manual: await manualReview() });
  });
  /** Undo an edit the AI approved: put back the values it replaced. */
  app.post("/api/admin/moderation/revert/:logId", requireAdmin, async (req, res) => {
    const e = await storage.getModLog(Number(req.params.logId));
    if (!e || !e.isEdit || e.action !== "approve" || !e.before) return res.status(400).json({ message: "Only an approved edit can be reverted" });
    const before = JSON.parse(e.before);
    if (e.kind === "spot") { if (!(await storage.rawSpot(e.targetId))) return res.status(404).json({ message: "Not found" }); await storage.updateSpot(e.targetId, before); }
    else { if (!(await storage.getReview(e.targetId))) return res.status(404).json({ message: "Not found" }); await storage.setReviewMod(e.targetId, before); }
    await storage.logMod({ kind: e.kind as "spot" | "review", targetId: e.targetId, actor: "admin", action: "revert", reason: byAdmin(req, "Edit reverted"), isEdit: true, before: e.after ? JSON.parse(e.after) : undefined, after: before });
    res.json({ ok: true });
  });
  /**
   * Admin override, whatever the AI decided.
   * approve = publish it (or apply the waiting edit); reject = take it off the site (or discard the waiting edit); recheck = run the AI again.
   */
  app.post("/api/admin/moderation/:kind/:id", requireAdmin, async (req, res) => {
    const kind = String(req.params.kind), action = String(req.body?.action || "");
    if (!["spot", "review"].includes(kind) || !["approve", "reject", "recheck"].includes(action)) return res.status(400).json({ message: "kind spot|review, action approve|reject|recheck" });
    const note = String(req.body?.note || "").slice(0, 300);
    if (kind === "spot") {
      const s = await storage.rawSpot(id(req));
      if (!s) return res.status(404).json({ message: "Not found" });
      let edit: any = null; try { edit = s.pendingEdit ? JSON.parse(s.pendingEdit) : null; } catch { /* ignore */ }
      if (action === "recheck") { await storage.setSpotMod(s.id, { modState: "checking", modAttempts: 0 }); kickModerator(); }
      else if (action === "approve") {
        if (edit) await storage.updateSpot(s.id, edit);
        await storage.setSpotMod(s.id, { status: "live", pendingEdit: null, modState: "approved", modNote: "", modAttempts: 0 });
      } else await storage.setSpotMod(s.id, edit ? { pendingEdit: null, modState: "approved", modNote: "" } : { status: "rejected", modState: "rejected", modNote: note ? `[admin] ${note}` : "[admin] Removed by a moderator." });
      const before = edit && action === "approve" ? Object.fromEntries(Object.keys(edit).map((k) => [k, (s as any)[k] ?? null])) : undefined;
      await storage.logMod({ kind: "spot", targetId: s.id, actor: "admin", action, reason: byAdmin(req, note || (edit ? (action === "approve" ? "Edit applied" : action === "reject" ? "Edit discarded" : "") : "")), isEdit: !!edit, before, after: edit || undefined });
    } else {
      const r = await storage.getReview(id(req));
      if (!r) return res.status(404).json({ message: "Not found" });
      let edit: any = null; try { edit = r.pendingEdit ? JSON.parse(r.pendingEdit) : null; } catch { /* ignore */ }
      if (action === "recheck") { await storage.setReviewMod(r.id, { modState: "checking", modAttempts: 0 }); kickModerator(); }
      else if (action === "approve") await storage.setReviewMod(r.id, { ...(edit || {}), status: "live", pendingEdit: null, modState: "approved", modNote: "", modAttempts: 0 });
      else await storage.setReviewMod(r.id, edit ? { pendingEdit: null, modState: "approved", modNote: "" } : { status: "rejected", modState: "rejected", modNote: note ? `[admin] ${note}` : "[admin] Removed by a moderator." });
      const before = edit && action === "approve" ? { rating: r.rating, comment: r.comment, costLevel: r.costLevel } : undefined;
      await storage.logMod({ kind: "review", targetId: r.id, actor: "admin", action, reason: byAdmin(req, note || (edit ? (action === "approve" ? "Edit applied" : action === "reject" ? "Edit discarded" : "") : "")), isEdit: !!edit, before, after: edit || undefined });
    }
    res.json({ ok: true });
  });
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

  startModerator();
  return httpServer;
}
