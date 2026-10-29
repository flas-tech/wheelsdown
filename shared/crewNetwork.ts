// Crew network (Oct 2026, admins first behind crew_network_audience): overlap alerts with My Crew, trip crew chat,
// and a read-only family link ("where I am tonight").
export type Overlap = { personId: number; name: string; icao: string; city: string; from: string; to: string };
export type CrewNetworkMe = { on: boolean; overlaps: boolean; family: { on: boolean; showHotel: boolean; url: string | null } };
export type FamilyStop = { icao: string; name: string; city: string; country: string; tz: string | null; from: string; to: string; hotel: string | null };
export type FamilyView = { name: string; now: FamilyStop | null; next: FamilyStop[]; checkedInAt: number | null; updatedAt: number };
export const TRIP_CHAT = { maxPeople: 12, keepDaysAfter: 3, defaultDays: 14 } as const;
/** Nights a trip sheet stop lasts, from its layover length. */
export const stopNights = (layover: string, nights?: number | null) => (layover === "multi" ? Math.max(2, nights || 2) : layover === "overnight" ? 1 : 0);
export function addDays(d: string, n: number) { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
