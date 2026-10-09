// In-browser demo backend used for the static GitHub Pages build (VITE_STATIC=1).
// Mirrors server/routes.ts. Data is seeded from shared/seed.ts and saved only in this browser.
import { similarity, squash } from "@shared/similar";
import { seedAirports, seedSpots, seedReviews, seedAds } from "@shared/seed";
import type { Airport, Spot, Review, Ad, Vote } from "@shared/schema";
import { computeVet, seedVotesFor, shouldAutoHold } from "@shared/vetting";
import { computePoints, recentActivity, publicName, tierFor, SEED_USERS, SEED_PASSWORD } from "@shared/tiers";
import { CREW_ROLES } from "@shared/schema";
import { SERVICES } from "@shared/services";
import type { FeedbackItem } from "@shared/feedback";
import { CHECKIN_RULES, type MapDot } from "@shared/checkins";
import { achievementProgress, type AchStats } from "@shared/achievements";
import { validAircraftList } from "@shared/aircraft";
import { BIO_MAX, INTERESTS, MAX_INTERESTS } from "@shared/interests";
import { WRIGHT_SEATS } from "@shared/club";
import { buildHighlights } from "@shared/highlights";
import { crewCost, costOptions, isValidCost, milesBetween, isPace, paceMinutes } from "@shared/cost";
import { suggestPicks } from "@shared/briefing";
import { SEED_AIRPORT_COORDS } from "@shared/seedAirportCoords";
import type { BriefingStop } from "@shared/schema";

export const DEMO_ADMIN_KEY = "wheelsdown-admin";
const STORE_KEY = "wheelsdown-demo-v4";

type DemoUser = { referredBy?: number | null; id: number; handle: string; displayName: string; crewRole: string; homeBase: string; anonymous: boolean; email?: string; aircraft?: string; bio?: string; interests?: string[]; wrightNo?: number | null; pw: string; bonusPoints: number; createdAt: number };
type DemoBriefing = { id: number; userId: number; title: string; stops: BriefingStop[]; shareToken: string; createdAt: number; updatedAt: number };
type DB = { airports: Airport[]; spots: Spot[]; reviews: Review[]; ads: Ad[]; votes: Vote[]; users: DemoUser[]; sessions: Record<string, number>; briefings?: DemoBriefing[]; favorites?: { userId: number; spotId: number; at: number }[]; follows?: { a: number; b: number; at: number }[]; wrightTaken?: number; feedback?: FeedbackItem[]; checkins?: { id: number; userId: number; spotId: number | null; icao: string; lat: number; lng: number; createdAt: number }[];
  seq: { spot: number; review: number; ad: number; vote: number; user: number } };
// Demo only: not a secure hash. The server build uses scrypt.
const demoHash = (pw: string) => { let h = 5381; for (let i = 0; i < pw.length; i++) h = ((h << 5) + h + pw.charCodeAt(i)) | 0; return "demo:" + (h >>> 0).toString(36); };

function seed(): DB {
  const now = Date.now();
  const users: DemoUser[] = SEED_USERS.map((u, i) => ({ id: i + 1, handle: u.handle, displayName: u.displayName, crewRole: u.crewRole, homeBase: u.homeBase, anonymous: false, pw: demoHash(SEED_PASSWORD), bonusPoints: u.bonus, createdAt: now - (400 - i * 50) * 86400_000 }));
  const airports = seedAirports.map(([icao, iata, name, city, region, country]) => ({ icao, iata, name, city, region, country, lat: SEED_AIRPORT_COORDS[icao]?.[0] ?? null, lon: SEED_AIRPORT_COORDS[icao]?.[1] ?? null }));
  const spots: Spot[] = seedSpots.map((s, i) => ({
    id: i + 1, icao: s.icao, category: s.category, name: s.name, description: s.description, address: s.address || "", website: "",
    costLevel: s.costLevel, minutesNeeded: s.minutesNeeded, milesFromField: s.milesFromField, crewTip: s.crewTip || "",
    tags: JSON.stringify(s.tags), submittedBy: users[i % users.length].displayName, userId: users[i % users.length].id, status: "live", createdAt: now - i * 3600_000,
    pace: null, lat: null, lng: null, placeRef: null, modState: "", modNote: "", modAttempts: 0, pendingEdit: null,
  }));
  const reviews: Review[] = [];
  seedReviews.forEach((r, i) => {
    const sp = spots.find((s) => s.name === r.spot);
    const u = users.find((x) => x.displayName === r.author);
    if (sp) reviews.push({ id: reviews.length + 1, spotId: sp.id, rating: r.rating, comment: r.comment, author: r.author, crewRole: r.crewRole, userId: u?.id ?? null, createdAt: now - i * 7200_000, costLevel: null, status: "live", modState: "", modNote: "", modAttempts: 0, pendingEdit: null });
  });
  const ads: Ad[] = seedAds.map((a, i) => ({ id: i + 1, ...a, impressions: 0, clicks: 0 }));
  const votes: Vote[] = [];
  spots.forEach((sp, i) => seedVotesFor(i, now).forEach((v) => votes.push({ id: votes.length + 1, targetType: "spot", targetId: sp.id, ...v })));
  return { airports, spots, reviews, ads, votes, users, sessions: {}, seq: { spot: spots.length, review: reviews.length, ad: ads.length, vote: votes.length, user: users.length } };
}

