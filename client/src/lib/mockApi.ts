// In-browser demo backend used for the static GitHub Pages build (VITE_STATIC=1).
// Mirrors server/routes.ts. Data is seeded from shared/seed.ts and saved only in this browser.
import { seedAirports, seedSpots, seedReviews, seedAds } from "@shared/seed";
import type { Airport, Spot, Review, Ad, Vote } from "@shared/schema";
import { computeVet, seedVotesFor, shouldAutoHold } from "@shared/vetting";

export const DEMO_ADMIN_KEY = "wheelsdown-admin";
const STORE_KEY = "wheelsdown-demo-v2";

type DB = { airports: Airport[]; spots: Spot[]; reviews: Review[]; ads: Ad[]; votes: Vote[]; seq: { spot: number; review: number; ad: number; vote: number } };

function seed(): DB {
  const now = Date.now();
  const airports = seedAirports.map(([icao, iata, name, city, region, country]) => ({ icao, iata, name, city, region, country }));
  const spots: Spot[] = seedSpots.map((s, i) => ({
    id: i + 1, icao: s.icao, category: s.category, name: s.name, description: s.description, address: s.address || "", website: "",
    costLevel: s.costLevel, minutesNeeded: s.minutesNeeded, milesFromField: s.milesFromField, crewTip: s.crewTip || "",
    tags: JSON.stringify(s.tags), submittedBy: "Wheelsdown team", status: "live", createdAt: now - i * 3600_000,
  }));
  const reviews: Review[] = [];
  seedReviews.forEach((r, i) => {
    const sp = spots.find((s) => s.name === r.spot);
    if (sp) reviews.push({ id: reviews.length + 1, spotId: sp.id, rating: r.rating, comment: r.comment, author: r.author, crewRole: r.crewRole, createdAt: now - i * 7200_000 });
  });
  const ads: Ad[] = seedAds.map((a, i) => ({ id: i + 1, ...a, impressions: 0, clicks: 0 }));
  const votes: Vote[] = [];
  spots.forEach((sp, i) => seedVotesFor(i, now).forEach((v) => votes.push({ id: votes.length + 1, targetType: "spot", targetId: sp.id, ...v })));
  return { airports, spots, reviews, ads, votes, seq: { spot: spots.length, review: reviews.length, ad: ads.length, vote: votes.length } };
}

