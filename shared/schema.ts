import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const CATEGORIES = ["eat", "do", "stay", "fbo"] as const;
export type Category = (typeof CATEGORIES)[number];

// Time buckets, in minutes of free time required
export const TIME_BUCKETS = [
  { id: "quick", label: "Quick turn", sub: "under 1 hr", max: 60 },
  { id: "short", label: "A few hours", sub: "1–4 hrs", max: 240 },
  { id: "half", label: "Half day", sub: "4–8 hrs", max: 480 },
  { id: "day", label: "Full day", sub: "8–24 hrs", max: 1440 },
  { id: "multi", label: "Multi-day", sub: "24 hrs +", max: 99999 },
] as const;

export const airports = sqliteTable("airports", {
  icao: text("icao").primaryKey(),
  iata: text("iata"),
  name: text("name").notNull(),
  city: text("city").notNull(),
  region: text("region"),
  country: text("country").notNull().default("US"),
});
export const insertAirportSchema = createInsertSchema(airports);
export type InsertAirport = z.infer<typeof insertAirportSchema>;
export type Airport = typeof airports.$inferSelect;

export const spots = sqliteTable("spots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  icao: text("icao").notNull(),
  category: text("category").notNull(), // eat | do | stay | fbo
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  address: text("address").default(""),
  website: text("website").default(""),
  costLevel: integer("cost_level").notNull().default(1), // 0 free, 1 $, 2 $$, 3 $$$, 4 $$$$
  minutesNeeded: integer("minutes_needed").notNull().default(60),
  milesFromField: real("miles_from_field").default(0),
  crewTip: text("crew_tip").default(""),
  tags: text("tags").notNull().default("[]"), // JSON array
  submittedBy: text("submitted_by").default("Anonymous crew"),
  status: text("status").notNull().default("live"), // live | pending | hidden
  createdAt: integer("created_at").notNull().default(0),
});
export const insertSpotSchema = createInsertSchema(spots, {
  icao: z.string().min(3).max(4),
  category: z.enum(CATEGORIES),
  name: z.string().min(2, "Give it a name").max(120),
  costLevel: z.coerce.number().int().min(0).max(4),
  minutesNeeded: z.coerce.number().int().min(5).max(10080),
}).omit({ id: true, createdAt: true });
export type InsertSpot = z.infer<typeof insertSpotSchema>;
export type Spot = typeof spots.$inferSelect;

export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  spotId: integer("spot_id").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull().default(""),
  author: text("author").default("Anonymous crew"),
  crewRole: text("crew_role").default("Crew"),
  createdAt: integer("created_at").notNull().default(0),
});
export const insertReviewSchema = createInsertSchema(reviews, {
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().max(1500),
}).omit({ id: true, createdAt: true });
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;

export const ads = sqliteTable("ads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slot: text("slot").notNull().default("inline"), // top | inline | footer
  advertiser: text("advertiser").notNull(),
  headline: text("headline").notNull(),
  body: text("body").default(""),
  cta: text("cta").default("Learn more"),
  url: text("url").default(""),
  targetIcao: text("target_icao").default(""), // blank = run of network
  active: integer("active").notNull().default(1),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
});
export const insertAdSchema = createInsertSchema(ads).omit({ id: true, impressions: true, clicks: true });
export type InsertAd = z.infer<typeof insertAdSchema>;
export type Ad = typeof ads.$inferSelect;

export type SpotWithStats = Spot & { avgRating: number | null; reviewCount: number; airport?: Airport; vet: VetInfo };

// ---- Crew votes (up/down) on listings and reviews ----
export const votes = sqliteTable("votes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  targetType: text("target_type").notNull(), // spot | review
  targetId: integer("target_id").notNull(),
  voter: text("voter").notNull(),
  value: integer("value").notNull(), // 1 or -1
  reason: text("reason").default(""),
  createdAt: integer("created_at").notNull().default(0),
});
export type Vote = typeof votes.$inferSelect;

export const DOWN_REASONS = [
  { id: "closed", label: "Closed / gone" },
  { id: "outdated", label: "Info outdated" },
  { id: "location", label: "Wrong location" },
  { id: "not_worth", label: "Not worth it" },
  { id: "not_crew", label: "Not crew-friendly" },
  { id: "other", label: "Other" },
] as const;

export type VetLevel = "vetted" | "needs_check" | "new" | "ok";
export type VetInfo = {
  up: number; down: number; score: number; level: VetLevel;
  lastUpAt: number | null; reasons: Record<string, number>; myVote: number;
};
export type ReviewWithVotes = Review & { up: number; down: number; myVote: number };
