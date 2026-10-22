// End-to-end encryption for private messages (see server/dm.ts and shared/dm.ts).
//
// Each device (browser, home-screen app) makes two P-256 key pairs with WebCrypto: ECDH to receive, ECDSA to sign.
// The private keys are created non-extractable and kept in this device's IndexedDB, so not even this page's code can
// export them, and they never reach the server. Sending a message:
//   1. a fresh AES-256-GCM key encrypts the text;
//   2. a one-time ECDH key pair is made, and for every device in the conversation that AES key is wrapped with
//      AES-GCM under SHA-256(ECDH(one-time, device) || "wd-dm-v1" || device id);
//   3. the sending device signs the ciphertext (shared/dm.ts dmSigned) so readers know it came from that device.
// Reading reverses it with this device's ECDH key. A device can only read messages sent after it was set up.
import { dmSigned, type DmDevice, type DmKeyBox, type DmMessage, type DmSend } from "@shared/dm";

const DB = "wd-dm", STORE = "keys";
type Stored = { userId: number; deviceId: number; enc: CryptoKeyPair; sig: CryptoKeyPair };

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("This browser can't do private messages (no WebCrypto). Try Safari or Chrome over https.");
  return s;
};
export const dmSupported = () => typeof indexedDB !== "undefined" && !!globalThis.crypto?.subtle;

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  return btoa(s);
};
const unb64 = (s: string) => { const bin = atob(s); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; };
const enc = new TextEncoder(), dec = new TextDecoder();
const join = (a: Uint8Array, b: Uint8Array) => { const o = new Uint8Array(a.length + b.length); o.set(a); o.set(b, a.length); return o; };

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => { open.result.createObjectStore(STORE); };
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const r = fn(tx.objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      tx.oncomplete = () => open.result.close();
    };
  });
}
const keyFor = (userId: number) => `u${userId}`;
export const loadDevice = (userId: number) => idb<Stored | undefined>("readonly", (s) => s.get(keyFor(userId)) as IDBRequest<Stored | undefined>);
const saveDevice = (d: Stored) => idb("readwrite", (s) => s.put(d, keyFor(d.userId)));
export const forgetDevice = (userId: number) => idb("readwrite", (s) => s.delete(keyFor(userId)));

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;
const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

/** New key pairs for this device. Private halves are non-extractable. */
export async function makeKeys() {
  const encK = await subtle().generateKey(ECDH, false, ["deriveBits"]) as CryptoKeyPair;
  const sigK = await subtle().generateKey(ECDSA, false, ["sign", "verify"]) as CryptoKeyPair;
  return {
    enc: encK, sig: sigK,
    encPub: b64(await subtle().exportKey("raw", encK.publicKey)),
    sigPub: b64(await subtle().exportKey("raw", sigK.publicKey)),
  };
}
export async function rememberDevice(userId: number, deviceId: number, k: { enc: CryptoKeyPair; sig: CryptoKeyPair }) {
  await saveDevice({ userId, deviceId, enc: k.enc, sig: k.sig });
}

/** Short code to compare in person: the same on both phones means nobody swapped keys in between. */
export async function safetyCode(pubs: string[]) {
  const h = new Uint8Array(await subtle().digest("SHA-256", enc.encode([...pubs].sort().join("|"))));
  return Array.from(h.slice(0, 10)).map((x) => x.toString().padStart(3, "0")).join(" ").replace(/(\d{3} \d{3} \d{3} \d{3} \d{3}) /, "$1\n");
}

async function wrapKeyFor(ephPriv: CryptoKey, devicePub: string, deviceId: number) {
  const pub = await subtle().importKey("raw", unb64(devicePub), ECDH, false, []);
  const bits = await subtle().deriveBits({ name: "ECDH", public: pub }, ephPriv, 256);
  const kek = await subtle().digest("SHA-256", join(new Uint8Array(bits), enc.encode(`wd-dm-v1|${deviceId}`)));
  return subtle().importKey("raw", kek, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** Encrypt a message for every device in the conversation and sign it with this device's key. */
export async function sealMessage(convId: number, me: Stored, devices: DmDevice[], text: string): Promise<DmSend> {
  const body = enc.encode(JSON.stringify({ t: text, at: Date.now() }));
  const msgKey = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle().encrypt({ name: "AES-GCM", iv }, msgKey, body);
  const raw = new Uint8Array(await subtle().exportKey("raw", msgKey));
  const eph = await subtle().generateKey(ECDH, true, ["deriveBits"]) as CryptoKeyPair;
  const keys: DmKeyBox[] = [];
  for (const d of devices) {
    const kek = await wrapKeyFor(eph.privateKey, d.encPub, d.id);
    const kiv = crypto.getRandomValues(new Uint8Array(12));
    keys.push({ deviceId: d.id, wrapped: b64(await subtle().encrypt({ name: "AES-GCM", iv: kiv }, kek, raw)), iv: b64(kiv) });
  }
  const out = { deviceId: me.deviceId, ct: b64(ct), iv: b64(iv), eph: b64(await subtle().exportKey("raw", eph.publicKey)), keys };
  const sig = await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, me.sig.privateKey, enc.encode(dmSigned(convId, out)));
  return { ...out, sig: b64(sig) };
}

export type Opened = { id: number; senderId: number; createdAt: number; text: string | null; state: "ok" | "no-key" | "bad" };

/** Decrypt one message with this device's key and check the sender's signature. */
export async function openMessage(convId: number, me: Stored, m: DmMessage, devices: DmDevice[]): Promise<Opened> {
  const base = { id: m.id, senderId: m.senderId, createdAt: m.createdAt };
  if (!m.key) return { ...base, text: null, state: "no-key" };
  try {
    const sender = devices.find((d) => d.id === m.senderDevice && d.userId === m.senderId);
    if (!sender) return { ...base, text: null, state: "bad" };
    const ok = await verifyOwn(convId, m, sender.sigPub);
    if (!ok) return { ...base, text: null, state: "bad" };
    const ephPub = await subtle().importKey("raw", unb64(m.eph), ECDH, false, []);
    const bits = await subtle().deriveBits({ name: "ECDH", public: ephPub }, me.enc.privateKey, 256);
    const kekRaw = await subtle().digest("SHA-256", join(new Uint8Array(bits), enc.encode(`wd-dm-v1|${me.deviceId}`)));
    const kek = await subtle().importKey("raw", kekRaw, "AES-GCM", false, ["decrypt"]);
    const raw = await subtle().decrypt({ name: "AES-GCM", iv: unb64(m.key.iv) }, kek, unb64(m.key.wrapped));
    const msgKey = await subtle().importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
    const plain = await subtle().decrypt({ name: "AES-GCM", iv: unb64(m.iv) }, msgKey, unb64(m.ct));
    const j = JSON.parse(dec.decode(plain));
    return { ...base, text: String(j?.t ?? ""), state: "ok" };
  } catch {
    return { ...base, text: null, state: "bad" };
  }
}

async function verifyOwn(convId: number, m: DmMessage, sigPub: string) {
  const pub = await subtle().importKey("raw", unb64(sigPub), ECDSA, false, ["verify"]);
  const signed = enc.encode(dmSigned(convId, { deviceId: m.senderDevice, iv: m.iv, ct: m.ct, eph: m.eph }));
  return subtle().verify({ name: "ECDSA", hash: "SHA-256" }, pub, unb64(m.sig), signed);
}
