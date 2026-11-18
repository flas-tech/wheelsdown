// How close you have to be for a check-in to verify.
export const CHECKIN_RULES = {
  spotMiles: 0.35,          // within about a third of a mile of the listing's map pin
  unpinnedSlackMiles: 1.5,  // listings without a pin: anywhere within their distance from the field plus this
  airportMiles: 3,          // on or around the field
  maxAccuracyMiles: 1,      // a location fix rougher than this can't verify anything
};
/**
 * Past visits ("Logged later"): when a check-in can't verify (you've left, or no location), a member can log that they were at a
 * listing today or up to maxDaysBack days ago. Stored as an unverified check-in: private, no points, never counted in public visit
 * counts or anything that needs you to really be there (Crew Up, the field you're at, the family link).
 */
export const PAST_VISIT_RULES = {
  maxDaysBack: 7,
  dupWindowHours: 20,  // a visit within this long of another one at the same listing is the same visit
  perDay: 10,          // past visits a member can log in 24 hours
};
/** "Today", "Yesterday", "2 days ago" ... for the past-visit picker. */
export const pastVisitLabel = (daysAgo: number) => (daysAgo === 0 ? "Today" : daysAgo === 1 ? "Yesterday" : `${daysAgo} days ago`);
/** When a past visit is stored: now for today, otherwise the same time of day that many days back. */
export const pastVisitAt = (daysAgo: number, now = Date.now()) => now - Math.max(0, Math.min(PAST_VISIT_RULES.maxDaysBack, Math.floor(daysAgo))) * 86_400_000;
/** later: only past visits logged later at this place, no verified check-in. */
export type MapDot = { kind: "added" | "checkin" | "airport"; spotId: number | null; name: string; icao: string; category: string | null; lat: number; lng: number; later?: boolean };
export type CheckIn = { id: number; spotId: number | null; icao: string; lat: number; lng: number; createdAt: number; spotName: string | null; category: string | null; verified: boolean };
