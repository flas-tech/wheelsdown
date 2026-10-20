// Push notifications: what a member can get, and their settings. Shared by server and client.
export type PushKind = "crew_request" | "crew_accepted" | "crewup_posted" | "crewup_joined" | "team";

export type NotifyPrefs = {
  crewRequests: boolean; // someone asks to add you; someone accepts yours
  crewUp: boolean; // a crew member posts Crew Up plans
  crewUpJoins: boolean; // someone says they're in on your Crew Up
  team: boolean; // replies to your feedback and notes from the Wheelsdown team
  quiet: boolean; // overnight (quietStart..quietEnd, local time) notifications arrive without sound
  quietStart: number; // hour 0-23
  quietEnd: number; // hour 0-23
  tz: string; // IANA zone from the member's device, for quiet hours
};
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = { crewRequests: true, crewUp: true, crewUpJoins: true, team: true, quiet: true, quietStart: 22, quietEnd: 7, tz: "America/New_York" };

/** Which setting turns each kind on or off. */
export const PREF_FOR: Record<PushKind, keyof NotifyPrefs> = {
  crew_request: "crewRequests", crew_accepted: "crewRequests", crewup_posted: "crewUp", crewup_joined: "crewUpJoins", team: "team",
};

export type PushConfig = {
  /** Push is open to this member (admins-only while testing). */
  available: boolean;
  publicKey: string;
  prefs: NotifyPrefs;
  /** How many of their devices are signed up. */
  devices: number;
};
export type PushAudience = "admins" | "members";
