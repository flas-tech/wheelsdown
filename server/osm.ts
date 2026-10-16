// Real places near an airport from OpenStreetMap (Overpass API, free, ODbL). Feeds "Find with AI": the model picks
// and describes from these instead of searching the web from scratch, so runs are faster and rarely come back empty.
// Data © OpenStreetMap contributors.
import { milesBetween } from "@shared/cost";

export type OsmCat = "eat" | "do" | "stay";
export type Candidate = {
  ref: string; category: OsmCat; name: string; lat: number; lng: number; miles: number;
  kind: string; cuisine: string; address: string; website: string; hours: string; brand: string; wiki: boolean; score: number; osmUrl: string;
};

const ENDPOINTS = (process.env.OVERPASS_URLS || "https://overpass-api.de/api/interpreter,https://overpass.private.coffee/api/interpreter,https://overpass.kumi.systems/api/interpreter")
  .split(",").map((s) => s.trim()).filter(Boolean);
const UA = "Wheelsdown/1.0 (+https://getwheelsdown.com)";
let lastGood = 0; // index of the server that answered last, tried first next time
let downUntil = 0; // after every server fails, skip OpenStreetMap for a while so searches fall back fast
const DOWN_MS = 10 * 60_000;
const CACHE_MS = 7 * 86400_000;
const cache = new Map<string, { at: number; v: Candidate[] }>();

