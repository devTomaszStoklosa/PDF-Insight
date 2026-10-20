#!/usr/bin/env bash
# Checks that the deployed API answers the CORS preflight for the given origin.
# The API loads its configuration before it answers a preflight, so this catches a crashing
# function or a missing variable. A preflight never reaches the LLM or the request limit,
# so the check uses no quota.
#
# With an expected commit, it also waits until the API reports that commit in X-App-Version,
# or a newer commit that contains it. Vercel deploys the API on its own, so this allows up to
# 30 tries, 10 s apart; without a commit it tries 5 times. CHECK_API_ATTEMPTS and
# CHECK_API_DELAY_SECONDS override both. Recognising a newer commit needs the git history,
# so run the script in a full clone (fetch-depth: 0 in GitHub Actions).
#
# Usage: scripts/check-api-preflight.sh <api-base-url> <origin> [expected-commit]
set -euo pipefail

api_url="${1:?API base URL required}"
api_url="${api_url%/}/api/analyze"
origin="${2:?origin required}"
expected_version="${3:-}"
default_attempts=$([ -n "$expected_version" ] && echo 30 || echo 5)
attempts="${CHECK_API_ATTEMPTS:-$default_attempts}"
delay_seconds="${CHECK_API_DELAY_SECONDS:-10}"

header_value() {
  printf '%s\n' "$1" | awk -F': ' -v name="$2" 'tolower($1) == name { print $2 }'
}

# A newer merge can reach Vercel before this run checks the API; its commit contains the
# expected one, so it counts as deployed. The header comes from the network, so only a full
# commit hash reaches git. A commit pushed after the checkout is fetched first.
contains_expected() {
  [[ "$1" =~ ^[0-9a-f]{40}$ ]] || return 1
  git cat-file -e "$1^{commit}" 2>/dev/null || git fetch --quiet origin "$1" 2>/dev/null || return 1
  git merge-base --is-ancestor "$expected_version" "$1" 2>/dev/null
}

for attempt in $(seq 1 "$attempts"); do
  headers=$(curl --silent --show-error --max-time 15 --output /dev/null --dump-header - \
    --request OPTIONS \
    --header "Origin: $origin" \
    --header 'Access-Control-Request-Method: POST' \
    "$api_url" | tr -d '\r') || headers=''
  status=$(printf '%s\n' "$headers" | awk 'toupper($1) ~ /^HTTP\// { code = $2 } END { print code }')
  allowed=$(header_value "$headers" 'access-control-allow-origin')
  version=$(header_value "$headers" 'x-app-version')

  if [ "$status" = '204' ] && [ "$allowed" = "$origin" ]; then
    if [ -z "$expected_version" ] || [ "$version" = "$expected_version" ]; then
      echo "API preflight OK: 204, Access-Control-Allow-Origin: $allowed, X-App-Version: ${version:-none}"
      exit 0
    fi
    if contains_expected "$version"; then
      echo "API preflight OK: 204, Access-Control-Allow-Origin: $allowed, X-App-Version: $version, a newer commit that contains $expected_version"
      exit 0
    fi
  fi
  echo "Attempt $attempt/$attempts: status '${status:-none}', Access-Control-Allow-Origin '${allowed:-none}', X-App-Version '${version:-none}'"
  if [ "$attempt" -lt "$attempts" ]; then
    sleep "$delay_seconds"
  fi
done

if [ -n "$expected_version" ] && [ "$status" = '204' ] && [ "$allowed" = "$origin" ]; then
  echo "::error::The API at $api_url serves ${version:-none}, expected $expected_version or a newer commit that contains it. Check which deployment is current in Vercel."
else
  echo "::error::The API at $api_url did not answer the CORS preflight for $origin with 204."
fi
exit 1
