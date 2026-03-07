# Podcasts to Ebooks

A Chrome extension that turns Chinese podcast transcripts into structured EPUB ebooks using LLM-powered summarization. Paste a transcript, click through four steps, download an EPUB.

This is a single-user project. The architecture is intentionally simple, explicit, and easy to debug.

---

## System Overview

```mermaid
flowchart LR
  subgraph Browser["Chrome Extension (sidepanel)"]
    A[Paste transcript] --> B[local-pipeline.js]
    B -->|"3 sequential LLM calls"| C["OpenRouter / OpenAI API"]
    C --> B
    B --> D[local-epub.js]
    D --> E["Download .epub"]
  end
```

The extension is **fully self-contained** — it calls the LLM provider directly from the browser using the user's own API key. There is no backend server required for the primary workflow. The backend exists only for developer tooling (observability dashboards, regression tests, method comparisons).

### What happens when a user clicks through the flow

```mermaid
sequenceDiagram
  participant U as User
  participant SP as Sidepanel UI
  participant LP as local-pipeline.js
  participant LLM as OpenRouter API
  participant EB as local-epub.js

  U->>SP: Paste transcript + click "Working Notes"
  SP->>LP: createWorkingNotesFromTranscript()
  LP->>LLM: POST /chat/completions (temp=0.2)
  LLM-->>LP: JSON { title, summary[], sections[] }
  LP-->>SP: WorkingNotes rendered in UI

  U->>SP: Click "Outline"
  SP->>LP: createBookletOutlineFromWorkingNotes()
  LP->>LLM: POST /chat/completions (temp=0.2)
  LLM-->>LP: JSON { title, sections[{id, heading, goal}] }
  LP-->>SP: BookletOutline rendered in UI

  U->>SP: Click "Draft"
  SP->>LP: createBookletDraftFromOutline()
  LP->>LLM: POST /chat/completions (temp=0.3)
  LLM-->>LP: JSON { title, sections[{id, heading, body}] }
  LP-->>SP: BookletDraft rendered in UI

  U->>SP: Click "Export EPUB"
  SP->>EB: createEpubFromBookletDraft()
  Note over EB: Build EPUB ZIP in memory<br/>(pure JS, no server)
  EB-->>SP: Blob (application/epub+zip)
  SP->>U: Download link appears
```

---

## Architecture Diagram

```mermaid
flowchart TD
  subgraph EXT["Chrome Extension"]
    direction TB
    POPUP["popup/ — launcher<br/>Opens sidepanel"]
    SP["sidepanel/ — main UI<br/>Form, status, output cards"]
    LP["local-pipeline.js<br/>LLM orchestration"]
    LE["local-epub.js<br/>In-browser EPUB builder"]

    POPUP --> SP
    SP --> LP
    SP --> LE
  end

  subgraph LLM_PROVIDER["External LLM"]
    OR["OpenRouter / OpenAI<br/>google/gemini-3-flash-preview"]
  end

  LP -->|"fetch POST /chat/completions<br/>user's own API key"| OR
  OR -->|"JSON response"| LP
  LE -->|"blob: URL"| SP

  subgraph BACKEND["Backend (dev tools only)"]
    direction TB
    EXPRESS["Express server<br/>port 8080"]
    JOBS_REPO["jobsRepo.ts<br/>Legacy full pipeline"]
    WN_SVC["workingNotesService.ts<br/>Staged pipeline (server-side)"]
    DRAFT_SVC["draftEpubService.ts<br/>EPUB renderer"]
    BLLM["bookletLlm.ts<br/>Legacy LLM calls"]
    PG[("PostgreSQL<br/>(optional)")]

    EXPRESS --> WN_SVC
    EXPRESS --> DRAFT_SVC
    EXPRESS --> JOBS_REPO
    JOBS_REPO --> BLLM
    EXPRESS -.->|"if DATABASE_URL set"| PG
  end

  subgraph DEVTOOLS["Developer Dashboards"]
    OBS1["observe-transcript-run.mjs<br/>Single-shot pipeline viewer"]
    OBS2["observe-staged-booklet-run.mjs<br/>Staged pipeline viewer"]
    COMPARE["compare-methods.mjs<br/>Method A/B/C comparison"]
  end

  DEVTOOLS -->|"HTTP calls"| EXPRESS

  style EXT fill:#e8f5e9,stroke:#2e7d32
  style LLM_PROVIDER fill:#e3f2fd,stroke:#1565c0
  style BACKEND fill:#fff3e0,stroke:#e65100
  style DEVTOOLS fill:#fce4ec,stroke:#c62828
```

