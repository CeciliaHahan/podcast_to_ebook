#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
AUTH_HEADER="${AUTH_HEADER:-Authorization: Bearer dev:cecilia@example.com}"

echo "Health:"
curl -sS "$BASE_URL/healthz"
echo

echo "Create transcript job:"
CREATE_RESPONSE="$(curl -sS -X POST "$BASE_URL/v1/jobs/from-transcript" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d '{
    "title":"Smoke Test Episode",
    "language":"zh-CN",
    "transcript_text":"这是用于 smoke test 的测试文本，验证任务创建与产物下载流程。",
    "template_id":"templateA-v0-book",
    "output_formats":["epub","pdf","md"],
    "metadata":{"episode_url":"https://example.com/ep/smoke"},
    "compliance_declaration":{
      "for_personal_or_authorized_use_only":true,
      "no_commercial_use":true
    }
  }')"
echo "$CREATE_RESPONSE"

JOB_ID="$(echo "$CREATE_RESPONSE" | sed -n 's/.*"job_id":"\([^"]*\)".*/\1/p')"
if [ -z "$JOB_ID" ]; then
  echo "Failed to parse job_id."
  exit 1
fi

echo "Polling job status..."
for _ in 1 2 3 4 5 6 7 8; do
  STATUS_RESPONSE="$(curl -sS -H "$AUTH_HEADER" "$BASE_URL/v1/jobs/$JOB_ID")"
  echo "$STATUS_RESPONSE"
  if echo "$STATUS_RESPONSE" | rg -q '"status":"succeeded"'; then
    break
  fi
  sleep 1
done

echo "Artifacts:"
curl -sS -H "$AUTH_HEADER" "$BASE_URL/v1/jobs/$JOB_ID/artifacts"
echo

echo "Inspector:"
curl -sS -H "$AUTH_HEADER" "$BASE_URL/v1/jobs/$JOB_ID/inspector"
echo
