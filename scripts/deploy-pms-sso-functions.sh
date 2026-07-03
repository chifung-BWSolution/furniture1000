#!/usr/bin/env bash
# Deploy PMS-side SSO edge functions to kqwktnplkqucsbasyfjl
set -euo pipefail

PROJECT_REF="${PMS_PROJECT_REF:-kqwktnplkqucsbasyfjl}"
TOKEN="${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN required}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

deploy() {
  local slug="$1"
  local name="$2"
  local file="$3"
  local verify_jwt="${4:-false}"

  echo "{\"name\":\"${name}\",\"entrypoint_path\":\"index.ts\",\"verify_jwt\":${verify_jwt}}" > "$TMPDIR/meta.json"

  echo "Deploying ${slug} (verify_jwt=${verify_jwt})..."
  local out
  out="$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
    "https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${slug}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -F "metadata=@${TMPDIR}/meta.json;type=application/json" \
    -F "file=@${file}")"

  echo "$out"
  if ! grep -qE 'HTTP_STATUS:(200|201)' <<<"$out"; then
    echo "Deploy failed for ${slug}" >&2
    exit 1
  fi
  echo "OK: ${slug}"
}

deploy "supabase-functions-sync-pms-auth-to-bwf" "sync-pms-auth-to-bwf" \
  "${ROOT}/supabase/functions/sync-pms-auth-to-bwf/index.ts" false

deploy "supabase-functions-bwf-sso-start" "bwf-sso-start" \
  "${ROOT}/supabase/functions/bwf-sso-start/index.ts" true

echo "All PMS SSO functions deployed."
