/** Expertise badges crew can pick for their profile (up to MAX_INTERESTS). Fixed list, so nothing free-form needs moderating. */
export const INTEREST_GROUPS = [
  { group: "Eat & drink", items: [
    ["pizza", "Pizza expert"], ["bbq", "BBQ expert"], ["sushi", "Sushi expert"], ["burgers", "Burger expert"], ["tacos", "Taco expert"],
    ["steak", "Steakhouse expert"], ["seafood", "Seafood expert"], ["coffee", "Coffee expert"], ["brunch", "Brunch expert"], ["dessert", "Dessert expert"],
    ["street_food", "Street food expert"], ["fine_dining", "Fine dining expert"], ["plant_based", "Plant-based expert"], ["healthy", "Healthy eats expert"],
    ["craft_beer", "Craft beer expert"], ["wine", "Wine expert"], ["cocktails", "Cocktail expert"], ["late_night", "Late-night eats expert"],
  ] },
  { group: "Things to do", items: [
    ["hiking", "Hiker"], ["running", "Runner"], ["gym", "Gym regular"], ["golf", "Golfer"], ["beaches", "Beach finder"], ["museums", "Museum goer"],
    ["history", "History buff"], ["aviation_history", "Aviation history buff"], ["live_music", "Live music fan"], ["nightlife", "Nightlife guide"],
    ["shopping", "Shopper"], ["theme_parks", "Theme park fan"], ["spa", "Spa and wellness"], ["photography", "Photographer"], ["sports", "Sports fan"], ["budget", "Budget layover pro"],
  ] },
] as const;
export const MAX_INTERESTS = 5;
export const BIO_MAX = 160;
export const INTERESTS: Record<string, string> = Object.fromEntries(INTEREST_GROUPS.flatMap((g) => g.items.map(([id, label]) => [id, label])));
export const INTEREST_IDS = Object.keys(INTERESTS);
export const parseInterests = (raw: string | null | undefined): string[] => {
  try { const a = JSON.parse(raw || "[]"); return Array.isArray(a) ? a.filter((x) => typeof x === "string" && x in INTERESTS).slice(0, MAX_INTERESTS) : []; } catch { return []; }
};
