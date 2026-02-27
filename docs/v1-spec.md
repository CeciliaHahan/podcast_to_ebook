# Podcasts_to_ebooks V1 Spec

Related docs:

- `docs/openapi.v1.yaml` (API contract)
- `docs/decision-checkpoints.md` (when founder should decide)
- `docs/founder-decisions-v1.md` (blocking decisions and default recommendations)
- `docs/epub-template-baseline.md` (book-style initial template baseline)
- `docs/booklet-template-contract.v1.md` (canonical booklet structure contract for EPUB/PDF/Markdown)
- `docs/booklet-template-content.v1.md` (copy-ready content scaffold)
- `docs/transcript-pipeline-v2.md` (semantic-first transcript understanding and generation blueprint)
- `docs/db-schema.v1.sql` (PostgreSQL schema draft)
- `docs/job-state-machine.md` (backend job lifecycle contract)

## 1. Scope (Confirmed)

- Product form: Chrome Extension with `Side Panel` as the main workspace.
- Primary users: listeners / knowledge organizers, focused on dense, information-heavy podcasts.
- V1 input priority: `transcript > audio upload > RSS > platform link`.
- Architecture: `Cloud + Standard Backend` (async jobs).
- Compliance baseline: minimal permissions, copyright statement, source traceability.
- V1 outputs: `EPUB + PDF + Markdown` (EPUB as core, PDF/MD for compatibility and editing).
- Default template: `templateA-v0-book` based on `assets/templates/ep36_templateA_v0.epub`.

## 2. Why EPUB + PDF + Markdown

- EPUB is ideal for reflowable ebook reading and annotation in ebook apps.
- EPUB openability is inconsistent for some mainstream desktop/browser workflows.
- PDF is universal and immediately viewable.
- Markdown supports user editing and downstream reuse.

Conclusion: V1 should generate all three formats in one run, with EPUB as the "primary artifact".

## 3. Extension UX and Upload Entry

### 3.1 Workspace shape

- Use Side Panel as the default full workflow entry.
- Keep popup minimal: only "Open Workspace", "Recent Jobs", and status badge.
- For long content editing/preview, provide an "Open in Full Tab" action from Side Panel.

This avoids trying to cram complex interactions into popup while preserving extension convenience.

### 3.2 Core user flow

1. User opens Side Panel.
2. User chooses input mode:
   - Paste transcript
   - Upload audio
   - Paste RSS feed URL
   - Paste platform episode URL
3. User fills metadata (title/author/language/target style).
4. User accepts compliance declaration and starts generation.
5. Job enters async queue; UI shows progress and logs.
6. User downloads EPUB/PDF/MD and can inspect source trace info.

### 3.3 RSS in listener scenario

Common ways listeners can get RSS:

- Podcast app "share/copy feed URL" entry.
- Show/creator public homepage with RSS link.
- Public podcast directories exposing feed URLs.
- If no RSS available, fallback to transcript/audio/link modes.

## 4. Architecture (Cloud + Standard Backend)

## 4.1 Why this model first

- Audio/transcription/summarization/format conversion are compute-heavy and variable-latency.
- Async jobs + queue improve reliability and user experience.
- Standard backend supports auth, job history, retries, billing limits, and audit logs.

### 4.2 Logical components

- Extension frontend:
  - Side Panel UI
  - upload + input validation
  - job polling + artifact download
- API service:
  - request validation
  - auth/rate limit
  - job lifecycle orchestration
- Worker pipeline:
  - transcript normalization
  - audio transcription (if needed)
  - RSS parsing + episode extraction
  - structure generation and chaptering
  - export (EPUB/PDF/MD)
- Storage:
  - object storage for source and artifacts
  - relational DB for users/jobs/status/events
- Observability:
  - structured logs
  - processing metrics
  - failure classification

## 5. API Contract (V1)

Base path: `/v1`

Auth: `Authorization: Bearer <token>`

Common status enum:

- `queued`
- `processing`
- `succeeded`
- `failed`
- `canceled`

Input/usage policy (approved):

