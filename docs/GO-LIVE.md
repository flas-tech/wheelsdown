# Wheelsdown Go-Live Plan

From today's GitHub Pages demo to a working public site with real accounts, a hosted database, a custom domain and email, then the App Store.

Prepared October 6, 2026. Repository: [github.com/flas-tech/wheelsdown](https://github.com/flas-tech/wheelsdown). Current demo: [flas-tech.github.io/wheelsdown](https://flas-tech.github.io/wheelsdown/).

## Recommended stack

| Layer | Recommendation | Why | Cost |
|---|---|---|---|
| Web app and API | **Render** web service, Starter instance, Virginia region | Runs the Express server and the site together, deploys automatically from GitHub, gives free TLS and custom domains. The smallest paid instance is $7/mo with 512 MB RAM ([Render pricing](https://render.com/pricing)). Don't use the free tier: free web services spin down after 15 minutes idle and take about a minute to wake ([Render docs](https://render.com/docs/your-first-deploy)). | $7/mo |
| Database | **Supabase** Postgres, us-east-1 | Managed Postgres plus a spreadsheet-style Table Editor for administrator bulk edits. Free: 500 MB, pauses after 1 week of inactivity. Pro: $25/mo ([Supabase pricing](https://supabase.com/pricing)). | $0 in beta, $25/mo at launch |
| DB connection | Supabase **shared pooler, session mode**, port 5432 | Works over IPv4 on every plan. The direct connection is IPv6-only unless you buy the IPv4 add-on ([Supabase docs](https://supabase.com/docs/guides/database/connecting-to-postgres)). | Included |
| Domain and DNS | **getwheelsdown.com** at **Cloudflare Registrar** | At-cost pricing with free DNS ([Cloudflare](https://www.cloudflare.com/application-services/products/registrar/buy-com-domains/)). The .com wholesale fee rises on Nov 1, 2026, so register before then ([dev.to](https://dev.to/301st/the-com-price-rises-on-1-november-lock-todays-for-up-to-ten-years-2epn)). | about $10–11/yr |
| Email (password reset) | **Resend** | Free: 3,000 emails/mo, 100/day. Pro: $20/mo for 50,000 ([Resend pricing](https://resend.com/pricing)). | $0 to start |
| Inbound mail (hello@, ads@) | Cloudflare Email Routing, forwarding to your inbox | No mailbox to pay for. | $0 |
| iOS (later) | Apple Developer Program | $99/yr membership ([Apple](https://developer.apple.com/programs/)). | $99/yr |

**Domain note:** wheelsdown.com, wheelsdown.app, wheelsdownapp.com and wheelsdown.aero are already registered by others. getwheelsdown.com and wheelsdowncrew.com were unregistered when checked on Oct 6, 2026.

**Fallbacks if you prefer one vendor less:** Railway Hobby (minimum $5 of usage per month; [Railway](https://railway.com/pricing)) instead of Render, or Neon Free (1 GB per project; [Neon](https://neon.com/docs/introduction/plans)) instead of Supabase. The app works with any Postgres 14 or newer: only `DATABASE_URL` changes.

### Monthly cost

| Stage | Items | Approx. cost |
|---|---|---|
| Private beta | Render Starter + Supabase Free + Resend Free + domain | about $7/mo + about $11/yr |
| Public launch | Render Starter + Supabase Pro + Resend Free + domain | about $32/mo + about $11/yr |
| App Store | add the Apple Developer Program | + $99/yr |

## Already done

The code is production-ready and pushed to `main`. CI (type check, build, Postgres, 27-step API test) and the Pages demo deploy both pass.

- **Postgres backend.** Runs on any hosted Postgres through `DATABASE_URL`, with an embedded Postgres for local development. The schema creates itself on first boot.
- **Production seed.** An empty database gets 61 airports, 39 starter listings credited to "Wheelsdown team," and a house "Advertise with us" banner. No fake users or votes.
- **Accounts.**
    - Passwords are hashed with scrypt.
    - Session tokens are stored hashed and expire after 90 days.
    - Sign-in works with either handle or email.
- **Password reset by email.** Single-use links expire after 1 hour, and a reset signs the account out everywhere.
- **Account deletion** from the Logbook, which the App Store requires ([Apple 5.1.1(v)](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)).
- **Sign-up consent.** A Terms checkbox, plus optional email.
- **Legal pages.** Terms, Privacy, Community Guidelines and About & Advertise, all drafts for attorney review.
- **Security.**
    - Security headers and a content security policy.
    - Rate limits on sign-in and writes.
    - Production refuses to start with a weak admin key.
    - No tokens are logged, and internal errors are hidden from users.
- **Operations.**
    - `/api/health` for monitoring.
    - `/ads.txt` is served from a setting.
    - `/robots.txt` is in place.
    - Graceful shutdown.
- **Deploy files.**
    - `render.yaml` one-click blueprint.
    - `.env.example`.
    - `script/smoke.sh`, which you can point at the live site.

## Step by step

Steps marked **You** need your accounts, payment or legal decisions. Steps marked **Me** I can do once the relevant connector is connected, or I can walk you through them.

### Phase 1: Decisions and accounts (day 1, about 1 hour)

1. **You:** Choose the legal entity that runs Wheelsdown, either an existing LLC or a new one. It goes in Terms and Privacy and on ad invoices.
2. **You:** Run a trademark search for "Wheelsdown" in classes 9 and 42 at [USPTO](https://tmsearch.uspto.gov/). Note that the owner of wheelsdown.com may object to the name.
3. **You:** Create a Cloudflare account and register **getwheelsdown.com** before Nov 1. Turn on auto-renew.
4. **You:** Create accounts at Render, Supabase and Resend. Signing in with GitHub works for all three. Add a payment card to Render.

### Phase 2: Database (done Oct 6, 2026)

5. **Done:** Supabase project `wheelsdown` (ref `lwhobdawreebbbnyrfew`) created in us-east-1 under flas-tech's Org (Pro plan).
6. **Done:**
    - The app connects as a dedicated role, `wheelsdown_app`, that owns a private `wheelsdown` schema.
    - The tables aren't exposed through Supabase's public API, and the security advisor reports no issues.
    - Connection: session pooler `aws-0-us-east-1.pooler.supabase.com:5432`, user `wheelsdown_app.lwhobdawreebbbnyrfew`.
    - The password is kept outside the repository.
7. **Done:** Tables created, and the starter content is loaded: 61 airports, 39 listings and the house ad, with no users or votes. The 27-step smoke test passed against it.

### Phase 3: App on Render (20 minutes)

8. **Me or you:** In Render, choose New, then Blueprint, and select `flas-tech/wheelsdown`. This creates the `wheelsdown` service on the Starter plan in Virginia, with automatic deploys from `main` and a health check on `/api/health`.
9. Fill in the prompted settings:

| Setting | Value |
|---|---|
| `DATABASE_URL` | Supabase session pooler URI from step 6 |
| `APP_URL` | `https://getwheelsdown.com` |
| `CONTACT_EMAIL` | `hello@getwheelsdown.com` |
| `RESEND_API_KEY` | from Phase 5 (can be added later) |
| `EMAIL_FROM` | `Wheelsdown <no-reply@mail.getwheelsdown.com>` |
| `VITE_OPERATOR_NAME` | your legal entity name |
| `ADMIN_KEY` | generated automatically; copy it from the Render dashboard |

10. Deploy. When the logs show `[seed] starter` and `database ready (postgres)`, open `https://wheelsdown.onrender.com/api/health`. It should return `"db":"up"`.
11. **Me:** Run the smoke test against it: `BASE=https://wheelsdown.onrender.com ADMIN_KEY=... npm run test:api`. Expect 27 passed. The test creates and then deletes a throwaway account.

### Phase 4: Domain (30 minutes plus DNS time)

12. In Render, open Settings, then Custom Domains, and add `getwheelsdown.com` and `www.getwheelsdown.com`.
13. In Cloudflare DNS, add the records Render shows:
    - A CNAME for `www` pointing to `wheelsdown.onrender.com`.
    - For the apex, a CNAME to the same target (Cloudflare flattens it automatically).
    - Set both to **DNS only** (grey cloud) until Render shows the certificate as issued.
14. Confirm that `https://getwheelsdown.com` loads with a valid certificate and that `www` redirects to it.

### Phase 5: Email (30 minutes)

15. In Resend, add the domain `mail.getwheelsdown.com`, then add its SPF, DKIM and MX records in Cloudflare DNS and verify.
16. Create an API key with sending permission only, and set `RESEND_API_KEY` in Render.
17. Turn on Cloudflare Email Routing for `getwheelsdown.com`. Forward `hello@` and `ads@` to your personal inbox.
18. Test: sign up with your email, use "Forgot password?", and confirm the email arrives and the link works.

### Phase 6: Admin and content (ongoing, start before beta)

19. Open `https://getwheelsdown.com/#/admin` and enter the `ADMIN_KEY`.
20. Review the 39 starter listings. Remove any you can't vouch for, and correct hours and prices.
21. Bulk-add listings for your core airports:
    - Export the CSV.
    - Fill it in Excel or Sheets. Leave `id` blank for new rows.
    - Import it again.
    - Aim for at least 5 listings per category at your 10 most-flown airports.
22. For spreadsheet-style editing, Supabase's Table Editor works directly on the `spots` table. Edits appear in the app right away, though leaderboard totals can lag by up to 30 seconds.
23. Optionally set `MODERATE=1` during beta. New listings from members below Commercial tier then wait in the admin queue.

### Phase 7: Monitoring and backups (20 minutes)

24. Add a free uptime monitor, such as UptimeRobot or Better Stack, on `https://getwheelsdown.com/api/health`, with alerts to your phone.
25. Supabase Free has **no backups**. Until you upgrade, take a weekly dump: `pg_dump "$DATABASE_URL" > wheelsdown-$(date +%F).sql`. I can set this up as a recurring task.
26. Check Render logs and Supabase usage weekly during beta.

### Phase 8: Legal (1–2 weeks, in parallel)

27. **You:** Have an attorney review the draft Terms, Privacy and Community Guidelines (`client/src/pages/legal.tsx`), especially liability, user-content licence, and Florida and CCPA privacy terms.
28. Confirm the Privacy Policy matches what you actually run. If you add analytics or ad networks, update it first.

### Phase 9: Private beta (2–4 weeks)

29. Invite 20–50 crew members across Pilot, Flight Attendant and Mechanic roles. Seed accounts for a few trusted contributors and use admin bonus points to place them at Commercial tier so they skip moderation.
30. Collect feedback: search by route, the time and cost filters, the rate-first spot page, and the tiers.
31. Watch the "Needs check" queue and down-vote reasons, and tune the vetting thresholds if needed.

### Phase 10: Public launch

32. Upgrade Supabase to **Pro** ($25/mo). This stops pausing and adds daily backups.
33. Leave `MODERATE` on for the first weeks if spam appears. Rate limits are already active.
34. Announce through crew forums, base crew rooms, FBO partners and social media. Put a QR code on the house ad flyer.

### Phase 11: Revenue

35. **Direct-sold banners first.** The admin Ads tab already supports top, inline and footer slots, airport targeting, and impression and click counts.
    - Sell airport-targeted placements to crew hotels, FBOs and restaurants.
    - Use the impression and click report for invoices.
36. **AdSense later.** Wait until there is steady traffic and original content. Google requires sites to meet its eligibility and content policies ([Google AdSense](https://support.google.com/adsense/answer/9724?hl=en)). When approved:
    - Put Google's publisher line in the `ADS_TXT` setting.
    - Ask me to add the AdSense script, which requires loosening the content security policy, and a consent banner.
    - Update the Privacy Policy.

### Phase 12: iPhone

37. **Now:** It already works as a home-screen web app (Safari, Share, Add to Home Screen) with its own icon.
38. **App Store:** Join the Apple Developer Program ($99/yr), then I'll wrap the app with Capacitor. Apple can reject apps that are just a website in a wrapper ([guideline 4.2 overview](https://we.inc/blog/turn-website-into-iphone-app)), so the first native release should add device features:
    - push notifications for new spots on saved routes
    - offline saved routes
    - native sharing
39. Account deletion, which Apple requires, is already in the app.

## Day-to-day operations

| Task | Where |
|---|---|
| Approve, hide or bulk-edit listings | `/#/admin` (Spots and Needs check tabs) |
| Spreadsheet edits | Admin CSV export and import, or the Supabase Table Editor |
| Manage ads and see clicks | `/#/admin`, Ads tab |
| Grant or remove points | `/#/admin`, Crew tab |
| Deploy a change | Push to `main`; Render redeploys automatically |
| Check health | `/api/health` and the uptime monitor |
| Restore data | Supabase backups (Pro) or the weekly `pg_dump` file |

## Known limits

- Legal pages are drafts until an attorney reviews them.
- Leaderboard points are computed in memory with a 30-second cache. This is fine into the tens of thousands of rows; past that, move to SQL rollups.
- There is no Sign in with Apple, crew verification by company email, or review report button yet. These are planned post-launch.
- The GitHub Pages demo stays a browser-only sample.
