// Aircraft registration (tail number) detection for Crew Lounge.
// Crew Lounge doesn't allow tail numbers from any country, so a post can't identify an owner, operator or passenger trip.
// Shared by the server (enforced on every post) and the browser (warns while typing).
//
// Covers:
//  - US N-numbers: N123AB, n-12345, N 4G, N12Z (no I or O letters, 1 to 5 characters after the N)
//  - Dashed foreign registrations with a known nationality prefix: C-GABC, G-ABCD, D-IABC, VH-ABC, HB-JFA, 9H-ABC, XA-ABC,
//    VP-CXX, A6-ABC, A9C-ABC, B-1234 / B-12345 (China, Taiwan), RA-12345 (Russia), JA123A (Japan), HL1234 (Korea)
//  - Spelled-out tries: "N 1 2 3 A B", "N.1.2.3.A.B", "November one two three alpha bravo", "Golf Alpha Bravo Charlie Delta"
// Engine and gear terms pilots use all the time (N1, N2, N95, PT-6, C-130, B-737, EC-135) are not flagged.

export type TailHit = { text: string; index: number; length: number };

const LETTER = "A-HJ-NP-Z"; // US N-numbers never use I or O
const US_TAIL = new RegExp(`^[1-9](?:\\d{0,4}|\\d{0,3}[${LETTER}]|\\d{0,2}[${LETTER}]{2})$`);
/** Tokens that look like N-numbers but are everyday aviation words. */
const US_ALLOW = new Set(["N1", "N2", "N1S", "N2S", "N95", "N99", "N100"]);

// ICAO nationality marks that are written with a dash. Single-letter countries use four letters after the dash.
const SINGLE = new Set(["C", "D", "F", "G", "I", "M"]);
const MULTI = new Set((
  "2 3A 3B 3C 3D 3X 4K 4L 4O 4R 4X 5A 5B 5H 5N 5R 5T 5U 5V 5W 5X 5Y 6O 6V 6Y 7O 7P 7Q 7T 8P 8Q 8R 9A 9G 9H 9J 9K 9L 9M 9N 9Q 9U 9V 9XR 9Y " +
  "A2 A3 A4O A5 A6 A7 A8 A9C AP C2 C3 C5 C6 C9 CC CN CP CS CU CX D2 D4 D6 DQ E3 E5 E7 EC EI EK EL EP ER ES ET EW EX EY EZ " +
  "HA HB HC HH HI HK HP HR HS HZ J2 J3 J5 J6 J7 J8 JU JY LN LV LX LY LZ OB OD OE OH OK OM OO OY P2 P4 PH PJ PK PP PR PS PT PU PZ " +
  "RP S2 S5 S7 S9 SE SP ST SU SX T2 T3 T7 T8A TC TF TG TI TJ TL TN TR TS TT TU TY TZ UK UN UP UR V2 V3 V4 V5 V6 V7 V8 VH VN VP VQ VT " +
  "XA XB XC XT XU XW XY YA YI YJ YK YL YN YR YS YU YV Z Z3 Z6 ZA ZK ZP ZS"
).split(/\s+/));
/** Countries that register with digits after the dash. */
const NUMERIC = new Set(["B", "RA", "EW", "UR", "UK", "UP", "UN", "EX", "EY", "EZ", "4K", "4L"]);
/** Ordinary words that happen to sit behind a nationality mark (OK-ish, SE-Asia, G-suit). */
const WORD_ALLOW = new Set(["ISH", "ASIA", "SUIT", "RING", "PASS", "BOMB", "WORD", "LINE", "MAIL", "TEAM", "BASE", "WIFI", "TIME", "STOP", "1900"]);

function foreignOk(prefix: string, suffix: string) {
  const p = prefix.toUpperCase(), s = suffix.toUpperCase();
  if (WORD_ALLOW.has(s)) return false;
  if (p === "B") return /^\d{4,5}$/.test(s);
  if (SINGLE.has(p)) return /^[A-Z]{4}$/.test(s);
  if (!MULTI.has(p) && !NUMERIC.has(p)) return false;
  if (NUMERIC.has(p) && /^\d{4,5}$/.test(s)) return true;
  return /^[A-Z]{3,4}$/.test(s) || (/^[A-Z]{1,2}\d{1,3}$/.test(s) && p === "PK") || (p === "Z" && /^[A-Z]{3}$/.test(s));
}

