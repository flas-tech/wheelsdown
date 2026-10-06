// Worldwide airport reference (OurAirports, public domain): ICAO, IATA, name, city, region, country, lat, lon, size(1-3).
import raw from "./data/airports.json";
import { milesBetween } from "@shared/cost";

type Row = [string, string, string, string, string, string, number, number, number];
const ROWS = raw as unknown as Row[];
const byIcao = new Map<string, Row>();
const byIata = new Map<string, Row>();
for (const r of ROWS) {
  byIcao.set(r[0], r);
  if (r[1] && (!byIata.has(r[1]) || r[8] > byIata.get(r[1])![8])) byIata.set(r[1], r);
}
export type RefAirport = { icao: string; iata: string; name: string; city: string; region: string; country: string; lat: number; lon: number; size: number };
const toObj = (r: Row): RefAirport => ({ icao: r[0], iata: r[1], name: r[2], city: r[3], region: r[4], country: r[5], lat: r[6], lon: r[7], size: r[8] });

export function refAirport(code: string): RefAirport | undefined {
  const c = code.trim().toUpperCase();
  const r = c.length === 4 ? byIcao.get(c) : c.length === 3 ? byIata.get(c) || byIcao.get("K" + c) : undefined;
  return r ? toObj(r) : undefined;
}
/** Closest airports to a point. Small strips are only returned if they are much closer than a public-use field. */
export function nearestAirports(lat: number, lon: number, limit = 3): (RefAirport & { miles: number })[] {
  const scored: { r: Row; mi: number }[] = [];
  for (const r of ROWS) {
    if (Math.abs(r[6] - lat) > 1.5 || Math.abs(r[7] - lon) > 2) continue;
    scored.push({ r, mi: milesBetween({ lat, lon }, { lat: r[6], lon: r[7] }) });
  }
  // prefer airports with an IATA code or medium/large size: penalize tiny private strips
  scored.sort((a, b) => (a.mi + (a.r[8] === 1 && !a.r[1] ? 4 : 0)) - (b.mi + (b.r[8] === 1 && !b.r[1] ? 4 : 0)));
  return scored.slice(0, limit).map(({ r, mi }) => ({ ...toObj(r), miles: Math.round(mi * 10) / 10 }));
}
export const airportCount = ROWS.length;