function load(): DB {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (raw) {
      const d = JSON.parse(raw) as DB;
      d.airports.forEach((a) => { if (a.lat == null && SEED_AIRPORT_COORDS[a.icao]) { a.lat = SEED_AIRPORT_COORDS[a.icao][0]; a.lon = SEED_AIRPORT_COORDS[a.icao][1]; } });
      return d;
    }
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
  if (!/^[A-Z0-9]{3,4}$/.test(c)) return undefined;
  return db.airports.find((a) => a.icao === c) || (/^[A-Z]{3}$/.test(c) ? db.airports.find((a) => a.iata === c) || db.airports.find((a) => a.icao === "K" + c) : undefined)
    || (c.length === 4 && c[0] === "K" ? db.airports.find((a) => a.icao === c.slice(1)) : undefined);
}
function ensureAirport(code: string, city?: string, name?: string) {
  const f = resolve(code);
  if (f) return f.icao;
  const icao = /^[A-Z]{3}$/.test(code) ? "K" + code : code;
  db.airports.push({ icao, iata: /^[A-Z]{3}$/.test(code) ? code : null, name: name || icao, city: city || "Unknown", region: "", country: "", lat: null, lon: null });
  return icao;
}
/** Demo only: sample listings have no real coordinates, so put them at their listed distance from the field on a fixed bearing. */
function demoPin(s: Spot): { lat: number | null; lng: number | null } {
  if (s.lat != null && s.lng != null) return { lat: s.lat, lng: s.lng };
  const ap = db.airports.find((a) => a.icao === s.icao);
  if (ap?.lat == null || ap?.lon == null) return { lat: null, lng: null };
  const miles = Math.max(0.3, s.milesFromField || 0.5), brg = ((s.id * 137.508) % 360) * Math.PI / 180;
  const dLat = (miles / 69) * Math.cos(brg), dLng = (miles / (69 * Math.cos(ap.lat * Math.PI / 180))) * Math.sin(brg);
  return { lat: ap.lat + dLat, lng: ap.lon + dLng };
}
function withStats(rows: Spot[], voter = "") {
  return rows.map((s) => {
    const rs = db.reviews.filter((r) => r.spotId === s.id);
    const vs = db.votes.filter((v) => v.targetType === "spot" && v.targetId === s.id);
    const base = { ...({ pace: null, lat: null, lng: null, placeRef: null } as Pick<Spot, "pace" | "lat" | "lng" | "placeRef">), ...s };
    Object.assign(base, demoPin(base as Spot));
    return { ...base, goArounds: rs.filter((r) => r.rating === 0).length, avgRating: rs.length ? rs.reduce((a, r) => a + r.rating, 0) / rs.length : null, reviewCount: rs.length, airport: db.airports.find((a) => a.icao === s.icao), vet: computeVet(vs, voter),
      ...crewCost(s.category, s.costLevel, rs.map((r) => r.costLevel)) };
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
  for (const k of ["icao", "category", "name", "description", "address", "website", "crewTip", "tags", "submittedBy", "status", "placeRef"]) if (o[k] !== undefined && o[k] !== null) out[k] = String(o[k]);
  for (const k of ["costLevel", "minutesNeeded", "milesFromField", "lat", "lng"]) if (o[k] !== undefined && o[k] !== "" && o[k] !== null) out[k] = Number(o[k]);
  if (o.pace !== undefined) out.pace = isPace(o.pace) ? o.pace : null;
  if (out.category && !CATS.includes(out.category)) throw new Error("Invalid category");
  if (out.name !== undefined && out.name.trim().length < 2) throw new Error("Give it a name");
  if (out.costLevel !== undefined && (out.costLevel < 0 || out.costLevel > 4)) throw new Error("costLevel must be 0–4");
  return out;
}

// ---- CSV ----
const CSV_COLS = ["id", "icao", "category", "name", "description", "address", "website", "costLevel", "minutesNeeded", "pace", "milesFromField", "lat", "lng", "crewTip", "tags", "submittedBy", "status", "airportCity", "airportName"];
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

function achStats(uid: number): AchStats {
  const live = db.spots.filter((s) => s.status === "live"), mine = live.filter((s) => s.userId === uid), liveIds = new Set(live.map((s) => s.id));
  const revs = db.reviews.filter((r) => r.userId === uid && r.status === "live" && liveIds.has(r.spotId));
  const firstBy = new Map<string, number | null>();
  [...live].sort((a, b) => a.createdAt - b.createdAt || a.id - b.id).forEach((s) => { if (!firstBy.has(s.icao)) firstBy.set(s.icao, s.userId ?? null); });
  const mineIds = new Set(mine.map((s) => s.id));
  const five = mine.filter((s) => { const rs = db.reviews.filter((r) => r.spotId === s.id && r.status === "live"); return rs.length >= 3 && rs.reduce((a, r) => a + r.rating, 0) / rs.length >= 4.5; }).length;
  return { listings: mine.length, airports: new Set(mine.map((s) => s.icao)).size, eat: mine.filter((s) => s.category === "eat").length, do: mine.filter((s) => s.category === "do").length,
    stay: mine.filter((s) => s.category === "stay").length, fbo: mine.filter((s) => s.category === "fbo").length, ratings: revs.length,
    detailed: revs.filter((r) => r.comment.trim().length >= 40).length, goArounds: revs.filter((r) => r.rating === 0).length,
    favoritedByOthers: (db.favorites || []).filter((f) => mineIds.has(f.spotId) && f.userId !== uid).length, fiveStarFinds: five,
    briefings: (db.briefings || []).filter((b) => b.userId === uid).length, firstAtAirport: Array.from(firstBy.values()).filter((x) => x === uid).length, followers: followCounts(uid).followers };
}
const canonBase = (b: string) => { const c = b.trim().toUpperCase().slice(0, 4); return c ? resolve(c)?.icao || c : ""; };
function meOf(u: DemoUser) {
  const b = computePoints(db, u.id, u.bonusPoints);
  return { id: u.id, handle: u.handle, displayName: u.displayName, crewRole: u.crewRole, homeBase: u.homeBase, anonymous: !!u.anonymous, email: u.email || "",
    participation: b.participation, points: b.total, tierId: tierFor(b.total).tier.id, createdAt: u.createdAt, aircraft: u.aircraft || "", breakdown: b,
    bio: u.bio || "", interests: u.interests || [], follows: followCounts(u.id), wrightNo: u.wrightNo ?? null, achievements: achievementProgress(achStats(u.id)) };
}
const fl = () => (db.follows ||= []);
function followCounts(id: number) {
  return { followers: fl().filter((f) => f.b === id).length, following: fl().filter((f) => f.a === id && !db.users.find((u) => u.id === f.b)?.anonymous).length };
}
function publicUsers(admin = false) {
  return db.users.map((u) => {
    const { breakdown, follows: _f, wrightNo: _w, achievements: _a, ...rest } = meOf(u);
    return admin || !u.anonymous ? rest : { ...rest, handle: "", displayName: publicName(u), bio: "", interests: [] };
  }).sort((a, b) => b.points - a.points);
}
function relabel(u: DemoUser) {
  const label = publicName(u);
  db.spots.forEach((s) => { if (s.userId === u.id) s.submittedBy = label; });
  db.reviews.forEach((r) => { if (r.userId === u.id) { r.author = label; r.crewRole = u.crewRole; } });
}
function newSession(userId: number) {
  const t = "t-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  db.sessions[t] = userId; return t;
}

class HttpError extends Error { constructor(public status: number, msg: string) { super(msg); } }

function route(method: string, path: string, query: URLSearchParams, body: any, headers: Record<string, string>): any {
  const admin = () => { if ((headers["x-admin-key"] || query.get("key")) !== DEMO_ADMIN_KEY) throw new HttpError(401, "Admin key required"); };
  let m: RegExpMatchArray | null;
  const token = String(headers["authorization"] || "").replace(/^Bearer\s+/i, "");
  const user = token && db.sessions[token] ? db.users.find((u) => u.id === db.sessions[token]) : undefined;
  const voter = user ? `u:${user.id}` : "";
  const needUser = () => { if (!user) throw new HttpError(401, "Sign in to contribute"); return user; };

  // ---- accounts ----
  if (method === "POST" && path === "/api/auth/signup") {
    const handle = String(body.handle || "").trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,24}$/.test(handle)) throw new HttpError(400, "Handle: 3–24 letters, numbers, . _ -");
    if (String(body.password || "").length < 8) throw new HttpError(400, "Password must be at least 8 characters");
    if (String(body.displayName || "").trim().length < 2) throw new HttpError(400, "Add a display name");
    if (db.users.some((u) => u.handle === handle)) throw new HttpError(409, "That handle is taken");
    if (body.acceptTerms !== true) throw new HttpError(400, "Please accept the Terms and Community Guidelines");
    const role = (CREW_ROLES as readonly string[]).includes(body.crewRole) ? body.crewRole : "Pilot";
    const u: DemoUser = { id: ++db.seq.user, handle, displayName: String(body.displayName).trim().slice(0, 40), crewRole: role, anonymous: !!body.anonymous,
      homeBase: canonBase(String(body.homeBase || "")), email: String(body.email || "").trim().toLowerCase(), pw: demoHash(String(body.password)), bonusPoints: 0, createdAt: Date.now() };
    { const r = Number(body.ref); if (r > 0 && db.users.some((x) => x.id === r)) u.referredBy = r; }
    if ((db.wrightTaken || 0) < WRIGHT_SEATS) { db.wrightTaken = (db.wrightTaken || 0) + 1; u.wrightNo = db.wrightTaken; }
    db.users.push(u); const t = newSession(u.id); save();
    return { token: t, me: meOf(u) };
  }
  if (method === "GET" && (m = path.match(/^\/api\/ref\/(\d+)$/))) { const r = db.users.find((x) => x.id === Number(m![1])); return r ? { name: publicName(r) } : null; }
  if (method === "POST" && path === "/api/auth/login") {
    const h = String(body.handle || "").trim().toLowerCase();
    const u = db.users.find((x) => x.handle === h || (!!x.email && x.email === h));
    if (!u || u.pw !== demoHash(String(body.password || ""))) throw new HttpError(401, "Handle or password is wrong");
    const t = newSession(u.id); save(); return { token: t, me: meOf(u) };
  }
  if (method === "POST" && path === "/api/auth/logout") { delete db.sessions[token]; save(); return { ok: true }; }
  if (method === "GET" && path === "/api/me") return user ? meOf(user) : null;
  if (method === "PATCH" && path === "/api/me") {
    const u = needUser();
    if (body.displayName !== undefined) { const n = String(body.displayName).trim(); if (n.length < 2) throw new HttpError(400, "Add a display name"); u.displayName = n.slice(0, 40); }
    if (body.crewRole !== undefined) { if (!(CREW_ROLES as readonly string[]).includes(body.crewRole)) throw new HttpError(400, "Pick a position"); u.crewRole = body.crewRole; }
    if (body.homeBase !== undefined) u.homeBase = canonBase(String(body.homeBase));
    if (body.anonymous !== undefined) u.anonymous = !!body.anonymous;
    if (body.email !== undefined) u.email = String(body.email).trim().toLowerCase();
    if (body.aircraft !== undefined) { if (!validAircraftList(String(body.aircraft))) throw new HttpError(400, "Pick up to 6 aircraft from the list"); u.aircraft = String(body.aircraft); }
    if (body.bio !== undefined) { const t = String(body.bio).trim(); if (/https?:\/\/|www\.|@\w+\.\w/.test(t)) throw new HttpError(400, "Leave links and emails out of your bio."); u.bio = t.slice(0, BIO_MAX); }
    if (body.interests !== undefined) u.interests = (Array.isArray(body.interests) ? body.interests : []).filter((i: string) => i in INTERESTS).slice(0, MAX_INTERESTS);
    relabel(u); save();
    return meOf(u);
  }
  if (method === "POST" && path === "/api/auth/forgot") return { ok: true, message: "Demo build: no emails are sent. On the live site, a reset link goes to the email on your account." };
  if (method === "POST" && path === "/api/auth/reset") throw new HttpError(400, "Password reset works on the live site only.");
  if (method === "GET" && path === "/api/config") return { contactEmail: "", emailEnabled: false, moderated: false, ai: false };
  if (method === "DELETE" && path === "/api/me") {
    const u = needUser();
    if (String(body?.confirm || "").toLowerCase() !== u.handle) throw new HttpError(400, "Type your handle to confirm");
    const revIds = new Set(db.reviews.filter((r) => r.userId === u.id).map((r) => r.id));
    db.votes = db.votes.filter((v) => v.voter !== `u:${u.id}` && !(v.targetType === "review" && revIds.has(v.targetId)));
    db.reviews = db.reviews.filter((r) => r.userId !== u.id);
    db.spots.forEach((sp) => { if (sp.userId === u.id) { sp.userId = null as any; sp.submittedBy = "Former crew member"; } });
    for (const t of Object.keys(db.sessions)) if (db.sessions[t] === u.id) delete db.sessions[t];
    db.users = db.users.filter((x) => x.id !== u.id);
    db.briefings = (db.briefings || []).filter((b) => b.userId !== u.id);
    save(); return { ok: true };
  }
  if (method === "GET" && path === "/api/me/contributions") {
    const u = needUser();
    return {
      activity: recentActivity(db, u.id),
      spots: withStats(db.spots.filter((s) => s.userId === u.id)),
      reviews: db.reviews.filter((r) => r.userId === u.id).sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ ...r, spotName: db.spots.find((s) => s.id === r.spotId)?.name || "" })),
    };
  }
  if (method === "GET" && path === "/api/crew") return publicUsers();
  if (method === "GET" && path === "/api/leaderboard") {
    const all = publicUsers();
    let rank = 0, prev = -1;
    const ranked = all.map((u, i) => { if (u.points !== prev) { rank = i + 1; prev = u.points; } return { ...u, rank }; });
    const q = String(query.get("q") || "").trim().toLowerCase().replace(/^@/, "");
    const canon = (b: string) => resolve(b)?.icao || b.trim().toUpperCase();
    const base = String(query.get("base") || "").trim() ? canon(String(query.get("base"))) : "";
    const rows = ranked.filter((u) => (!q || u.displayName.toLowerCase().includes(q) || (!!u.handle && u.handle.toLowerCase().includes(q))) && (!base || (!!u.homeBase && canon(u.homeBase) === base)));
    const offset = Number(query.get("offset")) || 0, limit = Math.min(1000, Number(query.get("limit")) || 50);
    let around: { rows: typeof ranked; position: number } | null = null;
    const aid = Number(query.get("around")) || 0;
    if (aid && !q && !base) { const pos = ranked.findIndex((u) => u.id === aid); if (pos >= limit) { const from = Math.max(limit, pos - 3); around = { rows: ranked.slice(from, pos + 4), position: pos + 1 }; } }
    return { total: rows.length, crewTotal: all.length, base: base || null, rows: rows.slice(offset, offset + limit), offset, limit, around };
  }
  if (method === "GET" && path === "/api/leaderboard/bases") {
    const c = new Map<string, number>();
    for (const u of publicUsers()) if (u.homeBase) { const k = resolve(u.homeBase)?.icao || u.homeBase.toUpperCase(); c.set(k, (c.get(k) || 0) + 1); }
    return Array.from(c, ([code, n]) => ({ code, n })).sort((a, b) => b.n - a.n);
  }
  // ---- favorites ----
  const favs = () => (db.favorites ||= []);
  if (method === "GET" && path === "/api/me/favorites/ids") { const u = needUser(); return favs().filter((f) => f.userId === u.id).map((f) => f.spotId); }
  if (method === "GET" && path === "/api/me/favorites") {
    const u = needUser();
    const mine = favs().filter((f) => f.userId === u.id).sort((a, b) => b.at - a.at);
    return withStats(mine.map((f) => db.spots.find((s) => s.id === f.spotId && s.status === "live")).filter(Boolean) as Spot[]);
  }
  if (method === "PUT" && (m = path.match(/^\/api\/spots\/(\d+)\/favorite$/))) {
    const u = needUser(); const sid = Number(m[1]);
    if (!db.spots.find((s) => s.id === sid)) throw new HttpError(404, "Not found");
    const on = body.on !== false;
    db.favorites = favs().filter((f) => !(f.userId === u.id && f.spotId === sid));
    if (on) db.favorites.push({ userId: u.id, spotId: sid, at: Date.now() });
    save(); return { ok: true, on };
  }

  if (method === "GET" && path === "/api/airports") return [...db.airports].sort((a, b) => a.icao.localeCompare(b.icao));
  if (method === "GET" && path === "/api/highlights") {
    return buildHighlights(withStats(db.spots.filter((s) => s.status === "live"), voter), { category: query.get("category") });
  }
  if (method === "GET" && path === "/api/search") {
    const codes = parseRoute(query.get("route") || "");
    const legs = codes.map((code) => ({ code, airport: resolve(code) || null }));
    const icaos = legs.filter((l) => l.airport).map((l) => l.airport!.icao);
    const live = db.spots.filter((s) => s.status === "live");
    const rows = codes.length ? live.filter((s) => icaos.includes(s.icao)) : [...live].sort((a, b) => b.createdAt - a.createdAt);
    return { legs, spots: withStats(rows, voter) };
  }
  if (method === "GET" && path === "/api/spots/similar") {
    const name = String(query.get("name") || ""), code = String(query.get("icao") || "");
    if (code.length < 3 || squash(name).length < 3) return [];
    const icao = resolve(code)?.icao || code.toUpperCase();
    const lat = query.get("lat") ? Number(query.get("lat")) : null, lng = query.get("lng") ? Number(query.get("lng")) : null;
    return db.spots.filter((x) => x.icao === icao && x.status === "live")
      .map((x) => ({ x, s: similarity({ name, lat, lng, placeRef: query.get("placeRef") }, x as any) })).filter((r) => r.s >= 0.6).sort((a, b) => b.s - a.s).slice(0, 3)
      .map(({ x, s }) => { const rs = db.reviews.filter((r) => r.spotId === x.id && (r as any).status !== "hidden");
        return { id: x.id, name: x.name, category: x.category, address: x.address || "", reviewCount: rs.length, avgRating: rs.length ? rs.reduce((t, r) => t + r.rating, 0) / rs.length : null, mine: !!user && rs.some((r) => r.userId === user.id), score: s }; });
  }
  if (method === "GET" && (m = path.match(/^\/api\/spots\/(\d+)$/))) {
    const s = db.spots.find((x) => x.id === Number(m![1]));
    if (!s || s.status === "hidden") throw new HttpError(404, "Not found");
    const reviews = db.reviews.filter((r) => r.spotId === s.id).sort((a, b) => b.createdAt - a.createdAt).map((r) => {
      const vs = db.votes.filter((v) => v.targetType === "review" && v.targetId === r.id);
      const au = r.userId != null ? db.users.find((x) => x.id === r.userId) : undefined;
      return { ...r, authorId: au && !au.anonymous ? au.id : null, up: vs.filter((v) => v.value > 0).length, down: vs.filter((v) => v.value < 0).length, myVote: vs.find((v) => v.voter === voter)?.value ?? 0 };
    });
    return { spot: withStats([s], voter)[0], reviews };
  }
  if (method === "POST" && (m = path.match(/^\/api\/(spots|reviews)\/(\d+)\/vote$/))) {
    needUser();
    const value = Number(body.value);
    if (![1, -1, 0].includes(value)) throw new HttpError(400, "value must be 1, -1 or 0");
    castVote(m[1] === "spots" ? "spot" : "review", Number(m[2]), voter, value, String(body.reason || "").slice(0, 40));
    save(); return { ok: true };
  }
  if (method === "POST" && path === "/api/spots") {
    const u = needUser();
    const code = String(body.icao || "").trim().toUpperCase();
    if (code.length < 3) throw new HttpError(400, "Airport code required");
    if (!resolve(code) && !body.airportCity) throw new HttpError(400, `We don't know ${code} yet — add the city so we can create it.`);
    const icao = ensureAirport(code, body.airportCity);
    const tags = Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean);
    const data = cleanSpot({ ...body, icao, tags: JSON.stringify(tags.slice(0, 8)) });
    if (data.category === "fbo") data.costLevel = 0;
    else if (!isValidCost(data.category, data.costLevel)) throw new HttpError(400, data.category === "do" ? "Pick a price" : "Pick a price from $ to $$$$");
    if (data.category === "eat") {
      if (!isPace(data.pace)) throw new HttpError(400, "Pick Grab & go, Sit-down, or both");
      data.minutesNeeded = paceMinutes(data.pace);
    } else data.pace = null;
    if (data.category === "stay") data.minutesNeeded = 720;
    if (data.category === "fbo") data.minutesNeeded = 30;
    const ap = resolve(icao);
    if (data.lat != null && data.lng != null && ap?.lat != null && ap?.lon != null)
      data.milesFromField = Math.round(milesBetween({ lat: ap.lat, lon: ap.lon }, { lat: data.lat, lon: data.lng }) * 10) / 10;
    if (body.goAround && String(body.goAround.comment || "").trim().length < 10) throw new HttpError(400, "Tell crews why to go around (a sentence is enough)");
    const spot: Spot = { id: ++db.seq.spot, description: "", address: "", website: "", costLevel: 1, minutesNeeded: 60, milesFromField: 0, crewTip: "", pace: null, lat: null, lng: null, placeRef: null, ...data, submittedBy: publicName(u), userId: u.id, status: "live", createdAt: Date.now() };
    db.spots.push(spot);
    const why = String(body.goAround?.comment || "").trim();
    if (body.goAround) {
      db.reviews.push({ id: ++db.seq.review, spotId: spot.id, rating: 0, comment: why.slice(0, 1000), author: publicName(u), crewRole: u.crewRole, userId: u.id, createdAt: Date.now(), costLevel: null, status: "live", modState: "", modNote: "", modAttempts: 0, pendingEdit: null } as Review);
    }
    save(); return spot;
  }
  if (method === "PATCH" && (m = path.match(/^\/api\/spots\/(\d+)$/))) {
    const u = needUser();
    const sp = db.spots.find((s) => s.id === Number(m![1]));
    if (!sp) throw new HttpError(404, "Not found");
    if (sp.userId !== u.id) throw new HttpError(403, "Only the crew member who posted this can edit it");
    const code = String(body.icao || sp.icao).trim().toUpperCase();
    if (!resolve(code) && !body.airportCity) throw new HttpError(400, `We don't know ${code} yet — add the city so we can create it.`);
    const icao = ensureAirport(code, body.airportCity);
    const tags = body.tags === undefined ? undefined : JSON.stringify((Array.isArray(body.tags) ? body.tags : String(body.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean)).slice(0, 8));
    const data = cleanSpot({ ...sp, ...body, icao, ...(tags ? { tags } : {}) });
    if (data.category === "fbo") data.costLevel = 0;
    else if (!isValidCost(data.category, data.costLevel)) throw new HttpError(400, data.category === "do" ? "Pick a price" : "Pick a price from $ to $$$$");
    if (data.category === "eat") {
      if (!isPace(data.pace)) throw new HttpError(400, "Pick Grab & go, Sit-down, or both");
      data.minutesNeeded = paceMinutes(data.pace);
    } else data.pace = null;
    if (data.category === "stay") data.minutesNeeded = 720;
    if (data.category === "fbo") data.minutesNeeded = 30;
    const ap = resolve(icao);
    if (data.lat != null && data.lng != null && ap?.lat != null && ap?.lon != null)
      data.milesFromField = Math.round(milesBetween({ lat: ap.lat, lon: ap.lon }, { lat: data.lat, lon: data.lng }) * 10) / 10;
    const { submittedBy: _s, status: _st, ...safe } = data;
    Object.assign(sp, safe, { lat: body.lat === null ? null : sp.lat, lng: body.lng === null ? null : sp.lng }, data.lat != null ? { lat: data.lat, lng: data.lng } : {});
    save(); return sp;
  }
  if (method === "PATCH" && (m = path.match(/^\/api\/reviews\/(\d+)$/))) {
    const u = needUser();
    const r = db.reviews.find((x) => x.id === Number(m![1]));
    if (!r) throw new HttpError(404, "Not found");
    if (r.userId !== u.id) throw new HttpError(403, "Only the author can edit this rating");
    const sp = db.spots.find((s) => s.id === r.spotId)!;
    const rating = body.rating === undefined ? r.rating : Number(body.rating);
    if (!(rating >= 0 && rating <= 5)) throw new HttpError(400, "Pick a rating");
    const comment = body.comment === undefined ? r.comment : String(body.comment).slice(0, 1500);
    if (rating === 0 && comment.trim().length < 10) throw new HttpError(400, "Tell crews why to go around (a sentence is enough)");
    const cv = body.costLevel === undefined ? r.costLevel : body.costLevel == null || body.costLevel === "" ? null : Number(body.costLevel);
    Object.assign(r, { rating, comment, costLevel: cv != null && costOptions(sp.category).includes(cv) ? cv : null });
    save(); return r;
  }
  if (method === "POST" && (m = path.match(/^\/api\/spots\/(\d+)\/reviews$/))) {
    const u = needUser();
    const spotId = Number(m[1]); const rating = Number(body.rating);
    const sp = db.spots.find((s) => s.id === spotId);
    if (!sp) throw new HttpError(404, "Not found");
    if (!(rating >= 0 && rating <= 5) || body.rating === undefined || body.rating === null || body.rating === "") throw new HttpError(400, "Pick a rating");
    if (rating === 0 && String(body.comment || "").trim().length < 10) throw new HttpError(400, "Tell crews why to go around (a sentence is enough)");
    const cv = body.costLevel == null || body.costLevel === "" ? null : Number(body.costLevel);
    const costLevel = cv != null && costOptions(sp.category).includes(cv) ? cv : null;
    const r: Review = { id: ++db.seq.review, spotId, rating, comment: String(body.comment || "").slice(0, 1500), author: publicName(u), crewRole: u.crewRole, userId: u.id, createdAt: Date.now(), costLevel, status: "live", modState: "", modNote: "", modAttempts: 0, pendingEdit: null };
    db.reviews.push(r); save(); return r;
  }
  // ---- location & autofill (demo: airports only; business autofill needs the live server) ----
  if (method === "GET" && path === "/api/airports/nearest") {
    const lat = Number(query.get("lat")), lon = Number(query.get("lon"));
    return db.airports.filter((a) => a.lat != null && a.lon != null)
      .map((a) => ({ ...a, iata: a.iata || "", region: a.region || "", size: 2, miles: Math.round(milesBetween({ lat, lon }, { lat: a.lat!, lon: a.lon! }) * 10) / 10 }))
      .sort((a, b) => a.miles - b.miles).slice(0, 3);
  }
  if (method === "GET" && (m = path.match(/^\/api\/airports\/lookup\/([A-Za-z0-9]+)$/))) {
    const a = resolve(m[1]); if (!a) throw new HttpError(404, "Unknown airport"); return a;
  }
  if (method === "GET" && (path === "/api/places/search" || path === "/api/places/nearby"))
    throw new HttpError(503, "Business autofill works on the live site (getwheelsdown.com). In this demo, type the details in.");

  // ---- crew profiles ----
  if (method === "GET" && (m = path.match(/^\/api\/crew\/(\d+)$/))) {
    const uid = Number(m[1]);
    const list = publicUsers();
    const idx = list.findIndex((x) => x.id === uid);
    const du = db.users.find((x) => x.id === uid);
    if (idx < 0 || !du) throw new HttpError(404, "Not found");
    const liveIds = new Set(db.spots.filter((s) => s.status === "live").map((s) => s.id));
    const mySpots = withStats(db.spots.filter((s) => s.userId === uid && s.status === "live")).sort((a, b) => b.createdAt - a.createdAt);
    const myRevs = db.reviews.filter((r) => r.userId === uid && liveIds.has(r.spotId)).sort((a, b) => b.createdAt - a.createdAt);
    const counts = { listings: mySpots.length, reviews: myRevs.length };
    const follow = du.anonymous ? null : { ...followCounts(uid), isFollowing: !!user && fl().some((f) => f.a === user.id && f.b === uid) };
    if (du.anonymous) return { user: list[idx], rank: idx + 1, counts, follow, spots: [], reviews: [], hidden: true, wrightNo: null, badges: [] };
    return { user: list[idx], rank: idx + 1, counts, follow, hidden: false, spots: mySpots, wrightNo: du.wrightNo ?? null, badges: achievementProgress(achStats(uid)).filter((b) => b.earned).map((b) => b.id),
      reviews: myRevs.map(({ userId: _u, ...r }) => ({ ...r, spotName: db.spots.find((s) => s.id === r.spotId)?.name || "" })) };
  }

  if (method === "GET" && path === "/api/club") {
    const taken = db.wrightTaken || 0;
    return { seats: WRIGHT_SEATS, taken, left: Math.max(0, WRIGHT_SEATS - taken) };
  }
  // ---- following ----
  if ((m = path.match(/^\/api\/crew\/(\d+)\/follow$/)) && (method === "POST" || method === "DELETE")) {
    const u = needUser(), uid = Number(m[1]);
    const t = db.users.find((x) => x.id === uid);
    if (!t) throw new HttpError(404, "Not found");
    if (uid === u.id) throw new HttpError(400, "You can't follow yourself");
    if (method === "POST") { if (t.anonymous) throw new HttpError(400, "This member posts anonymously, so they can't be followed"); if (!fl().some((f) => f.a === u.id && f.b === uid)) fl().push({ a: u.id, b: uid, at: Date.now() }); }
    else db.follows = fl().filter((f) => !(f.a === u.id && f.b === uid));
    save();
    return { isFollowing: method === "POST", ...followCounts(uid) };
  }
  if (method === "GET" && (path === "/api/me/following" || path === "/api/me/followers")) {
    const u = needUser();
    const ids = path.endsWith("following") ? fl().filter((f) => f.a === u.id).map((f) => f.b) : fl().filter((f) => f.b === u.id).map((f) => f.a);
    return publicUsers().filter((p) => ids.includes(p.id) && !p.anonymous);
  }
  if (method === "GET" && path === "/api/me/feed") {
    const u = needUser();
    const ids = new Set(fl().filter((f) => f.a === u.id && !db.users.find((x) => x.id === f.b)?.anonymous).map((f) => f.b));
    const ppl = new Map(publicUsers().map((p) => [p.id, p]));
    const who = (id: number | null) => { const p = id ? ppl.get(id) : undefined; return p ? { id: p.id, displayName: p.displayName, aircraft: p.aircraft, tierId: p.tierId } : null; };
    const live = new Map(db.spots.filter((s) => s.status === "live").map((s) => [s.id, s]));
    return [
      ...db.spots.filter((s) => s.userId && ids.has(s.userId) && s.status === "live").map((s) => ({ kind: "spot", at: s.createdAt, user: who(s.userId), spot: { id: s.id, name: s.name, icao: s.icao, category: s.category }, description: s.description.slice(0, 200) })),
      ...db.reviews.filter((r) => r.userId && ids.has(r.userId) && live.has(r.spotId)).map((r) => { const s = live.get(r.spotId)!; return { kind: "review", at: r.createdAt, user: who(r.userId), spot: { id: s.id, name: s.name, icao: s.icao, category: s.category }, rating: r.rating, comment: r.comment.slice(0, 280) }; }),
    ].sort((a, b) => b.at - a.at).slice(0, 40);
  }

  // ---- trip briefings ----
  const bList = () => (db.briefings ||= []);
  const sponsorFor = (icao: string) => {
    const act = db.ads.filter((a) => a.active);
    const ad = act.find((a) => a.targetIcao === icao) || act.find((a) => !a.targetIcao);
    return ad ? { id: ad.id, advertiser: ad.advertiser, headline: ad.headline, url: ad.url } : null;
  };
  const favSet = (uid: number) => new Set((db.favorites || []).filter((f) => f.userId === uid).map((f) => f.spotId));
  const expand = (b: DemoBriefing, withCandidates: boolean) => ({
    id: b.id, title: b.title, shareToken: b.shareToken, createdAt: b.createdAt, updatedAt: b.updatedAt,
    stops: b.stops.map((st) => {
      const airport = resolve(st.icao) || null;
      const all = withStats(db.spots.filter((s) => s.status === "live" && s.icao === airport?.icao));
      const fv = favSet(b.userId);
      const favHere = all.filter((s) => fv.has(s.id)).map((s) => s.id);
      const ids = [...favHere.filter((i) => !st.picks.includes(i)), ...st.picks];
      return { icao: airport?.icao || st.icao, layover: st.layover, nights: st.nights, airport, favoriteIds: favHere, picks: ids.map((i) => all.find((s) => s.id === i)).filter(Boolean),
        candidates: withCandidates ? all : undefined, sponsor: sponsorFor(airport?.icao || st.icao) };
    }),
  });
  const cleanStops = (raw: any): BriefingStop[] => {
    const stops = Array.isArray(raw) ? raw : [];
    if (!stops.length) throw new HttpError(400, "Add at least one stop");
    if (stops.length > 12) throw new HttpError(400, "Up to 12 stops");
    return stops.map((st: any) => {
      const a = resolve(String(st.icao || ""));
      if (!a) throw new HttpError(400, `Unknown airport ${String(st.icao || "").toUpperCase()}`);
      const layover = ["quick", "hours", "overnight", "multi"].includes(st.layover) ? st.layover : "hours";
      return { icao: a.icao, layover, nights: st.nights ? Number(st.nights) : undefined, picks: (Array.isArray(st.picks) ? st.picks : []).map(Number).slice(0, 20) };
    });
  };
  if (method === "POST" && path === "/api/briefings/suggest") {
    const u = needUser();
    const fv = favSet(u.id);
    const stops = cleanStops(body.stops).map((st) => ({ ...st, picks: suggestPicks(withStats(db.spots.filter((s) => s.status === "live" && s.icao === st.icao)), st.layover).filter((i) => !fv.has(i)) }));
    return { title: String(body.title || ""), stops };
  }
  if (method === "GET" && path === "/api/briefings") {
    const u = needUser();
    return bList().filter((b) => b.userId === u.id).sort((a, b) => b.updatedAt - a.updatedAt).map((b) => ({ id: b.id, title: b.title, stops: b.stops.map((s) => ({ icao: s.icao, layover: s.layover })), updatedAt: b.updatedAt }));
  }
  if ((m = path.match(/^\/api\/briefings\/(\d+)$/))) {
    const u = needUser();
    const b = bList().find((x) => x.id === Number(m![1]) && x.userId === u.id);
    if (method === "DELETE") { if (!b) throw new HttpError(404, "Not found"); db.briefings = bList().filter((x) => x !== b); save(); return { ok: true }; }
    if (!b) throw new HttpError(404, "Not found");
    return expand(b, true);
  }
  if (method === "POST" && path === "/api/briefings") {
    const u = needUser();
    const stops = cleanStops(body.stops);
    const title = String(body.title || "").trim().slice(0, 80);
    let b = body.id ? bList().find((x) => x.id === Number(body.id) && x.userId === u.id) : undefined;
    if (body.id && !b) throw new HttpError(404, "Not found");
    if (b) { b.title = title; b.stops = stops; b.updatedAt = Date.now(); }
    else {
      b = { id: bList().reduce((mx, x) => Math.max(mx, x.id), 0) + 1, userId: u.id, title, stops, shareToken: Math.random().toString(36).slice(2) + Date.now().toString(36) + "demo", createdAt: Date.now(), updatedAt: Date.now() };
      bList().push(b);
    }
    save(); return expand(b, true);
  }
  if (method === "GET" && (m = path.match(/^\/api\/shared\/briefings\/([A-Za-z0-9_-]+)$/))) {
    const b = bList().find((x) => x.shareToken === m![1]);
    if (!b) throw new HttpError(404, "This briefing link is no longer available.");
    return expand(b, false);
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
  // the demo has no AI; show the moderation panel in its "off" state
  if (method === "GET" && path === "/api/admin/moderation") return { ai: false, manual: false, spots: [], reviews: [], log: [],
    status: { lastRunAt: 0, lastError: "", lastErrorAt: 0, checking: 0, held: 0, approved24h: 0, held24h: 0, errors24h: 0, overrides24h: 0 } };
  if (method === "PUT" && path === "/api/admin/moderation/settings") return { manual: false };
  // the demo records no traffic; the report shows its real ad, audience and content numbers with empty traffic
  // ---- check-ins (demo: stored in this browser; same distance rules as the live site) ----
  const cks = () => (db.checkins ||= []);
  const addedDots = (uid: number): MapDot[] => db.spots.filter((s) => s.userId === uid && s.status === "live").map((s) => {
    const ap = resolve(s.icao);
    return { kind: "added" as const, spotId: s.id, name: s.name, icao: s.icao, category: s.category, lat: (s.lat ?? ap?.lat) as number, lng: (s.lng ?? ap?.lon) as number };
  }).filter((d) => d.lat != null && d.lng != null);
  if (method === "POST" && path === "/api/checkins") {
    const u = needUser(); const b = body || {};
    const here = { lat: Number(b.lat), lon: Number(b.lng) };
    if ((Number(b.accuracy) || 0) / 1609.34 > CHECKIN_RULES.maxAccuracyMiles) throw new HttpError(400, "Your location is too rough to verify. Step outside or turn on precise location, then try again.");
    let t: { spotId: number | null; icao: string; lat: number; lng: number; r: number; name: string } | null = null;
    if (b.spotId) {
      const s = db.spots.find((x) => x.id === Number(b.spotId) && x.status === "live"); if (!s) throw new HttpError(404, "Not found");
      const ap = resolve(s.icao);
      if (s.lat != null && s.lng != null) t = { spotId: s.id, icao: s.icao, lat: s.lat, lng: s.lng, r: CHECKIN_RULES.spotMiles, name: s.name };
      else if (ap?.lat != null && ap?.lon != null) t = { spotId: s.id, icao: s.icao, lat: ap.lat, lng: ap.lon, r: (s.milesFromField || 0) + CHECKIN_RULES.unpinnedSlackMiles, name: s.name };
    } else { const ap = resolve(String(b.icao || "")); if (ap?.lat != null && ap?.lon != null) t = { spotId: null, icao: ap.icao, lat: ap.lat, lng: ap.lon, r: CHECKIN_RULES.airportMiles, name: ap.icao }; }
    if (!t) throw new HttpError(400, "Nothing to check in at");
    const d = milesBetween(here, { lat: t.lat, lon: t.lng });
    if (d > t.r) throw new HttpError(400, `You're about ${d < 10 ? d.toFixed(1) : Math.round(d)} miles from ${t.name}. Check in when you're there.`);
    const prior = cks().find((c) => c.userId === u.id && c.spotId === t!.spotId && c.icao === t!.icao && c.createdAt > Date.now() - 20 * 3600_000);
    if (prior) return { ok: true, id: prior.id, already: true, createdAt: prior.createdAt };
    const row = { id: (cks().reduce((m, c) => Math.max(m, c.id), 0)) + 1, userId: u.id, spotId: t.spotId, icao: t.icao, lat: t.lat, lng: t.lng, createdAt: Date.now() };
    cks().push(row); return { ok: true, id: row.id, already: false, createdAt: row.createdAt };
  }
  if (method === "GET" && path === "/api/me/checkins") {
    const u = needUser();
    return cks().filter((c) => c.userId === u.id).sort((a, b) => b.createdAt - a.createdAt).map((c) => { const s = db.spots.find((x) => x.id === c.spotId); return { ...c, spotName: s?.name ?? null, category: s?.category ?? null }; });
  }
  if (method === "DELETE" && (m = path.match(/^\/api\/checkins\/(\d+)$/))) { const u = needUser(); db.checkins = cks().filter((c) => !(c.id === Number(m![1]) && c.userId === u.id)); return { ok: true }; }
  if (method === "GET" && path === "/api/me/map") {
    const u = needUser(); const seen = new Set<string>();
    const checkins: MapDot[] = cks().filter((c) => c.userId === u.id).sort((a, b) => b.createdAt - a.createdAt).filter((c) => { const k = `${c.spotId}|${c.icao}`; return !seen.has(k) && !!seen.add(k); })
      .map((c) => { const s = db.spots.find((x) => x.id === c.spotId); return { kind: c.spotId ? "checkin" as const : "airport" as const, spotId: c.spotId, name: s?.name || c.icao, icao: c.icao, category: s?.category ?? null, lat: c.lat, lng: c.lng }; });
    return { added: addedDots(u.id), checkins };
  }
  if (method === "GET" && (m = path.match(/^\/api\/crew\/(\d+)\/map$/))) { const du = db.users.find((x) => x.id === Number(m![1])); return { added: du && !du.anonymous ? addedDots(du.id) : [], checkins: [] }; }

  // ---- moderation fixes and owner questions need the live server ----
  if (method === "GET" && path === "/api/me/notices") return [];
  if (method === "GET" && path === "/api/me/notifications") {
    const u = needUser(); const seenAt = (db as any).notifSeen?.[u.id] || 0;
    const back = new Set(fl().filter((f) => f.a === u.id).map((f) => f.b)); const pu = new Map(publicUsers().map((p) => [p.id, p]));
    const items = fl().filter((f) => f.b === u.id).sort((x, y) => y.at - x.at).map((f) => ({ f, p: pu.get(f.a) })).filter((x) => x.p && !x.p.anonymous)
      .map(({ f, p }) => ({ kind: "follow", at: f.at, unread: f.at > seenAt, followingBack: back.has(f.a), user: { id: p!.id, displayName: p!.displayName, aircraft: p!.aircraft, tierId: p!.tierId, points: p!.points, crewRole: p!.crewRole, homeBase: p!.homeBase } }));
    return { seenAt, unread: items.filter((i) => i.unread).length, items };
  }
  if (method === "POST" && path === "/api/me/notifications/seen") { const u = needUser(); ((db as any).notifSeen ||= {})[u.id] = Date.now(); save(); return { ok: true }; }
  if (method === "GET" && path === "/api/admin/moderation/extras") { admin(); return { duplicates: {} }; }
  if (method === "POST" && /^\/api\/admin\/moderation\/(spot|review)\/\d+\/(fix|fix\/apply|ask-owner)$/.test(path)) { admin(); throw new HttpError(400, "AI fixes and owner questions only work on the live site."); }

  // ---- feedback (demo: stored in this browser) ----
  const fb = () => (db.feedback ||= []);
  if (method === "POST" && path === "/api/feedback") {
    const b = body || {}; const msg = String(b.message || "").trim();
    if (msg.length < 5) throw new HttpError(400, "Tell us a little more");
    if (b.website) return { ok: true };
    const now = Date.now();
    fb().unshift({ id: (fb()[0]?.id || 0) + 1, kind: String(b.kind || "other"), message: msg.slice(0, 2000), contact: user ? "" : String(b.contact || "").slice(0, 120), page: String(b.page || ""), device: "Demo browser",
      status: "new", adminNote: "", createdAt: now, updatedAt: now, userId: user?.id ?? null, userName: user?.displayName ?? null, handle: user?.handle ?? null });
    return { ok: true };
  }
  if (method === "GET" && path === "/api/admin/feedback") {
    admin();
    const st = query.get("status") || "open";
    const items = fb().filter((f) => st === "all" || (st === "open" ? f.status === "new" || f.status === "reviewing" : f.status === st));
    const counts: Record<string, number> = {}; fb().forEach((f) => { counts[f.status] = (counts[f.status] || 0) + 1; });
    return { items, counts };
  }
  if ((m = path.match(/^\/api\/admin\/feedback\/(\d+)$/))) {
    admin(); const f = fb().find((x) => x.id === Number(m![1])); if (!f) throw new HttpError(404, "Not found");
    if (method === "PATCH") { if (body?.status) f.status = body.status; if (body?.adminNote !== undefined) f.adminNote = String(body.adminNote); f.updatedAt = Date.now(); return { ok: true }; }
    if (method === "DELETE") { db.feedback = fb().filter((x) => x.id !== f.id); return { ok: true }; }
  }
  if (method === "GET" && path === "/api/admin/costs") {
    const z = { calls: 0, failures: 0, input_tokens: 0, cached_tokens: 0, output_tokens: 0, searches: 0, cost: 0 };
    const days = [7, 30, 90].includes(Number(query.get("days"))) ? Number(query.get("days")) : 30;
    return { days, since: "", month: new Date().toISOString().slice(0, 7), trackingSince: null, model: "gpt-5-mini", aiOn: false,
      prices: { input: 0.25, cached: 0.025, output: 2, search: 10 }, today: z, period: z, monthToDate: z, byPurpose: [], daily: [],
      beforeTracking: { listings: 0, ratings: 0, estimate: 0 }, services: SERVICES, fixedMonthly: SERVICES.reduce((a, sv) => a + (sv.monthly || 0), 0) };
  }
  if (method === "GET" && path === "/api/admin/advertisers") {
    const days = [7, 30, 90].includes(Number(query.get("days"))) ? Number(query.get("days")) : 30;
    const live = db.spots.filter((s) => s.status === "live");
    const tally = (v: string[]) => Object.entries(v.reduce((m: Record<string, number>, x) => { if (x) m[x] = (m[x] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]);
    return { days, since: new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10),
      traffic: { visitors: 0, crewActive: 0, visits: 0, pageviews: 0, searches: 0, spotViews: 0, outbound: 0, shares: 0, signups: 0 },
      series: [], pages: {}, outbound: {}, devices: {}, airports: [],
      ads: db.ads.map((x) => ({ id: x.id, advertiser: x.advertiser, headline: x.headline, targetIcao: x.targetIcao || "", active: !!x.active, impressions: 0, clicks: 0, lifetimeImpressions: x.impressions, lifetimeClicks: x.clicks })),
      audience: { crew: db.users.length, newCrew: 0, roles: tally(db.users.map((u: any) => u.crewRole || "")), aircraft: [], homeBases: tally(db.users.map((u: any) => String(u.homeBase || "").toUpperCase())).slice(0, 12), interests: [] },
      content: { listings: live.length, airports: new Set(live.map((x) => x.icao)).size, eat: live.filter((x) => x.category === "eat").length, do: live.filter((x) => x.category === "do").length, stay: live.filter((x) => x.category === "stay").length, fbo: live.filter((x) => x.category === "fbo").length, ratings: db.reviews.length } };
  }
  if (method === "GET" && path === "/api/admin/stats") {
    return {
      spots: db.spots.filter((s) => s.status === "live").length, pending: db.spots.filter((s) => s.status === "pending").length,
      reviews: db.reviews.length, users: db.users.length, votes: db.votes.filter((v) => v.targetType === "spot").length, airports: new Set(db.spots.map((s) => s.icao)).size,
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
          pace: o.pace || null, lat: o.lat || null, lng: o.lng || null,
          tags: JSON.stringify((o.tags || "").split(/[;|]/).map((t) => t.trim()).filter(Boolean)), submittedBy: o.submittedBy || "Admin import",
          status: ["live", "pending", "hidden"].includes(o.status) ? o.status : "live",
        });
        const ex = o.id ? db.spots.find((s) => s.id === Number(o.id)) : undefined;
        if (ex) { Object.assign(ex, data); updated++; }
        else { db.spots.push({ id: ++db.seq.spot, userId: null, pace: null, lat: null, lng: null, placeRef: null, ...data, createdAt: Date.now() }); created++; }
      } catch (e: any) { errors.push(`Row ${idx + 2}: ${e.message}`); }
    });
    save(); return { created, updated, errors: errors.slice(0, 50) };
  }
  if (method === "GET" && path === "/api/admin/users") return publicUsers(true);
  if (method === "POST" && (m = path.match(/^\/api\/admin\/users\/(\d+)\/bonus$/))) {
    const u = db.users.find((x) => x.id === Number(m![1])); const delta = Math.trunc(Number(body.delta));
    if (!u || !Number.isFinite(delta)) throw new HttpError(400, "Bad request");
    u.bonusPoints = Math.max(0, u.bonusPoints + delta); save(); return { ok: true };
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
