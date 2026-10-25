/** FBO portal (beta): shared limits, field lists and CSV import mapping. FBO accounts are a separate source of info:
 *  they never appear on the crew leaderboard and never earn points (they live in their own tables, not `users`). */

export const FBO_CATEGORIES = ["eat", "stay", "do"] as const;
export type FboCategory = (typeof FBO_CATEGORIES)[number];
export const FBO_CAT_LABEL: Record<FboCategory, string> = { eat: "Restaurant", stay: "Hotel", do: "Thing to do" };
export const FBO_CAT_PLURAL: Record<FboCategory, string> = { eat: "Where to eat", stay: "Where to stay", do: "Things to do" };

export const FBO_ROLES = ["owner", "editor"] as const;
export type FboRole = (typeof FBO_ROLES)[number];
export const FBO_ROLE_LABEL: Record<FboRole, string> = { owner: "Owner", editor: "Editor" };

/** Beta guardrails. Enforced on the server. */
export const FBO_LIMITS = {
  places: 400,
  bulkRows: 300,
  offers: 100,
  activeAds: 3,
  ads: 12,
  users: 15,
  headline: 60,
  body: 120,
  cta: 20,
  name: 120,
  notes: 600,
  short: 160,
  about: 600,
  intel: 300,
  passwordMin: 10,
};

/** FBO intel fields. Each is shown on the public page labeled "Provided by <FBO>" with its own updated date. */
export const FBO_INTEL_FIELDS: { key: string; label: string; hint: string; group: string }[] = [
  { key: "hours", label: "Hours", hint: "e.g. 24/7, or 0600–2200 local", group: "Desk" },
  { key: "frequency", label: "Frequency", hint: "e.g. 122.95 (Unicom)", group: "Desk" },
  { key: "after_hours", label: "After-hours service", hint: "Call-out fee, how to reach the line", group: "Desk" },
  { key: "fuel", label: "Fuel", hint: "Brand, Jet A / 100LL, additive, self-serve", group: "Ramp" },
  { key: "fuel_price", label: "Fuel price", hint: "Posted price and the date it applies", group: "Ramp" },
  { key: "fees", label: "Ramp / facility fees", hint: "Fee and the fuel minimum that waives it", group: "Ramp" },
  { key: "hangar", label: "Hangar / parking", hint: "Overnight hangar, tie-downs, de-ice, GPU", group: "Ramp" },
  { key: "crew_car", label: "Crew car", hint: "Available? Time limit? How to reserve", group: "Crew" },
  { key: "lounge", label: "Crew lounge", hint: "Snooze rooms, showers, quiet room", group: "Crew" },
  { key: "wifi", label: "Wi-Fi / flight planning", hint: "Network, printing, weather room", group: "Crew" },
  { key: "transport", label: "Shuttle / rideshare", hint: "Hotel shuttles, rideshare pickup point", group: "Crew" },
  { key: "catering", label: "Catering", hint: "Who you use, lead time", group: "Crew" },
  { key: "notes", label: "Anything else crews should know", hint: "Gate codes are best kept off this page", group: "Crew" },
];
export const FBO_INTEL_KEYS = new Set(FBO_INTEL_FIELDS.map((f) => f.key));

/** Column names we recognize in an uploaded spreadsheet (lowercased, spaces/punctuation stripped). */
export const FBO_IMPORT_COLUMNS: Record<string, string[]> = {
  name: ["name", "business", "businessname", "restaurant", "hotel", "place", "placename", "title"],
  category: ["category", "type", "kind", "cat"],
  address: ["address", "location", "street", "fulladdress"],
  phone: ["phone", "phonenumber", "tel", "telephone"],
  website: ["website", "url", "web", "site", "link"],
  notes: ["notes", "note", "description", "why", "comments", "comment", "recommendation", "tip"],
  crewRate: ["crewrate", "rate", "crewdiscount", "price", "pricing"],
  distance: ["distance", "miles", "drive", "drivetime", "minutes"],
  favorite: ["favorite", "favourite", "fav", "star", "starred", "top"],
  level: ["level", "listing", "recommend", "recommended", "listorrecommend", "listonly"],
  code: ["code", "discountcode", "couponcode", "promocode", "coupon", "promo", "discount"],
  offer: ["offer", "deal", "discountdetails", "coupondetails", "offerdetails"],
  expires: ["expires", "expiration", "expiry", "expireson", "validuntil", "enddate"],
};

