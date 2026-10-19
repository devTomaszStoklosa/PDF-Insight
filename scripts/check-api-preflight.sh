#!/usr/bin/env bash
# Checks that the deployed API answers the CORS preflight for the given origin.
# The API loads its configuration before it answers a preflight, so this catches a crashing
# function or a missing variable. A preflight never reaches the LLM or the request limit,
# so the check uses no quota.
#
# Usage: scripts/check-api-preflight.sh <api-base-url> <origin>
set -euo pipefail

api_url="${1:?API base URL required}"
api_url="${api_url%/}/api/analyze"
origin="${2:?origin required}"
attempts=5
delay_seconds=10

for attempt in $(seq 1 "$attempts"); do
  headers=$(curl --silent --show-error --max-time 15 --output /dev/null --dump-header - \
    --request OPTIONS \
    --header "Origin: $origin" \
    --header 'Access-Control-Request-Method: POST' \
    "$api_url" | tr -d '\r') || headers=''
  status=$(printf '%s\n' "$headers" | awk 'toupper($1) ~ /^HTTP\// { code = $2 } END { print code }')
  allowed=$(printf '%s\n' "$headers" |
    awk -F': ' 'tolower($1) == "access-control-allow-origin" { print $2 }')

  if [ "$status" = '204' ] && [ "$allowed" = "$origin" ]; then
    echo "API preflight OK: 204, Access-Control-Allow-Origin: $allowed"
    exit 0
  fi
  echo "Attempt $attempt/$attempts: status '${status:-none}', Access-Control-Allow-Origin '${allowed:-none}'"
  if [ "$attempt" -lt "$attempts" ]; then
    sleep "$delay_seconds"
  fi
done

echo "::error::The API at $api_url did not answer the CORS preflight for $origin with 204."
exit 1
