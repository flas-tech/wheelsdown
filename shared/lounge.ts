// Crew Lounge: a discussion board for crews (airport ops, gear, layovers, the app, hangar talk).
// PHASE 0: admins only. Nothing about Crew Lounge goes in What's new, the FAQ or the welcome tour until it opens to members.
// Opening it later: set app_settings lounge_audience = "members" (see server/lounge.ts), then add one What's new entry.

export type LoungeCategoryId = "airport-ops" | "gear" | "layovers" | "app" | "hangar";
export const LOUNGE_CATEGORIES: { id: LoungeCategoryId; label: string; blurb: string }[] = [
  { id: "airport-ops", label: "Airport Ops", blurb: "FBOs, ramp, customs, curfews, fuel and PPRs" },
  { id: "gear", label: "Gear & Gadgets", blurb: "Headsets, EFBs, bags and new products" },
  { id: "layovers", label: "Layover Life", blurb: "City tips that don't fit a single listing" },
  { id: "app", label: "Wheelsdown App", blurb: "Questions, bugs and ideas for the app" },
  { id: "hangar", label: "Hangar Talk", blurb: "Everything else" },
];
export const isLoungeCategory = (c: unknown): c is LoungeCategoryId => LOUNGE_CATEGORIES.some((x) => x.id === c);
export const loungeCategoryLabel = (c: string) => LOUNGE_CATEGORIES.find((x) => x.id === c)?.label || c;

export const LOUNGE_LIMITS = { title: [6, 120], body: [1, 5000], reply: [1, 3000], airports: 3 } as const;
export const LOUNGE_REPORT_REASONS = ["Tail number or private info", "Spam or self-promotion", "Rude or harassing", "Unsafe or wrong", "Other"] as const;
/** Shown on Airport Ops threads. */
export const LOUNGE_OPS_DISCLAIMER = "Crew-reported, not official. Always check NOTAMs, the Chart Supplement and the FBO before you go.";
export const HOUSE_AUTHOR = "Wheelsdown crew";

export type LoungeAuthor = { id: number | null; name: string; crewRole: string; tierId: string | null; aircraft: string; anonymous: boolean; house: boolean; realName?: string };
export type LoungeThread = {
  id: number; category: LoungeCategoryId; title: string; body: string; airports: string[]; author: LoungeAuthor; mine: boolean;
  pinned: boolean; locked: boolean; status: "live" | "hidden" | "deleted"; replyCount: number; helpful: number; votedHelpful: boolean;
  createdAt: number; editedAt: number | null; lastActivityAt: number; openReports?: number;
};
export type LoungePost = { id: number; threadId: number; body: string; author: LoungeAuthor; mine: boolean; status: "live" | "hidden" | "deleted"; helpful: number; votedHelpful: boolean; createdAt: number; editedAt: number | null; openReports?: number };
export type LoungeReport = { id: number; targetType: "thread" | "post"; targetId: number; threadId: number; reason: string; note: string; reporter: string; excerpt: string; createdAt: number };

/**
 * Starter threads, added once to an empty Crew Lounge under the house author (no member is credited, and votes on them earn nobody points).
 * They ask questions rather than state facts, so nothing here needs to be verified. Admins can hide or delete any of them.
 */
