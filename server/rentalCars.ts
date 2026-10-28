/**
 * Rental cars (PJ's feedback #71): a fifth listing type, "car". Admins first: until app_settings rental_cars_audience
 * is "members", car listings are left out of everything members see (search, listing pages, feeds, profiles) and only
 * admins can add one. The cached value is read synchronously by storage, refreshed in the background.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { logChange } from "./ops";
import type { User } from "@shared/schema";

type Audience = "admins" | "members";
let cur: { at: number; v: Audience } = { at: 0, v: "admins" };
async function refresh() {
  try {
    const r = ((await db().execute(sql`SELECT value FROM app_settings WHERE key = 'rental_cars_audience'`)).rows[0] as any);
    cur = { at: Date.now(), v: r?.value === "members" ? "members" : "admins" };
  } catch { /* keep last value */ }
  return cur.v;
}
export async function rentalCarsAudience(): Promise<Audience> { return Date.now() - cur.at < 15_000 ? cur.v : refresh(); }
/** Sync read for storage queries: true once cars are open to members. */
export function carsOpenNow() { if (Date.now() - cur.at > 15_000) void refresh(); return cur.v === "members"; }

export function registerRentalCars(app: Express, o: {
  userOf: (req: Request) => Promise<User | null | undefined>; isSuperAdmin: (u?: User | null) => boolean;
  requireAdmin: (req: Request, res: Response, next: NextFunction) => any;
}) {
  void db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('rental_cars_audience', 'admins') ON CONFLICT (key) DO NOTHING`).then(refresh).catch(() => {});
  app.get("/api/admin/rental-cars", o.requireAdmin, async (_req, res) => {
    const n = ((await db().execute(sql`SELECT COUNT(*)::int AS n FROM spots WHERE category = 'car' AND status = 'live'`)).rows[0] as any)?.n || 0;
    res.json({ audience: await rentalCarsAudience(), votes: n, people: 0 });
  });
  app.put("/api/admin/rental-cars", o.requireAdmin, async (req, res) => {
    const v: Audience = req.body?.audience === "members" ? "members" : "admins";
    await db().execute(sql`INSERT INTO app_settings (key, value) VALUES ('rental_cars_audience', ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
    cur = { at: Date.now(), v };
    await logChange({ actor: (req as any).adminName || "Admin", kind: "admin", action: "rental_cars_audience", entity: "settings", summary: v === "members" ? "Rental cars opened to members" : "Rental cars back to admins only" });
    res.json({ audience: v });
  });
}
/** Can this request see car listings? */
export async function carsFor(u: User | null | undefined, isSuperAdmin: (u?: User | null) => boolean) {
  return (await rentalCarsAudience()) === "members" || (!!u && isSuperAdmin(u));
}