### Architectural Boundaries

| Boundary | Left side | Right side | Contract |
|---|---|---|---|
| **Extension ↔ LLM** | `local-pipeline.js` | OpenRouter/OpenAI | OpenAI Chat Completions API (`POST /chat/completions`) with `response_format: json_object` |
| **Extension ↔ Storage** | `sidepanel.js` | `chrome.storage.local` | Two keys: `pte_settings_v2` (LLM config), `pte_workspace_v1` (full session state) |
| **Backend ↔ LLM** | `workingNotesService.ts` / `bookletLlm.ts` | OpenRouter | Same Chat Completions API, configured via env vars |
| **Backend ↔ Disk** | `draftEpubService.ts` / `jobsRepo.ts` | `.dev-artifacts/` | EPUB/PDF/MD files written per job ID |
| **Backend ↔ DB** | `usersRepo.ts` / `jobsRepo.ts` | PostgreSQL | Optional — only needed for job history and user records |
| **Dashboards ↔ Backend** | `observe-*.mjs` | Express routes | HTTP POST to `/v1/*` endpoints |

---

## Domain Model

The pipeline transforms data through four stages. Each stage has a typed schema:

```mermaid
flowchart LR
  T["Transcript<br/>(raw text, max 80k chars)"]
  WN["WorkingNotes<br/>{title, summary[], sections[]}"]
  BO["BookletOutline<br/>{title, sections[{id, heading, goal}]}"]
  BD["BookletDraft<br/>{title, sections[{id, heading, body}]}"]
  EP["EPUB file<br/>(application/epub+zip)"]

  T -->|"LLM call 1<br/>temp=0.2"| WN
  WN -->|"LLM call 2<br/>temp=0.2"| BO
  BO -->|"LLM call 3<br/>temp=0.3"| BD
  BD -->|"deterministic<br/>ZIP build"| EP
```

### Entity Schemas

```
TranscriptInput
├── title: string               # auto-generated if blank
├── language: string             # hardcoded "zh-CN"
└── transcript_text: string      # raw paste, max 80,000 chars

WorkingNotes
├── title: string
├── summary: string[]            # 3-7 bullet points
└── sections[]                   # 3-8 sections
    ├── heading: string
    ├── bullets: string[]        # key points
    └── excerpts: string[]       # verbatim quotes from transcript

BookletOutline
├── title: string
└── sections[]                   # 3-8 sections
    ├── id: string               # e.g. "sec_01"
    ├── heading: string
    └── goal?: string            # what this section accomplishes

BookletDraft
├── title: string
└── sections[]                   # 3-8 sections
    ├── id: string               # matches outline section ID
    ├── heading: string
    └── body: string             # prose, max 4,000 chars/section

EPUB Artifact
├── download_url: string         # blob: URL (extension) or /downloads/ URL (backend)
├── checksum_sha256: string
└── expires_at?: string          # 1 hour for backend artifacts
```

---

## Data Flow: Extension Pipeline (Primary)

