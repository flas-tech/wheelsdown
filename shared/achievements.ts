// Earned profile badges. Cosmetic only: they never add points or change rankings.
// Each badge is a threshold on one stat computed from a member's live contributions (see storage.achievementStats).
export type AchStat =
  | "listings" | "firstAtAirport" | "airports" | "eat" | "do" | "stay" | "fbo"
  | "ratings" | "detailed" | "goArounds" | "favoritedByOthers" | "fiveStarFinds" | "briefings" | "followers";
export type Achievement = { id: string; name: string; desc: string; stat: AchStat; goal: number; icon: string; tone: "bronze" | "silver" | "gold" };

export const ACHIEVEMENTS: Achievement[] = [
  { id: "wheels_down", name: "Wheels Down", desc: "Added your first listing", stat: "listings", goal: 1, icon: "plane-landing", tone: "bronze" },
  { id: "pathfinder", name: "Pathfinder", desc: "First crew to list a spot at an airport", stat: "firstAtAirport", goal: 1, icon: "compass", tone: "silver" },
  { id: "route_builder", name: "Route Builder", desc: "Listings at 5 different airports", stat: "airports", goal: 5, icon: "route", tone: "silver" },
  { id: "globetrotter", name: "Globetrotter", desc: "Listings at 15 different airports", stat: "airports", goal: 15, icon: "globe", tone: "gold" },
  { id: "galley_chief", name: "Galley Chief", desc: "Listed 10 places to eat", stat: "eat", goal: 10, icon: "utensils", tone: "silver" },
  { id: "tour_guide", name: "Tour Guide", desc: "Listed 10 things to do", stat: "do", goal: 10, icon: "map", tone: "silver" },
  { id: "night_stop", name: "Night Stop Pro", desc: "Listed 5 places to stay", stat: "stay", goal: 5, icon: "bed", tone: "silver" },
  { id: "ramp_inspector", name: "Ramp Inspector", desc: "Listed 3 FBOs", stat: "fbo", goal: 3, icon: "clipboard-check", tone: "silver" },
  { id: "check_airman", name: "Check Airman", desc: "Rated 25 places", stat: "ratings", goal: 25, icon: "star", tone: "gold" },
  { id: "thorough_debrief", name: "Thorough Debrief", desc: "10 ratings with a real write-up (40+ characters)", stat: "detailed", goal: 10, icon: "message-square", tone: "silver" },
  { id: "safety_officer", name: "Safety Officer", desc: "Warned crews off 3 places with a go-around", stat: "goArounds", goal: 3, icon: "shield-alert", tone: "silver" },
  { id: "crowd_favorite", name: "Crowd Favorite", desc: "Your listings saved to favorites 10 times by other crews", stat: "favoritedByOthers", goal: 10, icon: "heart", tone: "gold" },
  { id: "five_star_find", name: "Five-Star Find", desc: "A listing of yours averages 4.5+ stars from 3 or more crews", stat: "fiveStarFinds", goal: 1, icon: "award", tone: "gold" },
  { id: "flight_planner", name: "Flight Planner", desc: "Built 5 trip briefings", stat: "briefings", goal: 5, icon: "clipboard-list", tone: "bronze" },
  { id: "crew_lead", name: "Crew Lead", desc: "10 crew members follow you", stat: "followers", goal: 10, icon: "users", tone: "gold" },
];
export type AchStats = Record<AchStat, number>;
export type AchProgress = { id: string; earned: boolean; value: number; goal: number };
export const achievementProgress = (s: AchStats): AchProgress[] =>
  ACHIEVEMENTS.map((a) => ({ id: a.id, earned: (s[a.stat] || 0) >= a.goal, value: Math.min(s[a.stat] || 0, a.goal), goal: a.goal }));
export const achievementById = (id: string) => ACHIEVEMENTS.find((a) => a.id === id);
