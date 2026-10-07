// Profile aircraft: a crew member's chosen icon, smallest to largest. Cosmetic only (no points).
export const AIRCRAFT = [
  { id: "sep", label: "Single piston", example: "Cessna 172, SR22" },
  { id: "mep", label: "Twin piston", example: "Baron, Seneca" },
  { id: "setp", label: "Single turboprop", example: "PC-12, TBM" },
  { id: "metp", label: "Twin turboprop", example: "King Air, Dash 8" },
  { id: "light_jet", label: "Light jet", example: "Citation CJ, Phenom 300" },
  { id: "midsize_jet", label: "Midsize jet", example: "Challenger 350, Praetor" },
  { id: "large_jet", label: "Large-cabin jet", example: "Gulfstream G650, Global" },
  { id: "airliner", label: "Commercial jet", example: "737, A320" },
  { id: "widebody", label: "Widebody", example: "787, 777, A350" },
] as const;
export type AircraftId = (typeof AIRCRAFT)[number]["id"];
export const AIRCRAFT_IDS = AIRCRAFT.map((a) => a.id) as unknown as [AircraftId, ...AircraftId[]];
export const aircraftById = (id: string | null | undefined) => AIRCRAFT.find((a) => a.id === id);
