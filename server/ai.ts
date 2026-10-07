// AI autofill + moderation. Uses an OpenAI-compatible Responses API (OPENAI_API_KEY, optional OPENAI_BASE_URL / AI_MODEL).
// When no key is set every function reports "disabled" and the app behaves exactly as before.
import dns from "node:dns/promises";
import net from "node:net";
import { COST_LABELS, COST_RANGES, costOptions } from "@shared/cost";
import type { Category } from "@shared/schema";

const KEY = process.env.OPENAI_API_KEY || "";
const BASE = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const MODEL = process.env.AI_MODEL || "gpt-5-mini";
export const AI_ENABLED = !!KEY && process.env.AI_DISABLED !== "1";
const UA = "Wheelsdown/1.0 (+https://getwheelsdown.com)";

// ---------------------------------------------------------------- model calls
type CallOpts = { search?: boolean; schema: { name: string; schema: any }; timeoutMs?: number; effort?: "minimal" | "low" | "medium" };
async function callModel<T>(system: string, user: string, o: CallOpts): Promise<T> {
  if (!AI_ENABLED) throw new Error("AI disabled");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), o.timeoutMs ?? 60_000);
  try {
    const body: any = {
      model: MODEL,
      instructions: system,
      input: user,
      reasoning: { effort: o.effort ?? "low" },
      text: { format: { type: "json_schema", name: o.schema.name, schema: o.schema.schema, strict: true } },
    };
    if (o.search) body.tools = [{ type: "web_search" }];
    const r = await fetch(`${BASE}/responses`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    if (!r.ok) throw new Error(`AI ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j: any = await r.json();
    const textOut = j.output_text ?? (j.output || []).flatMap((x: any) => x.type === "message" ? (x.content || []) : []).filter((c: any) => c.type === "output_text").map((c: any) => c.text).join("");
    const sources: string[] = (j.output || []).flatMap((x: any) => x.type === "message" ? (x.content || []) : [])
      .flatMap((c: any) => c.annotations || []).filter((a: any) => a.type === "url_citation" && a.url).map((a: any) => a.url);
    const parsed = JSON.parse(textOut);
    if (sources.length && Array.isArray(parsed.sources)) parsed.sources = Array.from(new Set([...parsed.sources, ...sources])).slice(0, 6);
    return parsed as T;
  } finally { clearTimeout(t); }
}

/** OpenAI's free moderation endpoint. Returns null when unavailable (e.g. a proxy that doesn't offer it). */
let modEndpointOk = true;
async function moderationEndpoint(text: string): Promise<{ flagged: boolean; categories: string[] } | null> {
  if (!AI_ENABLED || !modEndpointOk || !text.trim()) return null;
  try {
    const r = await fetch(`${BASE}/moderations`, { method: "POST", headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "omni-moderation-latest", input: text.slice(0, 8000) }), signal: AbortSignal.timeout(10_000) });
    if (r.status === 404) { modEndpointOk = false; return null; }
    if (!r.ok) return null;
    const res = (await r.json())?.results?.[0];
    if (!res) return null;
    return { flagged: !!res.flagged, categories: Object.entries(res.categories || {}).filter(([, v]) => v).map(([k]) => k) };
  } catch { return null; }
}

// ---------------------------------------------------------------- outside data
function privateIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  return v === "::1" || v === "::" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80") || v.startsWith("::ffff:127.") || v.startsWith("::ffff:10.") || v.startsWith("::ffff:192.168.");
}
async function safeUrl(raw: string): Promise<URL | null> {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && !["80", "443"].includes(u.port))) return null;
    const addrs = await dns.lookup(u.hostname, { all: true });
    if (!addrs.length || addrs.some((a) => privateIp(a.address))) return null;
    return u;
  } catch { return null; }
}
/** Reads a public web page as plain text (max ~6k chars). Blocks private networks and follows at most 3 redirects. */
export async function readWebsite(raw: string): Promise<{ url: string; title: string; text: string } | null> {
  let url = raw;
  for (let hop = 0; hop < 4; hop++) {
    const u = await safeUrl(url);
    if (!u) return null;
    try {
      const r = await fetch(u, { redirect: "manual", headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" }, signal: AbortSignal.timeout(7000) });
      if (r.status >= 300 && r.status < 400 && r.headers.get("location")) { url = new URL(r.headers.get("location")!, u).toString(); continue; }
      if (!r.ok || !/text\/html|xhtml/.test(r.headers.get("content-type") || "")) return null;
      const reader = r.body?.getReader(); if (!reader) return null;
      let html = "", size = 0;
      while (size < 600_000) { const { value, done } = await reader.read(); if (done) break; size += value.length; html += new TextDecoder().decode(value); }
      reader.cancel().catch(() => {});
      const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").replace(/\s+/g, " ").trim().slice(0, 150);
      const meta = (html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] || "").slice(0, 300);
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, " ").replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ").trim();
      return { url: u.toString(), title, text: (meta ? meta + " | " : "") + text.slice(0, 6000) };
    } catch { return null; }
  }
  return null;
}
/** Full OpenStreetMap tags for a picked place (cuisine, hours, phone, takeaway, website…). */
export async function osmTags(placeRef?: string | null): Promise<Record<string, string> | null> {
  const m = /^osm:([NWR])(\d+)$/.exec(placeRef || "");
  if (!m) return null;
  const kind = { N: "node", W: "way", R: "relation" }[m[1] as "N" | "W" | "R"];
  try {
    const r = await fetch(`https://api.openstreetmap.org/api/0.6/${kind}/${m[2]}.json`, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(7000) });
    if (!r.ok) return null;
    const tags = (await r.json())?.elements?.[0]?.tags || {};
    const keep = Object.entries(tags).filter(([k]) => !/^(source|note|fixme|check_date|ref:|wikidata|wikipedia|survey)/.test(k)).slice(0, 40);
    return Object.fromEntries(keep) as Record<string, string>;
  } catch { return null; }
}

// ---------------------------------------------------------------- shared prompt bits
const priceGuide = (cat: string) => costOptions(cat as Category).map((i) => `${i}=${COST_LABELS[i] || "Free"} (${(COST_RANGES as any)[cat]?.[i] ?? ""})`).join(", ");
const CAT_HELP = "eat = restaurants/cafes/bars, do = activities and attractions, stay = hotels, fbo = the airport's FBO itself";
const TAG_HINT = "short lowercase tags crews filter on, e.g. late night, crew discount, open 24h, breakfast, healthy, walkable, shuttle, gym, pool, coffee, local favorite";

// ---------------------------------------------------------------- autofill
export type AutofillInput = {
  icao: string; category: Category; name: string; airport?: { name: string; city: string; lat: number | null; lon: number | null } | null;
  address?: string; website?: string; lat?: number | null; lng?: number | null; placeRef?: string | null; milesFromField?: number | null;
};
export type AutofillResult = {
  found: boolean; name: string; address: string; website: string; description: string; crewTip: string;
  costLevel: number | null; pace: "grab" | "sit" | "both" | null; minutesNeeded: number | null; tags: string[];
  confidence: "high" | "medium" | "low"; notes: string; sources: string[];
};
const AUTOFILL_SCHEMA = { name: "spot_autofill", schema: {
  type: "object", additionalProperties: false,
  required: ["found", "name", "address", "website", "description", "crewTip", "costLevel", "pace", "minutesNeeded", "tags", "confidence", "notes", "sources"],
  properties: {
    found: { type: "boolean" }, name: { type: "string" }, address: { type: "string" }, website: { type: "string" },
    description: { type: "string" }, crewTip: { type: "string" },
    costLevel: { type: ["integer", "null"] }, pace: { type: ["string", "null"], enum: ["grab", "sit", "both", null] },
    minutesNeeded: { type: ["integer", "null"] }, tags: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] }, notes: { type: "string" }, sources: { type: "array", items: { type: "string" } },
  } } };

