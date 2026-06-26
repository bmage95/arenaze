#!/usr/bin/env bash
# Arenaze end-to-end smoke test — exercises the core loop against a running server.
# Usage:  API=http://localhost:4000 bash scripts/smoke.sh
# Requires: a booted server (npm run dev:server) + a seeded DB (npm run db:seed).
set -uo pipefail

API="${API:-http://localhost:4000}"
PASS=0; FAIL=0
j() { python3 -c "import sys,json; d=json.load(sys.stdin); print(eval(sys.argv[1]))" "$1" 2>/dev/null; }
ok()   { echo "  ✅ $1"; PASS=$((PASS+1)); }
bad()  { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
hdr()  { echo; echo "── $1"; }

# Capture an HTTP status + body in one shot: sets $CODE and $BODY.
req() { # METHOD PATH [JSON_BODY] [extra curl args...]
  local m="$1" p="$2" b="${3:-}"; shift; shift; [ $# -gt 0 ] && shift || true
  local tmp; tmp=$(mktemp)
  if [ -n "$b" ]; then
    CODE=$(curl -s -o "$tmp" -w '%{http_code}' -X "$m" "$API$p" -H 'Content-Type: application/json' "$@" -d "$b")
  else
    CODE=$(curl -s -o "$tmp" -w '%{http_code}' -X "$m" "$API$p" "$@")
  fi
  BODY=$(cat "$tmp"); rm -f "$tmp"
}

hdr "Health"
req GET /api/health
[ "$CODE" = "200" ] && ok "GET /api/health 200" || bad "health ($CODE)"

hdr "Auth — admin login"
req POST /api/auth/login '{"username":"admin","password":"admin123"}'
ATOK=$(echo "$BODY" | j "d['accessToken']")
[ "$CODE" = "200" ] && [ -n "$ATOK" ] && ok "admin login 200 + token" || { bad "admin login ($CODE): $BODY"; echo "Cannot continue without a token."; exit 1; }
AUTH=(-H "Authorization: Bearer $ATOK")

hdr "Auth — bad creds rejected"
req POST /api/auth/login '{"username":"admin","password":"nope"}'
[ "$CODE" = "401" ] && ok "bad password → 401" || bad "expected 401, got $CODE"

hdr "Floor snapshot"
req GET /api/devices '' "${AUTH[@]}"
NDEV=$(echo "$BODY" | j "len(d)")
[ "$CODE" = "200" ] && [ "${NDEV:-0}" -ge 1 ] && ok "GET /api/devices → $NDEV devices" || bad "devices ($CODE): $BODY"
FREE_ID=$(echo "$BODY" | j "next((x['id'] for x in d if x['status']=='available'), '')")
[ -n "$FREE_ID" ] && ok "found a free device: $FREE_ID" || bad "no free device to seat"

hdr "Dashboard tiles"
req GET /api/dashboard/tiles '' "${AUTH[@]}"
[ "$CODE" = "200" ] && ok "tiles 200 (occupancy=$(echo "$BODY" | j "d['occupancyRate']")%)" || bad "tiles ($CODE)"

hdr "Start → end a walk-in session"
if [ -n "$FREE_ID" ]; then
  req POST "/api/devices/$FREE_ID/start" '{"playerLabel":"SmokeTest","durationMinutes":60}' "${AUTH[@]}"
  [ "$CODE" = "200" ] || [ "$CODE" = "201" ] && ok "start session ($CODE)" || bad "start ($CODE): $BODY"
  req POST "/api/devices/$FREE_ID/end-session" '' "${AUTH[@]}"
  CH=$(echo "$BODY" | j "d['chargedPaise']")
  { [ "$CODE" = "200" ] && [ -n "$CH" ]; } && ok "end session → charged ${CH}p" || bad "end ($CODE): $BODY"
fi

hdr "Booking + double-book 409 + idempotency"
START=$(python3 -c "import datetime;print((datetime.datetime.now().astimezone()+datetime.timedelta(days=2)).replace(hour=14,minute=0,second=0,microsecond=0).isoformat())")
KEY=$(python3 -c "import uuid;print(uuid.uuid4())")
req POST /api/bookings "{\"deviceType\":\"PC\",\"guests\":1,\"startAt\":\"$START\",\"durationMinutes\":120,\"extendable\":false,\"customer\":{\"name\":\"Smoke Cust\",\"handle\":\"smoke\"}}" "${AUTH[@]}" -H "Idempotency-Key: $KEY"
BID=$(echo "$BODY" | j "d['id']")
BDEV=$(echo "$BODY" | j "d['devices'][0]['deviceId']")
{ [ "$CODE" = "201" ] && [ -n "$BID" ]; } && ok "create booking 201 ($(echo "$BODY" | j "d['code']")) on $BDEV" || bad "create ($CODE): $BODY"

# Same idempotency key again → must return the SAME booking, not a new one.
req POST /api/bookings "{\"deviceType\":\"PC\",\"guests\":1,\"startAt\":\"$START\",\"durationMinutes\":120,\"extendable\":false,\"customer\":{\"name\":\"Smoke Cust\",\"handle\":\"smoke\"}}" "${AUTH[@]}" -H "Idempotency-Key: $KEY"
BID2=$(echo "$BODY" | j "d['id']")
[ "$BID2" = "$BID" ] && ok "idempotent replay returns same booking" || bad "idempotency: $BID2 != $BID"

# Overlapping booking on the SAME device + slot → must be 409 slot_taken.
if [ -n "$BDEV" ]; then
  req POST /api/bookings "{\"deviceType\":\"PC\",\"guests\":1,\"startAt\":\"$START\",\"durationMinutes\":120,\"extendable\":false,\"customer\":{\"name\":\"Clash\"},\"deviceIds\":[\"$BDEV\"]}" "${AUTH[@]}" -H "Idempotency-Key: $(python3 -c 'import uuid;print(uuid.uuid4())')"
  CODEW=$(echo "$BODY" | j "d['error']['code']")
  { [ "$CODE" = "409" ] && [ "$CODEW" = "slot_taken" ]; } && ok "double-book rejected → 409 slot_taken" || bad "expected 409 slot_taken, got $CODE / $CODEW"
fi

hdr "Cancel the booking"
if [ -n "$BID" ]; then
  req POST "/api/bookings/$BID/cancel" '' "${AUTH[@]}"
  ST=$(echo "$BODY" | j "d['status']")
  { [ "$CODE" = "200" ] && [ "$ST" = "cancelled" ]; } && ok "cancel → status cancelled" || bad "cancel ($CODE): $BODY"
fi

hdr "Availability search"
req POST /api/availability/search "{\"deviceType\":\"PC\",\"guests\":2,\"startAt\":\"$START\",\"durationMinutes\":60,\"extendable\":false}" "${AUTH[@]}"
[ "$CODE" = "200" ] && ok "availability search 200 (ok=$(echo "$BODY" | j "d['ok']"), matches=$(echo "$BODY" | j "len(d['slot']['matches'])"))" || bad "availability ($CODE)"

hdr "Role gating — staff blocked from admin routes"
req POST /api/auth/login '{"username":"staff","password":"staff123"}'
STOK=$(echo "$BODY" | j "d['accessToken']")
[ -n "$STOK" ] && ok "staff login 200" || bad "staff login ($CODE)"
if [ -n "$STOK" ]; then
  req GET /api/pricing '' -H "Authorization: Bearer $STOK"
  [ "$CODE" = "403" ] && ok "staff → /api/pricing 403" || bad "expected 403, got $CODE"
  req GET /api/analytics/overview '' -H "Authorization: Bearer $STOK"
  [ "$CODE" = "403" ] && ok "staff → /api/analytics 403" || bad "expected 403, got $CODE"
fi

echo; echo "════════════════════════════════════"
echo "  PASS: $PASS    FAIL: $FAIL"
echo "════════════════════════════════════"
[ "$FAIL" -eq 0 ]
