// Schedule tools (admins first, schedule_tools_audience): check codes for trip import, and a calendar file
// (.ics) for a trip sheet with lobby/report alarms. The duty calculator runs in the browser (shared/schedule.ts).
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { randomBytes } from "crypto";
import tzlookup from "tz-lookup";
import { db } from "./db";
import type { User } from "@shared/schema";
import { storage } from "./storage";
import { refAirport } from "./airportsData";
import { scheduleTools } from "./switches";
import { stopNights, addDays } from "@shared/crewNetwork";

const APP_URL = process.env.APP_URL || "https://getwheelsdown.com";
const num = (v: unknown) => Number(v) || 0;
const FILES = new Map<string, { body: string; file: string; exp: number }>();
const tzOf = (lat: unknown, lon: unknown) => { try { return lat != null && lon != null ? tzlookup(Number(lat), Number(lon)) : null; } catch { return null; } };

/** Local wall time at tz -> UTC ms. */
export function zonedToUtc(date: string, time: string, tz: string | null) {
  const naive = Date.parse(`${date}T${time}:00Z`);
  if (!tz) return naive;
  const off = (ms: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`) - ms;
  };
  let t = naive - off(naive); t = naive - off(t); return t;
}
const icsEsc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsUtc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
const icsDate = (d: string) => d.replace(/-/g, "");
const fold = (l: string) => { const out: string[] = []; let s = l; while (s.length > 74) { out.push(s.slice(0, 74)); s = " " + s.slice(74); } out.push(s); return out.join("\r\n"); };

export function registerScheduleTools(app: Express, o: {
  isSuperAdmin: (u?: User | null) => boolean;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => any; requireUser: (req: Request, res: Response, next: NextFunction) => any;
}) {
  scheduleTools.register(app, "/api/admin/schedule-tools", o.requireAdmin);
  const gate = async (req: Request, res: Response) => {
    const u = (req as any).user as User;
    if ((await scheduleTools.audience()) === "members" || o.isSuperAdmin(u)) return u;
    res.status(404).json({ message: "Not found" }); return null;
  };
  const airport = async (code: string) => {
    const a: any = (await storage.resolveCode(code)) || refAirport(code);
    return a ? { icao: String(a.icao), name: String(a.name || ""), city: [a.city, a.region].filter(Boolean).join(", "), country: String(a.country || ""), tz: tzOf(a.lat, a.lon) } : null;
  };

  // Which of these tokens are airports we know (ICAO, IATA, FAA LIDs)?
  app.post("/api/schedule/resolve", o.requireUser, async (req, res) => {
    if (!(await gate(req, res))) return;
    const codes = Array.from(new Set((Array.isArray(req.body?.codes) ? req.body.codes : []).map((c: unknown) => String(c).toUpperCase().trim()).filter((c: string) => /^[A-Z0-9]{3,4}$/.test(c)))).slice(0, 80) as string[];
    const out: Record<string, { icao: string; name: string; city: string } | null> = {};
    for (const c of codes) { const a = await airport(c); out[c] = a ? { icao: a.icao, name: a.name, city: a.city } : null; }
    res.json({ airports: out });
  });

  // Calendar file for one of your trip sheets: a day block per stop, plus lobby/report times with an alarm.
  app.post("/api/schedule/ics/:id", o.requireUser, async (req, res) => {
    const u = await gate(req, res); if (!u) return;
    const b = (await db().execute(sql`SELECT id, user_id, title, stops FROM briefings WHERE id = ${num(req.params.id)}`)).rows[0] as any;
    if (!b || num(b.user_id) !== u.id) return res.status(404).json({ message: "Trip sheet not found" });
    let stops: any[] = []; try { stops = JSON.parse(b.stops); } catch {}
    const alarm = Math.min(240, Math.max(0, num(req.body?.alarm) || 60));
    const times: { stop: number; kind: "lobby" | "report"; date: string; time: string }[] = (Array.isArray(req.body?.times) ? req.body.times : [])
      .filter((t: any) => Number.isInteger(t?.stop) && stops[t.stop] && /^\d{4}-\d{2}-\d{2}$/.test(t?.date) && /^\d{2}:\d{2}$/.test(t?.time) && (t.kind === "lobby" || t.kind === "report")).slice(0, 40);
    const title = String(b.title || "Trip").trim() || "Trip";
    const link = `${APP_URL}/#/brief/${num(b.id)}`;
    const now = icsUtc(Date.now());
    const L: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wheelsdown//Trip sheet//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEsc(title)}`];
    let n = 0;
    for (let i = 0; i < stops.length; i++) {
      const s = stops[i]; const a = await airport(String(s.icao || "")); if (!a) continue;
      const where = a.city ? `${a.icao} (${a.city})` : a.icao;
      if (s.arriveDate && /^\d{4}-\d{2}-\d{2}$/.test(s.arriveDate)) {
        const nights = stopNights(s.layover, s.nights);
        L.push("BEGIN:VEVENT", `UID:wd-${num(b.id)}-stop-${i}@getwheelsdown.com`, `DTSTAMP:${now}`, `DTSTART;VALUE=DATE:${icsDate(s.arriveDate)}`, `DTEND;VALUE=DATE:${icsDate(addDays(s.arriveDate, Math.max(1, nights)))}`,
          `SUMMARY:${icsEsc(`${nights ? "Layover" : "Stop"} ${where}`)}`, `LOCATION:${icsEsc(a.name || a.icao)}`, `DESCRIPTION:${icsEsc(`${title}. Trip sheet: ${link}`)}`, "TRANSP:TRANSPARENT", "END:VEVENT"); n++;
      }
      for (const t of times.filter((x) => x.stop === i)) {
        const at = zonedToUtc(t.date, t.time, a.tz);
        const what = t.kind === "lobby" ? "Lobby" : "Report";
        L.push("BEGIN:VEVENT", `UID:wd-${num(b.id)}-${t.kind}-${i}-${t.date}@getwheelsdown.com`, `DTSTAMP:${now}`, `DTSTART:${icsUtc(at)}`, `DTEND:${icsUtc(at + 15 * 60_000)}`,
          `SUMMARY:${icsEsc(`${what} ${t.time} local - ${a.icao}`)}`, `LOCATION:${icsEsc(a.name || a.icao)}`, `DESCRIPTION:${icsEsc(`${title}. ${what} time ${t.time} local at ${where}. Trip sheet: ${link}`)}`);
        if (alarm) L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`${what} at ${t.time} local`)}`, `TRIGGER:-PT${alarm}M`, "END:VALARM");
        L.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${icsEsc(`${what} now`)}`, "TRIGGER:PT0M", "END:VALARM", "END:VEVENT"); n++;
      }
    }
    L.push("END:VCALENDAR");
    if (!n) return res.status(400).json({ message: "Add arrival dates to your stops, or a lobby or report time, first." });
    const file = `${title.replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 40) || "trip"}.ics`;
    const body = L.map(fold).join("\r\n") + "\r\n";
    // iPhone Calendar opens a plain link to a .ics best, so hand back a link that works for 10 minutes.
    const tok = randomBytes(18).toString("base64url");
    for (const [k, v] of Array.from(FILES.entries())) if (v.exp < Date.now()) FILES.delete(k);
    FILES.set(tok, { body, file, exp: Date.now() + 10 * 60_000 });
    res.json({ url: `/api/schedule/ics-file/${tok}/${encodeURIComponent(file)}`, events: n });
  });
  app.get("/api/schedule/ics-file/:tok/:name", (req, res) => {
    const f = FILES.get(String(req.params.tok));
    if (!f || f.exp < Date.now()) return res.status(404).type("text/plain").send("This calendar link has expired. Make a new one from the trip sheet.");
    res.set({ "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `inline; filename="${f.file}"`, "Cache-Control": "no-store" }).send(f.body);
  });
}
