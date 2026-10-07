import type { Express, Request, Response, NextFunction } from "express";
import { rateLimit } from "express-rate-limit";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { FEEDBACK_KINDS, FEEDBACK_MAX, FEEDBACK_STATUSES } from "@shared/feedback";

type Mw = (req: Request, res: Response, next: NextFunction) => any;
const kinds = FEEDBACK_KINDS.map(([k]) => k) as [string, ...string[]];
const submit = z.object({
  kind: z.enum(kinds), message: z.string().trim().min(5, "Tell us a little more").max(FEEDBACK_MAX),
  contact: z.string().trim().max(120).optional().default(""), page: z.string().max(200).optional().default(""),
  website: z.string().optional(), // honeypot: real people never fill this
});
const device = (ua: string) => {
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  const b = /CriOS|Chrome\//.test(ua) && !/Edg\//.test(ua) ? "Chrome" : /Edg\//.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${b} on ${os}${/Wheelsdown-PWA|standalone/.test(ua) ? " (home screen)" : ""}`;
};

/** Crew feedback: anyone can send it (signed in or not); only admins can read it. Private, never shown publicly, no points. */
export function registerFeedback(app: Express, opts: { userOf: (req: Request) => Promise<{ id: number } | undefined>; requireAdmin: Mw }) {
  const limit = rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { message: "That's a lot of feedback at once. Try again in a little while." } });
  app.post("/api/feedback", limit, async (req, res) => {
    const p = submit.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message || "Check the form and try again" });
    if (p.data.website) return res.json({ ok: true }); // quietly drop bots
    const u = await opts.userOf(req);
    const now = Date.now();
    await db().execute(sql`INSERT INTO feedback (user_id, kind, message, contact, page, device, status, admin_note, created_at, updated_at)
      VALUES (${u?.id ?? null}, ${p.data.kind}, ${p.data.message}, ${p.data.contact}, ${p.data.page}, ${device(String(req.headers["user-agent"] || ""))}, 'new', '', ${now}, ${now})`);
    res.json({ ok: true });
  });
  app.get("/api/admin/feedback", opts.requireAdmin, async (req, res) => {
    const st = String(req.query.status || "open");
    const where = st === "all" ? sql`TRUE` : st === "open" ? sql`f.status IN ('new','reviewing')` : sql`f.status = ${st}`;
    const rows = (await db().execute(sql`SELECT f.id, f.kind, f.message, f.contact, f.page, f.device, f.status, f.admin_note AS "adminNote",
        f.created_at::float8 AS "createdAt", f.updated_at::float8 AS "updatedAt", f.user_id AS "userId", u.display_name AS "userName", u.handle
      FROM feedback f LEFT JOIN users u ON u.id = f.user_id WHERE ${where} ORDER BY f.created_at DESC LIMIT 500`)).rows;
    const counts = Object.fromEntries(((await db().execute(sql`SELECT status, COUNT(*)::int AS n FROM feedback GROUP BY status`)).rows as any[]).map((r) => [r.status, r.n]));
    res.json({ items: rows, counts });
  });
  app.patch("/api/admin/feedback/:id", opts.requireAdmin, async (req, res) => {
    const p = z.object({ status: z.enum(FEEDBACK_STATUSES).optional(), adminNote: z.string().max(1000).optional() }).safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: "Invalid update" });
    const id = Number(req.params.id), now = Date.now();
    if (p.data.status) await db().execute(sql`UPDATE feedback SET status = ${p.data.status}, updated_at = ${now} WHERE id = ${id}`);
    if (p.data.adminNote !== undefined) await db().execute(sql`UPDATE feedback SET admin_note = ${p.data.adminNote}, updated_at = ${now} WHERE id = ${id}`);
    res.json({ ok: true });
  });
  app.delete("/api/admin/feedback/:id", opts.requireAdmin, async (req, res) => {
    await db().execute(sql`DELETE FROM feedback WHERE id = ${Number(req.params.id)}`);
    res.json({ ok: true });
  });
}
