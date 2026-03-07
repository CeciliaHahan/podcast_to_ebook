#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:8080}"
AUTH_HEADER="${AUTH_HEADER:-Authorization: Bearer dev:cecilia@example.com}"
CREATE_PATH="${CREATE_PATH:-/v1/epub/from-transcript}"

REQUEST_PAYLOAD="$(node -e '
const payload = {
  title: "Regression Test Episode",
  language: "zh-CN",
  transcript_text: "这是用于回归测试的转写文本。我们需要验证任务创建、状态查询、产物下载和 inspector 阶段信息都可用。",
  template_id: "templateA-v0-book",
  metadata: { episode_url: "https://example.com/regression" },
};
process.stdout.write(JSON.stringify(payload));
')"

json_get() {
  local json="$1"
  local expr="$2"
  node -e "const data = JSON.parse(process.argv[1]); const value = (${expr}); if (value === undefined || value === null) process.exit(2); if (typeof value === 'object') { process.stdout.write(JSON.stringify(value)); } else { process.stdout.write(String(value)); }" "$json"
}

assert_json() {
  local json="$1"
  local expr="$2"
  local message="$3"
  node -e "const data = JSON.parse(process.argv[1]); if (!(${expr})) { console.error(process.argv[2]); process.exit(1); }" "$json" "$message"
}

echo "[1/5] health check"
curl -sS "$BASE_URL/healthz" >/dev/null

echo "[2/5] create transcript job via $CREATE_PATH"
CREATE_RESPONSE="$(curl -sS -X POST "$BASE_URL$CREATE_PATH" \
  -H "$AUTH_HEADER" \
  -H 'Content-Type: application/json' \
  -d "$REQUEST_PAYLOAD")"
JOB_ID="$(json_get "$CREATE_RESPONSE" 'data.job_id')"
echo "job_id=$JOB_ID"

echo "[3/5] verify inline success"
FINAL_STATUS="$(json_get "$CREATE_RESPONSE" 'data.status')"
if [ "$FINAL_STATUS" != "succeeded" ]; then
  echo "Inline run failed."
  echo "$CREATE_RESPONSE"
  exit 1
fi

echo "[4/5] verify inline artifacts"
assert_json "$CREATE_RESPONSE" 'Array.isArray(data.artifacts) && data.artifacts.length >= 1' 'Expected at least one inline artifact.'
assert_json "$CREATE_RESPONSE" 'data.artifacts.some((item) => item.type === "epub")' 'Expected EPUB artifact to exist.'
FIRST_DOWNLOAD_URL="$(json_get "$CREATE_RESPONSE" 'data.artifacts[0]?.download_url')"
curl -fsS "$FIRST_DOWNLOAD_URL" >/dev/null

echo "[5/5] verify inline inspector"
assert_json "$CREATE_RESPONSE" 'Array.isArray(data.stages) && data.stages.length >= 2' 'Expected inspector to contain stage records.'
assert_json "$CREATE_RESPONSE" 'data.stages.some((stage) => stage.stage === "transcript")' 'Expected transcript stage in inspector.'
assert_json "$CREATE_RESPONSE" 'data.stages.some((stage) => stage.stage === "normalization")' 'Expected normalization stage in inspector.'

echo "PASS: transcript flow regression check passed"
echo "summary: job_id=$JOB_ID, first_download_url=$FIRST_DOWNLOAD_URL"