- Transcript max length: `120,000` characters per job.
- Audio max size: `300 MB`.
- Audio max duration: `180` minutes.
- Max active jobs per user: `2`.
- Beta daily job quota: `10`.

## 5.1 Create job from transcript

### `POST /jobs/from-transcript`

Request:

```json
{
  "title": "Episode title",
  "language": "zh-CN",
  "transcript_text": "full transcript...",
  "template_id": "templateA-v0-book",
  "output_formats": ["epub", "pdf", "md"],
  "metadata": {
    "podcast_name": "Example Show",
    "speaker": "Host A",
    "episode_url": "https://example.com/ep/1"
  },
  "compliance_declaration": {
    "for_personal_or_authorized_use_only": true,
    "no_commercial_use": true
  }
}
```

Response (`202`):

```json
{
  "job_id": "job_123",
  "status": "queued",
  "created_at": "2026-02-26T10:00:00Z"
}
```

## 5.2 Parse RSS

### `POST /rss/parse`

Request:

```json
{
  "rss_url": "https://example.com/feed.xml"
}
```

Response (`200`):

```json
{
  "podcast": {
    "title": "Example Podcast",
    "author": "Example Author",
    "language": "zh-cn"
  },
  "episodes": [
    {
      "episode_id": "ep_001",
      "title": "Episode 1",
      "published_at": "2026-01-01T00:00:00Z",
      "audio_url": "https://cdn.example.com/ep1.mp3",
      "link": "https://example.com/episodes/1"
    }
  ]
}
```

## 5.3 Create job from RSS episode

### `POST /jobs/from-rss`

Request:

```json
{
  "rss_url": "https://example.com/feed.xml",
  "episode_id": "ep_001",
  "template_id": "templateA-v0-book",
  "output_formats": ["epub", "pdf", "md"],
  "compliance_declaration": {
    "for_personal_or_authorized_use_only": true,
    "no_commercial_use": true
  }
}
```

Response (`202`) same as other job creation endpoints.

## 5.4 Create job from audio upload

### `POST /jobs/from-audio`

`multipart/form-data`

Fields:

- `file`: audio file (`mp3/m4a/wav`, size limit in policy)
- `title`
- `language`
- `template_id`
- `output_formats` (JSON string or repeated field)
- `compliance_declaration` (JSON)

Response (`202`) same as other job creation endpoints.

## 5.5 Create job from platform link

### `POST /jobs/from-link`

Request:

```json
{
  "episode_url": "https://example-platform.com/episode/123",
  "template_id": "templateA-v0-book",
  "output_formats": ["epub", "pdf", "md"],
  "compliance_declaration": {
    "for_personal_or_authorized_use_only": true,
    "no_commercial_use": true
  }
}
```

Response (`202`) same as other job creation endpoints.

## 5.6 Query job status

### `GET /jobs/{job_id}`

Response (`200`):

```json
{
  "job_id": "job_123",
  "status": "processing",
  "progress": 62,
  "stage": "chapter_structuring",
  "created_at": "2026-02-26T10:00:00Z",
  "updated_at": "2026-02-26T10:02:10Z",
  "error": null
}
```

Failure example:

```json
{
  "job_id": "job_123",
  "status": "failed",
  "progress": 100,
  "stage": "transcription",
  "error": {
    "code": "AUDIO_UNSUPPORTED_CODEC",
    "message": "Unsupported audio codec."
  }
}
```

## 5.7 List and fetch artifacts

### `GET /jobs/{job_id}/artifacts`

Response (`200`):

```json
{
  "job_id": "job_123",
  "status": "succeeded",
  "artifacts": [
    {
      "type": "epub",
      "file_name": "episode-1.epub",
      "size_bytes": 842133,
      "download_url": "https://signed-url.example.com/a.epub",
      "expires_at": "2026-02-26T11:00:00Z"
    },
    {
      "type": "pdf",
      "file_name": "episode-1.pdf",
      "size_bytes": 1342211,
      "download_url": "https://signed-url.example.com/a.pdf",
      "expires_at": "2026-02-26T11:00:00Z"
    },
    {
      "type": "md",
      "file_name": "episode-1.md",
      "size_bytes": 42110,
      "download_url": "https://signed-url.example.com/a.md",
      "expires_at": "2026-02-26T11:00:00Z"
    }
  ],
  "traceability": {
    "source_type": "rss",
    "source_ref": "https://example.com/feed.xml#ep_001",
    "generated_at": "2026-02-26T10:05:00Z"
  }
}
```

