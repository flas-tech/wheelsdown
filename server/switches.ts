/**
 * Audience switches for the Flight Crew View catch-up batches (Oct 2026). Each starts admin-only
 * ('admins') in app_settings and is opened from Settings by an admin.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { logChange } from "./ops";

export type Audience = "admins" | "members";
export function makeSwitch(key: string, label: string) {
  let cur = { at: 0, v: "admins" as Audience };
  const audience = async (): Promise<Audience> => {
    if (Date.now() - cur.at < 15_000) return cur.v;
    const r = ((await db().execute(sql`SELECT value FROM app_settings WHERE key = ${key}`).catch(() => ({ rows: [] }))).rows[0] as any);
    cur = { at: Date.now(), v: r?.value === "members" ? "members" : "admins" };
    return cur.v;
  };
  const register = (app: Express, path: string, requireAdmin: (req: Request, res: Response, next: NextFunction) => any, count?: () => Promise<number>) => {
    void db().execute(sql`INSERT INTO app_settings (key, value) VALUES (${key}, 'admins') ON CONFLICT (key) DO NOTHING`).catch(() => {});
    app.get(path, requireAdmin, async (_req, res) => res.json({ audience: await audience(), votes: count ? await count().catch(() => 0) : 0, people: 0 }));
    app.put(path, requireAdmin, async (req, res) => {
      const v: Audience = req.body?.audience === "members" ? "members" : "admins";
      await db().execute(sql`INSERT INTO app_settings (key, value) VALUES (${key}, ${v}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
      cur = { at: Date.now(), v };
      await logChange({ actor: (req as any).adminName || "Admin", kind: "admin", action: key, entity: "settings", entityId: 0, summary: v === "members" ? `${label} opened to members` : `${label} back to admins only` });
      res.json({ audience: v });
    });
  };
  return { audience, register };
}
export const layoverTools = makeSwitch("layover_tools_audience", "Layover tools (hotel sheet, forecast, abroad card, delay alerts)");
export const crewNetwork = makeSwitch("crew_network_audience", "Crew network (overlap alerts, trip crew chat, family link)");
export const scheduleTools = makeSwitch("schedule_tools_audience", "Schedule tools (calendar import, alarms, offline trips, duty calculator)");