```mermaid
flowchart TD
  subgraph INPUT["Input"]
    T[Transcript text pasted by user]
    S[Settings from chrome.storage.local<br/>API key, model, base URL]
  end

  subgraph STEP1["Step 1: Working Notes"]
    P1[Build system+user prompt in Chinese]
    L1[POST /chat/completions → OpenRouter]
    J1[extractFirstJsonObject from response]
    V1[readWorkingNotesFromUnknown — validate + cap lengths]
  end

  subgraph STEP2["Step 2: Outline"]
    P2[Inject WorkingNotes JSON into prompt]
    L2[POST /chat/completions → OpenRouter]
    J2[extractFirstJsonObject]
    V2[readBookletOutlineFromUnknown — validate]
  end

  subgraph STEP3["Step 3: Draft"]
    P3[Inject WorkingNotes + Outline into prompt]
    L3[POST /chat/completions → OpenRouter]
    J3[extractFirstJsonObject]
    V3[readBookletDraftFromUnknown — validate]
  end

  subgraph STEP4["Step 4: EPUB"]
    R1[Build XHTML chapter files]
    R2[Build OPF manifest + NCX + nav]
    R3[Build ZIP with stored mimetype]
    R4[SHA-256 checksum]
    R5[Blob URL for download]
  end

  T --> P1
  S --> L1
  P1 --> L1 --> J1 --> V1
  V1 --> P2 --> L2 --> J2 --> V2
  V1 --> P3
  V2 --> P3 --> L3 --> J3 --> V3
  V3 --> R1 --> R2 --> R3 --> R4 --> R5
```

### State Machine (UI)

Each step transitions the UI through states:

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> generating_notes: "Working Notes" clicked
  generating_notes --> notes_ready: LLM success
  generating_notes --> error: LLM failure / timeout

  notes_ready --> generating_outline: "Outline" clicked
  generating_outline --> outline_ready: LLM success
  generating_outline --> error: LLM failure

  outline_ready --> generating_draft: "Draft" clicked
  generating_draft --> draft_ready: LLM success
  generating_draft --> error: LLM failure

  draft_ready --> exporting_epub: "Export EPUB" clicked
  exporting_epub --> epub_ready: ZIP built successfully
  exporting_epub --> error: Build failure

  error --> idle: User retries
  notes_ready --> generating_notes: Re-run notes (clears downstream)
```

The workspace is saved to `chrome.storage.local` after each successful step. Closing and reopening the sidepanel restores the last state.

---

## Subsystem Breakdown

### 1. Chrome Extension (`extension/`)

**Owns:** User interface, LLM orchestration, EPUB generation, session persistence.

**Depends on:** OpenRouter or OpenAI API (user's own key). No backend dependency.

**Files:**

| File | Role |
|---|---|
| `manifest.json` | Chrome MV3 manifest. Permissions: `sidePanel`, `storage`. Host permissions: `openrouter.ai`, `api.openai.com`. No background worker, no content scripts. |
| `popup/popup.js` | One button — opens the sidepanel via `chrome.sidePanel.open()` |
| `sidepanel/sidepanel.js` | UI controller. Manages form state, button flow guards, workspace save/restore, stage trace rendering. Calls `local-pipeline.js` and `local-epub.js`. |
| `sidepanel/local-pipeline.js` | Three exported functions for the staged LLM pipeline. Validates host allowlist, builds prompts, calls `/chat/completions`, parses JSON, validates schemas. |
| `sidepanel/local-epub.js` | Builds a valid EPUB 3 ZIP entirely in memory using a hand-written ZIP writer (`buildStoredZip`). No compression (stored method). Computes SHA-256 via `crypto.subtle`. |
| `sidepanel/sidepanel.html` | Eight card sections: hero, composer, status, outputs, working-notes, booklet-outline, booklet-draft, events (debug), settings |

**Interfaces exposed:** None (it's the leaf consumer).

**Key invariants:**
- LLM host must be in `SUPPORTED_LLM_HOSTS`: `openrouter.ai` or `api.openai.com`
- Transcript input capped at 80,000 chars
- LLM timeout: 90 seconds per call
- Generating new working notes clears cached outline and draft (downstream invalidation)
- EPUB generation is deterministic — same draft always produces same EPUB

### 2. Backend (`backend/`)

**Owns:** Server-side pipeline (both legacy and staged), artifact persistence to disk, optional DB-backed job history.

**Depends on:** OpenRouter API (via `OPENROUTER_API_KEY` env var), optionally PostgreSQL.

**Interfaces exposed:**

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/working-notes/from-transcript` | Transcript → WorkingNotes (LLM) |
| `POST` | `/v1/booklet-outline/from-working-notes` | WorkingNotes → BookletOutline (LLM) |
| `POST` | `/v1/booklet-draft/from-booklet-outline` | WorkingNotes + BookletOutline → BookletDraft (LLM) |
| `POST` | `/v1/epub/from-booklet-draft` | BookletDraft → EPUB file (deterministic) |
| `POST` | `/v1/epub/from-transcript` | Legacy single-call transcript → EPUB (full pipeline) |
| `GET` | `/healthz` | Health check |
| `GET` | `/downloads/:job_id/:file_name` | Artifact download (requires `?token=dev`) |

