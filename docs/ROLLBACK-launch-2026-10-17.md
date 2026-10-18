# Rollback: launch of October 17, 2026 (commit 922074c)

What shipped: new home screen for signed-in members, My Crew, Crew Up (crew-only, renamed from Crew meetup),
Crew Lounge, Layover Today and Rate a spot open to members, delete-your-own-rating, one rating per member per place,
feedback replies in Notifications, What's new 10.

## Level 1: switch it off (instant, no deploy, recommended first)

Any one of these puts every member back on the classic app within about 30 seconds. Nothing members posted is lost,
and turning it back on restores everything.

- In the app: Logbook > Home screen card > "Open to members" off (super-user account).
- API: `PUT /api/admin/launch {"audience":"admins"}` with the admin key.
- Supabase SQL:
  `UPDATE wheelsdown.app_settings SET value = 'admins' WHERE key IN ('experience_audience','layover_audience','lounge_audience');`

Rating fixes (delete your own rating, one rating per place) and feedback replies stay on. They aren't behind the switch.

## Level 2: put the previous code back

1. Do Level 1 first. The old code has the original Crew meetup, which shows plans to any member at the same airport,
   not only to crew. With layover_audience still on members, that would expose plans to strangers.
2. Render: wheelsdown service > Deploys > deploy `dep-db8o86rl550s73ek0cag` (commit 2f2e5ac) > Rollback.
   Or in git: `git revert 922074c` and deploy, or deploy tag `rollback-pre-mycrew-2f2e5ac`.
3. Database: no changes needed. The new tables (crew_links, crew_privacy, member_messages) are additive and
   ignored by the old code. Keep them so crews and requests come back if you relaunch.

## Checks after either level

- `curl https://getwheelsdown.com/api/features` returns `{"experience":"admins"}` after Level 1.
- `curl https://getwheelsdown.com/api/version` returns 2f2e5acb98a2 after Level 2.
- `BASE=https://getwheelsdown.com ADMIN_KEY=... bash script/smoke.sh` passes. It checks the hidden or open state on its own.
