# Wheelsdown — crew-sourced layover guide

Flight crews search a route (`MIA TEB ASE`, `KOPF-KPBI`; IATA and ICAO both work), choose what they need (Eat, Do, Stay, FBO intel), filter by how much time they have and by cost, then rate and review spots. Adding a new spot takes three fields.

**Live demo:** https://flas-tech.github.io/wheelsdown/

The GitHub Pages build (`npm run build:pages`, `VITE_STATIC=1`) runs a stand-in for the server inside the browser (`client/src/lib/mockApi.ts`). It loads the sample data, and anything a visitor adds is saved only in that visitor's browser. The demo admin key is `wheelsdown-admin`. To share data between users, use the full server build or connect a hosted database.

## Stack
- React + Tailwind front end; installs on iPhone as a home-screen app (PWA manifest and Apple touch icon)
- Express API on Postgres through Drizzle ORM (`server/storage.ts`, `server/db.ts`). Production uses any hosted Postgres (Supabase recommended); local dev uses an embedded Postgres (PGlite) automatically
- Accounts with hashed sessions, password reset by email (Resend), account deletion, rate limiting and security headers
- Admin console at `/#/admin`: bulk edit, publish/hide, CSV import and export, ad inventory with impression and click tracking

## Run locally
```bash
npm ci
npm run dev                 # http://localhost:5000, embedded database in ./.pglite with demo crew (password "crewrest")
npm run build && ADMIN_KEY=$(openssl rand -hex 24) DATABASE_URL=postgres://... npm start
BASE=http://localhost:5000 ADMIN_KEY=... npm run test:api   # 27-step API smoke test
```
All settings are listed in `.env.example`. The schema creates itself on first boot; an empty database is seeded according to `SEED_MODE` (`demo`, `starter`, or `none`).

## Deploy (Render + Supabase)
1. Create a Supabase project (region us-east-1) and copy the Session pooler connection string.
2. In Render: New, then Blueprint, then select this repo. `render.yaml` creates the web service; paste `DATABASE_URL`, `APP_URL`, `CONTACT_EMAIL`, `RESEND_API_KEY`, `EMAIL_FROM`.
3. Add the custom domain in Render and point DNS at it (Cloudflare: CNAME, DNS only).
4. Check `https://your-domain/api/health`, then run `BASE=https://your-domain ADMIN_KEY=... npm run test:api`.

The GitHub Pages build (`npm run build:pages`) remains a browser-only demo with no server.

## Crew accounts, participation and status
- Browsing is open to everyone. Adding listings, rating and voting require a free crew account, so every contribution is credited to a person.
- **Profile (set once):** name, position (Pilot, Flight Attendant, Mechanic or Other), optional home base, and whether posts show your name or "Anonymous pilot" etc. Changing the preference re-labels your past posts. Anonymous members are hidden by name on the public leaderboard; admins can still see who they are.
- **Participation counter:** your listings, ratings and votes are counted and shown in a recent-activity log in your Logbook.
- **Points:** 10 per listing (+20 when it becomes Crew-vetted), 5 per rating (+3 for 40+ characters), 1 per vote, +1 for each upvote your listings get, +2 for each "helpful" vote your reviews get. Points are worked out from your activity rather than stored, so they always match what you did. Admins can add bonus points for activity outside the app.
- **Status ladder:** Student (0), Private (50), Instrument (150), Commercial (400), ATP (1,000), Check Airman (2,500), Ancient Albatross (6,000). Each status has its own badge, shown next to your name on everything you post. Perks marked "planned" are not built yet.
- Accounts use scrypt-hashed passwords and session tokens on the server build. In the GitHub Pages demo, accounts live only in your own browser.

## Home page and browsing
- The home page never lists the whole catalog. It shows the top-rated and newest picks, plus a **Browse everything** button.
- After you pick a category you choose one of two paths: enter a route, or browse everything in that category. Browsing loads 10 at a time; a route search shows up to 6 per airport, with a button to show the rest.

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
| users | handle, displayName, crewRole, homeBase, anonymous, passwordHash (scrypt), bonusPoints |
| sessions | token, userId |
| ads | slot (top/inline/footer), optional targetIcao, active, impressions, clicks |

Time filter: activity minutes plus a round trip at about 2 minutes per mile.

## CSV bulk editing
Export from Admin, then Import / Export. Edit the file in Excel or Sheets and import it again. Rows that have an `id` are updated; rows with no `id` are created. Tags are separated with `;`. An unknown airport is created automatically when `airportCity` is filled in.

## Roadmap after launch
- Sign in with Apple and optional crew verification by company email domain
- iOS App Store build with Capacitor, with native features (push for new spots on saved routes, offline saved routes) so it's more than a wrapped website
- Report button on reviews; AdSense or direct-sold banners via the existing ad slots (`ADS_TXT` env serves `/ads.txt`)
