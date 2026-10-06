// Business autofill via Photon (OpenStreetMap data, https://photon.komoot.io). Server-side proxy with caching
// so the client never calls third parties directly (CSP stays 'self') and we stay well inside fair use.
const PHOTON = process.env.PHOTON_URL || "https://photon.komoot.io";
const UA = "Wheelsdown/1.0 (+https://getwheelsdown.com; hello@getwheelsdown.com)";

const TAGS: Record<string, string[]> = {
  eat: ["amenity:restaurant", "amenity:fast_food", "amenity:cafe", "amenity:bar", "amenity:pub", "amenity:food_court", "amenity:ice_cream", "shop:bakery"],
  stay: ["tourism:hotel", "tourism:motel", "tourism:guest_house", "tourism:hostel"],
  do: ["tourism:attraction", "tourism:museum", "tourism:viewpoint", "tourism:zoo", "tourism:theme_park", "tourism:gallery", "leisure:park",
    "leisure:golf_course", "leisure:fitness_centre", "leisure:sports_centre", "leisure:beach_resort", "leisure:nature_reserve", "natural:beach",
    "historic:monument", "historic:memorial", "amenity:theatre", "amenity:cinema", "shop:mall", "amenity:spa"],
  fbo: ["aeroway:terminal", "aeroway:aerodrome", "aeroway:hangar"],
};

export type PlaceHit = {
  ref: string; name: string; address: string; city: string; lat: number; lng: number; kind: string; website?: string;
};

const cache = new Map<string, { at: number; v: PlaceHit[] }>();
const TTL = 6 * 3600_000;
let last = 0;

async function photon(path: string): Promise<any> {
  // gentle pacing: never more than ~4 requests/second from this server
  const wait = Math.max(0, last + 250 - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(PHOTON + path, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error(`Photon ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

function toHit(f: any): PlaceHit | null {
  const p = f?.properties || {};
  const [lng, lat] = f?.geometry?.coordinates || [];
  if (!p.name || typeof lat !== "number") return null;
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const city = p.city || p.town || p.village || p.district || p.county || "";
  const address = [street, city, [p.state, p.postcode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return { ref: `osm:${p.osm_type || "N"}${p.osm_id}`, name: String(p.name).slice(0, 120), address: address.slice(0, 200), city, lat, lng, kind: String(p.osm_value || "").replace(/_/g, " ") };
}

function tagQuery(cat?: string) {
  return (TAGS[cat || ""] || []).map((t) => `&osm_tag=${encodeURIComponent(t)}`).join("");
}

async function cached(key: string, fn: () => Promise<PlaceHit[]>) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.v;
  const v = await fn();
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return v;
}

const dedupe = (hits: (PlaceHit | null)[]) => {
  const seen = new Set<string>();
  return hits.filter((h): h is PlaceHit => !!h && !seen.has(h.ref) && (seen.add(h.ref), true));
};

/** Type-ahead search near a point (airport or the user's location). Falls back to an unfiltered search if the category filter finds nothing. */
export async function searchPlaces(q: string, lat: number, lng: number, cat?: string): Promise<PlaceHit[]> {
  const query = q.trim().slice(0, 80);
  if (query.length < 2 || !Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const key = `s|${query.toLowerCase()}|${lat.toFixed(2)}|${lng.toFixed(2)}|${cat || ""}`;
  return cached(key, async () => {
    const d = 0.45; // ~30 miles box around the point
    const bbox = `&bbox=${(lng - d).toFixed(4)},${(lat - d).toFixed(4)},${(lng + d).toFixed(4)},${(lat + d).toFixed(4)}`;
    const base = `/api/?q=${encodeURIComponent(query)}&lat=${lat}&lon=${lng}&limit=8&lang=en${bbox}`;
    let j = await photon(base + tagQuery(cat));
    let hits = dedupe((j.features || []).map(toHit));
    if (hits.length < 3) {
      j = await photon(base);
      hits = dedupe([...hits, ...(j.features || []).map(toHit)]);
    }
    return hits.slice(0, 8);
  });
}

/** Businesses closest to a point, for "Use current location". */
export async function nearbyPlaces(lat: number, lng: number, cat?: string): Promise<PlaceHit[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
  const key = `n|${lat.toFixed(3)}|${lng.toFixed(3)}|${cat || ""}`;
  return cached(key, async () => {
    const j = await photon(`/reverse?lat=${lat}&lon=${lng}&radius=3&limit=12&lang=en${tagQuery(cat)}`);
    return dedupe((j.features || []).map(toHit)).slice(0, 12);
  });
}
