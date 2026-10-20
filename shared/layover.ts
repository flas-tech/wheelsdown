// Layover Today, Crew Up and Rate a spot (admins only until app_settings layover_audience = "members"; the launch switch sets it):
//  - Layover Today: one screen for the airport you're at (local time, METAR, sunrise/sunset, your briefing, crew picks).
//  - Crew Up (was "Crew meetup"): layover plans at the airport level, seen only by people in each other's My Crew.
//  - Rate a spot: places you've been (check-ins, briefings, favorites) that you haven't rated yet.

export const MEETUP_RULES = {
  noteMax: 200,
  hours: [2, 4, 8, 12, 24] as const,
  defaultHours: 12,
  /** Off: Crew Up is crew-only (both people agreed), so a check-in isn't needed to post. "Checked in" still shows when there is one. */
  requireCheckin: false,
  checkinWindowHours: 20,
  /** plans a member can have posted at once, now or coming up (feedback #49) */
  maxPlans: 6,
  /** how far ahead a plan can start */
  maxDaysAhead: 30,
};

/** Raw meetups row helpers, shared by the Crew Up and My Crew routes. viewer_ids is "1,2,3" (picked crew) or null (all crew). */
export const meetupViewers = (raw: unknown): number[] | null => {
  const v = String(raw ?? "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return raw == null || raw === "" || !v.length ? null : v;
};
export const meetupVisibleTo = (row: { viewer_ids?: unknown }, uid: number) => { const v = meetupViewers(row.viewer_ids); return !v || v.includes(uid); };
export const meetupStart = (row: { starts_at?: unknown; created_at?: unknown }) => Number(row.starts_at) || Number(row.created_at) || 0;

/** Notes stay at the airport level: no tail numbers, no room numbers, no hotel names. */
export const MEETUP_PRIVACY = "Keep it at the airport level. No hotel names, room numbers or tail numbers. You can end it any time, and it ends by itself.";

const ROOM = /\b(room|rm|suite|ste)\.?\s*#?\s*\d{1,5}\b/i;
const HOTEL = /\b(hotel|inn|marriott|hilton|hyatt|sheraton|westin|courtyard|hampton|holiday inn|doubletree|embassy suites|residence inn|fairfield|springhill|homewood|aloft|kimpton|ihg|wyndham|best western|radisson|motel|lodge|resort)\b/i;
/** Plain-language reason when a note says where someone is sleeping. */
export function meetupNoteProblem(note: string): string | null {
  if (ROOM.test(note)) return "Leave room numbers out. Meet somewhere public instead.";
  if (HOTEL.test(note)) return "Leave your hotel out. Suggest a public place to meet instead, like a restaurant or the FBO.";
  return null;
}

export type FlightCat = "VFR" | "MVFR" | "IFR" | "LIFR";
export type Metar = {
  station: string; stationMiles: number; raw: string; observedAt: number; flightCat: FlightCat | null;
  tempC: number | null; dewC: number | null; windDir: number | "VRB" | null; windKt: number | null; gustKt: number | null;
  visibility: string | null; ceilingFt: number | null; clouds: string; wx: string;
};

export type TodayPick = { id: number; name: string; category: string; milesFromField: number; avgRating: number | null; reviewCount: number; rated: boolean; icao?: string; address?: string | null; lat?: number | null; lng?: number | null; /** an AI pick in the briefing (negative id, no listing page yet) */ ai?: boolean };
export type TodayResp = {
  icao: string | null; source: "query" | "checkin" | "briefing" | null; checkedInAt: number | null;
  airport: { icao: string; name: string; city: string; region: string; country: string; lat: number; lon: number } | null;
  tz: string | null; sun: { rise: number | null; set: number | null; nextRise: number | null } | null;
  metar: Metar | null; metarError: boolean;
  briefing: { id: number; title: string; layover: string; nights: number | null; picks: TodayPick[] } | null;
  crewPicks: { eat: TodayPick[]; do: TodayPick[] };
  favorites: TodayPick[];
  meetup: { mine: boolean; others: number | null };
  toRate: number;
  recent: string[]; // airports from recent check-ins and briefings, for quick switching
};

export type MeetupPerson = { id: number; name: string; crewRole: string; aircraft: string; tierId: string; verified: boolean };
export type Meetup = {
  id: number; icao: string; note: string; spot: { id: number; name: string; category: string } | null;
  createdAt: number; expiresAt: number; host: MeetupPerson; mine: boolean; joined: boolean; joins: number; attendees: MeetupPerson[];
  /** when the plan starts (now-plans: when posted); times show in the airport's zone */
  startsAt: number; tz: string | null;
  /** the host only: who can see it (null = all of their crew) */
  viewers?: MeetupPerson[] | null;
};
export type MeetupResp = { icao: string | null; tz: string | null; mine: Meetup[]; others: Meetup[] | null; crewElsewhere: Meetup[]; crewCount: number; myAirports: string[]; requireCheckin: boolean; verifiedHere: boolean };

export type RateItem = { id: number; name: string; icao: string; category: string; avgRating: number | null; reviewCount: number; reason: "checkin" | "visit" | "briefing" | "favorite"; detail: string; at: number };