export const LOUNGE_SEED: { category: LoungeCategoryId; title: string; body: string; airports?: string[]; pinned?: boolean; locked?: boolean }[] = [
  {
    category: "hangar", pinned: true, locked: true,
    title: "Welcome to Crew Lounge: read before you push back",
    body: [
      "This is the crew room for Wheelsdown: airport ops, gear, layovers, the app and general hangar talk.",
      "Ground rules:",
      "- No tail numbers, from any country. Say \"a CJ3\" or \"a G550\" instead. The post box flags them before you can post.",
      "- No passenger, owner or company-confidential details. Nothing that belongs in a safety report.",
      "- Airport Ops posts are crew-reported, not official. Check NOTAMs, the Chart Supplement and the FBO.",
      "- Posting anonymously is fine. Admins can still see who posted, so keep it professional.",
      "- Points only come from other crews: each Helpful vote on your thread or reply is worth 2. Posting by itself earns nothing.",
    ].join("\n"),
  },
  {
    category: "airport-ops",
    title: "The Great FBO Cookie Census",
    body: "Warm, chewy, fresh out of the oven, or a sad plastic-wrapped puck? Name the FBO and the field, rate the cookie, and let's settle this with data. Bonus points for FBOs that also have decent coffee.",
  },
  {
    category: "airport-ops",
    title: "PPR roulette: which fields are making you call ahead this season?",
    body: "Event weekends, ramp construction, slot programs. Where have you needed a PPR or reservation lately, and how far ahead did you have to call? Tag the airport so the next crew finds it.",
  },
  {
    category: "airport-ops",
    title: "Customs on the fly: your smoothest (and roughest) international returns",
    body: "Which ports of entry make the return easy, and which ones had you waiting on the ramp with the engines off? eAPIS tips, officer hours, how much notice they want. Share what worked.",
  },
  {
    category: "airport-ops",
    title: "Curfew crunch: noise-abatement procedures that keep you up at night",
    body: "Departure curfews, quiet hours, voluntary noise programs that aren't so voluntary. Which ones have bitten you, and how do you plan around them on a long day?",
  },
  {
    category: "gear",
    title: "Headset hangar: the long-leg ear test",
    body: "Five hours in, which headset still feels good? ANC, clamp force, Bluetooth for the phone, battery life. Tell us what you fly with and what you'd never wear again.",
  },
  {
    category: "gear",
    title: "EFB mount survival: who makes it through a Florida summer ramp?",
    body: "Suction cups that let go at the worst moment, iPads that overheat on the glareshield, kneeboards that pinch. What setup actually holds up, and where do you keep a backup?",
  },
  {
    category: "gear",
    title: "Crew bag Tetris: what's in your go bag?",
    body: "One bag, three days, unknown weather and a baggage compartment that's already full. Show us the packing list. Best roller, best backpack, the one item you never leave home without.",
  },
  {
    category: "layovers",
    title: "Quick-turn grub: real food in under 45 minutes",
    body: "You've got an hour on the ground and you're tired of FBO vending machines. Where's your go-to quick grab near the field? If it's good, add it in Wheelsdown too so it shows up in briefings.",
  },
  {
    category: "layovers",
    title: "No crew car? Best walkable layover towns",
    body: "Some overnights are great on foot, others mean a hotel room and a delivery app. Which layover towns let you walk to dinner, coffee and something worth seeing?",
  },
  {
    category: "layovers",
    title: "Hotel gym or hotel bar? Staying sharp on a four-day trip",
    body: "Workouts that fit a hotel room, the best crew-friendly gyms you've found, sleep tricks for early shows. What keeps you rested and fit on the road?",
  },
  {
    category: "app",
    title: "Wheelsdown wish list: what should we build next?",
    body: "Briefings, AI picks, check-ins, maps, Crew Lounge itself. What would make Wheelsdown more useful on your next trip? One idea per reply makes it easier for others to mark the ones they want.",
  },
  {
    category: "app",
    title: "Squawk sheet: bugs and gripes",
    body: "Something not working right? Write it up like a squawk: what you did, what you expected, what happened, and your phone or browser. We'll sign it off when it's fixed.",
  },
  {
    category: "hangar",
    title: "Best \"say again?\" you've ever heard on frequency",
    body: "Keep it anonymous and keep it kind: no callsigns, no tail numbers. What's the funniest exchange you've heard between a crew and ATC?",
  },
  {
    category: "hangar",
    title: "Galley coffee showdown: pods, pour-over or the FBO pot?",
    body: "What's brewing on your airplane, and what's the best FBO coffee you've had? Extra credit for a setup that survives turbulence.",
  },
];