## 5.8 Job events (optional but recommended)

### `GET /jobs/{job_id}/events`

Response (`200`):

```json
{
  "job_id": "job_123",
  "events": [
    {"ts": "2026-02-26T10:00:00Z", "stage": "queued", "message": "Job accepted"},
    {"ts": "2026-02-26T10:00:20Z", "stage": "transcription", "message": "Started"},
    {"ts": "2026-02-26T10:03:10Z", "stage": "export", "message": "Generating EPUB/PDF/MD"}
  ]
}
```

## 5.9 Error model

Standard envelope:

```json
{
  "error": {
    "code": "INVALID_INPUT",
    "message": "language is required",
    "request_id": "req_abc"
  }
}
```

Suggested codes:

- `INVALID_INPUT`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `RATE_LIMITED`
- `SOURCE_FETCH_FAILED`
- `AUDIO_UNSUPPORTED_CODEC`
- `TRANSCRIPTION_FAILED`
- `GENERATION_FAILED`
- `ARTIFACT_EXPIRED`
- `AUDIO_TOO_LARGE`
- `AUDIO_TOO_LONG`
- `ACTIVE_JOB_LIMIT_EXCEEDED`
- `DAILY_QUOTA_EXCEEDED`

## 6. Data and Compliance Baseline

- Keep source references in every job for traceability.
- Store compliance declaration with immutable timestamp.
- Show copyright disclaimer in the generation step and download step.
- Follow least-privilege permission in extension:
  - avoid broad host permissions by default
  - request optional permissions only when needed

## 7. Risk-Ordered TODO (with rationale)

## Phase 0: Product contract freeze

- Finalize V1 scope and non-goals.
- Freeze input priority and output set.
- Freeze compliance copy and accepted-use boundaries.

Why first: prevents rework across backend/UI/pipeline.

## Phase 1: Backend skeleton + async job framework

- Set up auth, job table, queue, worker heartbeat, retry policy.
- Implement `POST /jobs/from-transcript` + `GET /jobs/{job_id}` baseline.

Why second: all input modes converge into the same job system.

## Phase 2: Transcript-first end-to-end (golden path)

- Build transcript normalization and chapter structuring.
- Generate EPUB/PDF/MD artifacts.
- Implement `GET /jobs/{job_id}/artifacts`.

Why third: fastest value delivery with lowest ingestion complexity.

## Phase 3: Audio and RSS ingestion

- Add `POST /jobs/from-audio`.
- Add `POST /rss/parse` + `POST /jobs/from-rss`.

Why fourth: these are high-value but operationally riskier (network/audio variance).

## Phase 4: Platform link ingestion

- Add `POST /jobs/from-link` with strict source policy and parser fallback logic.

Why fifth: source heterogeneity and legal/technical instability are highest here.

## Phase 5: Extension workspace UX

- Build Side Panel flow, progress polling, artifacts panel.
- Add popup shortcut and optional full-tab editor/preview.

Why here: build on stable backend contracts to avoid UI churn.

## Phase 6: Hardening and beta

- Failure recovery, idempotency keys, quota/rate limiting.
- Telemetry dashboard and quality/error SLA.
- Closed beta with target users and iteration loop.

Why last: optimize only after core path works in real usage.

## 8. Immediate Next Build Tasks (Next 7-10 days)

1. Define DB schema: users, jobs, artifacts, job_events, compliance_records.
2. Ship transcript path API + worker + artifact export end-to-end.
3. Build minimal Side Panel:
   - transcript input
   - job status polling
   - artifact download list
4. Add source traceability in artifact metadata and UI.
5. Add RSS parse endpoint and one-click episode import.
