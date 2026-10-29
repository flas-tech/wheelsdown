// Ramp check reports (FBO intel): crews flag where FAA or other federal inspectors are doing ramp checks, so the next
// crew in has their paperwork in order. Reports are anonymous to members, fade after 30 days, and never name people.
export const RAMP_AGENCIES = [
  { id: "faa", label: "FAA" },
  { id: "cbp", label: "CBP / Customs" },
  { id: "tsa", label: "TSA" },
  { id: "other", label: "Other federal" },
] as const;
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
