// Plain-language release notes for the admin Change log. Newest first. Add an entry with each production release.
export type Release = { date: string; sha?: string; title: string; notes: string[] };

export const RELEASES: Release[] = [
  { date: "2026-10-12", title: "Admin error log, change log and feedback #18 / #19", notes: [
    "Admin: new Overview, Errors (filter by source, level, status, date and text; resolve or reopen) and Change log (every admin change, moderation decision, release and bonus, with filters and CSV).",
    "Admin: AI picks tab to review, hide and refresh AI picks per airport; feedback filters by type and text.",
    "Browser crashes and script errors now reach the error log, and a crashed page shows Reload instead of a blank screen.",
    "AI picks: choose a food type or Surprise me (what the area is known for) when finding more places.",
    "Logbook: My hotel programs. Hotels from your programs come first in AI picks, briefs and search.",
    "First to rate: +10 bonus points for the first crew member to rate a listing added from an AI pick.",
  ] },
  { date: "2026-10-12", sha: "6045177", title: "Pick more with AI", notes: [
    "Brief stops: add any other AI pick for the airport, or ask AI to find more places (added alongside, never replacing).",
    "AI picks always run a web search, which fixes empty results at some airports.",
  ] },
  { date: "2026-10-12", sha: "820b10e", title: "AI picks fixes", notes: [
    "AI picks work at airports that have no crew listings yet (from the reference airport list).",
    "Empty AI answers are retried; overnights get breakfast, lunch, dinner, two things to do and one hotel.",
    "A failed AI run shows Try again instead of nothing.",
  ] },
  { date: "2026-10-12", sha: "530debf", title: "AI picks are opt-in", notes: [
    "Pick with AI per brief stop and in search; Prefer crew (default) or Prefer AI setting in the Logbook.",
  ] },
  { date: "2026-10-12", sha: "b8ad8cf", title: "AI picks, rewards filter, FBO fix, simpler landing page", notes: [
    "AI picks fill brief gaps for meals, things to do and hotels, tagged AI pick or Crew pick.",
    "Hotel rewards filter (Hilton, Marriott, IHG, Hyatt, Wyndham, Choice, Best Western).",
    "FBO search stays on the field (Signature Bedford fix).",
  ] },
  { date: "2026-10-09", sha: "525bee6", title: "Follower notifications", notes: ["Logbook > Notifications for new followers, with Follow back and an unread badge."] },
  { date: "2026-10-08", sha: "2dad1e6", title: "Map view", notes: ["List | Map under Search with OpenStreetMap pins, clusters, route and filters.", "Duplicate check while adding a spot, welcome tour and profile checklist."] },
  { date: "2026-10-07", sha: "57c31e1", title: "Check-ins, food types, crew roles", notes: [
    "Verified check-ins and a profile map; food-type filter; crew-role icons.",
    "Status ladder: Private 40, Instrument 150, Commercial 250, Restricted ATP 750, ATP 1,500.",
    "Referral points (25 per sign-up), feedback inbox, profile badges, Wright Club (50 seats).",
  ] },
  { date: "2026-10-07", sha: "ef73b02", title: "AI autofill and moderation", notes: [
    "AI autofill for new spots and background AI moderation for listings, ratings, edits and names.",
    "Admin moderation console with decision log, overrides and undo; Costs and Advertisers reports.",
  ] },
  { date: "2026-10-06", sha: "2490137", title: "Production launch", notes: [
    "Postgres backend on Render and Supabase, password reset, account deletion, legal pages and CI smoke tests.",
    "Crew accounts, status tiers, leaderboard, vetting votes, trip briefings with maps and PDF.",
  ] },
];
