#!/usr/bin/env bash
# End-to-end API smoke test. Usage: BASE=https://your-site ADMIN_KEY=... bash script/smoke.sh
# Creates a throwaway account, exercises the main flows, then deletes the account.
set -u
BASE="${BASE:-http://localhost:5000}"
ADMIN_KEY="${ADMIN_KEY:-wheelsdown-admin}"
H="smoke$(date +%s)"
PASS=0; FAIL=0
ok()   { echo "  PASS  $1"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL  $1  ->  $2"; FAIL=$((FAIL+1)); }
curl() { command curl -H "x-wd-test: 1" "$@"; }  # never counted in advertiser metrics
check(){ # name, expected substring, actual
  if [[ "$3" == *"$2"* ]]; then ok "$1"; else bad "$1" "${3:0:200}"; fi; }
J='content-type: application/json'
jget(){ python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "Smoke test against $BASE"
check "health"            '"db":"up"'      "$(curl -s $BASE/api/health)"
check "home page"         '<div id="root"' "$(curl -s $BASE/)"
check "link preview tags"  'og:image'       "$(curl -s $BASE/)"
check "preview image"      '200'            "$(curl -s -o /dev/null -w '%{http_code}' $BASE/og.png)"
check "airports"          'KMIA'           "$(curl -s $BASE/api/airports)"
check "route search"      '"legs"'         "$(curl -s "$BASE/api/search?route=MIA%20TEB")"
check "highlights"        '"top"'          "$(curl -s "$BASE/api/highlights?category=eat")"
check "vote needs login"  'Sign in'        "$(curl -s -XPOST $BASE/api/spots/1/vote -H "$J" -d '{"value":1}')"

R=$(curl -s -XPOST $BASE/api/auth/signup -H "$J" -d "{\"handle\":\"$H\",\"password\":\"smoke-pass-123\",\"displayName\":\"Smoke Test\",\"crewRole\":\"Pilot\",\"email\":\"$H@example.com\",\"acceptTerms\":true}")
T=$(echo "$R" | jget "d.get('token','')" 2>/dev/null)
[[ -n "$T" ]] && ok "sign up" || bad "sign up" "$R"
check "test signup takes no club seat" '"wrightNo":null' "$R"
check "club"               '"seats":50'     "$(curl -s $BASE/api/club)"
A="authorization: Bearer $T"
check "me"                "\"handle\":\"$H\"" "$(curl -s $BASE/api/me -H "$A")"
MYID=$(curl -s $BASE/api/me -H "$A" | jget "d['id']")
check "invite: who sent it" '"name":"Smoke Test"' "$(curl -s $BASE/api/ref/$MYID)"
check "invite: no points yet" '"referrals":0' "$(curl -s $BASE/api/me -H "$A")"
H2="${H}r"
R2=$(curl -s -XPOST $BASE/api/auth/signup -H "$J" -d "{\"handle\":\"$H2\",\"password\":\"smoke-pass-123\",\"displayName\":\"Smoke Invitee\",\"crewRole\":\"Pilot\",\"email\":\"$H2@example.com\",\"acceptTerms\":true,\"ref\":$MYID}")
T2=$(echo "$R2" | jget "d.get('token','')" 2>/dev/null)
check "invite: points on sign-up" '"referrals":1' "$(curl -s $BASE/api/me -H "$A")"
check "invite: bad ref still signs up" '"token"' "$(curl -s -XPOST $BASE/api/auth/signup -H "$J" -d "{\"handle\":\"${H}x\",\"password\":\"smoke-pass-123\",\"displayName\":\"Smoke X\",\"crewRole\":\"Pilot\",\"acceptTerms\":true,\"ref\":\"abc\"}" | tee /tmp/smx.json)"
TX=$(jget "d.get('token','')" < /tmp/smx.json 2>/dev/null); curl -s -o /dev/null -XDELETE $BASE/api/me -H "authorization: Bearer $TX" -H "$J" -d "{\"confirm\":\"${H}x\"}"
curl -s -o /dev/null -XDELETE $BASE/api/me -H "authorization: Bearer $T2" -H "$J" -d "{\"confirm\":\"$H2\"}"
check "invite: removed when they delete" '"referrals":0' "$(curl -s $BASE/api/me -H "$A")"
check "login by handle"   '"token"'        "$(curl -s -XPOST $BASE/api/auth/login -H "$J" -d "{\"handle\":\"$H\",\"password\":\"smoke-pass-123\"}")"
check "login by email"    '"token"'        "$(curl -s -XPOST $BASE/api/auth/login -H "$J" -d "{\"handle\":\"$H@example.com\",\"password\":\"smoke-pass-123\"}")"
check "bad password"      'wrong'          "$(curl -s -XPOST $BASE/api/auth/login -H "$J" -d "{\"handle\":\"$H\",\"password\":\"nope\"}")"
S=$(curl -s -XPOST $BASE/api/spots -H "$A" -H "$J" -d '{"icao":"KMIA","category":"eat","name":"Smoke Test Cafe","costLevel":1,"pace":"grab","minutesNeeded":30,"milesFromField":2}')
SID=$(echo "$S" | jget "d.get('id','')" 2>/dev/null)
[[ -n "$SID" ]] && ok "add listing" || bad "add listing" "$S"
# With AI moderation on, new posts wait for the check; the smoke test publishes its own items through the admin queue.
AI=$(curl -s $BASE/api/config | jget "str(d.get('ai', False)).lower()")
approve(){ [[ "$AI" == "true" ]] && curl -s -XPOST $BASE/api/admin/moderation/$1/$2 -H "x-admin-key: $ADMIN_KEY" -H "$J" -d '{"action":"approve"}' >/dev/null; return 0; }
if [[ "$AI" == "true" ]]; then
  check "listing held for check" '"modState":"checking"' "$S"
  check "unpublished is private" 'Not found' "$(curl -s $BASE/api/spots/$SID)"
  approve spot $SID
fi
check "config"             '"ai":'          "$(curl -s $BASE/api/config)"
check "admin moderation"   '"reviews"'      "$(curl -s $BASE/api/admin/moderation -H "x-admin-key: $ADMIN_KEY")"
check "moderation status+log" '"log":'       "$(curl -s $BASE/api/admin/moderation -H "x-admin-key: $ADMIN_KEY")"
check "revert guard"       'Only an approved edit' "$(curl -s -XPOST $BASE/api/admin/moderation/revert/0 -H "x-admin-key: $ADMIN_KEY")"
check "settings need admin" 'Admin key'     "$(curl -s -XPUT $BASE/api/admin/moderation/settings -H "$J" -d '{"manual":true}')"
check "bio saves"          'Smoke test bio' "$(curl -s -XPATCH $BASE/api/me -H "$A" -H "$J" -d '{"bio":"Smoke test bio for a pilot who likes pizza.","interests":["pizza","bbq"]}')"
check "bio blocks links"   'links'          "$(curl -s -XPATCH $BASE/api/me -H "$A" -H "$J" -d '{"bio":"see www.example.com"}')"
check "can't follow self"  "yourself"       "$(curl -s -XPOST $BASE/api/crew/$(curl -s $BASE/api/me -H "$A" | jget "d['id']")/follow -H "$A")"
check "feed"               '['              "$(curl -s $BASE/api/me/feed -H "$A")"
check "profile follow info" '"follow"'      "$(curl -s $BASE/api/crew/$(curl -s $BASE/api/me -H "$A" | jget "d['id']"))"
check "autofill needs login" 'Sign in'      "$(curl -s -XPOST $BASE/api/ai/autofill -H "$J" -d '{"icao":"KMIA","category":"eat","name":"x"}')"
check "vote up"           '"ok":true'      "$(curl -s -XPOST $BASE/api/spots/$SID/vote -H "$A" -H "$J" -d '{"value":1}')"
check "rate + comment"    '"rating":5'     "$(curl -s -XPOST $BASE/api/spots/$SID/reviews -H "$A" -H "$J" -d '{"rating":5,"comment":"Smoke test review with enough characters to count as detailed."}')"
R1=$(curl -s $BASE/api/spots/$SID -H "$A" | jget "[r['id'] for r in d['reviews']][0]" 2>/dev/null); approve review $R1
check "spot detail"       'Smoke Test Cafe' "$(curl -s $BASE/api/spots/$SID -H "$A")"
check "digit airport code" '"icao":"X51"'  "$(curl -s $BASE/api/airports/lookup/X51)"
check "favorite on"        '"on":true'      "$(curl -s -XPUT $BASE/api/spots/$SID/favorite -H "$A" -H "$J" -d '{"on":true}')"
check "favorites list"     "\"id\":$SID"    "$(curl -s $BASE/api/me/favorites -H "$A")"
check "favorite needs login" 'Sign in'      "$(curl -s -XPUT $BASE/api/spots/$SID/favorite -H "$J" -d '{"on":true}')"
E=$(curl -s -XPATCH $BASE/api/spots/$SID -H "$A" -H "$J" -d '{"name":"Smoke Test Cafe (edited)"}')
if [[ "$AI" == "true" ]]; then check "edit held, live unchanged" '"editPending":true' "$E"; approve spot $SID; E=$(curl -s $BASE/api/spots/$SID -H "$A"); fi
check "edit own listing"   'Smoke Test Cafe (edited)' "$E"
RID=$(curl -s $BASE/api/spots/$SID -H "$A" | jget "[r['id'] for r in d['reviews']][0]" 2>/dev/null)
check "go around needs why" 'go around'     "$(curl -s -XPATCH $BASE/api/reviews/$RID -H "$A" -H "$J" -d '{"rating":0,"comment":"no"}')"
ER=$(curl -s -XPATCH $BASE/api/reviews/$RID -H "$A" -H "$J" -d '{"rating":0,"comment":"Smoke test: go around this one, it has enough detail to count."}')
[[ "$AI" == "true" ]] && check "rating edit held" '"editPending":true' "$ER" || check "edit own rating" '"rating":0' "$ER"
approve review $RID
check "go-around counted"  '"goArounds":1'  "$(curl -s $BASE/api/spots/$SID -H "$A")"
check "leaderboard"        '"crewTotal"'    "$(curl -s "$BASE/api/leaderboard?q=$H")"
check "leaderboard bases"  '['              "$(curl -s $BASE/api/leaderboard/bases)"
BID=$(curl -s -XPOST $BASE/api/briefings -H "$A" -H "$J" -d '{"title":"Smoke","stops":[{"icao":"KMIA","layover":"hours","picks":[]}]}' | jget "d.get('id','')" 2>/dev/null)
[[ -n "$BID" ]] && ok "save briefing" || bad "save briefing" "no id"
check "delete briefing"    '"ok":true'      "$(curl -s -XDELETE $BASE/api/briefings/$BID -H "$A")"
check "briefing gone"      'Not found'      "$(curl -s $BASE/api/briefings/$BID -H "$A")"
check "delete again 404"   'Not found'      "$(curl -s -XDELETE $BASE/api/briefings/$BID -H "$A")"
check "go anonymous"      '"anonymous":true' "$(curl -s -XPATCH $BASE/api/me -H "$A" -H "$J" -d '{"anonymous":true}')"
check "author relabeled"  'Anonymous pilot' "$(curl -s $BASE/api/spots/$SID)"
P=$(curl -s $BASE/api/me -H "$A" | jget "d['points']")
[[ "$P" -ge 19 ]] && ok "points counted ($P)" || bad "points counted" "$P"
check "activity log"      '"activity"'     "$(curl -s $BASE/api/me/contributions -H "$A")"
check "leaderboard"       '"tierId"'       "$(curl -s $BASE/api/crew)"
check "forgot password"   'on its way'     "$(curl -s -XPOST $BASE/api/auth/forgot -H "$J" -d "{\"email\":\"nobody-$H@example.invalid\"}")"
check "admin rejects bad key" 'Admin key'  "$(curl -s $BASE/api/admin/stats -H 'x-admin-key: wrong')"
check "admin stats"       '"users"'        "$(curl -s $BASE/api/admin/stats -H "x-admin-key: $ADMIN_KEY")"
check "regular crew is not admin" 'Admin key' "$(curl -s $BASE/api/admin/stats -H "$A")"
check "multi aircraft saves" '"aircraft":"heli_mt,airliner"' "$(curl -s -XPATCH $BASE/api/me -H "$A" -H 'content-type: application/json' -d '{"aircraft":"heli_mt,airliner"}')"
check "aircraft limit"      'up to 6'         "$(curl -s -XPATCH $BASE/api/me -H "$A" -H 'content-type: application/json' -d '{"aircraft":"sep,mep,setp,metp,light_jet,midsize_jet,large_jet"}')"
check "dispatcher role"     '"crewRole":"Dispatcher"' "$(curl -s -XPATCH $BASE/api/me -H "$A" -H 'content-type: application/json' -d '{"crewRole":"Flight Scheduler"}' >/dev/null; curl -s -XPATCH $BASE/api/me -H "$A" -H 'content-type: application/json' -d '{"crewRole":"Dispatcher"}')"
check "go-around needs a reason" 'why to go around' "$(curl -s -XPOST $BASE/api/spots -H "$A" -H 'content-type: application/json' -d '{"icao":"KMIA","category":"eat","name":"Smoke Go Around","costLevel":1,"pace":"grab","goAround":{"comment":"no"}}')"
check "me reports no admin" '"isAdmin":false' "$(curl -s $BASE/api/me -H "$A")"
check "crew profile badges" '"badges"'       "$(curl -s "$BASE/api/crew/5")"
check "feedback needs admin" '401'          "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/feedback")"
check "feedback rejects empty" '400'         "$(curl -s -o /dev/null -w '%{http_code}' -XPOST "$BASE/api/feedback" -H 'content-type: application/json' -d '{"kind":"idea","message":""}')"
check "feedback honeypot"   '"ok":true'      "$(curl -s -XPOST "$BASE/api/feedback" -H 'content-type: application/json' -d '{"kind":"idea","message":"bot text here","website":"x"}')"
check "feedback inbox"      '"counts"'       "$(curl -s "$BASE/api/admin/feedback?status=open" -H "x-admin-key: $ADMIN_KEY")"
check "ai cost report"     '"monthToDate"'   "$(curl -s "$BASE/api/admin/costs?days=30" -H "x-admin-key: $ADMIN_KEY")"
check "services list"      '"supabase"'      "$(curl -s "$BASE/api/admin/costs?days=7" -H "x-admin-key: $ADMIN_KEY")"
check "advertiser report"  '"traffic"'      "$(curl -s "$BASE/api/admin/advertisers?days=30" -H "x-admin-key: $ADMIN_KEY")"
check "advertiser airports" '"airports"'    "$(curl -s "$BASE/api/admin/advertisers?days=7" -H "x-admin-key: $ADMIN_KEY")"
check "usage beacon"       '"ok":true'      "$(curl -s -XPOST $BASE/api/t -H 'content-type: application/json' -d '{"vid":"v-smoketest123","page":"home"}')"
check "admin export"      'icao,category'  "$(curl -s "$BASE/api/admin/export.csv" -H "x-admin-key: $ADMIN_KEY" | head -1)"
check "checkin needs sign-in" '401'         "$(curl -s -o /dev/null -w '%{http_code}' -XPOST $BASE/api/checkins -H "$J" -d '{"icao":"KMIA","lat":25.7932,"lng":-80.2906}')"
check "checkin too far"     'miles from'     "$(curl -s -XPOST $BASE/api/checkins -H "$A" -H "$J" -d '{"icao":"KMIA","lat":26.5,"lng":-80.2906,"accuracy":20}')"
check "checkin at airport"  '"already":false' "$(curl -s -XPOST $BASE/api/checkins -H "$A" -H "$J" -d '{"icao":"KMIA","lat":25.7932,"lng":-80.2906,"accuracy":20}')"
check "checkin once a day"  '"already":true'  "$(curl -s -XPOST $BASE/api/checkins -H "$A" -H "$J" -d '{"icao":"KMIA","lat":25.7935,"lng":-80.2900,"accuracy":20}')"
check "my check-ins"        '"icao":"KMIA"'  "$(curl -s $BASE/api/me/checkins -H "$A")"
check "my map"              '"checkins":[{'  "$(curl -s $BASE/api/me/map -H "$A")"
check "owner questions need sign-in" '401' "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/me/notices)"
check "owner questions (none)"   '[]'       "$(curl -s $BASE/api/me/notices -H "$A")"
check "answer needs a real question" '404' "$(curl -s -o /dev/null -w '%{http_code}' -XPOST $BASE/api/notices/999999 -H "$A" -H "$J" -d '{"decision":"same"}')"
check "AI fix needs admin"       '401'      "$(curl -s -o /dev/null -w '%{http_code}' -XPOST $BASE/api/admin/moderation/spot/1/fix)"
check "ask owner needs admin"    '401'      "$(curl -s -o /dev/null -w '%{http_code}' -XPOST $BASE/api/admin/moderation/spot/1/ask-owner -H "$J" -d '{}')"
check "duplicate info"           '"duplicates"' "$(curl -s $BASE/api/admin/moderation/extras -H "x-admin-key: $ADMIN_KEY")"
check "map deep link page"   '<div id="root"' "$(curl -s "$BASE/")"
check "search has pins"       '"lng"'        "$(curl -s "$BASE/api/search?route=")"
check "duplicate lookup"         '['        "$(curl -s "$BASE/api/spots/similar?icao=MIA&name=Smoke%20Test%20Caf")"
check "duplicate lookup too short" '[]'     "$(curl -s "$BASE/api/spots/similar?icao=KMIA&name=ab")"
check "duplicate lookup bad airport" '[]'   "$(curl -s "$BASE/api/spots/similar?icao=K&name=Versailles")"
check "admin removes listing" '"changed":1' "$(curl -s -XPOST $BASE/api/admin/spots/bulk -H "x-admin-key: $ADMIN_KEY" -H "$J" -d "{\"ids\":[$SID],\"action\":\"delete\"}")"
check "delete account"    '"ok":true'      "$(curl -s -XDELETE $BASE/api/me -H "$A" -H "$J" -d "{\"confirm\":\"$H\"}")"
check "session gone"      'null'           "$(curl -s $BASE/api/me -H "$A")"
echo "Result: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
