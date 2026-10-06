import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import { insertSpotSchema, insertReviewSchema, insertAdSchema, CATEGORIES, signupSchema, loginSchema, updateMeSchema, type User } from "@shared/schema";
import { tierFor, TIERS, publicName } from "@shared/tiers";
import { buildHighlights } from "@shared/highlights";
import { z } from "zod";

const ADMIN_KEY = process.env.ADMIN_KEY || "wheelsdown-admin";
const MODERATE = process.env.MODERATE === "1"; // when on, new submissions land as "pending"

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const key = (req.headers["x-admin-key"] as string) || (req.query.key as string);
  if (key !== ADMIN_KEY) return res.status(401).json({ message: "Admin key required" });
  next();
}

const tokenOf = (req: Request) => String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
const userOf = (req: Request): User | undefined => storage.userForToken(tokenOf(req));
const voterOf = (req: Request) => { const u = userOf(req); return u ? `u:${u.id}` : ""; };
function requireUser(req: Request, res: Response, next: NextFunction) {
  const u = userOf(req);
  if (!u) return res.status(401).json({ message: "Sign in to contribute" });
  (req as any).user = u;
  next();
}

// Split "MIA-TEB ASE/KAPA,TJSJ" into codes
function parseRoute(route: string) {
  return route.toUpperCase().split(/[^A-Z0-9]+/).filter((c) => c.length === 3 || c.length === 4);
}

