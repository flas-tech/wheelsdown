#!/usr/bin/env bash
# My Crew / Crew Up / launch switch / own-rating delete. Usage: BASE=http://localhost:5000 ADMIN_KEY=... bash script/mycrew-test.sh
# Creates three throwaway accounts, opens the launch switch if LAUNCH=1 (local only), then deletes the accounts.
set -u
BASE="${BASE:-http://localhost:5000}"; ADMIN_KEY="${ADMIN_KEY:-wheelsdown-admin}"
PASS=0; FAIL=0; S=$(date +%s)
ok(){ echo "  PASS  $1"; PASS=$((PASS+1)); }; bad(){ echo "  FAIL  $1  ->  $2"; FAIL=$((FAIL+1)); }
check(){ if [[ "$3" == *"$2"* ]]; then ok "$1"; else bad "$1" "${3:0:240}"; fi; }
curl(){ command curl -s -H "x-wd-test: 1" "$@"; }
J='content-type: application/json'; AK="x-admin-key: $ADMIN_KEY"
jget(){ python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
mk(){ curl -XPOST $BASE/api/auth/signup -H "$J" -d "{\"handle\":\"smoke$1$S\",\"password\":\"smoke-pass-123\",\"displayName\":\"Smoke $1\",\"crewRole\":\"Pilot\",\"acceptTerms\":true$2}"; }
RA=$(mk a ""); TA=$(echo "$RA" | jget 'd["token"]'); A="authorization: Bearer $TA"; IA=$(curl $BASE/api/me -H "$A" | jget 'd["id"]')
RB=$(mk b ""); TB=$(echo "$RB" | jget 'd["token"]'); B="authorization: Bearer $TB"; IB=$(curl $BASE/api/me -H "$B" | jget 'd["id"]')
echo "users $IA $IB"
if [[ "${LAUNCH:-0}" == "1" ]]; then
  check "launch closed: member 404" '404' "$(curl -o /dev/null -w '%{http_code}' $BASE/api/mycrew -H "$A")"
  check "launch switch needs admin" '401' "$(curl -o /dev/null -w '%{http_code}' -XPUT $BASE/api/admin/launch -H "$J" -d '{"audience":"members"}')"
  check "open to members" '"members"' "$(curl -XPUT $BASE/api/admin/launch -H "$AK" -H "$J" -d '{"audience":"members"}')"
  sleep 16
fi
check "features" '"experience":"members"' "$(curl $BASE/api/features)"
check "my crew empty" '"crew":[]' "$(curl $BASE/api/mycrew -H "$A")"
check "invite url" "ref=$IA&crew=1" "$(curl $BASE/api/mycrew -H "$A")"
check "find by handle" "\"id\":$IB" "$(curl "$BASE/api/mycrew/find?q=smokeb$S" -H "$A")"
check "can't add self" '400' "$(curl -o /dev/null -w '%{http_code}' -XPOST $BASE/api/mycrew/requests -H "$A" -H "$J" -d "{\"userId\":$IA}")"
check "send request" '"outgoing"' "$(curl -XPOST $BASE/api/mycrew/requests -H "$A" -H "$J" -d "{\"userId\":$IB}")"
check "send again is idempotent" '"outgoing"' "$(curl -XPOST $BASE/api/mycrew/requests -H "$A" -H "$J" -d "{\"userId\":$IB}")"
check "B sees incoming" "\"id\":$IA" "$(curl $BASE/api/mycrew -H "$B" | jget 'json.dumps(d["incoming"]).replace(": ", ":")')"
RID=$(curl $BASE/api/mycrew -H "$B" | jget 'd["incoming"][0]["id"]')
check "status from B" '"incoming"' "$(curl $BASE/api/mycrew/status/$IA -H "$B")"
check "shared hidden before accept" '404' "$(curl -o /dev/null -w '%{http_code}' $BASE/api/mycrew/$IB/shared -H "$A")"
check "A can't accept own request" '404' "$(curl -o /dev/null -w '%{http_code}' -XPOST $BASE/api/mycrew/requests/$RID/accept -H "$A")"
# Crew Up before crew: B posts, A should not see it
check "B posts Crew Up" '"ok":true' "$(curl -XPOST $BASE/api/preview/meetups -H "$B" -H "$J" -d '{"icao":"KTEB","note":"Dinner at 7","hours":4}')"
check "A can't see stranger's plans" '"others":[]' "$(curl "$BASE/api/preview/meetups?icao=KTEB" -H "$A")"
MID=$(curl "$BASE/api/preview/meetups?icao=KTEB" -H "$B" | jget 'd["mine"]["id"]')
check "A can't join stranger" '404' "$(curl -o /dev/null -w '%{http_code}' -XPOST $BASE/api/preview/meetups/$MID/join -H "$A")"
check "B accepts" '"crew"' "$(curl -XPOST $BASE/api/mycrew/requests/$RID/accept -H "$B")"
check "A got accepted message" 'accepted your crew request' "$(curl $BASE/api/me/messages -H "$A")"
check "messages seen" '"ok":true' "$(curl -XPOST $BASE/api/me/messages/seen -H "$A")"
check "messages unread 0" '"unread":0' "$(curl $BASE/api/me/messages -H "$A")"
check "A sees crew" "\"id\":$IB" "$(curl $BASE/api/mycrew -H "$A" | jget 'json.dumps(d["crew"]).replace(": ", ":")')"
check "crew shows Crew Up airport" '"crewUpAt":"KTEB"' "$(curl $BASE/api/mycrew -H "$A")"
check "A sees B's plans at KTEB" '"Dinner at 7"' "$(curl "$BASE/api/preview/meetups?icao=KTEB" -H "$A")"
check "A sees B's plans elsewhere" '"Dinner at 7"' "$(curl "$BASE/api/preview/meetups?icao=KMIA" -H "$A" | jget 'json.dumps(d["crewElsewhere"]).replace(": ", ":")')"
check "A joins B" '200' "$(curl -o /dev/null -w '%{http_code}' -XPOST $BASE/api/preview/meetups/$MID/join -H "$A")"
check "today counts crew" '"others":1' "$(curl "$BASE/api/preview/today?icao=KTEB" -H "$A")"
check "shared: checkins private by default" '"checkins":null' "$(curl $BASE/api/mycrew/$IB/shared -H "$A")"
check "B shares checkins" '"shareCheckins":true' "$(curl -XPUT $BASE/api/mycrew/privacy -H "$B" -H "$J" -d '{"shareCheckins":true}')"
check "shared: checkins now list" '"checkins":[' "$(curl $BASE/api/mycrew/$IB/shared -H "$A")"
check "B closes requests" '"allowRequests":false' "$(curl -XPUT $BASE/api/mycrew/privacy -H "$B" -H "$J" -d '{"allowRequests":false}')"
RC=$(mk c ",\"ref\":$IA,\"crewInvite\":true"); TC=$(echo "$RC" | jget 'd["token"]'); C="authorization: Bearer $TC"; IC=$(curl $BASE/api/me -H "$C" | jget 'd["id"]')
check "crew invite link leaves request" "\"id\":$IA" "$(curl $BASE/api/mycrew -H "$C" | jget 'json.dumps(d["incoming"]).replace(": ", ":")')"
check "C blocked by B's setting" '403' "$(curl -o /dev/null -w '%{http_code}' -XPOST $BASE/api/mycrew/requests -H "$C" -H "$J" -d "{\"userId\":$IB}")"
check "C declines A quietly" '"none"' "$(curl -XPOST $BASE/api/mycrew/requests/$(curl $BASE/api/mycrew -H "$C" | jget 'd["incoming"][0]["id"]')/decline -H "$C")"
check "A can ask again after decline" '"outgoing"' "$(curl -XPOST $BASE/api/mycrew/requests -H "$A" -H "$J" -d "{\"userId\":$IC}")"
check "C sending back accepts" '"crew"' "$(curl -XPOST $BASE/api/mycrew/requests -H "$C" -H "$J" -d "{\"userId\":$IA}")"
check "A removes B" '"none"' "$(curl -XDELETE $BASE/api/mycrew/$IB -H "$A")"
check "plans gone after remove" '"others":[]' "$(curl "$BASE/api/preview/meetups?icao=KTEB" -H "$A")"
check "shared gone after remove" '404' "$(curl -o /dev/null -w '%{http_code}' $BASE/api/mycrew/$IB/shared -H "$A")"
# ratings: one per member per place, author can delete
SID=$(curl "$BASE/api/search?route=KTEB" | jget '[s["id"] for s in d["spots"] if s["category"]=="eat"][0]')
check "rate a place" '"id"' "$(curl -XPOST $BASE/api/spots/$SID/reviews -H "$A" -H "$J" -d '{"rating":5,"comment":"Smoke test rating"}' | tee /tmp/t/r1.json)"
RVID=$(jget 'd["id"]' < /tmp/t/r1.json)
check "second rating refused" '409' "$(curl -o /dev/null -w '%{http_code}' -XPOST $BASE/api/spots/$SID/reviews -H "$A" -H "$J" -d '{"rating":4,"comment":"Again"}')"
check "others can't delete it" '403' "$(curl -o /dev/null -w '%{http_code}' -XDELETE $BASE/api/reviews/$RVID -H "$B")"
check "author deletes it" '"ok":true' "$(curl -XDELETE $BASE/api/reviews/$RVID -H "$A")"
check "can rate again after delete" '"id"' "$(curl -XPOST $BASE/api/spots/$SID/reviews -H "$A" -H "$J" -d '{"rating":5,"comment":"Smoke test rating"}' | tee /tmp/t/r2.json)"
curl -XDELETE $BASE/api/reviews/$(jget 'd["id"]' < /tmp/t/r2.json) -H "$A" >/dev/null
# feedback reply
curl -XPOST $BASE/api/feedback -H "$B" -H "$J" -d "{\"kind\":\"other\",\"message\":\"Smoke feedback $S please ignore\",\"page\":\"/\"}" >/dev/null
FID=$(curl "$BASE/api/admin/feedback?status=all" -H "$AK" | jget "[f['id'] for f in d['items'] if '$S' in f['message']][0]")
[[ -n "$FID" ]] && check "admin replies in app" '"ok":true' "$(curl -XPOST $BASE/api/admin/feedback/$FID/notify -H "$AK" -H "$J" -d '{"message":"Smoke reply, please ignore"}')"
[[ -n "$FID" ]] && check "member got the reply" 'Smoke reply' "$(curl $BASE/api/me/messages -H "$B")"
[[ -n "$FID" ]] && curl -XDELETE $BASE/api/admin/feedback/$FID -H "$AK" >/dev/null
curl -XDELETE $BASE/api/preview/meetups/$MID -H "$B" >/dev/null
for T in "$A:smokea$S" "$B:smokeb$S" "$C:smokec$S"; do curl -XDELETE $BASE/api/me -H "${T%%:smoke*}" -H "$J" -d "{\"confirm\":\"${T##*:}\"}" >/dev/null; done
check "crew links gone with accounts" '404' "$(curl -o /dev/null -w '%{http_code}' $BASE/api/mycrew/$IA/shared -H "$A")"
if [[ "${LAUNCH:-0}" == "1" ]]; then curl -XPUT $BASE/api/admin/launch -H "$AK" -H "$J" -d '{"audience":"admins"}' >/dev/null; fi
echo "Result: $PASS passed, $FAIL failed"; [[ $FAIL -eq 0 ]]
