import { AIRCRAFT_IDS } from "./aircraft";
import { pgTable, text, integer, serial, bigint, doublePrecision, index, uniqueIndex } from "drizzle-orm/pg-core";
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

export const airports = pgTable("airports", {
  icao: text("icao").primaryKey(),
  iata: text("iata"),
  name: text("name").notNull(),
  city: text("city").notNull(),
  region: text("region"),
  country: text("country").notNull().default("US"),
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
});
export const insertAirportSchema = createInsertSchema(airports);
export type InsertAirport = z.infer<typeof insertAirportSchema>;
export type Airport = typeof airports.$inferSelect;

export const spots = pgTable("spots", {
  id: serial("id").primaryKey(),
  icao: text("icao").notNull(),
  category: text("category").notNull(), // eat | do | stay | fbo
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  address: text("address").default(""),
  website: text("website").default(""),
  costLevel: integer("cost_level").notNull().default(1), // 0 free, 1 $, 2 $$, 3 $$$, 4 $$$$
  minutesNeeded: integer("minutes_needed").notNull().default(60),
  milesFromField: doublePrecision("miles_from_field").default(0),
  crewTip: text("crew_tip").default(""),
  tags: text("tags").notNull().default("[]"), // JSON array
  submittedBy: text("submitted_by").default("Anonymous crew"),
  userId: integer("user_id"),
  status: text("status").notNull().default("live"), // live | pending | hidden
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
  pace: text("pace"), // eat only: grab | sit (null = derived from minutesNeeded)
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  placeRef: text("place_ref"), // e.g. osm:N1576341770
  // AI moderation: "" (not checked / legacy) | checking | approved | flagged. A held edit to a live listing waits in pendingEdit (JSON).
  modState: text("mod_state").notNull().default(""),
  modNote: text("mod_note").notNull().default(""),
  modAttempts: integer("mod_attempts").notNull().default(0),
  pendingEdit: text("pending_edit"),
}, (t) => [index("spots_icao_idx").on(t.icao), index("spots_user_idx").on(t.userId)]);
export const insertSpotSchema = createInsertSchema(spots, {
  icao: z.string().min(3).max(4),
  category: z.enum(CATEGORIES),
  name: z.string().min(2, "Give it a name").max(120),
  costLevel: z.coerce.number().int().min(0).max(4).optional(), // required per category in the submit route
  minutesNeeded: z.coerce.number().int().min(5).max(10080).default(60),
  pace: z.enum(["grab", "sit", "both"]).nullable().optional(),
  lat: z.number().min(-90).max(90).nullable().optional(),
  lng: z.number().min(-180).max(180).nullable().optional(),
  placeRef: z.string().max(40).nullable().optional(),
}).omit({ id: true, createdAt: true, modState: true, modNote: true, modAttempts: true, pendingEdit: true });
export type InsertSpot = z.infer<typeof insertSpotSchema>;
export type Spot = typeof spots.$inferSelect;

export const reviews = pgTable("reviews", {
  id: serial("id").primaryKey(),
  spotId: integer("spot_id").notNull(),
  rating: integer("rating").notNull(),
  comment: text("comment").notNull().default(""),
  author: text("author").default("Anonymous crew"),
  crewRole: text("crew_role").default("Crew"),
  userId: integer("user_id"),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
  costLevel: integer("cost_level"), // optional price vote: 0 free … 4 $$$$
  status: text("status").notNull().default("live"), // live | pending | rejected (only live ratings count)
  modState: text("mod_state").notNull().default(""),
  modNote: text("mod_note").notNull().default(""),
  modAttempts: integer("mod_attempts").notNull().default(0),
  pendingEdit: text("pending_edit"),
}, (t) => [index("reviews_spot_idx").on(t.spotId), index("reviews_user_idx").on(t.userId)]);
export const insertReviewSchema = createInsertSchema(reviews, {
  // 1-5 stars, or 0 = "Go around" (crew says avoid this place)
  rating: z.coerce.number().int().min(0, "Pick a rating").max(5),
  comment: z.string().max(1500),
  costLevel: z.number().int().min(0).max(4).nullable().optional(),
}).omit({ id: true, createdAt: true, status: true, modState: true, modNote: true, modAttempts: true, pendingEdit: true });
export type InsertReview = z.infer<typeof insertReviewSchema>;
export type Review = typeof reviews.$inferSelect;

