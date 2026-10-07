// Wheelsdown "Logbook" crew status — tiers modeled on the pilot certificate ladder.
import { computeVet } from "./vetting";

export type TierId = "student" | "private" | "instrument" | "commercial" | "restricted_atp" | "atp" | "check_airman" | "ancient_albatross";

export const TIERS: {
  id: TierId; name: string; min: number; stripes: number; color: string; tagline: string; perks: string[];
}[] = [
  { id: "student", name: "Student", min: 0, stripes: 0, color: "#94A3B8", tagline: "Solo endorsement pending",
    perks: ["Add listings, rate, review and vote", "Your own crew logbook"] },
  { id: "private", name: "Private", min: 40, stripes: 1, color: "#C08457", tagline: "Cleared for the local area",
    perks: ["Private badge on everything you post", "Listed on the crew leaderboard"] },
  { id: "instrument", name: "Instrument", min: 150, stripes: 2, color: "#CBD5E1", tagline: "Comfortable in the soup",
    perks: ["Silver badge", "Reviews are tagged \"Instrument-rated reviewer\"", "Suggest edits to any listing (planned)"] },
  { id: "commercial", name: "Commercial", min: 250, stripes: 3, color: "#F5B83D", tagline: "Getting paid to know the good spots",
    perks: ["Gold badge", "Listings you add skip the moderation queue", "Early access to partner crew rates (planned)"] },
  { id: "restricted_atp", name: "Restricted ATP", min: 750, stripes: 4, color: "#E8A88E", tagline: "Almost there, with a few more hours to log",
    perks: ["Rose-gold badge", "Everything Commercial gets", "First look at new partner perks (planned)"] },
  { id: "atp", name: "ATP", min: 1500, stripes: 4, color: "#E5E7EB", tagline: "Airline Transport Pro",
    perks: ["Platinum badge", "\"ATP Pick\" highlight on your listings (planned)", "Partner perks and giveaways (planned)"] },
  { id: "check_airman", name: "Check Airman", min: 2500, stripes: 4, color: "#67E8F9", tagline: "Trusted to check everyone else",
    perks: ["Diamond badge", "Resolve \"Needs check\" flags in your region (planned)", "Annual Wheelsdown swag kit (planned)"] },
  { id: "ancient_albatross", name: "Ancient Albatross", min: 6000, stripes: 4, color: "#F8D27A", tagline: "Longest-serving, most-trusted crew in the network",
    perks: ["Obsidian & gold badge", "Name on the Albatross Wall", "Advisory seat on new features (planned)"] },
];

export const POINTS = {
  listing: 10,        // add a listing
  listingVetted: 20,  // bonus when your listing becomes Crew-vetted
  review: 5,          // rate a listing
  reviewDetail: 3,    // bonus for a review with 40+ characters of comment
  vote: 1,            // cast an up/down vote
  upvoteReceived: 1,  // someone else upvotes your listing
  helpfulReceived: 2, // someone marks your review helpful
  referral: 25,       // someone signs up with your invite link (only once they have an account)
} as const;

/** Milestone inside Student. Does not change tier thresholds or rankings. */
export const SOLO_POINTS = 25;
export const hasSoloed = (points: number) => points >= SOLO_POINTS;

export function tierFor(points: number) {
  let i = 0;
  for (let k = 0; k < TIERS.length; k++) if (points >= TIERS[k].min) i = k;
  const tier = TIERS[i];
  const next = TIERS[i + 1];
  const progress = next ? (points - tier.min) / (next.min - tier.min) : 1;
  return { tier, next, index: i, progress: Math.max(0, Math.min(1, progress)), toNext: next ? next.min - points : 0 };
}

export type PointsBreakdown = {
  listings: number; listingsVetted: number; reviews: number; detailedReviews: number;
  votes: number; upvotesReceived: number; helpfulReceived: number; referrals: number; bonus: number; total: number;
  /** Participation counter: everything this crew member has done (listings + ratings + votes). */
  participation: number;
};

type Row = { id: number; userId?: number | null; createdAt: number };
type Data = {
  spots: (Row & { status: string; name: string; modState?: string })[];
  reviews: (Row & { comment: string; spotId: number; rating: number; status?: string })[];
  votes: { targetType: string; targetId: number; voter: string; value: number; reason?: string | null; createdAt: number; id: number }[];
  /** Members, for referral credit: a signed-up account whose referredBy is you. */
  users?: { id: number; referredBy?: number | null; createdAt: number; displayName: string; crewRole: string; anonymous?: boolean | number | null }[];
};
/** Accounts that signed up with this member's invite link. Deleted accounts drop out, so the credit always matches real sign-ups. */
const referralsOf = (data: Data, userId: number) => (data.users || []).filter((u) => u.referredBy === userId && u.id !== userId);

/** A listing earns points unless it was hidden or rejected, or it's new and still waiting on (or held by) the automatic check. */
const earns = (s: { status: string; modState?: string }) =>
  s.status !== "hidden" && s.status !== "rejected" && !(s.status === "pending" && (s.modState === "checking" || s.modState === "flagged" || s.modState === "awaiting"));

