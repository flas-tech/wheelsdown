// Layover tools (Oct 2026, admins first behind app_settings layover_tools_audience):
//  - crew hotel sheet: one-tap shuttle call, van notes and amenity chips that crews confirm
//  - TAF and a 10-day forecast on Layover today
//  - abroad card: local emergency numbers, US embassy directory, State Department advisories
//  - FAA NAS status (ground stops, ground delay programs, delays, closures) with push alerts for trip sheet airports

export const HOTEL_AMENITIES = [
  { id: "shuttle", label: "Airport shuttle" },
  { id: "shuttle24", label: "24-hour shuttle" },
  { id: "breakfast", label: "Free breakfast" },
  { id: "food", label: "Late food on site" },
  { id: "walk", label: "Food in walking distance" },
  { id: "gym", label: "Gym" },
  { id: "pool", label: "Pool" },
  { id: "laundry", label: "Guest laundry" },
  { id: "dark", label: "Blackout curtains" },
  { id: "quiet", label: "Quiet rooms" },
  { id: "fridge", label: "Fridge and microwave" },
  { id: "lateout", label: "Late checkout for crew" },
] as const;
export type HotelAmenityId = (typeof HOTEL_AMENITIES)[number]["id"];
export type HotelSheet = {
  spotId: number;
  shuttlePhone: string | null;
  shuttleNote: string | null;
  /** yes = crews say it has it, no = crews say it doesn't; amenities nobody has answered are left out */
  amenities: Partial<Record<HotelAmenityId, "yes" | "no">>;
  /** last time any crew added or confirmed something, and how many different crews have */
  confirmedAt: number | null;
  crews: number;
};
export const PHONE_RE = /^\+?[0-9 ().\-]{7,24}$/;
export const telHref = (p: string) => "tel:" + p.replace(/[^0-9+]/g, "");

export type NasEvent = {
  /** FAA LID as published (SAN), and the ICAO we matched (KSAN) */
  arpt: string; icao: string;
  kind: "ground_stop" | "gdp" | "delay" | "closure" | "other";
  title: string; detail: string; reason: string;
};
export type ForecastDay = { date: string; hiF: number; loF: number; hiC: number; loC: number; code: number; pop: number | null };
export type Abroad = {
  country: string; countryName: string;
  police: string | null; fire: string | null; ambulance: string | null; note: string | null;
};
export type LayoverToolsResp = {
  on: boolean; icao: string;
  nas: NasEvent[]; nasUpdated: number | null;
  taf: { raw: string; issued: string | null } | null;
  forecast: ForecastDay[] | null;
  abroad: Abroad | null;
};

/** WMO weather codes (Open-Meteo) to short words. */
export function wxWord(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code === 85 || code === 86) return "Snow showers";
  if (code >= 95) return "Thunderstorms";
  return "Mixed";
}

/** US and its territories: no abroad card. */
export const US_LIKE = new Set(["US", "PR", "VI", "GU", "AS", "MP", "UM"]);

/**
 * Emergency numbers (police / fire / ambulance) for countries crews commonly fly to. Countries not listed show
 * "ask your hotel or FBO" rather than a guess. Keep this conservative: only numbers we are sure of.
 */