export const ads = pgTable("ads", {
  id: serial("id").primaryKey(),
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

export type SpotWithStats = Spot & {
  avgRating: number | null; reviewCount: number; airport?: Airport; vet: VetInfo;
  /** crew price: median of the submitter's price and every rating's price vote (null = not priced yet) */
  cost: number | null; costVotes: number;
  /** ratings of 0 ("Go around": avoid this place) */
  goArounds: number;
};

/** A rating of 0 means "Go around": the crew member says avoid this place. */
export const GO_AROUND = 0;

// ---- Favorites (per crew member; always included in their trip briefings) ----
export const favorites = pgTable("favorites", {
  userId: integer("user_id").notNull(),
  spotId: integer("spot_id").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
}, (t) => [uniqueIndex("favorites_user_spot_idx").on(t.userId, t.spotId), index("favorites_spot_idx").on(t.spotId)]);
export type Favorite = typeof favorites.$inferSelect;

// ---- Trip briefings (saved layover plans) ----
export const briefings = pgTable("briefings", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  title: text("title").notNull().default(""),
  stops: text("stops").notNull().default("[]"), // JSON BriefingStop[]
  shareToken: text("share_token").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull().default(0),
}, (t) => [index("briefings_user_idx").on(t.userId), uniqueIndex("briefings_share_idx").on(t.shareToken)]);
export type Briefing = typeof briefings.$inferSelect;
export const LAYOVERS = [
  { id: "quick", label: "Quick turn", sub: "under 1 hr" },
  { id: "hours", label: "A few hours", sub: "1–6 hrs" },
  { id: "overnight", label: "Overnight", sub: "1 night" },
  { id: "multi", label: "Several days", sub: "2+ nights" },
] as const;
export type LayoverId = (typeof LAYOVERS)[number]["id"];
export type BriefingStop = { icao: string; layover: LayoverId; nights?: number; picks: number[] };
export const briefingSchema = z.object({
  title: z.string().trim().max(80).default(""),
  stops: z.array(z.object({
    icao: z.string().trim().min(3).max(4),
    layover: z.enum(["quick", "hours", "overnight", "multi"]),
    nights: z.coerce.number().int().min(1).max(14).optional(),
    picks: z.array(z.coerce.number().int()).max(20).default([]),
  })).min(1, "Add at least one stop").max(12),
});

// ---- Crew votes (up/down) on listings and reviews ----
export const votes = pgTable("votes", {
  id: serial("id").primaryKey(),
  targetType: text("target_type").notNull(), // spot | review
  targetId: integer("target_id").notNull(),
  voter: text("voter").notNull(),
  value: integer("value").notNull(), // 1 or -1
  reason: text("reason").default(""),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
}, (t) => [uniqueIndex("votes_unique").on(t.targetType, t.targetId, t.voter), index("votes_voter_idx").on(t.voter)]);
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
export type ReviewWithVotes = Review & { up: number; down: number; myVote: number; authorId?: number | null };

// ---- Crew accounts ----
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  email: text("email").unique(), // optional; used only for password reset
  displayName: text("display_name").notNull(),
  crewRole: text("crew_role").notNull().default("Crew"),
  homeBase: text("home_base").default(""),
  passwordHash: text("password_hash").notNull(),
  bonusPoints: integer("bonus_points").notNull().default(0),
  anonymous: integer("anonymous").notNull().default(0),
  aircraft: text("aircraft").notNull().default(""), // profile icon, see shared/aircraft.ts
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
});
export type User = typeof users.$inferSelect;
export const sessions = pgTable("sessions", {
  token: text("token").primaryKey(), // stored as SHA-256 hash of the bearer token
  userId: integer("user_id").notNull(),
  createdAt: bigint("created_at", { mode: "number" }).notNull().default(0),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull().default(0),
}, (t) => [index("sessions_user_idx").on(t.userId)]);
export const passwordResets = pgTable("password_resets", {
  tokenHash: text("token_hash").primaryKey(),
  userId: integer("user_id").notNull(),
  expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
  usedAt: bigint("used_at", { mode: "number" }),
});
export const CREW_ROLES = ["Pilot", "Flight Attendant", "Mechanic", "Other"] as const;
const roleSchema = z.enum(CREW_ROLES, { message: "Pick Pilot, Flight Attendant, Mechanic or Other" });
export const signupSchema = z.object({
  handle: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,24}$/, "Handle: 3–24 letters, numbers, . _ -"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  displayName: z.string().trim().min(2, "Add a display name").max(40),
  crewRole: roleSchema.default("Pilot"),
  homeBase: z.string().trim().toUpperCase().max(4).optional().default(""),
  anonymous: z.boolean().optional().default(false),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("That email doesn't look right")]).optional().default(""),
  acceptTerms: z.literal(true, { message: "Please accept the Terms and Community Guidelines" }).optional(),
});
export const updateMeSchema = z.object({
  displayName: z.string().trim().min(2, "Add a display name").max(40).optional(),
  crewRole: roleSchema.optional(),
  homeBase: z.string().trim().toUpperCase().max(4).optional(),
  anonymous: z.boolean().optional(),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("That email doesn't look right")]).optional(),
  aircraft: z.string().refine((v) => v === "" || (AIRCRAFT_IDS as readonly string[]).includes(v), "Pick an aircraft from the list").optional(),
});
export const loginSchema = z.object({ handle: z.string().trim().toLowerCase(), password: z.string() });
export const forgotSchema = z.object({ email: z.string().trim().toLowerCase().email("Enter the email on your account") });
export const resetSchema = z.object({ token: z.string().min(20, "That reset link is incomplete. Copy the full link from the email, or request a new one."), password: z.string().min(8, "Password must be at least 8 characters") });