export function normHeader(h: string) { return h.toLowerCase().replace(/[^a-z0-9]/g, ""); }

/** "Hotel", "lodging", "stay" -> stay; "restaurant", "food" -> eat; else do (or null if unreadable). */
export function categoryFrom(v: string): FboCategory | null {
  const s = v.toLowerCase().trim();
  if (!s) return null;
  if (/^(stay|hotel|motel|inn|lodg|resort|suite|accom|bnb|b&b)/.test(s) || /hotel|lodging|motel/.test(s)) return "stay";
  if (/^(eat|food|rest|dine|dining|cafe|coffee|bar|pub|grill|bistro|pizza|deli|bakery|brew|meal|lunch|breakfast|dinner)/.test(s) || /restaurant|food|dining/.test(s)) return "eat";
  if (/^(do|activity|activities|thing|fun|attraction|shop|gym|fitness|park|museum|golf|spa|tour)/.test(s)) return "do";
  return null;
}

/** How an FBO stands behind a listing: "listed" = close and decent (List only), "recommended" = the better options (List and recommend). */
export type FboLevel = "listed" | "recommended";
export const FBO_LEVEL_LABEL: Record<FboLevel, string> = { listed: "List only", recommended: "List and recommend" };
/** Spreadsheet value -> level. Blank means "use the default chosen at upload". */
export function levelFrom(v: string): FboLevel | null {
  const s = v.toLowerCase().trim();
  if (!s) return null;
  if (/^(n|no|false|0|list|listed|list only|listonly|basic)$/.test(s)) return "listed";
  if (/^(y|yes|true|1|x|rec|recommend|recommended|list and recommend|top|best)$/.test(s)) return "recommended";
  return null;
}

export const truthy = (v: string) => /^(y|yes|true|1|x|\*|★|fav|favorite|top)$/i.test(v.trim());

export function parseDelimited(text: string): string[][] {
  // Auto-detect tab-separated (pasted from Excel/Sheets) vs comma-separated.
  const first = text.split(/\r?\n/, 1)[0] || "";
  const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"' && cur === "") q = true;
    else if (ch === delim) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cur += ch;
  }
  row.push(cur);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

export type FboImportRow = {
  name: string; category: FboCategory | null; address: string; phone: string; website: string; notes: string;
  crewRate: string; distance: string; favorite: boolean; level: FboLevel | null; code: string; offer: string; expires: string;
};

/** Map a parsed sheet (first row = headers) onto import rows. `defaultCategory` fills rows with no category column. */
export function mapImport(table: string[][], defaultCategory: FboCategory | null): { rows: FboImportRow[]; matched: Record<string, string>; unknown: string[] } {
  if (!table.length) return { rows: [], matched: {}, unknown: [] };
  const headers = table[0].map(normHeader);
  const idx: Record<string, number> = {};
  const matched: Record<string, string> = {};
  for (const [field, names] of Object.entries(FBO_IMPORT_COLUMNS)) {
    const i = headers.findIndex((h) => names.includes(h));
    if (i >= 0) { idx[field] = i; matched[field] = table[0][i]; }
  }
  const unknown = table[0].filter((_, i) => !Object.values(idx).includes(i) && table[0][i]);
  const get = (r: string[], f: string) => (idx[f] != null ? String(r[idx[f]] ?? "").trim() : "");
  const rows = table.slice(1).map((r) => ({
    name: get(r, "name"),
    category: idx.category != null ? categoryFrom(get(r, "category")) : defaultCategory,
    address: get(r, "address"), phone: get(r, "phone"), website: get(r, "website"), notes: get(r, "notes"),
    crewRate: get(r, "crewRate"), distance: get(r, "distance"), favorite: truthy(get(r, "favorite")), level: levelFrom(get(r, "level")),
    code: get(r, "code"), offer: get(r, "offer"), expires: get(r, "expires"),
  })).filter((r) => r.name || r.address);
  return { rows, matched, unknown };
}

/** Normalized name for matching an FBO pick to an existing crew listing at the same airport. */
export const nameKey = (s: string) => s.toLowerCase().replace(/&/g, "and").replace(/\b(the|restaurant|hotel|inn|bar|grill|cafe)\b/g, "").replace(/[^a-z0-9]/g, "");

