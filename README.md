# Podcasts_to_ebooks Workspace

A Chrome extension plus backend that turns podcast transcripts into EPUB ebooks.

This repo is for one user. The system should stay simple, explicit, and easy to debug.

## TL;DR

- Primary path: send transcript text to `POST /v1/epub/from-transcript` and get EPUB artifacts plus inspector stages back in the same response.
- Fastest debug loop: run `./run_e2e_debug.sh` and use the local observability dashboard.
- PostgreSQL is optional for the primary EPUB flow. It is required for `/v1/jobs/*`, transcript history, and the dashboard sample/history views.

## Choose a Path

### Path 1: Fast Local EPUB Run (No DB Required)

Use this when you want the shortest transcript -> EPUB loop.

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

Then call:

- `POST /v1/epub/from-transcript`

This path:

- does not require Postgres
- returns EPUB artifacts inline on success
- returns inspector stages inline on success
- is the current main path used by the side panel

### Path 2: Full Debug Dashboard (DB Required)

Use this when you want recent transcript runs, stage-by-stage inspection, and sample picking.

```bash
./run_e2e_debug.sh
```

This script handles:

- PostgreSQL startup
- stale `postmaster.pid` cleanup
- backend env setup
- migration run
- backend build and start
- dashboard launch via `scripts/observe-transcript-run.mjs`

The dashboard runs against the DB-backed flow:

- `POST /v1/jobs/from-transcript`
- `GET /v1/jobs/{id}`
- `GET /v1/jobs/{id}/artifacts`
- `GET /v1/jobs/{id}/inspector`

## What Exists Today

- Chrome extension side panel submits transcript text.
- Express backend runs generation inline in the request lifecycle. There is no worker queue in the current main path.
- `POST /v1/epub/from-transcript` is DB-free and EPUB-only.
- PostgreSQL is only required for `/v1/jobs/*` compatibility/history endpoints and dashboard flows.
- Artifacts are written to local disk under `backend/.dev-artifacts/` and exposed by download URLs.
- Successful inline runs return artifact metadata and inspector stage data in the same response.

## Setup

### Backend

Required:

- Node.js and npm
- a copied env file: `backend/.env`

Optional:

- PostgreSQL 16 for DB-backed job routes and the observability dashboard

Example env file:

```bash
HOST=0.0.0.0
PORT=8080
DATABASE_URL=postgres://postgres:postgres@localhost:5432/podcasts_to_ebooks
NODE_ENV=development
PUBLIC_BASE_URL=http://localhost:8080
OPENROUTER_API_KEY=
```

Meaning of the main env vars:

- `PORT`: backend port. Default local value is `8080`.
- `DATABASE_URL`: required only for `/v1/jobs/*` and dashboard history/sample features.
- `PUBLIC_BASE_URL`: base URL used in generated download links.
- `OPENROUTER_API_KEY`: needed only when the current generation path reaches LLM-backed stages.

There is no pinned Node version in this repo yet. If you want stricter setup reproducibility later, add an engine field or `.nvmrc`.

### Chrome Extension

The extension is load-unpacked only right now.

1. Open `chrome://extensions`
2. Enable `Developer mode`
3. Click `Load unpacked`
4. Select the `extension/` folder
5. Open the extension side panel
6. Set:
   - API Base URL: `http://localhost:8080`
   - Bearer token: `dev:cecilia@example.com` or `dev-token`

Important:

- The current side panel submits directly to `POST /v1/epub/from-transcript`.
- Settings are stored in `chrome.storage.local`.

## Minimal API Example

Use this when you want to verify the backend without opening Chrome.

```bash
curl -X POST http://localhost:8080/v1/epub/from-transcript \
  -H 'Authorization: Bearer dev:cecilia@example.com' \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Smoke Test Episode",
    "language": "zh-CN",
    "transcript_text": "这是用于 smoke test 的测试文本，验证 transcript 到 EPUB 的主流程。",
    "template_id": "templateA-v0-book",
    "metadata": {
      "episode_url": "https://example.com/episodes/smoke"
    },
    "compliance_declaration": {
      "for_personal_or_authorized_use_only": true,
      "no_commercial_use": true
    }
  }'
```