async function one(url: string, q: string, ms: number): Promise<any[]> {
  const r = await fetch(url, { method: "POST", headers: { "user-agent": UA, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: "data=" + encodeURIComponent(q), signal: AbortSignal.timeout(ms) });
  if (!r.ok) throw new Error(`overpass ${r.status}`);
  const j: any = await r.json();
  if (j.remark && /runtime error|timed out|out of memory/i.test(j.remark) && !(j.elements || []).length) throw new Error("overpass busy");
  return Array.isArray(j.elements) ? j.elements : [];
}
/** Staggered race: the last good server first, the next one 4 s later, and so on. First answer wins. */
async function overpass(q: string): Promise<any[]> {
  if (Date.now() < downUntil) throw new Error("OpenStreetMap skipped (servers were down recently)");
  try { return await race(q); } catch (e) { downUntil = Date.now() + DOWN_MS; throw e; }
}
async function race(q: string): Promise<any[]> {
  const order = [...ENDPOINTS.slice(lastGood), ...ENDPOINTS.slice(0, lastGood)];
  return await new Promise<any[]>((resolve, reject) => {
    let left = order.length, done = false;
    order.forEach((url, i) => setTimeout(() => {
      if (done) { left--; return; }
      one(url, q, Number(process.env.OVERPASS_TIMEOUT_MS || 20_000)).then((v) => { if (!done) { done = true; lastGood = ENDPOINTS.indexOf(url); resolve(v); } })
        .catch((e) => { if (process.env.OVERPASS_DEBUG) console.log("[osm]", url, String(e?.message || e)); if (--left === 0 && !done) reject(new Error("no Overpass server answered")); });
    }, i * 3000));
  });
}

// ---------------------------------------------------------------- what to ask for
const EAT_AMENITY = `nwr["amenity"~"^(restaurant|cafe|fast_food|pub|bar|food_court|ice_cream|biergarten)$"]["name"]`;
// cuisine focus: OSM cuisine values and name words (POSIX regex, case-insensitive)
const CUISINE_Q: Record<string, { c: string; n: string; extra?: string[] }> = {
  pizza: { c: "pizza", n: "pizz" }, bbq: { c: "barbecue|bbq", n: "bbq|barbecue|barbeque|smokehouse" }, burgers: { c: "burger", n: "burger" },
  mexican: { c: "mexican|tex-mex|taco|burrito", n: "mexic|taco|taqueria|burrito|cantina" }, sushi: { c: "sushi|japanese|ramen|poke", n: "sushi|ramen|hibachi|japan|izakaya" },
  chinese: { c: "chinese|dim_sum|cantonese|szechuan|sichuan", n: "chinese|dim sum|dumpling|szechuan|sichuan" }, thai: { c: "thai|vietnamese", n: "thai|vietnam|banh mi|(^| )pho( |$)" },
  indian: { c: "indian|nepalese|pakistani", n: "india|tandoor|curry|masala|biryani" }, italian: { c: "italian", n: "italian|trattoria|osteria|ristorante|pasta" },
  mediterranean: { c: "greek|mediterranean|lebanese|turkish|kebab|falafel|middle_eastern", n: "greek|gyro|falafel|shawarma|kebab|mediterr|lebanese" },
  latin: { c: "cuban|latin_american|peruvian|colombian|venezuelan|brazilian|salvadoran|puerto_rican|argentinian|arepa|empanada", n: "cuban|latin|peruv|colombia|empanada|arepa|brazil|churrasc" },
  seafood: { c: "seafood|fish|fish_and_chips|oyster|crab|lobster", n: "seafood|oyster|crab|lobster|fish|shrimp|clam" }, steak: { c: "steak", n: "steak|chophouse|chop house" },
  caribbean: { c: "caribbean|jamaican|haitian|bahamian", n: "caribbean|jamaica|jerk|haiti|conch" }, southern: { c: "southern|soul_food|cajun|creole|fried_chicken", n: "southern|soul food|cajun|creole|biscuit" },
  wings: { c: "wings", n: "wing" }, deli: { c: "sandwich|deli|sub|hot_dog|bagel", n: "deli|sandwich|(^| )subs?( |$)|hoagie|cheesesteak" },
  breakfast: { c: "breakfast|brunch|pancake|diner|bagel|waffle", n: "breakfast|brunch|diner|pancake|waffle|bagel" },
  coffee: { c: "coffee", n: "coffee|espresso|roaster", extra: [`nwr["amenity"="cafe"]["name"]`] },
  bakery: { c: "donut|dessert|ice_cream|cake|bakery|frozen_yogurt|pastry", n: "bakery|donut|doughnut|pastr|gelato|ice cream|dessert", extra: [`nwr["shop"~"^(bakery|pastry|confectionery)$"]["name"]`, `nwr["amenity"="ice_cream"]["name"]`] },
  healthy: { c: "salad|vegan|vegetarian|juice|smoothie|health|acai|poke", n: "salad|vegan|juice|smoothie|acai|bowl" },
  bar: { c: "pub|beer|brewery", n: "pub|brew|tavern|taproom|beer", extra: [`nwr["amenity"~"^(pub|bar|biergarten)$"]["name"]`, `nwr["craft"~"^(brewery|winery|distillery)$"]["name"]`] },
};
const DO_ALL = [
  `nwr["tourism"~"^(museum|gallery|zoo|aquarium|theme_park|attraction|viewpoint)$"]["name"]`,
  `nwr["leisure"~"^(park|nature_reserve|garden|golf_course|miniature_golf|water_park|marina|beach_resort|spa|sauna|bowling_alley|amusement_arcade|escape_game|trampoline_park|ice_rink)$"]["name"]`,
  `nwr["historic"~"^(monument|castle|fort|ship|aircraft|lighthouse|battlefield|ruins|archaeological_site|locomotive|museum)$"]["name"]`,
  `nwr["amenity"~"^(theatre|cinema|arts_centre|casino|nightclub|planetarium|music_venue|spa|public_bath|marketplace)$"]["name"]`,
  `nwr["craft"~"^(brewery|winery|distillery)$"]["name"]`, `nwr["natural"="beach"]["name"]`, `nwr["man_made"="lighthouse"]["name"]`, `nwr["shop"="mall"]["name"]`,
];
// type-of-thing-to-do focus
const ACT_Q: Record<string, string[]> = {
  golf: [`nwr["leisure"~"^(golf_course|miniature_golf)$"]["name"]`, `nwr["golf"="driving_range"]["name"]`, `nwr["name"~"golf",i]["leisure"]`],
  fishing: [`nwr["leisure"~"^(marina|fishing|slipway)$"]["name"]`, `nwr["shop"="fishing"]["name"]`, `nwr["name"~"fishing|charter|marina|boat (tour|rental)",i]`],
  spa: [`nwr["leisure"~"^(spa|sauna)$"]["name"]`, `nwr["amenity"~"^(spa|public_bath)$"]["name"]`, `nwr["shop"="massage"]["name"]`, `nwr["shop"="beauty"]["beauty"~"spa|massage"]["name"]`, `nwr["name"~"(^| )spa( |$)|massage|wellness|day spa",i]["shop"]`, `nwr["name"~"(^| )spa( |$)|wellness",i]["leisure"]`],
  beach: [`nwr["natural"="beach"]["name"]`, `nwr["leisure"="beach_resort"]["name"]`],
  outdoors: [`nwr["leisure"~"^(park|nature_reserve|garden)$"]["name"]`, `nwr["boundary"~"^(national_park|protected_area)$"]["name"]`, `nwr["tourism"~"^(viewpoint|picnic_site)$"]["name"]`, `nwr["highway"="footway"]["name"~"trail|greenway|riverwalk",i]`],
  museums: [`nwr["tourism"~"^(museum|gallery)$"]["name"]`, `nwr["historic"~"^(monument|castle|fort|ship|aircraft|battlefield|ruins|museum|locomotive)$"]["name"]`],
  zoo: [`nwr["tourism"~"^(zoo|aquarium)$"]["name"]`, `nwr["zoo"]["name"]`],
  shopping: [`nwr["shop"~"^(mall|department_store|books|antiques|gift|outdoor)$"]["name"]`, `nwr["amenity"="marketplace"]["name"]`],
  fitness: [`nwr["leisure"~"^(fitness_centre|sports_centre|climbing|swimming_pool)$"]["name"]["access"!~"private|customers"]`, `nwr["sport"~"climbing|yoga|crossfit"]["name"]`],
  fun: [`nwr["leisure"~"^(bowling_alley|amusement_arcade|escape_game|miniature_golf|trampoline_park|water_park|ice_rink)$"]["name"]`, `nwr["amenity"~"^(cinema|theatre|casino)$"]["name"]`, `nwr["tourism"="theme_park"]["name"]`],
  nightlife: [`nwr["amenity"~"^(nightclub|music_venue|bar|pub)$"]["name"]`, `nwr["craft"~"^(brewery|winery|distillery)$"]["name"]`],
  sights: [`nwr["tourism"~"^(attraction|viewpoint)$"]["name"]`, `nwr["man_made"="lighthouse"]["name"]`, `nwr["historic"~"^(monument|castle|fort|ship|lighthouse)$"]["name"]`],
};
const STAY = [`nwr["tourism"~"^(hotel|motel)$"]["name"]`];

export type CandidateSpec = { category: OsmCat; focus?: string };
function clausesFor(s: CandidateSpec): string[] {
  const f = s.focus || "";
  if (s.category === "stay") return STAY;
  if (s.category === "eat") {
    const c = CUISINE_Q[f];
    if (!c) return [EAT_AMENITY];
    return [`${EAT_AMENITY}["cuisine"~"${c.c}",i]`, `${EAT_AMENITY}["name"~"${c.n}",i]`, ...(c.extra || [])];
  }
  const act = f.startsWith("act:") ? ACT_Q[f.slice(4)] : null;
  return act || DO_ALL;
}

// ---------------------------------------------------------------- shaping
const KIND: Record<string, string> = {
  restaurant: "restaurant", cafe: "café", fast_food: "fast food", pub: "pub", bar: "bar", food_court: "food court", ice_cream: "ice cream", biergarten: "beer garden",
  museum: "museum", gallery: "gallery", zoo: "zoo", aquarium: "aquarium", theme_park: "theme park", attraction: "attraction", viewpoint: "viewpoint",
  park: "park", nature_reserve: "nature reserve", garden: "garden", golf_course: "golf course", miniature_golf: "mini golf", water_park: "water park", marina: "marina",
  spa: "spa", sauna: "sauna", fitness_centre: "gym", sports_centre: "sports center", bowling_alley: "bowling", amusement_arcade: "arcade", escape_game: "escape room",
  trampoline_park: "trampoline park", ice_rink: "ice rink", theatre: "theater", cinema: "cinema", arts_centre: "arts center", casino: "casino", nightclub: "nightclub",
  planetarium: "planetarium", music_venue: "music venue", public_bath: "bathhouse", marketplace: "market", brewery: "brewery", winery: "winery", distillery: "distillery",
  beach: "beach", lighthouse: "lighthouse", mall: "mall", department_store: "department store", hotel: "hotel", motel: "motel", massage: "massage", beauty: "spa / beauty",
  bakery: "bakery", pastry: "pastry shop", confectionery: "sweets", books: "bookstore", antiques: "antiques", gift: "gift shop", outdoor: "outdoor store",
  monument: "monument", castle: "castle", fort: "fort", ship: "historic ship", aircraft: "historic aircraft", battlefield: "battlefield", ruins: "ruins",
  archaeological_site: "archaeological site", locomotive: "historic locomotive", fishing: "fishing", slipway: "boat ramp", climbing: "climbing", swimming_pool: "pool",
};
const pretty = (s: string) => s.split(";")[0].replace(/_/g, " ").trim();
function kindOf(t: Record<string, string>): string {
  const key = t.amenity || t.tourism || t.leisure || t.craft || t.shop || t.historic || t.natural || t.man_made || t.boundary || "";
  const base = KIND[key] || pretty(key) || "place";
  const cu = t.cuisine ? pretty(t.cuisine) : "";
  return cu && ["restaurant", "fast food", "café", "food court"].includes(base) ? `${cu.charAt(0).toUpperCase()}${cu.slice(1)} ${base}` : base;
}
const addressOf = (t: Record<string, string>) => {
  const street = [t["addr:housenumber"], t["addr:street"]].filter(Boolean).join(" ");
  const city = t["addr:city"] || t["addr:town"] || t["addr:village"] || "";
  return street ? [street, city, [t["addr:state"], t["addr:postcode"]].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
};
const SKIP = /\b(parking|car park|playground|dog park|cemetery|school|church|private|employees|crew lounge|terminal|gate [a-z]?\d)/i;
const AIRSIDE_MI = 0.35; // inside the terminal, usually behind security

const EAT_KEYS = /^(restaurant|cafe|fast_food|pub|bar|food_court|ice_cream|biergarten)$/;
function categoryOf(t: Record<string, string>, specs: CandidateSpec[]): OsmCat {
  if (specs.length === 1) return specs[0].category;
  if (/^(hotel|motel)$/.test(t.tourism || "")) return "stay";
  if (EAT_KEYS.test(t.amenity || "") || /^(bakery|pastry|confectionery)$/.test(t.shop || "")) return specs.some((x) => x.category === "eat") ? "eat" : "do";
  return "do";
}
const radiiFor = (s: CandidateSpec) => {
  const focused = !!s.focus && s.focus !== s.category;
  return s.category === "eat" ? (focused ? [12, 25] : [6, 12]) : s.category === "stay" ? [10, 20] : (focused ? [20, 35] : [15, 30]); // km: first pass, wider pass
};

/**
 * Named places near the field for each spec (category, optional type), best first, up to `want` each.
 * One Overpass query for everything (public servers allow only a couple of queries at a time), then one wider query for
 * any category that came back thin.
 */
export async function osmCandidates(ap: { lat: number; lon: number }, specs: CandidateSpec[], want: Partial<Record<OsmCat, number>>): Promise<Candidate[]> {
  const key = `${ap.lat.toFixed(3)},${ap.lon.toFixed(3)}|${specs.map((s) => `${s.category}:${s.focus || ""}`).join(",")}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.v;
  const v = await fetchCandidates(ap, specs, want);
  if (v.length) { cache.set(key, { at: Date.now(), v }); if (cache.size > 300) cache.delete(cache.keys().next().value!); }
  return v;
}
async function fetchCandidates(ap: { lat: number; lon: number }, specs: CandidateSpec[], want: Partial<Record<OsmCat, number>>): Promise<Candidate[]> {
  const run = async (list: CandidateSpec[], pass: 0 | 1) => {
    // gather each radius's named places once, then filter that set: far faster than one around() per clause
    const sets = list.map((s, i) => `nwr(around:${radiiFor(s)[pass] * 1000},${ap.lat.toFixed(5)},${ap.lon.toFixed(5)})["name"]->.s${i};`).join("");
    const body = list.flatMap((s, i) => clausesFor(s).map((c) => `${c.replace(/^nwr/, `nwr.s${i}`)};`)).join("");
    return shape(await overpass(`[out:json][timeout:25];${sets}(${body});out center tags 900;`), list);
  };
  const shape = (els: any[], list: CandidateSpec[]) => {
    const out: Candidate[] = [];
    for (const e of els) {
      const t = (e.tags || {}) as Record<string, string>;
      const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
      if (!t.name || lat == null || lng == null || SKIP.test(t.name) || t.access === "private" || t["disused:amenity"] || t.opening_hours === "closed") continue;
      const category = categoryOf(t, list);
      const spec = list.find((x) => x.category === category);
      if (!spec) continue;
      const focused = !!spec.focus && spec.focus !== category;
      if (t.beauty && category === "do" && !/spa|massage/i.test(t.beauty) && !/spa|massage|wellness/i.test(t.name)) continue;
      const miles = Math.round(milesBetween({ lat: ap.lat, lon: ap.lon }, { lat, lon: lng }) * 10) / 10;
      if (category !== "stay" && miles < AIRSIDE_MI) continue; // hotels can be on the field
      const website = t.website || t["contact:website"] || "";
      const brand = t.brand || "";
      let score = 10 - miles * (category === "eat" ? 0.9 : 0.35);
      if (t.wikidata || t.wikipedia) score += category === "eat" ? 2 : 4;
      if (website) score += 1;
      if (t.opening_hours) score += 0.7;
      if (t.cuisine) score += 0.4;
      if (addressOf(t)) score += 0.5;
      if (category === "eat" && brand && !focused) score -= 1.5; // locals first; chains still allowed
      if (category === "stay" && brand) score += 2; // rewards brands
      if (category === "do" && t.leisure === "park" && !t.wikidata && !website) score -= 2.5; // tiny neighborhood parks
      if (t.historic === "memorial") score -= 3;
      out.push({ ref: `${e.type[0]}${e.id}`, category, name: t.name.slice(0, 120), lat, lng, miles, kind: kindOf(t), cuisine: t.cuisine ? pretty(t.cuisine) : "",
        address: addressOf(t), website: /^https?:\/\//.test(website) ? website : website ? `https://${website}` : "", hours: (t.opening_hours || "").slice(0, 80), brand,
        wiki: !!(t.wikidata || t.wikipedia), score, osmUrl: `https://www.openstreetmap.org/${e.type}/${e.id}` });
    }
    return out;
  };
  const best = (list: Candidate[], cat: OsmCat) => {
    const seen = new Set<string>();
    return list.filter((c) => c.category === cat).sort((a, b) => b.score - a.score)
      .filter((c) => { const k = c.name.toLowerCase().replace(/[^a-z0-9]/g, ""); if (seen.has(k)) return false; seen.add(k); return true; }) // a chain shows once
      .slice(0, want[cat] || 30);
  };
  let all = await run(specs, 0);
  const thin = specs.filter((s) => best(all, s.category).length < Math.min(want[s.category] || 30, 12));
  if (thin.length) { try { const wide = await run(thin, 1); all = [...all.filter((c) => !thin.some((s) => s.category === c.category)), ...wide]; } catch { /* keep the first pass */ } }
  return specs.flatMap((s) => best(all, s.category));
}

/** One plain sentence for a place before AI has looked at it. */
export const draftDescription = (c: Candidate) => {
  const k = c.kind.charAt(0).toUpperCase() + c.kind.slice(1);
  return `${k}, ${c.miles} mi from the field.${c.hours ? ` Listed hours: ${c.hours}.` : ""} From OpenStreetMap; check details before you go.`.slice(0, 300);
};
