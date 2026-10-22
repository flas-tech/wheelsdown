// Database connection.
// Production: set DATABASE_URL (Supabase pooler, Neon, Render Postgres — any Postgres 14+).
// Local dev without DATABASE_URL: an embedded Postgres (PGlite) stored in ./.pglite, so no server is needed.
import * as schema from "@shared/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

export type DB = NodePgDatabase<typeof schema>;

let _db: DB;
let _kind: "postgres" | "pglite";
let _close: () => Promise<void> = async () => {};

export async function initDb(): Promise<DB> {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || process.env.PGSSL === "disable";
    const pool = new Pool({
      connectionString: url,
      // Supabase/Neon require TLS. Their certificates chain to public CAs, but poolers can present
      // intermediate certs that Node doesn't bundle, so verification is relaxed unless PGSSL=verify.
      ssl: local ? false : { rejectUnauthorized: process.env.PGSSL === "verify" },
      max: Number(process.env.PG_POOL_MAX || 5),
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (e) => console.error("[db] idle client error", e.message));
    _db = drizzle(pool, { schema }) as DB;
    _kind = "postgres";
    _close = () => pool.end();
  } else {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_EMBEDDED_DB !== "1") {
      throw new Error("DATABASE_URL is required in production (set ALLOW_EMBEDDED_DB=1 to override for a throwaway demo).");
    }
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const client = new PGlite(process.env.PGLITE_DIR || "./.pglite");
    _db = drizzle(client, { schema }) as unknown as DB;
    _kind = "pglite";
    _close = () => client.close();
  }
  await migrate(_db);
  return _db;
}

export const db = () => {
  if (!_db) throw new Error("initDb() has not run");
  return _db;
};
export const dbKind = () => _kind;
export const closeDb = () => _close();