const STOP = new Set(["the", "and", "of", "at", "a", "an", "restaurant", "hotel", "inn", "bar", "grill", "cafe", "kitchen", "suites", "by", "co", "llc"]);
const words = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/['\u2019]/g, "").split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w));
/** 0-100 likeness of two business names: 100 same name, 80 one contains the other, else shared distinctive words. */
export function nameLikeness(a: string, b: string): number {
  const ka = nameKey(a), kb = nameKey(b);
  if (ka.length < 3 || kb.length < 3) return 0;
  if (ka === kb) return 100;
  if (Math.min(ka.length, kb.length) >= 4 && (ka.includes(kb) || kb.includes(ka))) return 80;
  const wa = words(a), wb = new Set(words(b));
  if (!wa.length || !wb.size) return ka.slice(0, 5) === kb.slice(0, 5) ? 45 : 0;
  const hits = wa.filter((w) => wb.has(w) || Array.from(wb).some((x) => x.length >= 5 && w.length >= 5 && (x.startsWith(w) || w.startsWith(x))));
  const shared = hits.length;
  if (!shared) return ka.slice(0, 5) === kb.slice(0, 5) ? 45 : 0;
  // one common word only counts when it's a real name word ("Teterboro"), not "new" or "bay", and is half the name
  if (shared === 1 && (hits[0].length < 5 || shared / Math.max(wa.length, wb.size) < 0.5)) return ka.slice(0, 5) === kb.slice(0, 5) ? 45 : 0;
  return Math.round(40 + 40 * (shared / Math.max(wa.length, wb.size)));
}
/** Listings that may already be the place being typed, best first. */
export function similarListings<T extends { name: string }>(name: string, list: T[], max = 4, min = 45): T[] {
  if (name.trim().length < 3) return [];
  return list.map((s) => ({ s, n: nameLikeness(name, s.name) })).filter((x) => x.n >= min).sort((x, y) => y.n - x.n).slice(0, max).map((x) => x.s);
}

/** YYYY-MM-DD from common date spellings ("12/31/2026", "2026-12-31"); "" when unreadable. */
export function isoDate(v: string): string {
  const s = v.trim();
  if (!s) return "";
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : "";
}

export type FboAccount = {
  id: number; slug: string; name: string; icao: string; airportName: string; phone: string; email: string; website: string;
  address: string; about: string; status: "active" | "suspended"; createdAt: number;
};
export type FboUser = { id: number; fboId: number; email: string; name: string; role: FboRole; status: string; createdAt: number; lastLoginAt: number | null };
/** One FBO recommendation: a link from the FBO to a shared Wheelsdown listing (spots table), plus the FBO's own note.
 *  The listing itself exists once; any number of FBOs (and crews) can stand behind it. `id` is the recommendation id. */
export type FboPlace = {
  id: number; spotId: number; category: FboCategory; name: string; address: string; website: string; phone: string; notes: string;
  crewRate: string; distance: string; favorite: boolean; level: FboLevel; sort: number; hidden: boolean; updatedAt: number; updatedBy: string;
};
/** A listing at the FBO's airport, as shown in the portal's checklist. `rec` is set when this FBO recommends it. */
export type FboSpot = {
  spotId: number; category: FboCategory; name: string; address: string; website: string; description: string;
  costLevel: number | null; pace: string | null; miles: number | null; status: string;
  crew: { ratings: number; avg: number | null; goArounds: number };
  addedBy: "you" | "crew" | "fbo"; otherFbos: number; canEdit: boolean;
  rec: (Omit<FboPlace, "spotId" | "category" | "name" | "address" | "website">) | null;
};
export type FboSpotInput = {
  category: FboCategory; name: string; address?: string; website?: string; description?: string; crewTip?: string;
  costLevel?: number | null; pace?: string | null; lat?: number | null; lng?: number | null; placeRef?: string | null; tags?: string[];
};
export type FboOffer = { id: number; placeId: number | null; title: string; code: string; details: string; expiresOn: string; active: boolean; updatedAt: number; updatedBy: string };
export type FboIntel = Record<string, { value: string; updatedAt: number; updatedBy: string }>;
export type FboAd = { id: number; slot: string; headline: string; body: string; cta: string; url: string; active: boolean; impressions: number; clicks: number };