/** Points are computed from activity (not stored), so they can never drift from the record. */
export function computePoints(data: Data, userId: number, bonus = 0): PointsBreakdown {
  const voter = `u:${userId}`;
  // hidden and rejected listings and any rating that isn't live (still being checked, or held) earn nothing
  const mySpots = data.spots.filter((s) => s.userId === userId && earns(s));
  const mySpotIds = new Set(mySpots.map((s) => s.id));
  const myReviews = data.reviews.filter((r) => r.userId === userId && (r.status ?? "live") === "live");
  const myReviewIds = new Set(myReviews.map((r) => r.id));
  const spotVotes = (id: number) => data.votes.filter((v) => v.targetType === "spot" && v.targetId === id) as any;
  const listingsVetted = mySpots.filter((s) => computeVet(spotVotes(s.id)).level === "vetted").length;
  const votes = data.votes.filter((v) => v.voter === voter).length;
  const upvotesReceived = data.votes.filter((v) => v.targetType === "spot" && mySpotIds.has(v.targetId) && v.value > 0 && v.voter !== voter).length;
  const helpfulReceived = data.votes.filter((v) => v.targetType === "review" && myReviewIds.has(v.targetId) && v.value > 0 && v.voter !== voter).length;
  const detailedReviews = myReviews.filter((r) => (r.comment || "").trim().length >= 40).length;
  const referrals = referralsOf(data, userId).length;
  const total =
    mySpots.length * POINTS.listing + listingsVetted * POINTS.listingVetted + myReviews.length * POINTS.review +
    detailedReviews * POINTS.reviewDetail + votes * POINTS.vote + upvotesReceived * POINTS.upvoteReceived +
    helpfulReceived * POINTS.helpfulReceived + referrals * POINTS.referral + bonus;
  return { listings: mySpots.length, listingsVetted, reviews: myReviews.length, detailedReviews, votes, upvotesReceived, helpfulReceived, referrals, bonus, total,
    participation: mySpots.length + myReviews.length + votes };
}

export type ActivityItem = { kind: "listing" | "review" | "vote_up" | "vote_down" | "review_vote" | "referral"; label: string; spotId: number; points: number; at: number };

/** Most recent activity for the participation log. */
export function recentActivity(data: Data, userId: number, limit = 25): ActivityItem[] {
  const voter = `u:${userId}`;
  const name = (id: number) => data.spots.find((s) => s.id === id)?.name || "a listing";
  const items: ActivityItem[] = [];
  for (const s of data.spots) if (s.userId === userId && earns(s)) items.push({ kind: "listing", label: `Added ${s.name}`, spotId: s.id, points: POINTS.listing, at: s.createdAt });
  for (const r of data.reviews) if (r.userId === userId && (r.status ?? "live") === "live")
    items.push({ kind: "review", label: r.rating === 0 ? `Go around: ${name(r.spotId)}` : `Rated ${name(r.spotId)} ${r.rating}/5`, spotId: r.spotId, points: POINTS.review + ((r.comment || "").trim().length >= 40 ? POINTS.reviewDetail : 0), at: r.createdAt });
  for (const v of data.votes) if (v.voter === voter) {
    if (v.targetType === "spot") items.push({ kind: v.value > 0 ? "vote_up" : "vote_down", label: `${v.value > 0 ? "Upvoted" : "Flagged"} ${name(v.targetId)}`, spotId: v.targetId, points: POINTS.vote, at: v.createdAt });
    else { const r = data.reviews.find((x) => x.id === v.targetId); if (r) items.push({ kind: "review_vote", label: `Voted on a review of ${name(r.spotId)}`, spotId: r.spotId, points: POINTS.vote, at: v.createdAt }); }
  }
  for (const u of referralsOf(data, userId)) items.push({ kind: "referral", label: `${publicName(u as any)} joined with your invite`, spotId: 0, points: POINTS.referral, at: u.createdAt });
  return items.sort((a, b) => b.at - a.at).slice(0, limit);
}

/** Name shown on posts and the leaderboard, honoring the anonymous preference. */
export const publicName = (u: { displayName: string; crewRole: string; anonymous?: boolean | number | null }) =>
  u.anonymous ? (["Pilot", "Flight Attendant", "Mechanic", "Dispatcher", "Flight Scheduler"].includes(u.crewRole) ? `Anonymous ${u.crewRole.toLowerCase()}` : "Anonymous crew") : u.displayName;

export type PublicUser = {
  id: number; handle: string; displayName: string; crewRole: string; homeBase: string; anonymous: boolean; participation: number;
  points: number; tierId: TierId; createdAt: number; aircraft: string;
  bio: string; interests: string[]; // empty for anonymous members
  wrightNo: number | null; // founding club seat; hidden for anonymous members
};
export type Me = PublicUser & { breakdown: PointsBreakdown; email?: string; isAdmin?: boolean; achievements?: { id: string; earned: boolean; value: number; goal: number }[]; follows?: { followers: number; following: number } };

// Demo crew members so the leaderboard has range (bonus = legacy points for the demo only)
export const SEED_USERS = [
  { handle: "jramirez", displayName: "J. Ramirez", crewRole: "Pilot", homeBase: "KMIA", bonus: 6150 },
  { handle: "dcole", displayName: "D. Cole", crewRole: "Pilot", homeBase: "KTEB", bonus: 2600 },
  { handle: "anap", displayName: "Ana P.", crewRole: "Pilot", homeBase: "TJSJ", bonus: 980 },
  { handle: "kellym", displayName: "Kelly M.", crewRole: "Flight Attendant", homeBase: "KFLL", bonus: 320 },
  { handle: "chrisw", displayName: "Chris W.", crewRole: "Pilot", homeBase: "KDAL", bonus: 90 },
  { handle: "tomb", displayName: "Tom B.", crewRole: "Pilot", homeBase: "KATL", bonus: 20 },
];
export const SEED_PASSWORD = "crewrest";
