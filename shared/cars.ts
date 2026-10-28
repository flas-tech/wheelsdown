// Rental cars (category "car"): what crews most need to know, kept as listing tags so search, cards and the PDF show them.
export const CAR_FEATURES = [
  { id: "Delivers to the FBO", short: "Delivers to FBO" },
  { id: "Counter at the FBO", short: "At the FBO" },
  { id: "Counter on the airport", short: "On airport" },
  { id: "Shuttle to the counter", short: "Shuttle" },
  { id: "After-hours key drop", short: "After-hours drop" },
  { id: "Crew or corporate rate", short: "Crew rate" },
  { id: "One-way OK", short: "One-way" },
] as const;
export const CAR_FEATURE_IDS: string[] = CAR_FEATURES.map((f) => f.id);