All `POST /v1/*` routes require `Authorization: Bearer dev-token` or `Bearer dev:<email>`.

All routes are **synchronous** — no background queue. The pipeline runs inline in the HTTP request.

**Key services:**

| Service | File | What it does |
|---|---|---|
| Working notes pipeline | `services/workingNotesService.ts` | Three functions for the staged LLM pipeline (working notes, outline, draft) |
| EPUB renderer (staged) | `services/draftEpubService.ts` | Builds EPUB from BookletDraft. No LLM. Writes to `.dev-artifacts/`. |
| Legacy pipeline | `services/epubInlineService.ts` | Entry point for single-call transcript→EPUB |
| Legacy LLM | `services/bookletLlm.ts` | Full-book and per-chapter LLM generation with prompt profiles |
| Full pipeline engine | `repositories/jobsRepo.ts` | ~4000 lines. Transcript parsing, profile classification, semantic segmentation, chapter planning, base model building, LLM enrichment, quality gates, EPUB/PDF/MD rendering |

**Data handoffs:**
- `epubInlineService` → `jobsRepo.createArtifactsEphemeral()` → full pipeline → artifacts on disk
- `workingNotesService` → LLM → validated JSON back to caller
- `draftEpubService` → XHTML rendering → `zip` CLI → `.dev-artifacts/{jobId}/{jobId}.epub`

### 3. Developer Dashboards (`scripts/`)

**Owns:** Observability, quality comparison, regression testing.

**Depends on:** Running backend instance.

| Script | What it does |
|---|---|
| `observe-transcript-run.mjs` | Web dashboard (port 4173). Pick a sample transcript, run the legacy single-call pipeline, view stage timeline + artifacts. |
| `observe-staged-booklet-run.mjs` | Web dashboard (port 4174). Runs the 4-step staged pipeline. Shows working notes, outline, draft, and EPUB as structured cards. |
| `compare-methods.mjs` | Runs Methods A/B/C against same transcript, writes comparison HTML+JSON reports to `tasks/method-compare/`. |
| `run-staged-booklet-flow.mjs` | CLI runner for the staged pipeline. Saves EPUB + stage data to `.dev-artifacts/staged-runs/`. |
| `regression-transcript-flow.sh` | Smoke test: posts transcript, verifies stages + EPUB download. |
| `dev-up.sh` / `dev-down.sh` | Start/stop local dev stack (Postgres + backend). |
| `run-server.sh` | One-command backend launch (foreground). |
| `dev-smoke.sh` | Minimal smoke test (post transcript, check success). |

---

## Legacy Pipeline (Backend Only)

The backend contains an older, more elaborate pipeline in `jobsRepo.ts` used by `POST /v1/epub/from-transcript`. This is **not used by the Chrome extension** but powers the developer dashboards.

```mermaid
flowchart TD
  A[Raw transcript text] --> B[parseTranscriptEntries<br/>speaker/timestamp/text]
  B --> C[classifyTranscriptSourceProfile<br/>single / interview / discussion]
  C --> D[planSemanticSegments<br/>topic shifts, time gaps, question turns]
  D --> E[buildChapterPlan<br/>5-7 chapters with keyword-derived titles]
  E --> F[Build deterministic base model<br/>points, quotes, explanations, actions]

  F --> G{Transcript < 80k chars?}
  G -->|Yes| H[generateBookletDraftWithLlm<br/>Full-book LLM call]
  G -->|No| I[generateChapterPatchWithLlm<br/>Per-chapter LLM calls]
  H -->|Fails| I
  H -->|Succeeds| J[mergeBookletWithLlmDraft]
  I --> K[mergeBookletWithChapterPatches]

  J --> L[Quality gate<br/>30+ checks]
  K --> L
  L --> M[Render EPUB + PDF + MD]
  M --> N[Write to .dev-artifacts/]
```

