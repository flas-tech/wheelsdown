// Profile aircraft: icons a crew member picks for their profile, smallest to largest, plus crew-role emblems. Cosmetic only (no points).
// Stored on the user as a comma-separated list; the first one is the avatar.
export const AIRCRAFT = [
  { id: "sep", label: "Single piston", example: "Cessna 172, SR22", kind: "fixed" },
  { id: "mep", label: "Twin piston", example: "Baron, Seneca", kind: "fixed" },
  { id: "setp", label: "Single turboprop", example: "PC-12, TBM", kind: "fixed" },
  { id: "metp", label: "Twin turboprop", example: "King Air, Dash 8", kind: "fixed" },
  { id: "light_jet", label: "Light jet", example: "Citation CJ, Phenom 300", kind: "fixed" },
  { id: "midsize_jet", label: "Midsize jet", example: "Challenger 350, Praetor", kind: "fixed" },
  { id: "large_jet", label: "Large-cabin jet", example: "Gulfstream G650, Global", kind: "fixed" },
  { id: "airliner", label: "Commercial jet", example: "737, A320", kind: "fixed" },
  { id: "widebody", label: "Widebody", example: "787, 777, A350", kind: "fixed" },
  { id: "heli_sp", label: "Piston helicopter", example: "R22, R44, Cabri", kind: "heli" },
  { id: "heli_st", label: "Single-turbine helicopter", example: "H125, Bell 407", kind: "heli" },
  { id: "heli_lt", label: "Light twin helicopter", example: "H135, H145", kind: "heli" },
  { id: "heli_mt", label: "Medium twin helicopter", example: "AW139, S-76", kind: "heli" },
  { id: "heli_ht", label: "Heavy multi-turbine helicopter", example: "S-92, AW189, AW101", kind: "heli" },
  // crew-role emblems, for people who keep the fleet flying rather than (or as well as) flying it
  { id: "role_mech", label: "Mechanic", example: "Crossed wrenches", kind: "role" },
  { id: "role_fa", label: "Flight attendant", example: "Cabin crew wings", kind: "role" },
  { id: "role_disp", label: "Dispatcher", example: "Headset", kind: "role" },
  { id: "role_sched", label: "Scheduler", example: "Trip calendar", kind: "role" },
] as const;
export type AircraftId = (typeof AIRCRAFT)[number]["id"];
export const AIRCRAFT_IDS = AIRCRAFT.map((a) => a.id) as unknown as [AircraftId, ...AircraftId[]];
export const MAX_AIRCRAFT = 6;
/** Every valid aircraft in a stored list, in the member's order, without duplicates. */
export const aircraftList = (v: string | null | undefined) => {
  const seen = new Set<string>();
  return String(v || "").split(",").map((s) => s.trim()).filter((s) => s && !seen.has(s) && seen.add(s))
    .map((id) => AIRCRAFT.find((a) => a.id === id)).filter((a): a is (typeof AIRCRAFT)[number] => !!a);
};
/** The avatar aircraft: the first one in the list (works for a single id too). */
export const aircraftById = (v: string | null | undefined) => aircraftList(v)[0];
/** True when every entry is a known aircraft, no repeats, and within the limit. */
export const validAircraftList = (v: string) => {
  if (v === "") return true;
  const parts = v.split(",").map((s) => s.trim());
  return parts.length <= MAX_AIRCRAFT && new Set(parts).size === parts.length && parts.every((p) => (AIRCRAFT_IDS as readonly string[]).includes(p));
};