// ---- tiny CSV helpers ----
const CSV_COLS = ["id", "icao", "category", "name", "description", "address", "website", "costLevel", "minutesNeeded", "milesFromField", "crewTip", "tags", "submittedBy", "status", "airportCity", "airportName"] as const;
function csvEscape(v: unknown) {
  const s = v == null ? "" : String(v);
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

function ensureAirport(code: string, city?: string, name?: string) {
  const found = storage.resolveCode(code);
  if (found) return found.icao;
  const icao = code.length === 3 ? "K" + code : code;
  storage.upsertAirport({ icao, iata: code.length === 3 ? code : null, name: name || icao, city: city || "Unknown", region: "", country: "" });
  return icao;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // ---------- accounts ----------
  app.post("/api/auth/signup", (req, res) => {
    const p = signupSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message || "Invalid" });
    try {
      const u = storage.createUser(p.data);
      res.status(201).json({ token: storage.createSession(u.id), me: storage.me(u) });
    } catch (e: any) { res.status(409).json({ message: e.message }); }
  });
  app.post("/api/auth/login", (req, res) => {
    const p = loginSchema.safeParse(req.body);
    const token = p.success ? storage.login(p.data.handle, p.data.password) : undefined;
    if (!token) return res.status(401).json({ message: "Handle or password is wrong" });
    res.json({ token, me: storage.me(storage.userForToken(token)!) });
  });
  app.post("/api/auth/logout", (req, res) => { storage.logout(tokenOf(req)); res.json({ ok: true }); });
  app.get("/api/me", (req, res) => { const u = userOf(req); res.json(u ? storage.me(u) : null); });
  app.patch("/api/me", requireUser, (req, res) => {
    const p = updateMeSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message || "Invalid" });
    res.json(storage.me(storage.updateUser((req as any).user.id, p.data)));
  });
  app.get("/api/me/contributions", requireUser, (req, res) => res.json(storage.userContributions((req as any).user.id)));
  app.get("/api/crew", (_req, res) => res.json(storage.publicUsers()));

  // ---------- public ----------
  app.get("/api/airports", (_req, res) => res.json(storage.listAirports()));

  app.get("/api/search", (req, res) => {
    const codes = parseRoute(String(req.query.route || ""));
    const legs = codes.map((code) => ({ code, airport: storage.resolveCode(code) || null }));
    const icaos = legs.filter((l) => l.airport).map((l) => l.airport!.icao);
    const v = voterOf(req);
    const results = codes.length ? (icaos.length ? storage.searchSpots(icaos, false, v) : []) : storage.searchSpots([], false, v);
    res.json({ legs, spots: results });
  });

  app.get("/api/highlights", (req, res) => {
    const cat = req.query.category ? String(req.query.category) : null;
    res.json(buildHighlights(storage.searchSpots([], false, voterOf(req)), { category: cat }));
  });

  app.get("/api/spots/:id", (req, res) => {
    const v = voterOf(req);
    const s = storage.getSpot(Number(req.params.id), v);
    if (!s || s.status === "hidden") return res.status(404).json({ message: "Not found" });
    res.json({ spot: s, reviews: storage.listReviewsWithVotes(s.id, v) });
  });

  // Up/down vote on a listing or review. value: 1, -1, or 0 to clear. One vote per voter per target.
  const voteHandler = (type: "spot" | "review") => (req: Request, res: Response) => {
    const voter = voterOf(req);
    if (!voter) return res.status(400).json({ message: "Missing voter id" });
    const value = Number(req.body?.value);
    if (![1, -1, 0].includes(value)) return res.status(400).json({ message: "value must be 1, -1 or 0" });
    storage.vote(type, Number(req.params.id), voter, value, String(req.body?.reason || "").slice(0, 40));
    res.json({ ok: true });
  };
  app.post("/api/spots/:id/vote", requireUser, voteHandler("spot"));
  app.post("/api/reviews/:id/vote", requireUser, voteHandler("review"));

  const submitSchema = insertSpotSchema.extend({
    icao: z.string().trim().min(3).max(4),
    airportCity: z.string().optional(),
    tags: z.union([z.string(), z.array(z.string())]).optional(),
  });
  app.post("/api/spots", requireUser, (req, res) => {
    const user = (req as any).user as User;
    const p = submitSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message || "Invalid" });
    const { airportCity, tags, ...rest } = p.data;
    const code = rest.icao.toUpperCase();
    if (!storage.resolveCode(code) && !airportCity) return res.status(400).json({ message: `We don't know ${code} yet — add the city so we can create it.` });
    const icao = ensureAirport(code, airportCity);
    const tagArr = Array.isArray(tags) ? tags : String(tags || "").split(",").map((t) => t.trim()).filter(Boolean);
    // Commercial tier and above skip moderation
    const trusted = tierFor(storage.me(user).points).index >= TIERS.findIndex((t) => t.id === "commercial");
    const spot = storage.createSpot({ ...rest, icao, tags: JSON.stringify(tagArr.slice(0, 8)), submittedBy: publicName(user), userId: user.id, status: MODERATE && !trusted ? "pending" : "live" });
    res.status(201).json(spot);
  });

  app.post("/api/spots/:id/reviews", requireUser, (req, res) => {
    const user = (req as any).user as User;
    const p = insertReviewSchema.safeParse({ ...req.body, spotId: Number(req.params.id), author: publicName(user), crewRole: user.crewRole, userId: user.id });
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message || "Invalid" });
    if (!storage.getSpot(p.data.spotId)) return res.status(404).json({ message: "Not found" });
    res.status(201).json(storage.createReview(p.data));
  });

  app.get("/api/ads", (req, res) => {
    const icaos = parseRoute(String(req.query.icaos || ""));
    const all = storage.listAds().filter((a) => a.active);
    res.json(all.filter((a) => !a.targetIcao || icaos.includes(a.targetIcao)));
  });
  app.post("/api/ads/:id/:kind", (req, res) => {
    const kind = req.params.kind === "click" ? "clicks" : "impressions";
    storage.trackAd(Number(req.params.id), kind);
    res.json({ ok: true });
  });

  // ---------- admin ----------
  app.post("/api/admin/login", requireAdmin, (_req, res) => res.json({ ok: true }));
  app.get("/api/admin/stats", requireAdmin, (_req, res) => res.json(storage.stats()));
  app.get("/api/admin/spots", requireAdmin, (_req, res) => res.json(storage.searchSpots([], true)));
  app.get("/api/admin/spots/:id/votes", requireAdmin, (req, res) => res.json(storage.listSpotVotes(Number(req.params.id))));
  app.post("/api/admin/spots/:id/clear-downvotes", requireAdmin, (req, res) => {
    storage.clearDownvotes(Number(req.params.id));
    storage.updateSpot(Number(req.params.id), { status: "live" });
    res.json({ ok: true });
  });

  app.patch("/api/admin/spots/:id", requireAdmin, (req, res) => {
    const p = insertSpotSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message });
    const s = storage.updateSpot(Number(req.params.id), p.data);
    s ? res.json(s) : res.status(404).json({ message: "Not found" });
  });

  app.post("/api/admin/spots/bulk", requireAdmin, (req, res) => {
    const { ids, action, value } = req.body as { ids: number[]; action: string; value?: string };
    if (!Array.isArray(ids)) return res.status(400).json({ message: "ids required" });
    if (action === "delete") return res.json({ changed: storage.deleteSpots(ids) });
    if (action === "status" && ["live", "pending", "hidden"].includes(value || "")) {
      ids.forEach((id) => storage.updateSpot(id, { status: value }));
      return res.json({ changed: ids.length });
    }
    if (action === "category" && (CATEGORIES as readonly string[]).includes(value || "")) {
      ids.forEach((id) => storage.updateSpot(id, { category: value as any }));
      return res.json({ changed: ids.length });
    }
    res.status(400).json({ message: "Unknown action" });
  });

  app.get("/api/admin/export.csv", requireAdmin, (_req, res) => {
    const rows = storage.searchSpots([], true);
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

  app.post("/api/admin/import", requireAdmin, (req, res) => {
    const { csv } = req.body as { csv: string };
    if (!csv) return res.status(400).json({ message: "csv required" });
    const rows = parseCsv(csv);
    if (rows.length < 2) return res.status(400).json({ message: "CSV needs a header row and at least one data row" });
    const header = rows[0].map((h) => h.trim());
    let created = 0, updated = 0;
    const errors: string[] = [];
    rows.slice(1).forEach((cells, idx) => {
      const o: Record<string, string> = {};
      header.forEach((h, i) => (o[h] = (cells[i] ?? "").trim()));
      try {
        if (!o.icao || !o.name || !o.category) throw new Error("icao, name and category are required");
        const icao = ensureAirport(o.icao.toUpperCase(), o.airportCity, o.airportName);
        const data = insertSpotSchema.parse({
          icao,
          category: o.category.toLowerCase(),
          name: o.name,
          description: o.description || "",
          address: o.address || "",
          website: o.website || "",
          costLevel: o.costLevel || 1,
          minutesNeeded: o.minutesNeeded || 60,
          milesFromField: o.milesFromField ? Number(o.milesFromField) : 0,
          crewTip: o.crewTip || "",
          tags: JSON.stringify((o.tags || "").split(/[;|]/).map((t) => t.trim()).filter(Boolean)),
          submittedBy: o.submittedBy || "Admin import",
          status: ["live", "pending", "hidden"].includes(o.status) ? o.status : "live",
        });
        if (o.id && storage.getSpot(Number(o.id))) { storage.updateSpot(Number(o.id), data); updated++; }
        else { storage.createSpot(data); created++; }
      } catch (e: any) {
        errors.push(`Row ${idx + 2}: ${e?.issues?.[0]?.message || e.message}`);
      }
    });
    res.json({ created, updated, errors: errors.slice(0, 50) });
  });

  app.delete("/api/admin/reviews/:id", requireAdmin, (req, res) => { storage.deleteReview(Number(req.params.id)); res.json({ ok: true }); });

  app.get("/api/admin/users", requireAdmin, (_req, res) => res.json(storage.publicUsers(true)));
  app.post("/api/admin/users/:id/bonus", requireAdmin, (req, res) => {
    const delta = Math.trunc(Number(req.body?.delta));
    if (!Number.isFinite(delta) || Math.abs(delta) > 100000) return res.status(400).json({ message: "delta must be a number" });
    storage.grantBonus(Number(req.params.id), delta);
    res.json({ ok: true });
  });

  app.get("/api/admin/ads", requireAdmin, (_req, res) => res.json(storage.listAds()));
  app.post("/api/admin/ads", requireAdmin, (req, res) => {
    const p = insertAdSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message });
    res.status(201).json(storage.createAd({ ...p.data, targetIcao: (p.data.targetIcao || "").toUpperCase() }));
  });
  app.patch("/api/admin/ads/:id", requireAdmin, (req, res) => {
    const p = insertAdSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message });
    res.json(storage.updateAd(Number(req.params.id), p.data));
  });
  app.delete("/api/admin/ads/:id", requireAdmin, (req, res) => { storage.deleteAd(Number(req.params.id)); res.json({ ok: true }); });

  app.post("/api/admin/airports", requireAdmin, (req, res) => {
    const { icao, iata, name, city, region, country } = req.body;
    if (!icao || !name || !city) return res.status(400).json({ message: "icao, name, city required" });
    res.json(storage.upsertAirport({ icao: String(icao).toUpperCase(), iata: iata ? String(iata).toUpperCase() : null, name, city, region: region || "", country: country || "US" }));
  });

  return httpServer;
}