This pipeline produces a richer output structure (`BookletModel`) with TL;DR, glossary, action lists, appendix themes — features the staged pipeline does not yet include.

---

## Database Schema (Optional)

PostgreSQL is only needed when running the backend's job history features. The extension does not use a database.

```mermaid
erDiagram
  users ||--o{ jobs : creates
  users ||--o{ user_daily_usage : tracks
  jobs ||--|| compliance_records : requires
  jobs ||--|| job_inputs : has
  jobs ||--o{ artifacts : produces
  jobs ||--o{ job_events : logs

  users {
    text id PK "usr_<hex>"
    text email UK
    text role "user | admin"
    text status "active | suspended"
  }

  jobs {
    text id PK "job_<hex>"
    text user_id FK
    text source_type "transcript | audio | rss | link"
    text status "queued | processing | succeeded | failed | canceled"
    integer progress "0-100"
    text stage
    jsonb output_formats "['epub','pdf','md']"
    text error_code
    text error_message
  }

  compliance_records {
    text id PK "cmp_<hex>"
    text user_id FK
    boolean personal_use_only
    boolean no_commercial
  }

  artifacts {
    text id PK "art_<hex>"
    text job_id FK
    text type "epub | pdf | md"
    text storage_uri
    text checksum_sha256
    timestamp expires_at
  }

  job_inputs {
    text id PK "inp_<hex>"
    text job_id FK
    jsonb metadata
  }

  job_events {
    text id PK
    text job_id FK
    text level "info | warn | error"
    jsonb details
  }
```

---

## LLM Integration

| Parameter | Value |
|---|---|
| Provider | OpenRouter (`https://openrouter.ai/api/v1`) or OpenAI |
| Model | `google/gemini-3-flash-preview` |
| Protocol | OpenAI Chat Completions API |
| Response format | `{ type: "json_object" }` |
| Timeout | 90 seconds per call |
| Input cap | 80,000 characters |
| Temperature | 0.2 (notes, outline), 0.3 (draft) |

**Authentication:** The extension stores the user's API key in `chrome.storage.local`. The backend reads from `OPENROUTER_API_KEY` or `OPENAI_API_KEY` env vars.

**JSON extraction:** LLM responses are parsed with a hand-written brace-matching parser (`extractFirstJsonObject`) that handles markdown fences and nested objects. Parsed output is then run through typed validators (`readWorkingNotesFromUnknown`, etc.) that enforce field types and length caps. No raw LLM output reaches downstream code.

**Failure policy:** All LLM failures throw explicit errors with codes (`LLM_UNAVAILABLE`, `LLM_HTTP_ERROR`, `WORKING_NOTES_PARSE_FAILED`). No silent fallbacks in the staged pipeline.

---

## Observability: Inspector Stages

Every pipeline step records an `InspectorStageRecord` trace:

```
{ stage: "transcript" | "normalization" | "llm_request" | "llm_response" | "epub",
  ts: ISO timestamp,
  input?: { preview, charCount },
  config?: { model, temperature },
  output?: { preview, charCount } }
```

These traces are:
- Returned inline in API responses (`stages[]` array)
- Saved in `chrome.storage.local` as part of the workspace
- Rendered in the sidepanel's collapsible "events" debug section
- Displayed in the observability dashboards as timeline cards

---

## Quick Start

### Using the Chrome Extension (primary workflow)

1. Load `extension/` as an unpacked Chrome extension
2. Click the extension icon → opens the sidepanel
3. Open Settings (bottom of sidepanel), enter your OpenRouter API key
4. Paste a Chinese podcast transcript
5. Click through: Working Notes → Outline → Draft → Export EPUB

No backend or database needed.

