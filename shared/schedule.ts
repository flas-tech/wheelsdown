// Schedule tools (admins first, schedule_tools_audience): import a trip from a calendar file or pasted text,
// add a trip sheet to your calendar with alarms, and an advisory duty/rest calculator. Pure functions, no I/O.

export type TripLine = { date: string | null; codes: string[]; text: string };
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
// Upper-case words in schedules that look like airport codes but aren't.
const NOT_CODES = new Set(("JAN FEB MAR APR MAY JUN JUL AUG SEP SEPT OCT NOV DEC MON TUE WED THU FRI SAT SUN THE AND FOR " +
  "DEP ARR RPT REL REPORT RELEASE DUTY FLT FLIGHT CREW PIC SIC CAPT FO FA UTC LCL LOCAL EST EDT CST CDT MST MDT PST PDT HST AKST " +
  "ZULU GMT HOTEL LAYOVER LOBBY VAN PAX TRIP LEG LEGS BLOCK OFF ON OUT IN ETD ETA STD STA DH DHD DEAD HEAD RON TBD TBA NONE " +
  "VIA TO FROM NEW YORK CITY DAY DAYS NIGHT AM PM NOTE NOTES SEAT GATE CHARTER PART OPS PER MIN HRS HR TAIL REG").split(" "));

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(m)}-${pad(d)}` : null);

/** A date in free text: 2026-10-29, 10/29, 10/29/26, 29OCT, 29 Oct, Oct 29. Year defaults to the one that keeps it near `today`. */
export function findDate(text: string, today: string): string | null {
  const ty = Number(today.slice(0, 4));
  const near = (m: number, d: number) => { // pick the year closest to today
    const c = [ty - 1, ty, ty + 1].map((y) => iso(y, m, d)).filter(Boolean) as string[];
    const t = Date.parse(today);
    return c.sort((a, b) => Math.abs(Date.parse(a) - t) - Math.abs(Date.parse(b) - t))[0] || null;
  };
  let m = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/); if (m) return iso(+m[1], +m[2], +m[3]);
  m = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (m) return m[3] ? iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]) : near(+m[1], +m[2]);
  m = text.match(/\b(\d{1,2})\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/i); if (m) return near(MONTHS.indexOf(m[2].toUpperCase()) + 1, +m[1]);
  m = text.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2})\b/i); if (m) return near(MONTHS.indexOf(m[1].toUpperCase()) + 1, +m[2]);
  return null;
}
/** Upper-case 3-4 character tokens that could be airport codes (checked against the airport list on the server). */
export function findCodes(text: string): string[] {
  return (text.match(/\b[A-Z][A-Z0-9]{2,3}\b/g) || []).filter((c) => !NOT_CODES.has(c) && !/^\d/.test(c));
}
/** Pasted schedule text: one leg or day per line. Lines without a date take the date above them. */
export function parsePaste(text: string, today: string): TripLine[] {
  const out: TripLine[] = []; let last: string | null = null;
  for (const raw of text.split(/\r?\n/).slice(0, 200)) {
    const line = raw.trim(); if (!line) continue;
    const d = findDate(line, today); if (d) last = d;
    const codes = findCodes(line.replace(/\b\d{1,2}\s?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\b/gi, " "));
    if (codes.length) out.push({ date: d || last, codes, text: line.slice(0, 120) });
  }
  return out;
}
/** A calendar (.ics) file: each event's start date and the codes in its title and location. */
export function parseIcs(text: string, today: string, localDate: (utc: Date) => string): TripLine[] {
  const lines = text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const ev: TripLine[] = []; let cur: { start?: string; s?: string; loc?: string } | null = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") cur = {};
    else if (l === "END:VEVENT" && cur) {
      let date: string | null = null; const v = cur.start || "";
      const m = v.match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
      if (m) date = m[7] ? localDate(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]))) : iso(+m[1], +m[2], +m[3]);
      const txt = `${cur.loc || ""} ${cur.s || ""}`.replace(/\\[,;n]/g, " ");
      const codes = findCodes(txt);
      if (codes.length) ev.push({ date, codes, text: (cur.s || "").replace(/\\[,;n]/g, " ").slice(0, 120) });
      cur = null;
    } else if (cur) {
      const i = l.indexOf(":"); if (i < 0) continue;
      const k = l.slice(0, i).split(";")[0].toUpperCase(); const val = l.slice(i + 1);
      if (k === "DTSTART") cur.start = val; else if (k === "SUMMARY") cur.s = val; else if (k === "LOCATION") cur.loc = val;
    }
  }
  const from = addDaysIso(today, -1), to = addDaysIso(today, 90);
  return ev.filter((e) => !e.date || (e.date >= from && e.date <= to)).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 60);
}
export const addDaysIso = (d: string, n: number) => new Date(Date.parse(d + "T12:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export type ProposedStop = { icao: string; arriveDate: string | null; layover: "quick" | "hours" | "overnight" | "multi"; nights?: number };
/** Lines (with codes already mapped to known ICAO codes) to trip sheet stops: each line's destination is its last known code. */
export function linesToStops(lines: TripLine[], known: Record<string, string | null>): ProposedStop[] {
  const raw: { icao: string; date: string | null }[] = [];
  for (const l of lines) {
    const k = l.codes.map((c) => known[c]).filter(Boolean) as string[];
    if (!k.length) continue;
    const dest = k[k.length - 1];
    if (raw.length && raw[raw.length - 1].icao === dest) continue;
    raw.push({ icao: dest, date: l.date });
  }
  return raw.slice(0, 12).map((s, i, a) => {
    const nx = a[i + 1]?.date; const n = s.date && nx ? dayDiff(s.date, nx) : 0;
    return n >= 2 ? { icao: s.icao, arriveDate: s.date, layover: "multi", nights: Math.min(14, n) } : n === 1 ? { icao: s.icao, arriveDate: s.date, layover: "overnight" } : { icao: s.icao, arriveDate: s.date, layover: "quick" };
  });
}

// ---------------- Duty and rest (advisory only) ----------------
// Part 117 Table A / Table B (unaugmented), 117.25(e) 10 h rest, 117.23 cumulative; Part 135.267 unscheduled 1/2-pilot.
// Part 91 has no FAA crew duty or rest limits (91K fractional excepted), so it uses the company's own numbers.
const TABLE_B: [number, number[]][] = [ // [start hour from, limits for 1..7+ segments]
  [0, [9, 9, 9, 9, 9, 9, 9]], [4, [10, 10, 10, 10, 9, 9, 9]], [5, [12, 12, 12, 12, 11.5, 11, 10.5]], [6, [13, 13, 12, 12, 11.5, 11, 10.5]],
  [7, [14, 14, 13, 13, 12.5, 12, 11.5]], [12, [13, 13, 13, 13, 12.5, 12, 11.5]], [13, [12, 12, 12, 12, 11.5, 11, 10.5]],
  [17, [12, 12, 11, 11, 10, 9, 9]], [22, [11, 11, 10, 10, 9, 9, 9]], [23, [10, 10, 10, 9, 9, 9, 9]],
];
export function table117(reportHHMM: string, segments: number) {
  const h = Number(reportHHMM.slice(0, 2)) || 0;
  const row = [...TABLE_B].reverse().find(([from]) => h >= from)![1];
  const fdp = row[Math.min(7, Math.max(1, Math.round(segments))) - 1];
  const flight = h < 5 || h >= 20 ? 8 : 9;
  return { fdp, flight };
}
export type DutyRules = "117" | "135" | "91";
export type DutyIn = {
  rules: DutyRules; reportDate: string; reportTime: string; releaseAt?: string | null; // previous release, "YYYY-MM-DDTHH:MM"
  segments?: number; pilots?: 1 | 2; flightHours?: number; flight24?: number; fdp168?: number; flight672?: number; off30?: boolean;
  companyDuty?: number; companyRest?: number;
};
export type Check = { ok: boolean | null; label: string; detail: string };
export type DutyOut = { dutyEnds: string; maxDuty: number; maxFlight: number | null; restHours: number | null; nextReport: string; checks: Check[]; basis: string };
const toMs = (dt: string) => Date.parse(dt + ":00Z"); // naive clock: every time is on the same clock
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 16);
export function dutyCalc(i: DutyIn): DutyOut {
  const report = toMs(`${i.reportDate}T${i.reportTime}`);
  const rest = i.releaseAt ? (report - toMs(i.releaseAt)) / 3_600_000 : null;
  const checks: Check[] = [];
  const fh = i.flightHours ?? 0;
  let maxDuty: number; let maxFlight: number | null; let minRest: number; let basis: string;
  if (i.rules === "117") {
    const t = table117(i.reportTime, i.segments || 1);
    maxDuty = t.fdp; maxFlight = t.flight; minRest = 10;
    basis = `Part 117 Table B: report ${i.reportTime} acclimated, ${Math.max(1, i.segments || 1)} segment${(i.segments || 1) > 1 ? "s" : ""} = ${t.fdp} h FDP. Table A: ${t.flight} h flight time.`;
    if (i.flightHours != null) checks.push({ ok: fh <= t.flight, label: "Flight time", detail: `${fh} h planned, ${t.flight} h max (Table A)` });
    if (i.fdp168 != null) { const room = Math.max(0, 60 - i.fdp168); if (room < maxDuty) maxDuty = room;
      checks.push({ ok: room >= t.fdp ? true : room > 0 ? null : false, label: "FDP, last 168 h", detail: `${i.fdp168} h so far; limit 60 h (117.23(c))${room < t.fdp ? `, so this duty is capped at ${room} h` : ""}` }); }
    if (i.flight672 != null) checks.push({ ok: i.flight672 + fh <= 100, label: "Flight time, last 672 h", detail: `${i.flight672 + fh} h with this trip; limit 100 h (117.23(b))` });
    if (i.off30 != null) checks.push({ ok: i.off30, label: "30 h off in last 168 h", detail: "117.25(b): 30 consecutive hours free from all duty in the past 168 hours" });
  } else if (i.rules === "135") {
    const lim = i.pilots === 1 ? 8 : 10;
    maxDuty = 14; maxFlight = lim; minRest = 10;
    basis = `Part 135.267 (unscheduled, ${i.pilots === 1 ? "one pilot" : "two pilots"}): ${lim} h flight time in any 24 consecutive hours; with 10 h rest before, the assignment must end within 24 h of the start of that rest, so duty ends by report + 14 h.`;
    const f24 = i.flight24 ?? fh;
    checks.push({ ok: f24 <= lim, label: "Flight time in 24 h", detail: `${f24} h incl. other commercial flying; limit ${lim} h (135.267(b))` });
    checks.push({ ok: null, label: "If you go over", detail: "Weather and the like: 11 h rest if over by up to 30 min, 12 h up to 60 min, 16 h beyond (135.267(e))." });
  } else {
    maxDuty = i.companyDuty || 14; maxFlight = null; minRest = i.companyRest || 10;
    basis = `Part 91 has no FAA duty or rest limits for flight crew (91 subpart K fractional is different). Using your company limits: ${maxDuty} h duty, ${minRest} h rest.`;
  }
  if (rest != null) checks.unshift({ ok: rest >= minRest, label: "Rest before report", detail: `${Math.round(rest * 10) / 10} h since release; ${minRest} h needed${i.rules === "117" ? " incl. 8 h sleep opportunity (117.25(e))" : i.rules === "135" ? " (135.267(d))" : ""}` });
  const ends = report + maxDuty * 3_600_000;
  return { dutyEnds: fromMs(ends), maxDuty, maxFlight, restHours: rest, nextReport: fromMs(ends + minRest * 3_600_000), checks, basis };
}
