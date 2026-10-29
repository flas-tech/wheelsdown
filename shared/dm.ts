// Private messages (crew feedback from JPJ and Jeff King, Oct 2026): direct messages between crew, and a thread on
// every Crew Up plan. End-to-end encrypted: each device makes its own key pair and keeps the private half on the
// device; the server only stores encrypted text, so nobody running Wheelsdown (admins included) can read a message.
// Not moderated. Shared by server and client.

export const DM_RULES = {
  textMax: 2000, // characters of plain text per message
  ctMax: 12_000, // base64 characters of encrypted text the server accepts
  devicesMax: 10, // active devices (phone, home-screen app, computer...) per member
  crewUpMembersMax: 60, // people in a Crew Up thread
  crewUpKeepDays: 7, // a Crew Up thread is deleted this long after its plan ends
  pageSize: 50,
} as const;

export type DmAudience = "admins" | "members";
export type DmConfig = { available: boolean; opened: boolean };

export type DmDevice = { id: number; userId: number; encPub: string; sigPub: string };
export type MyDmDevice = { id: number; label: string; createdAt: number; lastSeen: number; current?: boolean };

export type DmPerson = { id: number; name: string; crewRole: string };
export type DmConversation = {
  id: number;
  kind: "direct" | "crewup" | "trip";
  /** Trip crew chat: the trip sheet it belongs to and when the trip ends (closes and is deleted 3 days later). */
  trip?: { briefingId: number; title: string; endsAt: number } | null;
  /** Crew Up thread: the plan it belongs to. */
  meetup: { id: number; icao: string; hostId: number; startsAt: number; ended: boolean } | null;
  /** Everyone in it except you. */
  people: DmPerson[];
  lastAt: number;
  lastFrom: number | null;
  unread: boolean;
  /** You can still send (direct: you're still crew; Crew Up: the plan hasn't been gone a week). */
  canSend: boolean;
  /** People in it who haven't opened Messages on any device yet; they can only read messages sent after they do. */
  noDevice: number[];
};

/** One wrapped copy of a message's key, for one device. */
export type DmKeyBox = { deviceId: number; wrapped: string; iv: string };
export type DmSend = {
  deviceId: number; // the sending device
  ct: string; // AES-GCM ciphertext of the JSON body (base64)
  iv: string; // its 12-byte IV (base64)
  eph: string; // the per-message ephemeral ECDH public key (base64 raw)
  sig: string; // ECDSA P-256 signature by the sending device over dmSigned(...) (base64)
  keys: DmKeyBox[]; // one per device of every person in the conversation (yours too)
};
export type DmMessage = {
  id: number; senderId: number; senderDevice: number; createdAt: number;
  ct: string; iv: string; eph: string; sig: string;
  /** This device's copy of the key, or null when the message was sent before this device was set up. */
  key: { wrapped: string; iv: string } | null;
};
export type DmThread = { conversation: DmConversation; messages: DmMessage[]; devices: DmDevice[]; more: boolean };

/** What the sending device signs: the conversation, the device, and the encrypted text with its IV and one-time key.
 *  The per-device key copies don't need signing: a swapped copy can't open the signed ciphertext (AES-GCM checks it). */
export function dmSigned(convId: number, m: { deviceId: number; iv: string; ct: string; eph: string }) {
  return `wd-dm-v1|${convId}|${m.deviceId}|${m.iv}|${m.ct}|${m.eph}`;
}