### Running the Backend (for dev tools)

```bash
cd backend
cp .env.example .env          # add OPENROUTER_API_KEY
npm install && npm run dev
```

Or use the one-command launcher:

```bash
./run_e2e_debug.sh            # starts Postgres + backend + dashboard
```

### Running the Observability Dashboards

```bash
# Legacy single-call pipeline viewer (port 4173)
node scripts/observe-transcript-run.mjs

# Staged 4-step pipeline viewer (port 4174)
node scripts/observe-staged-booklet-run.mjs
```

Transcript samples live in `tasks/transcript-samples/` and `data/transcripts/`.

---

## Repo Map

```text
.
├── extension/                    # Chrome extension (the product)
│   ├── manifest.json             # MV3 manifest, no background worker
│   ├── popup/                    # Launcher (opens sidepanel)
│   └── sidepanel/
│       ├── sidepanel.html/js/css # Main UI
│       ├── local-pipeline.js     # LLM orchestration (3 staged calls)
│       └── local-epub.js         # In-browser EPUB builder
├── backend/                      # Dev tools backend (not needed for extension)
│   └── src/
│       ├── app.ts                # Express wiring
│       ├── config.ts             # Env loading, LLM defaults
│       ├── routes/v1.ts          # 5 API endpoints
│       ├── services/
│       │   ├── workingNotesService.ts   # Staged pipeline (server-side)
│       │   ├── draftEpubService.ts      # EPUB from BookletDraft
│       │   ├── epubInlineService.ts     # Legacy single-call entry
│       │   └── bookletLlm.ts           # Legacy LLM generation
│       ├── repositories/
│       │   ├── jobsRepo.ts       # Full legacy pipeline (~4000 lines)
│       │   └── usersRepo.ts      # User upsert
│       ├── middleware/auth.ts    # Dev-token auth
│       └── lib/                  # Errors, async handler, ID generator
├── scripts/                      # Dev dashboards + test runners
│   ├── observe-transcript-run.mjs
│   ├── observe-staged-booklet-run.mjs
│   ├── compare-methods.mjs
│   ├── run-staged-booklet-flow.mjs
│   ├── dev-up.sh / dev-down.sh
│   └── regression-transcript-flow.sh
├── docs/                         # Architecture + decision docs
├── data/transcripts/             # Large real transcript samples
├── tasks/transcript-samples/     # Small fixture transcripts
├── assets/
│   ├── fonts/                    # CJK font for PDF rendering
│   └── templates/                # Baseline EPUB template
└── run_e2e_debug.sh              # One-command dev environment
```

---

## Key Design Decisions

1. **Extension is serverless.** The Chrome extension calls the LLM directly — no backend in the loop. This eliminates deployment, hosting, and networking complexity for a single-user tool.

2. **Staged pipeline over single-call.** Breaking transcript→EPUB into four explicit steps (notes → outline → draft → epub) lets the user inspect and retry each stage independently. The older single-call pipeline still exists in the backend for comparison testing.

3. **EPUB built in-browser.** `local-epub.js` constructs a valid EPUB 3 ZIP using a hand-written ZIP writer. No server round-trip, no native dependencies. The file is served as a `blob:` URL.

4. **User provides their own API key.** The key is stored only in `chrome.storage.local`. It never touches a server.

5. **Chinese-first prompts.** All system prompts are written in Chinese to match the target content and audience.

6. **Deterministic JSON extraction.** LLM output is parsed with a brace-matching parser, not `JSON.parse` on the raw response. This handles models that wrap JSON in markdown fences.

7. **No silent fallbacks.** If an LLM call fails, the error surfaces visibly. The user can retry or adjust their input.

8. **Workspace persistence.** The full session state (transcript, notes, outline, draft, stages) is saved to `chrome.storage.local` on every step. Closing and reopening the sidepanel restores everything.

9. **Backend is a dev tool.** The Express backend + Postgres exist for quality iteration (observability dashboards, method comparisons, regression tests), not for production use.

10. **`response_format: json_object`** is set on every LLM call to force structured output, reducing parse failures.
