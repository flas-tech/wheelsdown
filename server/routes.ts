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
const CSV_COLS = ["id", "icao", "category", "name", "description", "address", "website", "costLevel", "minutesNeeded", "milesFromField", "crewTip", "tags", "submittedBy", "status", "airportCity", "airportName"] as const;
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
  const found = await storage.resolveCode(code);
  if (found) return found.icao;
  const icao = code.length === 3 ? "K" + code : code;
  await storage.upsertAirport({ icao, iata: code.length === 3 ? code : null, name: name || icao, city: city || "Unknown", region: "", country: "" });
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

  // ---------- public ----------
  app.get("/api/airports", async (_req, res) => res.json(await storage.listAirports()));

  app.get("/api/search", async (req, res) => {
    const codes = parseRoute(String(req.query.route || ""));
    const legs = await Promise.all(codes.map(async (code) => ({ code, airport: (await storage.resolveCode(code)) || null })));
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
  app.post("/api/spots", requireUser, writeLimit, async (req, res) => {
    const user = (req as any).user as User;
    const p = submitSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    const { airportCity, tags, ...rest } = p.data;
    const code = rest.icao.toUpperCase();
    if (!(await storage.resolveCode(code)) && !airportCity) return res.status(400).json({ message: `We don't know ${code} yet — add the city so we can create it.` });
    const icao = await ensureAirport(code, airportCity);
    const tagArr = Array.isArray(tags) ? tags : String(tags || "").split(",").map((t) => t.trim()).filter(Boolean);
    const trusted = tierFor((await storage.me(user)).points).index >= TIERS.findIndex((t) => t.id === "commercial");
    const spot = await storage.createSpot({ ...rest, icao, tags: JSON.stringify(tagArr.slice(0, 8).map((t) => t.slice(0, 30))), submittedBy: publicName(user), userId: user.id, status: MODERATE && !trusted ? "pending" : "live" });
    res.status(201).json(spot);
  });

  app.post("/api/spots/:id/reviews", requireUser, writeLimit, async (req, res) => {
    const user = (req as any).user as User;
    const p = insertReviewSchema.safeParse({ ...req.body, spotId: id(req), author: publicName(user), crewRole: user.crewRole, userId: user.id });
    if (!p.success) return res.status(400).json({ message: msg(p.error) });
    if (!(await storage.getSpot(p.data.spotId))) return res.status(404).json({ message: "Not found" });
    res.status(201).json(await storage.createReview(p.data));
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
