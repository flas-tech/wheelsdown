# Wheelsdown — crew-sourced layover guide

Flight crews search a route (`MIA TEB ASE`, `KOPF-KPBI`; IATA and ICAO both work), choose what they need (Eat, Do, Stay, FBO intel), filter by how much time they have and by cost, then rate and review spots. Adding a new spot takes three fields.

**Live demo:** https://flas-tech.github.io/wheelsdown/

The GitHub Pages build (`npm run build:pages`, `VITE_STATIC=1`) runs a stand-in for the server inside the browser (`client/src/lib/mockApi.ts`). It loads the sample data, and anything a visitor adds is saved only in that visitor's browser. The demo admin key is `wheelsdown-admin`. To share data between users, use the full server build or connect a hosted database.

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

## Crew vetting (up/down votes)
- Crew can vote each listing up or down, one vote per device, and can change or remove it later. A downvote asks for a reason: closed, info outdated, wrong location, not worth it, not crew-friendly, or other.
- Only votes from the last 12 months count, so a listing has to keep getting upvotes to stay vetted.
- **Crew-vetted:** 3 or more upvotes, at least 75% positive. **Needs check:** 2 or more downvotes, at least 40% negative. A listing with fewer than 3 votes shows as **New**.
- A listing with 5 or more downvotes that are at least 60% negative is pulled automatically and sent to the admin **Needs check** queue. From there an admin can keep it and clear the downvotes, edit it, or hide it.
- Search defaults to **Most trusted** order, which ranks by a lower-bound (Wilson) score so a listing with many votes beats one with only a few. A **Crew-vetted only** switch hides everything else.
- Reviews also get up/down "Helpful?" votes, and the most helpful reviews are shown first.
- Logic lives in `shared/vetting.ts` and is used by both the server and the demo build.

## Data model
| Table | Purpose |
|---|---|
| airports | ICAO primary key, IATA, name, city. Unknown codes are created when someone submits a spot with a city |
| spots | icao, category (eat/do/stay/fbo), costLevel 0–4, minutesNeeded, milesFromField, crewTip, tags, status (live/pending/hidden) |
| reviews | 1–5 rating, comment, author, crew role |
| votes | targetType (spot/review), targetId, voter, value ±1, reason. One per voter per target |
| ads | slot (top/inline/footer), optional targetIcao, active, impressions, clicks |

Time filter: activity minutes plus a round trip at about 2 minutes per mile.

## CSV bulk editing
Export from Admin, then Import / Export. Edit the file in Excel or Sheets and import it again. Rows that have an `id` are updated; rows with no `id` are created. Tags are separated with `;`. An unknown airport is created automatically when `airportCity` is filled in.

## Production path
1. Hosted database: point storage at Postgres (Supabase, Neon or RDS) by switching Drizzle to `pg-core`. The schema maps 1:1. Supabase's table editor also gives administrators spreadsheet-style editing.
2. Auth: add Sign in with Apple and email magic links, plus optional crew verification (airline or company email domain), before the app opens to the public.
3. iOS App Store: wrap the built `dist/public` with Capacitor (`npx cap add ios`). Swap the ad banner component for Google AdMob or a direct-sold banner.
4. Moderation: set `MODERATE=1` and add a report button on reviews.
