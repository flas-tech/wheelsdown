/**
 * Guest limits (Nov 2026, from Patrick's guest-vs-member review, feedback #75).
 * Switch app_settings guest_limits_audience: "admins" = off (guests see everything, as before),
 * "members" = on (people without an account get a preview and are asked to sign up for the rest).
 * Everything here is enforced on the server; the app only draws the "Sign up to see" cards.
 */
import { makeSwitch } from "./switches";

export const guestLimits = makeSwitch("guest_limits_audience", "Guest limits (sign up for crew tips, every crew note, ramp check details and crew profiles)");
/** Crew notes a guest can read per place before the sign-up card. */
export const GUEST_NOTES = 2;

/** True when this request is from someone without an account and the switch is on. */
export async function limitGuest(viewer: unknown): Promise<boolean> {
  return !viewer && (await guestLimits.audience()) === "members";
}

/** Moderation and account fields people without an account never need (always trimmed for guests). */
function trim<T extends Record<string, any>>(s: T): T {
  const { modState, modNote, modAttempts, pendingEdit, placeRef, ...rest } = s as any;
  return rest as T;
}

/** A listing as a guest sees it. limited = the switch is on: the crew tip, address and website wait for an account. */
export function guestSpot<T extends Record<string, any>>(s: T, limited: boolean): T {
  const t: any = trim(s);
  if (!limited) return t;
  return { ...t, crewTip: "", address: "", website: "", fboRecs: undefined,
    guestLocked: { tip: !!s.crewTip, address: !!s.address, website: !!s.website } };
}

/** Crew notes for a guest: the first few in the app's order (most helpful, then newest); the rest keep only their rating so the chart stays right. */
export function guestReviews<T extends Record<string, any>>(rs: T[], limited: boolean): T[] {
  const out = rs.map((r) => {
    const { modState, modNote, modAttempts, pendingEdit, ...rest } = r as any;
    return { ...rest, userId: r.authorId ?? null } as any; // anonymous authors stay unlinked
  });
  if (!limited) return out;
  const order = [...out].sort((a, b) => (b.up - b.down) - (a.up - a.down) || b.createdAt - a.createdAt);
  const open = new Set(order.slice(0, GUEST_NOTES).map((r) => r.id));
  return out.map((r) => (open.has(r.id) ? r : { id: r.id, spotId: r.spotId, rating: r.rating, costLevel: r.costLevel ?? null, createdAt: r.createdAt, up: r.up, down: r.down, myVote: 0,
    status: r.status, author: "", crewRole: "", comment: "", authorId: null, userId: null, guestLocked: true }));
}