const E112 = { police: "112", fire: "112", ambulance: "112" };
export const EMERGENCY: Record<string, { name: string; police: string; fire: string; ambulance: string; note?: string }> = {
  CA: { name: "Canada", police: "911", fire: "911", ambulance: "911" },
  MX: { name: "Mexico", police: "911", fire: "911", ambulance: "911" },
  BS: { name: "Bahamas", police: "911", fire: "911", ambulance: "911", note: "919 also reaches police." },
  KY: { name: "Cayman Islands", police: "911", fire: "911", ambulance: "911" },
  BM: { name: "Bermuda", police: "911", fire: "911", ambulance: "911" },
  TC: { name: "Turks and Caicos", police: "911", fire: "911", ambulance: "911" },
  DO: { name: "Dominican Republic", police: "911", fire: "911", ambulance: "911" },
  AW: { name: "Aruba", police: "911", fire: "911", ambulance: "911" },
  CW: { name: "Curaçao", police: "911", fire: "911", ambulance: "911" },
  SX: { name: "Sint Maarten", police: "911", fire: "911", ambulance: "911" },
  JM: { name: "Jamaica", police: "119", fire: "110", ambulance: "110" },
  BB: { name: "Barbados", police: "211", fire: "311", ambulance: "511" },
  TT: { name: "Trinidad and Tobago", police: "999", fire: "990", ambulance: "811" },
  CR: { name: "Costa Rica", police: "911", fire: "911", ambulance: "911" },
  PA: { name: "Panama", police: "911", fire: "911", ambulance: "911" },
  BZ: { name: "Belize", police: "911", fire: "911", ambulance: "911" },
  HN: { name: "Honduras", police: "911", fire: "911", ambulance: "911" },
  SV: { name: "El Salvador", police: "911", fire: "911", ambulance: "911" },
  AR: { name: "Argentina", police: "911", fire: "100", ambulance: "107" },
  BR: { name: "Brazil", police: "190", fire: "193", ambulance: "192" },
  CL: { name: "Chile", police: "133", fire: "132", ambulance: "131" },
  CO: { name: "Colombia", police: "123", fire: "123", ambulance: "123" },
  GB: { name: "United Kingdom", police: "999", fire: "999", ambulance: "999", note: "112 also works." },
  IE: { name: "Ireland", police: "112", fire: "112", ambulance: "112", note: "999 also works." },
  FR: { name: "France", ...E112, note: "17 police, 18 fire, 15 medical also work." },
  DE: { name: "Germany", police: "110", fire: "112", ambulance: "112" },
  IT: { name: "Italy", ...E112 },
  ES: { name: "Spain", ...E112 },
  PT: { name: "Portugal", ...E112 },
  NL: { name: "Netherlands", ...E112 },
  BE: { name: "Belgium", ...E112 },
  LU: { name: "Luxembourg", ...E112 },
  CH: { name: "Switzerland", police: "117", fire: "118", ambulance: "144", note: "112 also works." },
  AT: { name: "Austria", ...E112 },
  DK: { name: "Denmark", ...E112 },
  SE: { name: "Sweden", ...E112 },
  NO: { name: "Norway", police: "112", fire: "110", ambulance: "113" },
  FI: { name: "Finland", ...E112 },
  IS: { name: "Iceland", ...E112 },
  GR: { name: "Greece", ...E112 },
  CZ: { name: "Czechia", ...E112 },
  PL: { name: "Poland", ...E112 },
  HR: { name: "Croatia", ...E112 },
  MT: { name: "Malta", ...E112 },
  CY: { name: "Cyprus", ...E112 },
  HU: { name: "Hungary", ...E112 },
  RO: { name: "Romania", ...E112 },
  TR: { name: "Türkiye", ...E112 },
  AE: { name: "United Arab Emirates", police: "999", fire: "997", ambulance: "998" },
  QA: { name: "Qatar", police: "999", fire: "999", ambulance: "999" },
  SA: { name: "Saudi Arabia", police: "911", fire: "911", ambulance: "911" },
  IL: { name: "Israel", police: "100", fire: "102", ambulance: "101" },
  IN: { name: "India", ...E112 },
  JP: { name: "Japan", police: "110", fire: "119", ambulance: "119" },
  KR: { name: "South Korea", police: "112", fire: "119", ambulance: "119" },
  CN: { name: "China", police: "110", fire: "119", ambulance: "120" },
  HK: { name: "Hong Kong", police: "999", fire: "999", ambulance: "999" },
  SG: { name: "Singapore", police: "999", fire: "995", ambulance: "995" },
  AU: { name: "Australia", police: "000", fire: "000", ambulance: "000", note: "112 works from mobile phones." },
  NZ: { name: "New Zealand", police: "111", fire: "111", ambulance: "111" },
  ZA: { name: "South Africa", police: "10111", fire: "10177", ambulance: "10177", note: "112 works from mobile phones." },
};
export const EMBASSY_URL = "https://www.usembassy.gov/";
export const ADVISORY_URL = "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html";
export const STEP_URL = "https://step.state.gov/";
