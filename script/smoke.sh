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
check(){ # name, expected substring, actual
  if [[ "$3" == *"$2"* ]]; then ok "$1"; else bad "$1" "${3:0:200}"; fi; }
J='content-type: application/json'
jget(){ python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }

echo "Smoke test against $BASE"
check "health"            '"db":"up"'      "$(curl -s $BASE/api/health)"
check "home page"         '<div id="root"' "$(curl -s $BASE/)"
check "airports"          'KMIA'           "$(curl -s $BASE/api/airports)"
check "route search"      '"legs"'         "$(curl -s "$BASE/api/search?route=MIA%20TEB")"
check "highlights"        '"top"'          "$(curl -s "$BASE/api/highlights?category=eat")"
check "vote needs login"  'Sign in'        "$(curl -s -XPOST $BASE/api/spots/1/vote -H "$J" -d '{"value":1}')"

R=$(curl -s -XPOST $BASE/api/auth/signup -H "$J" -d "{\"handle\":\"$H\",\"password\":\"smoke-pass-123\",\"displayName\":\"Smoke Test\",\"crewRole\":\"Pilot\",\"email\":\"$H@example.com\",\"acceptTerms\":true}")
T=$(echo "$R" | jget "d.get('token','')" 2>/dev/null)
[[ -n "$T" ]] && ok "sign up" || bad "sign up" "$R"
A="authorization: Bearer $T"
check "me"                "\"handle\":\"$H\"" "$(curl -s $BASE/api/me -H "$A")"
check "login by handle"   '"token"'        "$(curl -s -XPOST $BASE/api/auth/login -H "$J" -d "{\"handle\":\"$H\",\"password\":\"smoke-pass-123\"}")"
check "login by email"    '"token"'        "$(curl -s -XPOST $BASE/api/auth/login -H "$J" -d "{\"handle\":\"$H@example.com\",\"password\":\"smoke-pass-123\"}")"
check "bad password"      'wrong'          "$(curl -s -XPOST $BASE/api/auth/login -H "$J" -d "{\"handle\":\"$H\",\"password\":\"nope\"}")"
S=$(curl -s -XPOST $BASE/api/spots -H "$A" -H "$J" -d '{"icao":"KMIA","category":"eat","name":"Smoke Test Cafe","costLevel":1,"minutesNeeded":30,"milesFromField":2}')
SID=$(echo "$S" | jget "d.get('id','')" 2>/dev/null)
[[ -n "$SID" ]] && ok "add listing" || bad "add listing" "$S"
check "vote up"           '"ok":true'      "$(curl -s -XPOST $BASE/api/spots/$SID/vote -H "$A" -H "$J" -d '{"value":1}')"
check "rate + comment"    '"rating":5'     "$(curl -s -XPOST $BASE/api/spots/$SID/reviews -H "$A" -H "$J" -d '{"rating":5,"comment":"Smoke test review with enough characters to count as detailed."}')"
check "spot detail"       'Smoke Test Cafe' "$(curl -s $BASE/api/spots/$SID -H "$A")"
check "go anonymous"      '"anonymous":true' "$(curl -s -XPATCH $BASE/api/me -H "$A" -H "$J" -d '{"anonymous":true}')"
check "author relabeled"  'Anonymous pilot' "$(curl -s $BASE/api/spots/$SID)"
P=$(curl -s $BASE/api/me -H "$A" | jget "d['points']")
[[ "$P" -ge 19 ]] && ok "points counted ($P)" || bad "points counted" "$P"
check "activity log"      '"activity"'     "$(curl -s $BASE/api/me/contributions -H "$A")"
check "leaderboard"       '"tierId"'       "$(curl -s $BASE/api/crew)"
check "forgot password"   'on its way'     "$(curl -s -XPOST $BASE/api/auth/forgot -H "$J" -d "{\"email\":\"nobody-$H@example.invalid\"}")"
check "admin rejects bad key" 'Admin key'  "$(curl -s $BASE/api/admin/stats -H 'x-admin-key: wrong')"
check "admin stats"       '"users"'        "$(curl -s $BASE/api/admin/stats -H "x-admin-key: $ADMIN_KEY")"
check "admin export"      'icao,category'  "$(curl -s "$BASE/api/admin/export.csv" -H "x-admin-key: $ADMIN_KEY" | head -1)"
check "admin removes listing" '"changed":1' "$(curl -s -XPOST $BASE/api/admin/spots/bulk -H "x-admin-key: $ADMIN_KEY" -H "$J" -d "{\"ids\":[$SID],\"action\":\"delete\"}")"
check "delete account"    '"ok":true'      "$(curl -s -XDELETE $BASE/api/me -H "$A" -H "$J" -d "{\"confirm\":\"$H\"}")"
check "session gone"      'null'           "$(curl -s $BASE/api/me -H "$A")"
echo "Result: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
