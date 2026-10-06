# Wheelsdown — crew-sourced layover guide

Flight crews search a route (`MIA TEB ASE`, `KOPF-KPBI`; IATA and ICAO both work), choose what they need (Eat, Do, Stay, FBO intel), filter by how much time they have and by cost, then rate and review spots. Adding a new spot takes three fields.

## Stack
- React + Tailwind front end; installs on iPhone as a home-screen app (PWA manifest and Apple touch icon)
- Express API with SQLite through Drizzle ORM (`server/storage.ts`)
- Admin console at `/#/admin`: bulk edit, publish/hide, CSV import and export, ad inventory with impression and click tracking

## Run
```bash
npm ci
ADMIN_KEY=change-me npm run dev        # http://localhost:5000
npm run build && ADMIN_KEY=change-me npm start
```
Env vars: `ADMIN_KEY` (admin console password), `MODERATE=1` (new submissions wait as "pending" until approved), `DB_PATH` (SQLite file location).

## Data model
| Table | Purpose |
|---|---|
| airports | ICAO primary key, IATA, name, city. Unknown codes are created when someone submits a spot with a city |
| spots | icao, category (eat/do/stay/fbo), costLevel 0–4, minutesNeeded, milesFromField, crewTip, tags, status (live/pending/hidden) |
| reviews | 1–5 rating, comment, author, crew role |
| ads | slot (top/inline/footer), optional targetIcao, active, impressions, clicks |

Time filter: activity minutes plus a round trip at about 2 minutes per mile.

## CSV bulk editing
Export from Admin, then Import / Export. Edit the file in Excel or Sheets and import it again. Rows that have an `id` are updated; rows with no `id` are created. Tags are separated with `;`. An unknown airport is created automatically when `airportCity` is filled in.

## Production path
1. Hosted database: point storage at Postgres (Supabase, Neon or RDS) by switching Drizzle to `pg-core`. The schema maps 1:1. Supabase's table editor also gives administrators spreadsheet-style editing.
2. Auth: add Sign in with Apple and email magic links, plus optional crew verification (airline or company email domain), before the app opens to the public.
3. iOS App Store: wrap the built `dist/public` with Capacitor (`npx cap add ios`). Swap the ad banner component for Google AdMob or a direct-sold banner.
4. Moderation: set `MODERATE=1` and add a report button on reviews.