Successful inline response shape:

```json
{
  "job_id": "run_xxx",
  "status": "succeeded",
  "created_at": "2026-03-06T00:00:00.000Z",
  "artifacts": [
    {
      "type": "epub",
      "file_name": "run_xxx.epub",
      "size_bytes": 123456,
      "download_url": "http://localhost:8080/downloads/run_xxx/run_xxx.epub",
      "expires_at": null
    }
  ],
  "stages": [
    {
      "stage": "transcript",
      "ts": "2026-03-06T00:00:00.000Z"
    }
  ],
  "traceability": {
    "source_type": "transcript",
    "source_ref": "https://example.com/episodes/smoke",
    "generated_at": "2026-03-06T00:00:01.000Z"
  }
}
```

Current API surface:

| Method | Path | Current role |
| --- | --- | --- |
| `POST` | `/v1/epub/from-transcript` | Primary DB-free transcript -> EPUB entrypoint |
| `POST` | `/v1/jobs/from-transcript` | DB-backed compatibility and dashboard entrypoint |
| `GET` | `/v1/jobs/{id}` | DB-backed status polling |
| `GET` | `/v1/jobs/{id}/artifacts` | DB-backed artifact listing |
| `GET` | `/v1/jobs/{id}/inspector` | DB-backed inspector trace |

Auth for local dev:

- `Authorization: Bearer dev-token`
- `Authorization: Bearer dev:you@example.com`

## Concepts

### System Flow Map (As-Is)

```mermaid
flowchart TD
  U[User in Extension Sidepanel] --> F1

  subgraph F1[Flow 1: Entry Request Flow]
    A1[Fill form: title/language/transcript/compliance] --> A2[POST /v1/epub/from-transcript]
    A2 --> A3[Request validation + compliance check]
  end

  A3 --> F2
  subgraph F2[Flow 2: Data Transformation Flow]
    B1[extractTranscriptBody + cleanup] --> B2[parseTranscriptEntries]
    B2 --> B3[planSemanticSegments]
    B3 --> B4[buildChapterPlan]
    B4 --> B5[build deterministic base model]
  end

  B5 --> F3
  subgraph F3[Flow 3: Generation Strategy Flow]
    C1[generation_method = C only] --> C2{transcript > 32k?}
    C2 -->|Yes| C3[skip full-book LLM]
    C3 --> C4[chapter-level patch]
    C2 -->|No| C5[full-book LLM draft]
    C5 --> C6{draft parse OK?}
    C6 -->|No| C4
    C6 -->|Yes| C7[merge with evidence checks]
    C4 --> C7
  end

  C7 --> F4
  subgraph F4[Flow 4: Quality + Render Flow]
    D1[countModelQualityIssues] --> D2[quality gate stats]
    D2 --> D3[render artifacts]
    D3 --> D4[write .dev-artifacts/run_*]
  end

  D4 --> F5
  subgraph F5[Flow 5: Delivery Flow]
    E1[inline response: artifacts + stages] --> E2[sidepanel render status/events/download]
    E2 --> E3[GET /downloads/:job_id/:file_name]
  end

  D4 --> F6
  subgraph F6[Flow 6: Evaluation/Observability Flow]
    G1[inspector stages: transcript/normalization/llm_*] --> G2[observe-transcript-run dashboard]
    G2 --> G3[compare quality regressions]
  end
```

### Two Important Terms

`compliance_declaration`

- This is not a passive label.
- Both fields must be `true`, or the API rejects the request.
- Today it means: personal use or explicitly authorized use only, and no commercial use.

`generation_method = C`

- This is the only active method today.
- The backend currently forces generation method `C` even if other metadata values are sent.
- Treat it as current implementation detail plus compatibility marker, not a user-configurable strategy switch.

