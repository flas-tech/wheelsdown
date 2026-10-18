// Plain-language release notes for the admin Change log. Newest first. Add an entry with each production release.
export type Release = { date: string; sha?: string; title: string; notes: string[] };

export const RELEASES: Release[] = [
  { date: "2026-10-17", title: "Launch: new home screen, My Crew, Crew Up, Crew Lounge open to members; delete your own rating (What's new 10)", notes: [
    "One launch switch (app_settings experience_audience, plus layover_audience and lounge_audience) flipped from Logbook > Home screen > Open to members, or PUT /api/admin/launch. Turning it off puts every member back on the classic app instantly, without a deploy; nothing they posted is lost.",
    "Home screen (/start): signed-in members land there once per visit; guests keep Search. Tiles: Plan layover, Find spots, Crew lounge, Crew Up, My Crew, Rate a spot, Leaderboard, Logbook, plus Use the classic app.",
    "My Crew (/mycrew): mutual crew requests (Accept / quiet Decline), Find by name, @handle or home base (anonymous members only by exact handle), invite link ?ref=ID&crew=1 that leaves a pending request for the new member, Privacy: share check-ins (off by default), share favorites, accept requests. Crew requests and messages appear in Notifications. No points. New tables crew_links, crew_privacy, member_messages.",
    "Crew meetup renamed Crew Up and made crew-only: you see plans only from people in your crew (any airport), and can join only theirs. Invite other crew card on the Crew Up tab.",
    "Ratings: authors can delete their own rating; the server now refuses a second rating of the same place by the same member (409, edit instead). Fixes feedback #38 (Gabrielle's duplicate Eldr+Rime rating #271 removed). Admin feedback: Reply in app sends a message to the member's Notifications and marks it Done.",
    "Rollback point: git tag rollback-pre-mycrew-2f2e5ac (Render deploy dep-db8o86rl550s73ek0cag). The new tables are additive, so the old version runs fine against the new database.",
  ] },
  { date: "2026-10-15", title: "Admin landing page is now a tile grid (admins only)", notes: [
    "/start shows 8 tiles in 2 columns: Plan layover, Find spots, Crew lounge, Crew meetup, Rate a spot, Leaderboard, Logbook, Classic app. Each opens its page and sets the matching tailored nav.",
  ] },
  { date: "2026-10-15", title: "Version 0: Layover Today, Crew meetup, Rate a spot (admins only, not in What's new)", notes: [
    "Layover Today (/today, first tab in Plan a layover): the field you checked in at (or your latest briefing stop), local time, METAR from aviationweather.gov with flight category, sunrise and sunset, your briefing picks there, top crew picks, your favorites, and links to Meetup and Rate.",
    "Crew meetup (/meetup, in Crew Lounge): opt-in 'I'm at KXXX' for 2 to 24 hours with a short note and an optional public meeting place. You see other crews only after posting at the same field. I'm in, End it, Report (lands in the Change log). Blocks tail numbers, room numbers and hotel names; hotels can't be picked as meeting places. Check-in not required yet so admins can test (MEETUP_RULES.requireCheckin).",
    "Rate a spot (/rate, in Plan a layover and Find spots): unrated places from your check-ins, visit reminders, briefings and favorites, plus find any listing by airport.",
    "Server-gated: every /api/preview route answers 404 to anyone but super-user accounts until app_settings layover_audience = members. New tables meetups and meetup_joins only. No points, no ranking changes.",
  ] },
  { date: "2026-10-15", title: "Landing page preview (admins only, not in What's new)", notes: [
    "New landing page at /start with no navigation bar: Plan a layover, Find spots or Crew Lounge. Open it from the Admin preview card in the Logbook.",
    "After choosing, the bottom bar is tailored: Plan (Briefings, New brief, Favorites, Logbook, Switch), Spots (Search, Add spot, Favorites, Logbook, Switch), Lounge (Lounge, Crew, Logbook, Switch).",
    "Crew Lounge also has its own page at /lounge for admins. Members get Not found there and are sent to Search from /start.",
    "Members keep the classic six-item nav. The choice is saved on the device only; no data, points or rankings change.",
  ] },
  { date: "2026-10-15", title: "Crew Lounge, Phase 0 (admins only, not in What's new)", notes: [
    "Admin console: Crew Lounge tab for super-user accounts. Members get a 404 from every /api/lounge route until app_settings lounge_audience is set to members.",
    "Categories: Airport Ops, Gear & Gadgets, Layover Life, Wheelsdown App, Hangar Talk. Threads, replies, airport tags, search, sort, anonymous posting (admins still see the author).",
    "Tail numbers from any country are flagged while typing and refused by the server (N-numbers, dashed foreign registrations, spelled-out and phonetic tries).",
    "Points only from Helpful votes by other members (2 each). They join the status ladder only once the lounge opens to members, so leaderboards don't move now.",
    "Moderation: pin, lock, hide/restore, delete, member reports queue; actions land in the Change log. 15 starter threads under the Wheelsdown crew house name.",
  ] },
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