function load(): DB {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return seed();
}
let db = load();
function save() {
  try { window.localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch {}
}
export function resetDemo() {
  db = seed();
  save();
}

const CATS = ["eat", "do", "stay", "fbo"];
const parseRoute = (r: string) => r.toUpperCase().split(/[^A-Z0-9]+/).filter((c) => c.length === 3 || c.length === 4);
function resolve(code: string) {
  const c = code.trim().toUpperCase();
  if (c.length === 4) return db.airports.find((a) => a.icao === c);
  if (c.length === 3) return db.airports.find((a) => a.iata === c) || db.airports.find((a) => a.icao === "K" + c);
}
function ensureAirport(code: string, city?: string, name?: string) {
  const f = resolve(code);
  if (f) return f.icao;
  const icao = code.length === 3 ? "K" + code : code;
  db.airports.push({ icao, iata: code.length === 3 ? code : null, name: name || icao, city: city || "Unknown", region: "", country: "" });
  return icao;
}
function withStats(rows: Spot[], voter = "") {
  return rows.map((s) => {
    const rs = db.reviews.filter((r) => r.spotId === s.id);
    const vs = db.votes.filter((v) => v.targetType === "spot" && v.targetId === s.id);
    return { ...s, avgRating: rs.length ? rs.reduce((a, r) => a + r.rating, 0) / rs.length : null, reviewCount: rs.length, airport: db.airports.find((a) => a.icao === s.icao), vet: computeVet(vs, voter) };
  });
}
function castVote(targetType: string, targetId: number, voter: string, value: number, reason = "") {
  db.votes = db.votes.filter((v) => !(v.targetType === targetType && v.targetId === targetId && v.voter === voter));
  if (value !== 0) db.votes.push({ id: ++db.seq.vote, targetType, targetId, voter, value: value > 0 ? 1 : -1, reason: value < 0 ? reason : "", createdAt: Date.now() });
  if (targetType === "spot") {
    const s = db.spots.find((x) => x.id === targetId);
    if (s && s.status === "live" && shouldAutoHold(withStats([s])[0].vet)) s.status = "pending";
  }
}
function cleanSpot(o: any) {
  const out: any = {};
  for (const k of ["icao", "category", "name", "description", "address", "website", "crewTip", "tags", "submittedBy", "status"]) if (o[k] !== undefined) out[k] = String(o[k]);
  for (const k of ["costLevel", "minutesNeeded", "milesFromField"]) if (o[k] !== undefined && o[k] !== "") out[k] = Number(o[k]);
  if (out.category && !CATS.includes(out.category)) throw new Error("Invalid category");
  if (out.name !== undefined && out.name.trim().length < 2) throw new Error("Give it a name");
  if (out.costLevel !== undefined && (out.costLevel < 0 || out.costLevel > 4)) throw new Error("costLevel must be 0–4");
  return out;
}

// ---- CSV ----
const CSV_COLS = ["id", "icao", "category", "name", "description", "address", "website", "costLevel", "minutesNeeded", "milesFromField", "crewTip", "tags", "submittedBy", "status", "airportCity", "airportName"];
const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some((c) => c.trim())) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}
export function exportCsv() {
  const lines = [CSV_COLS.join(",")];
  for (const r of withStats(db.spots)) {
    const tags = (() => { try { return JSON.parse(r.tags).join("; "); } catch { return ""; } })();
    lines.push(CSV_COLS.map((c) => (c === "tags" ? esc(tags) : c === "airportCity" ? esc(r.airport?.city) : c === "airportName" ? esc(r.airport?.name) : esc((r as any)[c]))).join(","));
  }
  return lines.join("\n");
}

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

