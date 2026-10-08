/** Name/pin likeness used to catch duplicate listings while someone types (server and demo share it). */
import { milesBetween } from "./cost";

const STOP = new Set(["the", "and", "restaurant", "bar", "grill", "cafe", "hotel", "inn", "of", "at", "co", "company", "kitchen", "house"]);
const words = (x: string) => x.toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w.length > 1 && !STOP.has(w));
export const squash = (x: string) => words(x).join("");

/** How alike two listing names (and pins) are, 0..1. */
export function similarity(a: { name: string; lat?: number | null; lng?: number | null; placeRef?: string | null }, b: { name: string; lat: number | null; lng: number | null; placeRef?: string | null }) {
  if (a.placeRef && b.placeRef && a.placeRef === b.placeRef) return 1;
  const A = words(a.name), B = words(b.name);
  if (!A.length || !B.length) return 0;
  const sa = squash(a.name), sb = squash(b.name);
  let s = 0;
  if (sa === sb) s = 1;
  else if (Math.min(sa.length, sb.length) >= 4 && (sa.startsWith(sb) || sb.startsWith(sa))) s = 0.85; // "Half Shell" vs "Half Shell Oyster House"
  else {
    const setB = new Set(B);
    // a word counts if it matches, or one is a 4+ letter prefix of the other (people type "Vers" before "Versailles")
    const hit = A.filter((w) => setB.has(w) || B.some((v) => Math.min(w.length, v.length) >= 4 && (v.startsWith(w) || w.startsWith(v)))).length;
    s = hit / Math.max(A.length, B.length);
  }
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null && milesBetween({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }) < 0.05) s = Math.min(1, s + 0.25);
  return s;
}

