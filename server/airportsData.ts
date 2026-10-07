// Worldwide airport reference (OurAirports, public domain).
// Row: [code, iata, name, city, region, country, lat, lon, size(0-3), aliases "A|B"].
// code is the ICAO code when one exists (KOPF), otherwise the FAA identifier (X51, F45, 06FA, 1B9).
import raw from "./data/airports.json";
import { milesBetween } from "@shared/cost";

type Row = [string, string, string, string, string, string, number, number, number, string];
const ROWS = raw as unknown as Row[];
const byCode = new Map<string, Row>();
const byIata = new Map<string, Row>();
const byAlias = new Map<string, Row>();
for (const r of ROWS) {
  byCode.set(r[0], r);
  if (r[1] && (!byIata.has(r[1]) || r[8] > byIata.get(r[1])![8])) byIata.set(r[1], r);
}
for (const r of ROWS) for (const a of (r[9] || "").split("|")) if (a && !byCode.has(a) && (!byAlias.has(a) || r[8] > byAlias.get(a)![8])) byAlias.set(a, r);

export type RefAirport = { icao: string; iata: string; name: string; city: string; region: string; country: string; lat: number; lon: number; size: number; aliases: string[] };
const toObj = (r: Row): RefAirport => ({ icao: r[0], iata: r[1], name: r[2], city: r[3], region: r[4], country: r[5], lat: r[6], lon: r[7], size: r[8], aliases: (r[9] || "").split("|").filter(Boolean) });

/** Airport codes are 3-4 letters or digits: KOPF, OPF, X51, 06FA, 1B9. */
export const isCode = (c: string) => /^[A-Z0-9]{3,4}$/.test(c);

/**
 * Resolve what a pilot types. Order: exact code, IATA (3 letters), alias (FAA id / GPS code / ident),
 * then K + 3 letters for US fields. "X51" and "KX51" both reach Miami Homestead.
 */
export function refAirport(code: string): RefAirport | undefined {
  const c = code.trim().toUpperCase();
  if (!isCode(c)) return undefined;
  const r = byCode.get(c) || (/^[A-Z]{3}$/.test(c) ? byIata.get(c) : undefined) || byAlias.get(c) || (c.length === 3 ? byCode.get("K" + c) : undefined);
  return r ? toObj(r) : undefined;
}
/** Closest airports to a point. Small strips are only returned if they are much closer than a public-use field. */
export function nearestAirports(lat: number, lon: number, limit = 3): (RefAirport & { miles: number })[] {
  const scored: { r: Row; mi: number }[] = [];
  for (const r of ROWS) {
    if (r[8] === 0) continue; // seaplane bases only when typed
    if (Math.abs(r[6] - lat) > 1.5 || Math.abs(r[7] - lon) > 2) continue;
    scored.push({ r, mi: milesBetween({ lat, lon }, { lat: r[6], lon: r[7] }) });
  }
  // prefer airports with an IATA code or medium/large size: penalize tiny private strips
  scored.sort((a, b) => (a.mi + (a.r[8] === 1 && !a.r[1] ? 4 : 0)) - (b.mi + (b.r[8] === 1 && !b.r[1] ? 4 : 0)));
  return scored.slice(0, limit).map(({ r, mi }) => ({ ...toObj(r), miles: Math.round(mi * 10) / 10 }));
}
export const airportCount = ROWS.length;
