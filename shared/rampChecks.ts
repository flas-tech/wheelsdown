// Ramp check reports (FBO intel): crews flag where FAA, other federal or (abroad) local authorities are doing ramp checks, so the next
// crew in has their paperwork in order. Reports are anonymous to members, fade after 30 days, and never name people.
export const RAMP_AGENCIES = [
  { id: "faa", label: "FAA" },
  { id: "cbp", label: "CBP / Customs" },
  { id: "tsa", label: "TSA" },
  { id: "other", label: "Other federal" },
  { id: "caa", label: "Local aviation authority", short: "Local CAA" }, // abroad: SAFA / TCCA / AFAC ramp inspections and the like
  { id: "customs", label: "Local customs / police", short: "Local customs" },
] as const;
export const RAMP_INTL_AGENCIES: readonly string[] = ["caa", "customs"];
export type RampAgency = (typeof RAMP_AGENCIES)[number]["id"];
export const RAMP_WHEN = [
  { id: "now", label: "Right now", hoursAgo: 0 },
  { id: "today", label: "Earlier today", hoursAgo: 4 },
  { id: "yesterday", label: "Yesterday", hoursAgo: 24 },
  { id: "week", label: "This week", hoursAgo: 72 },
] as const;
export type RampWhen = (typeof RAMP_WHEN)[number]["id"];
export const RAMP_ACTIVE_HOURS = 48;   // "Active" badge
export const RAMP_SHOW_DAYS = 30;      // reports listed
export const RAMP_HOT_DAYS = 90;       // hot spot window
export const RAMP_HOT_MIN = 3;         // reports in that window to call a field a hot spot
export type RampReport = { id: number; agency: RampAgency; seenAt: number; where: string; note: string; confirms: number; mine: boolean; confirmed: boolean; by?: string };
export type RampAirport = { icao: string; active: boolean; hot: boolean; recent: number; last: number | null; reports: RampReport[] };
/** What to have ready (FAA ramp inspections look at the pilot and aircraft documents). */
export const RAMP_READY = [
  "Pilot certificate, current medical and government photo ID",
  "Airworthiness and registration certificates displayed or on board",
  "Flight manual / operating limitations and current weight and balance",
  "Radio station license and passports if you're flying international",
  "For 135 / 91K: the company's ops specs, manuals and training records as required",
];
export type RampMapField = { icao: string; name: string; city: string; country: string; lat: number; lon: number; reports: number; last: number; active: boolean; hot: boolean; agencies: Record<string, number> };
export const RAMP_MAP_DAYS = [7, 30, 90, 365] as const;
