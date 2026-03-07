#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
AUTH_HEADER="${AUTH_HEADER:-Authorization: Bearer dev:cecilia@example.com}"

echo "Health:"
curl -sS "$BASE_URL/healthz"
echo

echo "Create transcript job:"
CREATE_RESPONSE="$(curl -sS -X POST "$BASE_URL/v1/epub/from-transcript" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d '{
    "title":"Smoke Test Episode",
    "language":"zh-CN",
    "transcript_text":"这是用于 smoke test 的测试文本，验证任务创建与产物下载流程。",
    "template_id":"templateA-v0-book",
    "metadata":{"episode_url":"https://example.com/ep/smoke"}
  }')"
echo "$CREATE_RESPONSE"

if ! echo "$CREATE_RESPONSE" | rg -q '"status":"succeeded"'; then
  echo "Create did not succeed."
  exit 1
fi

EPUB_URL="$(node -e 'const data=JSON.parse(process.argv[1]); const row=(data.artifacts||[]).find((x)=>x.type==="epub"); if(!row||!row.download_url){process.exit(2)}; process.stdout.write(row.download_url);' "$CREATE_RESPONSE" || true)"
if [ -z "$EPUB_URL" ]; then
  echo "Failed to parse EPUB download URL from inline artifacts."
  exit 1
fi

echo "Download EPUB artifact:"
curl -fsS "$EPUB_URL" >/dev/null
echo "EPUB download OK"
echo

echo "Inline inspector stages:"
node -e 'const data=JSON.parse(process.argv[1]); console.log(JSON.stringify(data.stages||[], null, 2));' "$CREATE_RESPONSE"
echo
