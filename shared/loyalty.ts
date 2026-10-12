// Hotel rewards programs, worked out from the hotel's name (no stored field, so existing listings need no edits).
export type ProgramId = "hilton" | "marriott" | "ihg" | "hyatt" | "wyndham" | "choice" | "bestwestern";

export const PROGRAMS: { id: ProgramId; label: string; short: string; brands: string[] }[] = [
  { id: "hilton", label: "Hilton Honors", short: "Hilton", brands: ["hilton", "hampton inn", "hampton by hilton", "embassy suites", "doubletree", "double tree", "homewood suites", "home2 suites", "home2", "tru by hilton", "curio collection", "tapestry collection", "canopy by hilton", "conrad", "waldorf astoria", "lxr", "signia", "motto by hilton", "spark by hilton", "livsmart"] },
  { id: "marriott", label: "Marriott Bonvoy", short: "Marriott", brands: ["marriott", "courtyard", "residence inn", "fairfield inn", "fairfield by marriott", "springhill suites", "towneplace suites", "sheraton", "westin", "w hotel", "aloft", "element by westin", "four points", "renaissance", "ac hotel", "moxy", "ritz-carlton", "ritz carlton", "jw marriott", "le meridien", "le méridien", "delta hotels", "autograph collection", "tribute portfolio", "st. regis", "st regis", "edition hotel", "gaylord", "protea", "city express"] },
  { id: "ihg", label: "IHG One Rewards", short: "IHG", brands: ["holiday inn", "crowne plaza", "staybridge", "candlewood", "avid hotel", "kimpton", "intercontinental", "hotel indigo", "voco", "even hotel", "atwell suites", "garner", "regent", "six senses", "hualuxe"] },
  { id: "hyatt", label: "World of Hyatt", short: "Hyatt", brands: ["hyatt", "andaz", "thompson hotel", "alila", "caption by hyatt", "destination by hyatt", "joie de vivre", "miraval", "park hyatt", "grand hyatt"] },
  { id: "wyndham", label: "Wyndham Rewards", short: "Wyndham", brands: ["wyndham", "la quinta", "ramada", "days inn", "super 8", "microtel", "baymont", "wingate", "hawthorn suites", "travelodge", "howard johnson", "americinn", "trademark collection", "dazzler", "esplendor", "echo suites"] },
  { id: "choice", label: "Choice Privileges", short: "Choice", brands: ["comfort inn", "comfort suites", "quality inn", "quality suites", "sleep inn", "clarion", "cambria", "country inn & suites", "country inn and suites", "mainstay suites", "suburban studios", "econo lodge", "rodeway inn", "ascend collection", "everhome", "woodspring", "radisson"] },
  { id: "bestwestern", label: "Best Western Rewards", short: "Best Western", brands: ["best western", "surestay", "sure stay", "aiden by best western", "glo hotel", "vib hotel", "worldhotels"] },
];

const norm = (t: string) => ` ${t.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9&.\- ]+/g, " ").replace(/\s+/g, " ")} `;

/** The rewards program a hotel belongs to, or null for independents. Looks at the name first, then the description. */
export function programOf(s: { category?: string; name?: string | null; description?: string | null; website?: string | null }): ProgramId | null {
  if (s.category && s.category !== "stay") return null;
  const name = norm(s.name || "");
  const site = (s.website || "").toLowerCase();
  for (const p of PROGRAMS) if (p.brands.some((b) => name.includes(` ${b}`))) return p.id;
  // official brand websites are a reliable second signal
  const hosts: Record<string, ProgramId> = { "hilton.com": "hilton", "marriott.com": "marriott", "ihg.com": "ihg", "hyatt.com": "hyatt", "wyndhamhotels.com": "wyndham", "choicehotels.com": "choice", "bestwestern.com": "bestwestern", "radissonhotels": "choice" };
  for (const [h, id] of Object.entries(hosts)) if (site.includes(h)) return id;
  const desc = norm(s.description || "");
  for (const p of PROGRAMS) if (p.brands.some((b) => b.length > 6 && desc.includes(` ${b}`))) return p.id;
  return null;
}
export const programLabel = (id: ProgramId | null) => PROGRAMS.find((p) => p.id === id)?.label || "";
export const programShort = (id: ProgramId | null) => PROGRAMS.find((p) => p.id === id)?.short || "";
