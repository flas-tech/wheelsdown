// My Crew: friends on Wheelsdown. Both people have to agree (a crew request, then Accept).
// Crew members can see each other's Crew Up plans, and whatever else each person chooses to share in Privacy.
// No points for adding crew, so nobody is rewarded for collecting strangers.

export type CrewPrivacy = {
  /** Crew can see the places and airports you've checked in at (last 60 days). Off by default. */
  shareCheckins: boolean;
  /** Crew can see your favorites. */
  shareFavorites: boolean;
  /** Who can send you a crew request: anyone signed in, or nobody (you can still send requests). */
  allowRequests: boolean;
};
export const DEFAULT_PRIVACY: CrewPrivacy = { shareCheckins: false, shareFavorites: true, allowRequests: true };

export const MYCREW_LIMITS = { pendingOut: 50, crew: 500, findResults: 20 } as const;

export type CrewPerson = { id: number; displayName: string; handle: string; crewRole: string; homeBase: string; aircraft: string; tierId: string; points: number };
export type CrewRelation = "none" | "crew" | "outgoing" | "incoming" | "self";
export type CrewMember = CrewPerson & { since: number; shares: { checkins: boolean; favorites: boolean }; crewUpAt: string | null };
export type CrewRequest = { id: number; at: number; person: CrewPerson };
export type MyCrewResp = { crew: CrewMember[]; incoming: CrewRequest[]; outgoing: CrewRequest[]; privacy: CrewPrivacy; inviteUrl: string };
export type CrewFindRow = CrewPerson & { relation: CrewRelation; requestId: number | null; allowsRequests: boolean };
export type CrewShared = {
  person: CrewPerson;
  checkins: { spotId: number | null; name: string; icao: string; category: string | null; at: number }[] | null;
  favorites: { id: number; name: string; icao: string; category: string }[] | null;
};

/** Messages from the Wheelsdown team or the app (feedback replies, "accepted your crew request"). Shown in Notifications. */
export type MemberMessage = { id: number; kind: "feedback_reply" | "crew_accepted" | "team" | "crewup"; title: string; body: string; link: string; createdAt: number; unread: boolean };

/** Invite link that also asks the new member to join your crew after they sign up. */
export const crewInviteUrl = (origin: string, userId: number) => `${origin.replace(/\/$/, "")}/?ref=${userId}&crew=1`;
