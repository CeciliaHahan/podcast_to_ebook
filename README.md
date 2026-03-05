# Podcasts_to_ebooks Workspace

A Chrome extension + backend that turns podcast transcripts into ebooks.

This project is used by one person, so the architecture should stay simple, explicit, and easy to debug.

## Project Scope (Read First)

- This is a single-user product.
- The core goal is high-quality transcript -> EPUB output.
- Prefer straightforward implementations that are easy to reason about.
- Do not overengineer for scale, workflows, or abstractions we do not need yet.
- Add complexity only when it clearly improves output quality or fixes repeated real pain.

## Flow Map + Glossary

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

### Glossary (CN/EN, short)

| 中文术语 | English Term | 一句话定义 |
| --- | --- | --- |
| 入口数据 | Entry Data | 用户提交到 API 的原始请求数据包。 |
| 解析 | Parsing | 把非结构化文本转成结构化对象。 |
| 控制流 | Control Flow | 系统按什么顺序调用模块。 |
| 数据流 | Data Flow | 数据在各阶段如何变形与传递。 |
| 质量门 | Quality Gate | 渲染前的结构和内容检查机制。 |
| 证据约束 | Evidence Constraint | 引用与结论需可在原文中找到支持。 |
| 产物 | Artifact | 生成的 EPUB/PDF/MD 文件。 |
| 内联返回 | Inline Response | 同一个请求直接返回产物与阶段信息。 |
| 可观测性 | Observability | 可追踪系统内部阶段与数据状态。 |

Full version: `docs/system-flow-map-and-glossary.md`

## What Exists Today

- Chrome extension side panel submits transcript text.
- Express backend runs generation inline (same request lifecycle, no worker queue).
- `POST /v1/epub/from-transcript` is now DB-free for core transcript -> EPUB runs.
- PostgreSQL is only required for `/v1/jobs/*` compatibility/history endpoints.
- Artifacts are written to local disk (`.dev-artifacts/`) and exposed via download URLs.
- Primary endpoint (`/v1/epub/from-transcript`) returns artifact + inspector data inline when generation succeeds.

## Quick Start

```bash
cd backend
cp .env.example .env
npm install
psql "$DATABASE_URL" -f migrations/0001_init.sql
npm run dev
```

Or from repo root:

```bash
./scripts/dev-up.sh
```

If you only use `POST /v1/epub/from-transcript`, Postgres is optional.
If you use `/v1/jobs/*` or transcript history APIs, Postgres is required.

## Live E2E Observability Dashboard

Use this when you want a result-first transcript -> EPUB loop with visible stage-by-stage progress.

One command startup (recommended):

```bash
./run_e2e_debug.sh
```

This script handles:

- PostgreSQL startup + stale `postmaster.pid` cleanup
- backend env/migration/build/start
- dashboard launch (`scripts/observe-transcript-run.mjs`)

Manual dashboard-only start (if backend is already running):

```bash
node scripts/observe-transcript-run.mjs
```

What you get:

- sample picker (local samples + recent transcript runs)
- one-click E2E run (`/v1/jobs/from-transcript`)
- `Version A Storyboard`: narrative flow + stage cards
- live stage timeline (`transcript`, `normalization`, `llm_request`, `llm_response`, etc.)
- final EPUB + Markdown result panel
- shareable debug state in URL query:
  - `method=C`
  - `sample=<sample_id>`

Local sample files live in:

```text
tasks/transcript-samples/
data/transcripts/
```

## API Surface (Current)

| Method | Path | Status |
| --- | --- | --- |
| `POST` | `/v1/epub/from-transcript` | Primary DB-free transcript -> EPUB entrypoint (EPUB-only, no `output_formats` required, inline artifacts/inspector on success) |
| `POST` | `/v1/jobs/from-transcript` | Backward-compatible DB-backed transcript entrypoint |
| `GET` | `/v1/jobs/{id}` | Used for status polling |
| `GET` | `/v1/jobs/{id}/artifacts` | Used for downloads |
| `GET` | `/v1/jobs/{id}/inspector` | Used for debug trace |

Auth for local dev:

- `Authorization: Bearer dev-token`
- `Authorization: Bearer dev:you@example.com`

## Architecture (Today)

```mermaid
flowchart TD
  A[Extension side panel] --> B[POST /v1/epub/from-transcript]
  B --> C[runPipelineInline]
  C --> D[buildBookletModel]
  D --> E[optional LLM enrichment]
  E --> F[render artifacts: epub/md/pdf]
  F --> G[write files under .dev-artifacts]
  G --> H[inline response: artifacts + inspector stages]
  H --> I[Extension shows download immediately]
```

Important: there is no background queue right now. The pipeline runs inline in the backend process.
`/v1/jobs/*` remains as DB-backed compatibility mode.

## Target Simplification (Planned)

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

Optional lightweight record (only if needed later): save one `run` row for audit/debug, but no queue semantics.

## Transcript -> EPUB Pipeline (Core Logic)

```mermaid
flowchart LR
  A[Raw transcript] --> B[Parse speaker/timestamp/text]
  B --> C[Clean noise and normalize text]
  C --> D[Detect topic boundaries]
  D --> E[Create chapter plan]
  E --> F[Assemble base BookModel]
  F --> G[Optional LLM enhancement]
  G --> H[Quality checks for EPUB validity]
  H --> I[Render EPUB package]
```

## Failure Policy

- Do not hide failures with silent fallbacks.
- If LLM mode is enabled and fails, return explicit error details.
- Keep deterministic (non-LLM) mode explicit, not implicit.

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