### Short Glossary

| 中文术语 | English Term | 一句话定义 |
| --- | --- | --- |
| 入口数据 | Entry Data | 用户提交到 API 的原始请求数据包。 |
| 解析 | Parsing | 把非结构化文本转成结构化对象。 |
| 控制流 | Control Flow | 系统按什么顺序调用模块。 |
| 数据流 | Data Flow | 数据在各阶段如何变形与传递。 |
| 质量门 | Quality Gate | 渲染前的结构和内容检查机制。 |
| 证据约束 | Evidence Constraint | 引用与结论需可在原文中找到支持。 |
| 产物 | Artifact | 生成的 EPUB 文件和调试相关输出。 |
| 内联返回 | Inline Response | 同一个请求直接返回产物与阶段信息。 |
| 可观测性 | Observability | 可追踪系统内部阶段与数据状态。 |

Full version: `docs/system-flow-map-and-glossary.md`

## Debugging

The main debug tool is the local observability dashboard:

```bash
./run_e2e_debug.sh
```

What you get:

- sample picker using local transcript samples plus recent DB-backed runs
- one-click E2E run against `/v1/jobs/from-transcript`
- stage cards and timeline
- live inspector events such as `transcript`, `normalization`, `llm_request`, and `llm_response`
- final EPUB and Markdown result panels for comparison
- shareable debug state in URL query

Local sample files live in:

```text
tasks/transcript-samples/
data/transcripts/
```

If the backend is already running, you can start only the dashboard:

```bash
node scripts/observe-transcript-run.mjs
```

## Roadmap

### Target Simplification (Planned)

```mermaid
flowchart TD
  A[Extension side panel] --> B[POST /v1/epub/from-transcript]
  B --> C[validate + normalize transcript]
  C --> D[segment chapters]
  D --> E[optional LLM rewrite]
  E --> F[build canonical BookModel]
  F --> G[render EPUB]
  G --> H[return file response]
```

The intended simplification direction:

- keep one obvious transcript -> EPUB path
- keep inspector visibility, but move it behind normal happy-path usage
- avoid queue semantics unless audit/debug needs prove they are necessary

## Failure Policy

- Do not hide failures with silent fallbacks.
- If a request needs LLM-backed behavior and that path fails, surface the error clearly.
- Keep deterministic behavior explicit so quality regressions stay visible.

## Troubleshooting

### `DB_REQUIRED` error

Meaning:

- You called a DB-backed route without `DATABASE_URL`.

Fix:

- Use `POST /v1/epub/from-transcript` for DB-free runs.
- Or configure Postgres and use `./run_e2e_debug.sh`.

### Backend health check fails

Check:

- `http://localhost:8080/healthz`

Common causes:

- port `8080` already taken
- backend build failed
- missing env file

### Dashboard cannot start Postgres

Common causes:

- PostgreSQL 16 is not installed at the Homebrew path expected by `run_e2e_debug.sh`
- the Postgres data directory was never initialized
- stale `postmaster.pid` blocks startup

The script already tries to remove a stale `postmaster.pid` when the recorded process no longer exists.

### Extension cannot talk to backend

Check:

- API Base URL is `http://localhost:8080`
- Bearer token is `dev-token` or `dev:cecilia@example.com`
- backend health endpoint responds

## Repo Map

```text
.
├── backend/
│   └── src/
│       ├── routes/          # API handlers
│       ├── services/        # Job orchestration
│       ├── repositories/    # DB + generation + rendering (currently mixed)
│       └── config.ts
├── extension/
│   ├── sidepanel/           # Main UI
│   └── src/api/             # API client
├── docs/
├── scripts/
└── tasks/method-compare/
```

## Deep Docs

- `docs/openapi.v1.yaml`
- `docs/v1-spec.md`
- `docs/system-flow-map-and-glossary.md`
- `docs/simplify-backend-plan.md`