// Idempotent schema bootstrap. Safe to run on every boot; add new columns with ADD COLUMN IF NOT EXISTS.
const MIGRATION = `
CREATE TABLE IF NOT EXISTS airports (icao text PRIMARY KEY, iata text, name text NOT NULL, city text NOT NULL, region text, country text NOT NULL DEFAULT 'US');
CREATE INDEX IF NOT EXISTS airports_iata_idx ON airports(iata);
CREATE TABLE IF NOT EXISTS spots (id serial PRIMARY KEY, icao text NOT NULL, category text NOT NULL, name text NOT NULL,
  description text NOT NULL DEFAULT '', address text DEFAULT '', website text DEFAULT '', cost_level integer NOT NULL DEFAULT 1,
  minutes_needed integer NOT NULL DEFAULT 60, miles_from_field double precision DEFAULT 0, crew_tip text DEFAULT '', tags text NOT NULL DEFAULT '[]',
  submitted_by text DEFAULT 'Anonymous crew', user_id integer, status text NOT NULL DEFAULT 'live', created_at bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS spots_icao_idx ON spots(icao);
CREATE INDEX IF NOT EXISTS spots_user_idx ON spots(user_id);
CREATE TABLE IF NOT EXISTS reviews (id serial PRIMARY KEY, spot_id integer NOT NULL, rating integer NOT NULL, comment text NOT NULL DEFAULT '',
  author text DEFAULT 'Anonymous crew', crew_role text DEFAULT 'Crew', user_id integer, created_at bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS reviews_spot_idx ON reviews(spot_id);
CREATE INDEX IF NOT EXISTS reviews_user_idx ON reviews(user_id);
CREATE TABLE IF NOT EXISTS ads (id serial PRIMARY KEY, slot text NOT NULL DEFAULT 'inline', advertiser text NOT NULL, headline text NOT NULL,
  body text DEFAULT '', cta text DEFAULT 'Learn more', url text DEFAULT '', target_icao text DEFAULT '', active integer NOT NULL DEFAULT 1,
  impressions integer NOT NULL DEFAULT 0, clicks integer NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS votes (id serial PRIMARY KEY, target_type text NOT NULL, target_id integer NOT NULL, voter text NOT NULL,
  value integer NOT NULL, reason text DEFAULT '', created_at bigint NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS votes_unique ON votes(target_type, target_id, voter);
CREATE INDEX IF NOT EXISTS votes_voter_idx ON votes(voter);
CREATE TABLE IF NOT EXISTS users (id serial PRIMARY KEY, handle text NOT NULL UNIQUE, email text UNIQUE, display_name text NOT NULL,
  crew_role text NOT NULL DEFAULT 'Crew', home_base text DEFAULT '', password_hash text NOT NULL, bonus_points integer NOT NULL DEFAULT 0,
  anonymous integer NOT NULL DEFAULT 0, created_at bigint NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token text PRIMARY KEY, user_id integer NOT NULL, created_at bigint NOT NULL DEFAULT 0, expires_at bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);
ALTER TABLE airports ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE airports ADD COLUMN IF NOT EXISTS lon double precision;
ALTER TABLE spots ADD COLUMN IF NOT EXISTS pace text;
ALTER TABLE spots ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE spots ADD COLUMN IF NOT EXISTS lng double precision;
ALTER TABLE spots ADD COLUMN IF NOT EXISTS place_ref text;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS cost_level integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS aircraft text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio text NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS interests text NOT NULL DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS wright_no integer;
ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by integer;
-- trip sheets ever made, for badges: deleting an old sheet keeps the credit, and it never drops below what's saved now
ALTER TABLE users ADD COLUMN IF NOT EXISTS briefs_made integer NOT NULL DEFAULT 0;
ALTER TABLE spots ADD COLUMN IF NOT EXISTS mod_state text NOT NULL DEFAULT '';
ALTER TABLE spots ADD COLUMN IF NOT EXISTS mod_note text NOT NULL DEFAULT '';
ALTER TABLE spots ADD COLUMN IF NOT EXISTS mod_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE spots ADD COLUMN IF NOT EXISTS pending_edit text;
ALTER TABLE spots ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'crew';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'live';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS mod_state text NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS mod_note text NOT NULL DEFAULT '';
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS mod_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS pending_edit text;
CREATE TABLE IF NOT EXISTS briefings (id serial PRIMARY KEY, user_id integer NOT NULL, title text NOT NULL DEFAULT '', stops text NOT NULL DEFAULT '[]',
  share_token text NOT NULL, created_at bigint NOT NULL DEFAULT 0, updated_at bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS briefings_user_idx ON briefings(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS briefings_share_idx ON briefings(share_token);
CREATE TABLE IF NOT EXISTS favorites (user_id integer NOT NULL, spot_id integer NOT NULL, created_at bigint NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS favorites_user_spot_idx ON favorites(user_id, spot_id);
CREATE INDEX IF NOT EXISTS favorites_spot_idx ON favorites(spot_id);
CREATE TABLE IF NOT EXISTS password_resets (token_hash text PRIMARY KEY, user_id integer NOT NULL, expires_at bigint NOT NULL, used_at bigint);
CREATE TABLE IF NOT EXISTS mod_log (id serial PRIMARY KEY, kind text NOT NULL, target_id integer NOT NULL, actor text NOT NULL, action text NOT NULL,
  problem text NOT NULL DEFAULT '', reason text NOT NULL DEFAULT '', is_edit integer NOT NULL DEFAULT 0, before text, after text, created_at bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS mod_log_target_idx ON mod_log(kind, target_id);
CREATE INDEX IF NOT EXISTS mod_log_created_idx ON mod_log(created_at);
CREATE TABLE IF NOT EXISTS follows (follower_id integer NOT NULL, followee_id integer NOT NULL, created_at bigint NOT NULL DEFAULT 0);
CREATE UNIQUE INDEX IF NOT EXISTS follows_pair_idx ON follows(follower_id, followee_id);
CREATE INDEX IF NOT EXISTS follows_followee_idx ON follows(followee_id);
CREATE TABLE IF NOT EXISTS metrics_daily (day text NOT NULL, kind text NOT NULL, key text NOT NULL DEFAULT '', n integer NOT NULL DEFAULT 0, PRIMARY KEY (day, kind, key));
CREATE TABLE IF NOT EXISTS mod_fixes (kind text NOT NULL, target_id integer NOT NULL, sig text NOT NULL, json text NOT NULL, created_at bigint NOT NULL DEFAULT 0, PRIMARY KEY (kind, target_id));
CREATE TABLE IF NOT EXISTS notices (id serial PRIMARY KEY, user_id integer NOT NULL, kind text NOT NULL, spot_id integer, other_id integer, status text NOT NULL DEFAULT 'open', decision text NOT NULL DEFAULT '', created_at bigint NOT NULL DEFAULT 0, resolved_at bigint);
CREATE INDEX IF NOT EXISTS notices_user_idx ON notices (user_id, status);
CREATE TABLE IF NOT EXISTS checkins (id serial PRIMARY KEY, user_id integer NOT NULL, spot_id integer, icao text NOT NULL, lat double precision, lng double precision, created_at bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS checkins_user_idx ON checkins (user_id, created_at);
CREATE TABLE IF NOT EXISTS feedback (id serial PRIMARY KEY, user_id integer, kind text NOT NULL DEFAULT 'other', message text NOT NULL, contact text NOT NULL DEFAULT '', page text NOT NULL DEFAULT '', device text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'new', admin_note text NOT NULL DEFAULT '', created_at bigint NOT NULL DEFAULT 0, updated_at bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS feedback_status_idx ON feedback (status, created_at);
CREATE TABLE IF NOT EXISTS ai_usage_daily (day text NOT NULL, purpose text NOT NULL, calls integer NOT NULL DEFAULT 0, failures integer NOT NULL DEFAULT 0, input_tokens bigint NOT NULL DEFAULT 0, cached_tokens bigint NOT NULL DEFAULT 0, output_tokens bigint NOT NULL DEFAULT 0, searches integer NOT NULL DEFAULT 0, PRIMARY KEY (day, purpose));
CREATE TABLE IF NOT EXISTS visitors_daily (day text NOT NULL, vid text NOT NULL, signed_in integer NOT NULL DEFAULT 0, PRIMARY KEY (day, vid));
CREATE TABLE IF NOT EXISTS app_settings (key text PRIMARY KEY, value text NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS ai_picks (id serial PRIMARY KEY, icao text NOT NULL, category text NOT NULL, meal text NOT NULL DEFAULT '', name text NOT NULL, address text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '', description text NOT NULL DEFAULT '', cost_level integer, pace text, minutes_needed integer, tags text NOT NULL DEFAULT '[]', lat double precision, lng double precision, miles double precision, sources text NOT NULL DEFAULT '[]', status text NOT NULL DEFAULT 'live', created_at bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS ai_picks_icao_idx ON ai_picks (icao, status);
ALTER TABLE ai_picks ADD COLUMN IF NOT EXISTS focus text NOT NULL DEFAULT '';
ALTER TABLE ai_picks ADD COLUMN IF NOT EXISTS spot_id integer;
ALTER TABLE ai_picks ADD COLUMN IF NOT EXISTS bonus_user_id integer;
ALTER TABLE ai_picks ADD COLUMN IF NOT EXISTS draft boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS error_log (id serial PRIMARY KEY, fingerprint text NOT NULL, level text NOT NULL DEFAULT 'error', source text NOT NULL, message text NOT NULL, path text NOT NULL DEFAULT '', method text NOT NULL DEFAULT '', status_code integer, user_id integer, detail text NOT NULL DEFAULT '', count integer NOT NULL DEFAULT 1, first_at bigint NOT NULL DEFAULT 0, last_at bigint NOT NULL DEFAULT 0, resolved boolean NOT NULL DEFAULT false, resolved_by text NOT NULL DEFAULT '', resolved_at bigint);
CREATE INDEX IF NOT EXISTS error_log_fp_idx ON error_log (fingerprint, resolved);
CREATE INDEX IF NOT EXISTS error_log_last_idx ON error_log (last_at);
CREATE TABLE IF NOT EXISTS change_log (id serial PRIMARY KEY, at bigint NOT NULL, kind text NOT NULL DEFAULT 'admin', actor text NOT NULL DEFAULT '', actor_id integer, action text NOT NULL, entity text NOT NULL DEFAULT '', entity_id text NOT NULL DEFAULT '', summary text NOT NULL DEFAULT '', detail text NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS change_log_at_idx ON change_log (at);
INSERT INTO app_settings (key, value) VALUES ('wright_seats_taken', '0') ON CONFLICT (key) DO NOTHING;
CREATE TABLE IF NOT EXISTS lounge_threads (id serial PRIMARY KEY, category text NOT NULL, title text NOT NULL, body text NOT NULL DEFAULT '', airports text NOT NULL DEFAULT '[]', user_id integer, anonymous integer NOT NULL DEFAULT 0, pinned integer NOT NULL DEFAULT 0, locked integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'live', reply_count integer NOT NULL DEFAULT 0, created_at bigint NOT NULL DEFAULT 0, edited_at bigint, last_activity_at bigint NOT NULL DEFAULT 0);
CREATE INDEX IF NOT EXISTS lounge_threads_cat_idx ON lounge_threads (category, last_activity_at);
CREATE TABLE IF NOT EXISTS lounge_posts (id serial PRIMARY KEY, thread_id integer NOT NULL, user_id integer, body text NOT NULL, anonymous integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'live', created_at bigint NOT NULL DEFAULT 0, edited_at bigint);
CREATE INDEX IF NOT EXISTS lounge_posts_thread_idx ON lounge_posts (thread_id, created_at);
CREATE TABLE IF NOT EXISTS lounge_votes (target_type text NOT NULL, target_id integer NOT NULL, voter_id integer NOT NULL, created_at bigint NOT NULL DEFAULT 0, PRIMARY KEY (target_type, target_id, voter_id));
CREATE TABLE IF NOT EXISTS lounge_reports (id serial PRIMARY KEY, target_type text NOT NULL, target_id integer NOT NULL, reporter_id integer NOT NULL, reason text NOT NULL, note text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'open', created_at bigint NOT NULL DEFAULT 0, resolved_at bigint, resolved_by text NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS lounge_reports_status_idx ON lounge_reports (status, created_at);
INSERT INTO app_settings (key, value) VALUES ('lounge_audience', 'admins') ON CONFLICT (key) DO NOTHING;
UPDATE users u SET briefs_made = b.n FROM (SELECT user_id, COUNT(*)::int AS n FROM briefings GROUP BY user_id) b WHERE b.user_id = u.id AND u.briefs_made < b.n;
`;

async function migrate(d: DB) {
  for (const stmt of MIGRATION.split(";").map((s) => s.trim()).filter(Boolean)) {
    await d.execute(sql.raw(stmt));
  }
}
