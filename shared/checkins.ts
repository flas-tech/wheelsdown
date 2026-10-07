// How close you have to be for a check-in to verify.
export const CHECKIN_RULES = {
  spotMiles: 0.35,          // within about a third of a mile of the listing's map pin
  unpinnedSlackMiles: 1.5,  // listings without a pin: anywhere within their distance from the field plus this
  airportMiles: 3,          // on or around the field
  maxAccuracyMiles: 1,      // a location fix rougher than this can't verify anything
};
export type MapDot = { kind: "added" | "checkin" | "airport"; spotId: number | null; name: string; icao: string; category: string | null; lat: number; lng: number };
export type CheckIn = { id: number; spotId: number | null; icao: string; lat: number; lng: number; createdAt: number; spotName: string | null; category: string | null };