const PHONETIC: Record<string, string> = {
  alpha: "A", alfa: "A", bravo: "B", charlie: "C", delta: "D", echo: "E", foxtrot: "F", golf: "G", hotel: "H", india: "I", juliet: "J", juliett: "J",
  kilo: "K", lima: "L", mike: "M", november: "N", oscar: "O", papa: "P", quebec: "Q", romeo: "R", sierra: "S", tango: "T", uniform: "U",
  victor: "V", whiskey: "W", whisky: "W", xray: "X", "x-ray": "X", yankee: "Y", zulu: "Z",
  zero: "0", one: "1", two: "2", three: "3", tree: "3", four: "4", fower: "4", five: "5", fife: "5", six: "6", seven: "7", eight: "8", nine: "9", niner: "9",
};

/** Every tail number found in the text, in order. Empty when the text is clean. */
export function findTailNumbers(text: string): TailHit[] {
  const t = String(text || "");
  const hits: TailHit[] = [];
  const add = (index: number, raw: string) => {
    const length = raw.length;
    if (!hits.some((h) => index < h.index + h.length && h.index < index + length)) hits.push({ text: raw.trim(), index, length });
  };
  let m: RegExpExecArray | null;

  // 1. US N-numbers, with at most one separator after the N
  const us = /(?<![A-Za-z0-9])[Nn](?:[-.\u2013]|\s(?=\d))?([0-9][0-9A-Za-z]{0,4})(?![A-Za-z0-9])/g;
  while ((m = us.exec(t))) {
    const body = m[1].toUpperCase();
    if (US_TAIL.test(body) && !US_ALLOW.has("N" + body)) add(m.index, m[0]);
  }
  // 2. Japan and Korea (no dash)
  const jk = /(?<![A-Za-z0-9])(JA\d{3}[0-9A-Z]|JA\d{2}[A-Z]{2}|HL\d{4})(?![A-Za-z0-9])/gi;
  while ((m = jk.exec(t))) add(m.index, m[0]);
  // 3. Nationality mark + dash + registration
  const intl = /(?<![A-Za-z0-9])([A-Za-z0-9]{1,3})[-.\u2013\u2014]([A-Za-z0-9]{3,5})(?![A-Za-z0-9])/g;
  while ((m = intl.exec(t))) if (foreignOk(m[1], m[2])) add(m.index, m[0]);
  // 4. Spelled-out tries: single characters separated by spaces/dots/dashes ("N 1 2 3 A B")
  const spaced = /(?<![A-Za-z0-9])([A-Za-z0-9]{1,2})((?:[\s.\-_/]+[A-Za-z0-9](?![A-Za-z0-9])){2,6})/g;
  while ((m = spaced.exec(t))) {
    const joined = (m[1] + m[2]).replace(/[\s.\-_/]+/g, "").toUpperCase();
    if (isTail(joined)) add(m.index, m[0]);
  }
  // 5. Phonetic: "November one two three alpha bravo", "Golf Alpha Bravo Charlie Delta"
  const words = Array.from(t.matchAll(/[A-Za-z]+(?:-ray)?|\d+/g));
  for (let i = 0; i < words.length; i++) {
    const first = PHONETIC[words[i][0].toLowerCase()];
    if (!first || !/[A-Z]/.test(first)) continue;
    let s = first, j = i + 1;
    while (j < words.length && s.length < 7) {
      const w = words[j][0];
      const ch = /^\d+$/.test(w) ? w : PHONETIC[w.toLowerCase()];
      if (!ch) break;
      // the words must be next to each other (spaces, dashes or commas between them)
      const gap = t.slice(words[j - 1].index! + words[j - 1][0].length, words[j].index!);
      if (!/^[\s,.\-]*$/.test(gap)) break;
      s += ch; j++;
    }
    const spelled = j - i - 1;
    if (spelled >= 3 && isTail(s)) {
      const start = words[i].index!, end = words[j - 1].index! + words[j - 1][0].length;
      add(start, t.slice(start, end));
      i = j - 1;
    }
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** A run of characters with no separators, e.g. "N123AB" or "GABCD". */
function isTail(s: string) {
  if (/^N[0-9]/.test(s) && US_TAIL.test(s.slice(1)) && !US_ALLOW.has(s) && s.length >= 3) return true;
  for (const n of [1, 2, 3]) if (s.length > n + 2 && foreignOk(s.slice(0, n), s.slice(n))) return true;
  return false;
}

export const hasTailNumber = (text: string) => findTailNumbers(text).length > 0;
export const TAIL_RULE = "Tail numbers aren't allowed in Crew Lounge, from any country. Describe the aircraft by type instead (a CJ3, a G550).";
