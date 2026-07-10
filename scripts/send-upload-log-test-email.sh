#!/usr/bin/env bash
# Send a test 上載產品紀錄 email to brandingworks.ebiz@gmail.com
# Requires: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY set in Edge Function secrets
set -euo pipefail

PROJECT_URL="${VITE_SUPABASE_URL:-https://riaubhtruisbwdlwjzur.supabase.co}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY required}"

echo "Sending test upload log report email..."
curl -s -X POST "${PROJECT_URL}/functions/v1/send-upload-log-report-email" \
  -H "Authorization: Bearer ${SERVICE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"test":true,"to":"brandingworks.ebiz@gmail.com"}' | jq .
