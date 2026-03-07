#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
AUTH_HEADER="${AUTH_HEADER:-Authorization: Bearer dev:cecilia@example.com}"

echo "Health:"
curl -sS "$BASE_URL/healthz"
echo

echo "Create working notes from transcript:"
WN_RESPONSE="$(curl -sS -X POST "$BASE_URL/v1/working-notes/from-transcript" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d '{
    "title":"Smoke Test Episode",
    "language":"zh-CN",
    "transcript_text":"这是用于 smoke test 的测试文本，验证 staged pipeline 各阶段是否正常运行。需要足够长度才能通过验证。播客的核心话题是如何进行有效的时间管理，嘉宾分享了几个实用技巧。第一个技巧是番茄工作法，每25分钟专注工作后休息5分钟。第二个技巧是每天早上列出三件最重要的事。第三个技巧是学会说不，减少不必要的会议。",
    "metadata":{"episode_url":"https://example.com/ep/smoke"}
  }')"
echo "$WN_RESPONSE"

if ! echo "$WN_RESPONSE" | grep -q '"status":"succeeded"'; then
  echo "Working notes creation did not succeed."
  exit 1
fi
echo "Working notes OK"
echo