const cache = new Map<string, { at: number; v: AutofillResult }>();
export async function autofill(i: AutofillInput): Promise<AutofillResult> {
  const key = [i.icao, i.category, i.name.toLowerCase().trim(), i.placeRef || "", i.website || ""].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 24 * 3600_000) return hit.v;
  const [osm, site] = await Promise.all([osmTags(i.placeRef), i.website ? readWebsite(i.website) : Promise.resolve(null)]);
  const osmSite = !i.website && osm ? osm.website || osm["contact:website"] : "";
  const site2 = !site && osmSite ? await readWebsite(osmSite) : null;
  const system = `You fill in a listing for Wheelsdown, a guide where airline and charter flight crews share places near airports for layovers.
Use every source given plus web search to find this exact business near the airport. Only state facts you found; never invent prices, hours, discounts or menu items.
If the poster picked a map location (place.address / lat / lng), describe that exact branch. Chains often have several locations (including inside the terminal); never switch to a different one, and keep its address.
Rules:
- category is ${i.category} (${CAT_HELP}).
- description: 1-3 plain sentences (max 280 chars) a crew member would find useful: what it is, what it's known for, and hours if found. No hype, no emojis, no exclamation points.
- crewTip: one short practical tip only if a source supports it (e.g. "Open until 2am", "Free hotel shuttle from the FBO"); otherwise "".
- costLevel: integer for the price per ${i.category === "stay" ? "night" : "person"} using ${priceGuide(i.category)}${i.category === "fbo" ? "; FBO is always 0" : ""}; null if unknown.
- pace (eat only, else null): "grab" for counter service/takeout, "sit" for table service, "both" if it clearly offers both.
- minutesNeeded (do only, else null): typical visit length in minutes, not counting travel.
- tags: up to 5, ${TAG_HINT}.
- address: full street address, "" if not found. website: official site URL, "" if none (not Yelp/Tripadvisor/Facebook unless that is all they have).
- found=false and confidence=low if you can't confirm the place exists near this airport; explain in notes. Use notes (max 200 chars) for anything the poster should double-check, e.g. permanently closed, different location, name mismatch.
- sources: URLs you relied on.`;
  const user = JSON.stringify({
    airport: { code: i.icao, name: i.airport?.name, city: i.airport?.city, lat: i.airport?.lat, lon: i.airport?.lon },
    place: { name: i.name, address: i.address || "", website: i.website || osmSite || "", lat: i.lat, lng: i.lng, milesFromAirport: i.milesFromField ?? null },
    openStreetMapTags: osm || {},
    officialWebsiteText: (site || site2)?.text.slice(0, 5000) || "",
  });
  const v = await callModel<AutofillResult>(system, user, { search: true, schema: AUTOFILL_SCHEMA, timeoutMs: 75_000 });
  // normalize to what the form accepts
  v.description = (v.description || "").replace(/!/g, ".").slice(0, 500);
  v.crewTip = (v.crewTip || "").replace(/!/g, ".").slice(0, 140);
  if (v.costLevel != null && !costOptions(i.category).includes(v.costLevel)) v.costLevel = null;
  if (i.category === "fbo") v.costLevel = 0;
  if (i.category !== "eat") v.pace = null;
  if (i.category !== "do") v.minutesNeeded = null;
  v.tags = (v.tags || []).map((t) => t.toLowerCase().trim().slice(0, 30)).filter((t) => t && !/^(grab|sit|sit-down|grab & go|grab and go|eat|do|stay|fbo|restaurant)$/.test(t)).slice(0, 5);
  if (v.website && !/^https?:\/\//.test(v.website)) v.website = "https://" + v.website;
  if (v.website) { try { new URL(v.website); } catch { v.website = ""; } }
  v.sources = Array.from(new Set([...(v.sources || []), ...(site ? [site.url] : []), ...(i.placeRef?.startsWith("osm:") ? [`https://www.openstreetmap.org/${{ N: "node", W: "way", R: "relation" }[i.placeRef[4] as "N"]}/${i.placeRef.slice(5)}`] : [])]))
    .filter((u) => /^https?:\/\//.test(u)).slice(0, 6);
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  return v;
}

// ---------------------------------------------------------------- moderation
export type Verdict = { verdict: "approve" | "review" | "reject"; problem: "none" | "inappropriate" | "spam" | "personal_info" | "incorrect" | "duplicate" | "not_a_place" | "unverifiable"; reason: string };
const VERDICT_SCHEMA = { name: "moderation", schema: {
  type: "object", additionalProperties: false, required: ["verdict", "problem", "reason"],
  properties: {
    verdict: { type: "string", enum: ["approve", "review", "reject"] },
    problem: { type: "string", enum: ["none", "inappropriate", "spam", "personal_info", "incorrect", "duplicate", "not_a_place", "unverifiable"] },
    reason: { type: "string" },
  } } };
const SAFETY = `Inappropriate: hate or slurs, harassment or threats, sexual content, graphic violence, promoting illegal activity, naming or describing private individuals (staff names with insults, phone numbers, home addresses), doxxing, spam or ads unrelated to the place, links to unrelated sites, gibberish.
Allowed: honest negative opinions (slow service, rude staff, overpriced, dirty), mild profanity used descriptively, discussing alcohol at bars.`;

export type SpotForCheck = {
  icao: string; category: string; name: string; description?: string | null; crewTip?: string | null; address?: string | null; website?: string | null;
  costLevel?: number | null; pace?: string | null; minutesNeeded?: number; milesFromField?: number | null; lat?: number | null; lng?: number | null;
  placeRef?: string | null; tags?: string | null;
};
export async function checkSpot(s: SpotForCheck, ctx: { airport?: { name: string; city: string } | null; nearbyNames: string[]; isEdit: boolean; previous?: SpotForCheck | null }): Promise<Verdict> {
  const text = [s.name, s.description, s.crewTip, s.address, s.website, s.tags].filter(Boolean).join("\n");
  const mod = await moderationEndpoint(text);
  if (mod?.flagged && mod.categories.some((c) => !/^(violence|self-harm)$/.test(c))) return { verdict: "reject", problem: "inappropriate", reason: "This listing contains language that isn't allowed. Please keep it about the place and keep it civil." };
  const [osm, site] = await Promise.all([osmTags(s.placeRef), s.website ? readWebsite(s.website) : Promise.resolve(null)]);
  const system = `You moderate listings on Wheelsdown, a guide where flight crews share places near airports for layovers. Decide if this ${ctx.isEdit ? "edit" : "new listing"} can be published.
${SAFETY}
Also check accuracy using the data given and web search:
- The place should exist and be near the airport (milesFromField is measured from the airport; over 30 miles is suspicious unless it's a known day trip). milesFromField of 0 or null just means it wasn't measured; never hold for that.
- Category must fit (${CAT_HELP}). Price level, pace and address should be roughly consistent with what you find. Price guide: ${priceGuide(s.category)}.
- A duplicate is a listing of the same business at the same airport already in existingListings (minor spelling differences count).
Verdicts:
- approve: appropriate and plausibly correct. Small differences (formatting, a suite number, a neighboring city or suburb name, a slightly different price tier or distance, hours, missing details) are fine; approve and say nothing. If the business and address check out, approve. Don't block because you can't find a small local place online if nothing contradicts it.
- review: likely incorrect, a probable duplicate, wrong airport or city, closed permanently, or not a real place. A person will look.
- reject: clearly inappropriate or spam.
reason: one or two short polite sentences (under 250 characters) addressed to the poster saying exactly what to fix (empty when approving). No emojis or exclamation points.`;
  const user = JSON.stringify({
    airport: { code: s.icao, name: ctx.airport?.name, city: ctx.airport?.city },
    listing: { ...s, tags: s.tags },
    previousVersion: ctx.isEdit ? ctx.previous : undefined,
    existingListings: ctx.nearbyNames.slice(0, 80),
    openStreetMapTags: osm || {},
    officialWebsiteText: site?.text.slice(0, 3500) || (s.website ? "(website could not be loaded)" : ""),
  });
  const v = normalize(await callModel<Verdict>(system, user, { search: true, schema: VERDICT_SCHEMA, timeoutMs: 90_000 }));
  // editing an existing listing never makes it the duplicate; a newer copy would be
  if (ctx.isEdit && v.problem === "duplicate" && v.verdict === "review" && String((ctx.previous as any)?.name || "").trim().toLowerCase() === String(s.name || "").trim().toLowerCase()) return { verdict: "approve", problem: "none", reason: "" };
  return v;
}

export async function checkReview(r: { rating: number; comment: string; costLevel?: number | null }, spot: { name: string; category: string; icao: string }): Promise<Verdict> {
  if (!r.comment.trim()) return { verdict: "approve", problem: "none", reason: "" };
  const mod = await moderationEndpoint(r.comment);
  if (mod?.flagged && mod.categories.some((c) => !/^(violence|self-harm)$/.test(c))) return { verdict: "reject", problem: "inappropriate", reason: "This rating contains language that isn't allowed. Please keep it about the place and keep it civil." };
  const system = `You moderate ratings on Wheelsdown, a guide where flight crews rate places near airports. Rating 0 means "Go around" (avoid this place); 1-5 are stars.
${SAFETY}
- review: the comment is clearly about a different place, or makes a serious accusation (crime, food poisoning outbreak) as fact with no detail. A person will look.
- reject: inappropriate or spam.
- approve: everything else, including harsh but honest opinions and very short comments.
reason: one short polite sentence (under 200 characters) to the author saying what to change (empty when approving). No emojis or exclamation points.`;
  const user = JSON.stringify({ place: spot, rating: r.rating, comment: r.comment.slice(0, 1500) });
  return normalize(await callModel<Verdict>(system, user, { schema: VERDICT_SCHEMA, timeoutMs: 45_000, effort: "minimal" }));
}

/** Display names and handles: a quick synchronous check. Returns a message when the name isn't allowed, null when fine or unavailable. */
export async function checkName(name: string): Promise<string | null> {
  if (!AI_ENABLED || !name.trim()) return null;
  try {
    const mod = await moderationEndpoint(name);
    if (mod?.flagged) return "Pick a different name. Names are public, so they can't be offensive or look like site staff.";
    const v = await callModel<Verdict>(`You check public display names on a site for airline and charter flight crews. ${SAFETY}
Reject names that are slurs, sexual, hateful, harassing, impersonate the site staff ("admin", "moderator", "Wheelsdown"), or advertise. Normal names, nicknames, call signs and aviation jokes are fine.
problem "none" + verdict approve when fine. reason: one short sentence when rejecting.`, JSON.stringify({ name }), { schema: VERDICT_SCHEMA, timeoutMs: 8000, effort: "minimal" });
    return v.verdict === "reject" ? "Pick a different name. Names are public, so they can't be offensive or look like site staff." : null;
  } catch { return null; }
}

function normalize(v: Verdict): Verdict {
  if (!["approve", "review", "reject"].includes(v.verdict)) v.verdict = "review";
  // drop inline citations like ([site](url)) and turn [text](url) into text
  let reason = (v.reason || "").replace(/\s*\(\[[^\]]*\]\([^)]*\)\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/!/g, ".").replace(/\s{2,}/g, " ").trim();
  if (reason.length > 360) { const cut = reason.slice(0, 360); reason = cut.slice(0, Math.max(cut.lastIndexOf(". ") + 1, 200)).trim(); }
  v.reason = reason;
  if (v.verdict !== "approve" && !v.reason) v.reason = v.verdict === "reject" ? "This doesn't meet the community guidelines." : "A moderator will double-check this before it goes live.";
  return v;
}