function route(method: string, path: string, query: URLSearchParams, body: any, headers: Record<string, string>): any {
  const admin = () => { if ((headers["x-admin-key"] || query.get("key")) !== DEMO_ADMIN_KEY) throw new HttpError(401, "Admin key required"); };
  let m: RegExpMatchArray | null;
  const voter = headers["x-voter-id"] || "";

  if (method === "GET" && path === "/api/airports") return [...db.airports].sort((a, b) => a.icao.localeCompare(b.icao));
  if (method === "GET" && path === "/api/search") {
    const codes = parseRoute(query.get("route") || "");
    const legs = codes.map((code) => ({ code, airport: resolve(code) || null }));
    const icaos = legs.filter((l) => l.airport).map((l) => l.airport!.icao);
    const live = db.spots.filter((s) => s.status === "live");
    const rows = codes.length ? live.filter((s) => icaos.includes(s.icao)) : [...live].sort((a, b) => b.createdAt - a.createdAt);
    return { legs, spots: withStats(rows, voter) };
  }
  if (method === "GET" && (m = path.match(/^\/api\/spots\/(\d+)$/))) {
    const s = db.spots.find((x) => x.id === Number(m![1]));
    if (!s || s.status === "hidden") throw new HttpError(404, "Not found");
    const reviews = db.reviews.filter((r) => r.spotId === s.id).sort((a, b) => b.createdAt - a.createdAt).map((r) => {
      const vs = db.votes.filter((v) => v.targetType === "review" && v.targetId === r.id);
      return { ...r, up: vs.filter((v) => v.value > 0).length, down: vs.filter((v) => v.value < 0).length, myVote: vs.find((v) => v.voter === voter)?.value ?? 0 };
    });
    return { spot: withStats([s], voter)[0], reviews };
  }
  if (method === "POST" && (m = path.match(/^\/api\/(spots|reviews)\/(\d+)\/vote$/))) {
    if (!voter) throw new HttpError(400, "Missing voter id");
    const value = Number(body.value);
    if (![1, -1, 0].includes(value)) throw new HttpError(400, "value must be 1, -1 or 0");
    castVote(m[1] === "spots" ? "spot" : "review", Number(m[2]), voter, value, String(body.reason || "").slice(0, 40));
    save(); return { ok: true };
  }
  if (method === "POST" && path === "/api/spots") {
    const code = String(body.icao || "").trim().toUpperCase();
    if (code.length < 3) throw new HttpError(400, "Airport code required");
    if (!resolve(code) && !body.airportCity) throw new HttpError(400, `We don't know ${code} yet — add the city so we can create it.`);
    const icao = ensureAirport(code, body.airportCity);
    const tags = Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean);
    const data = cleanSpot({ ...body, icao, tags: JSON.stringify(tags.slice(0, 8)) });
    const spot: Spot = { id: ++db.seq.spot, description: "", address: "", website: "", costLevel: 1, minutesNeeded: 60, milesFromField: 0, crewTip: "", submittedBy: "Anonymous crew", ...data, status: "live", createdAt: Date.now() };
    db.spots.push(spot); save(); return spot;
  }
  if (method === "POST" && (m = path.match(/^\/api\/spots\/(\d+)\/reviews$/))) {
    const spotId = Number(m[1]); const rating = Number(body.rating);
    if (!db.spots.find((s) => s.id === spotId)) throw new HttpError(404, "Not found");
    if (!(rating >= 1 && rating <= 5)) throw new HttpError(400, "Rating 1–5 required");
    const r: Review = { id: ++db.seq.review, spotId, rating, comment: String(body.comment || "").slice(0, 1500), author: body.author || "Anonymous crew", crewRole: body.crewRole || "Crew", createdAt: Date.now() };
    db.reviews.push(r); save(); return r;
  }
  if (method === "GET" && path === "/api/ads") {
    const icaos = parseRoute(query.get("icaos") || "");
    return db.ads.filter((a) => a.active && (!a.targetIcao || icaos.includes(a.targetIcao)));
  }
  if (method === "POST" && (m = path.match(/^\/api\/ads\/(\d+)\/(impression|click)$/))) {
    const a = db.ads.find((x) => x.id === Number(m![1]));
    if (a) { m[2] === "click" ? a.clicks++ : a.impressions++; save(); }
    return { ok: true };
  }

  // ---- admin ----
  if (path.startsWith("/api/admin")) admin();
  if (method === "POST" && path === "/api/admin/login") return { ok: true };
  if (method === "GET" && path === "/api/admin/stats") {
    return {
      spots: db.spots.filter((s) => s.status === "live").length, pending: db.spots.filter((s) => s.status === "pending").length,
      reviews: db.reviews.length, votes: db.votes.filter((v) => v.targetType === "spot").length, airports: new Set(db.spots.map((s) => s.icao)).size,
      impressions: db.ads.reduce((a, x) => a + x.impressions, 0), clicks: db.ads.reduce((a, x) => a + x.clicks, 0),
    };
  }
  if (method === "GET" && path === "/api/admin/spots") return withStats([...db.spots].sort((a, b) => b.createdAt - a.createdAt));
  if (method === "GET" && (m = path.match(/^\/api\/admin\/spots\/(\d+)\/votes$/))) {
    const id = Number(m[1]);
    return db.votes.filter((v) => v.targetType === "spot" && v.targetId === id).sort((a, b) => b.createdAt - a.createdAt);
  }
  if (method === "POST" && (m = path.match(/^\/api\/admin\/spots\/(\d+)\/clear-downvotes$/))) {
    const id = Number(m[1]);
    db.votes = db.votes.filter((v) => !(v.targetType === "spot" && v.targetId === id && v.value < 0));
    const s = db.spots.find((x) => x.id === id); if (s) s.status = "live";
    save(); return { ok: true };
  }
  if (method === "PATCH" && (m = path.match(/^\/api\/admin\/spots\/(\d+)$/))) {
    const s = db.spots.find((x) => x.id === Number(m![1]));
    if (!s) throw new HttpError(404, "Not found");
    Object.assign(s, cleanSpot(body)); save(); return s;
  }
  if (method === "POST" && path === "/api/admin/spots/bulk") {
    const ids: number[] = body.ids || [];
    if (body.action === "delete") {
      const before = db.spots.length;
      db.spots = db.spots.filter((s) => !ids.includes(s.id)); db.votes = db.votes.filter((v) => !(v.targetType === "spot" && ids.includes(v.targetId))); db.reviews = db.reviews.filter((r) => !ids.includes(r.spotId));
      save(); return { changed: before - db.spots.length };
    }
    if ((body.action === "status" && ["live", "pending", "hidden"].includes(body.value)) || (body.action === "category" && CATS.includes(body.value))) {
      db.spots.forEach((s) => { if (ids.includes(s.id)) (s as any)[body.action] = body.value; });
      save(); return { changed: ids.length };
    }
    throw new HttpError(400, "Unknown action");
  }
  if (method === "POST" && path === "/api/admin/import") {
    const rows = parseCsv(String(body.csv || ""));
    if (rows.length < 2) throw new HttpError(400, "CSV needs a header row and at least one data row");
    const header = rows[0].map((h) => h.trim());
    let created = 0, updated = 0; const errors: string[] = [];
    rows.slice(1).forEach((cells, idx) => {
      const o: Record<string, string> = {}; header.forEach((h, i) => (o[h] = (cells[i] ?? "").trim()));
      try {
        if (!o.icao || !o.name || !o.category) throw new Error("icao, name and category are required");
        const icao = ensureAirport(o.icao.toUpperCase(), o.airportCity, o.airportName);
        const data = cleanSpot({
          icao, category: o.category.toLowerCase(), name: o.name, description: o.description || "", address: o.address || "", website: o.website || "",
          costLevel: o.costLevel || 1, minutesNeeded: o.minutesNeeded || 60, milesFromField: o.milesFromField || 0, crewTip: o.crewTip || "",
          tags: JSON.stringify((o.tags || "").split(/[;|]/).map((t) => t.trim()).filter(Boolean)), submittedBy: o.submittedBy || "Admin import",
          status: ["live", "pending", "hidden"].includes(o.status) ? o.status : "live",
        });
        const ex = o.id ? db.spots.find((s) => s.id === Number(o.id)) : undefined;
        if (ex) { Object.assign(ex, data); updated++; }
        else { db.spots.push({ id: ++db.seq.spot, ...data, createdAt: Date.now() }); created++; }
      } catch (e: any) { errors.push(`Row ${idx + 2}: ${e.message}`); }
    });
    save(); return { created, updated, errors: errors.slice(0, 50) };
  }
  if (method === "GET" && path === "/api/admin/ads") return db.ads;
  if (method === "POST" && path === "/api/admin/ads") {
    if (!body.advertiser || !body.headline) throw new HttpError(400, "Advertiser and headline required");
    const a: Ad = { id: ++db.seq.ad, slot: body.slot || "inline", advertiser: body.advertiser, headline: body.headline, body: body.body || "", cta: body.cta || "Learn more", url: body.url || "", targetIcao: String(body.targetIcao || "").toUpperCase(), active: body.active ?? 1, impressions: 0, clicks: 0 };
    db.ads.push(a); save(); return a;
  }
  if ((m = path.match(/^\/api\/admin\/ads\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === "DELETE") { db.ads = db.ads.filter((a) => a.id !== id); save(); return { ok: true }; }
    if (method === "PATCH") {
      const a = db.ads.find((x) => x.id === id); if (!a) throw new HttpError(404, "Not found");
      const { id: _i, impressions: _v, clicks: _c, ...rest } = body; Object.assign(a, rest); save(); return a;
    }
  }
  throw new HttpError(404, "Not found");
}

export async function mockFetch(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const u = new URL(url, "http://demo.local");
  try {
    const out = route(method.toUpperCase(), u.pathname, u.searchParams, body ?? {}, headers);
    return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e: any) {
    const status = e instanceof HttpError ? e.status : 400;
    return new Response(JSON.stringify({ message: e.message }), { status, headers: { "Content-Type": "application/json" } });
  }
}
