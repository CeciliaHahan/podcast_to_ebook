# TODO

## Current Task: Stabilize 3-Method Compare Runner (C Retry + Degraded Label) (2026-03-02)

### Plan

- [x] Add retry logic to compare runner API calls to reduce transient fetch failures.
- [x] Add method-level retry policy (`C` retries automatically) without aborting whole run.
- [x] Mark degraded outputs in per-method page and index page (recovered retry / LLM fallback / patch path).
- [x] Keep run output complete even when one method fails (write method page/json with error details).
- [x] Run one validation execution and record result path.

### Review

- Updated `scripts/compare-methods.mjs` with:
  - API-level retry wrapper for transient network/server errors.
  - method-level retry policy (`C`: up to 3 attempts; `A/B`: single attempt).
  - non-aborting behavior so one method failure still emits full HTML/JSON results.
  - degraded tagging and reasons in method pages, index page, and `run-summary.json`.
  - explicit error block rendering when a method cannot complete.
- Validation run completed:
  - `/Users/cecilia/Desktop/workspace/Podcasts_to_ebooks/tasks/method-compare/2026-03-02T09-00-48-427Z/index.html`
  - `/Users/cecilia/Desktop/workspace/Podcasts_to_ebooks/tasks/method-compare/2026-03-02T09-00-48-427Z/diff-highlight.html`

## Current Task: Release-Ready Quality Pipeline Alignment (2026-03-02)

### Plan

- [x] Finalize single-flow user path:
  - 用户仅提交 transcript（扩展端不再要求模板配置）。
  - Job 内部自动走模板策略（保留 `templateA-v0-book` 骨架，先做类型感知的参数化输出优化）。
- [x] Define output format strategy:
  - 保留 EPUB、PDF、Markdown 三种格式能力；
  - 先用 EPUB 做质量验收基线，逐步放开 PDF/Markdown 的自动化回归。
- [x] Improve output quality before visual template refactor:
  - 先优化 system prompt / 数据清洗 / 生成参数；
- [x] Add internal source classification (invisible to end-user):
  - 自动识别 `single / interview / discussion`；
  - 只用于生成参数，不在 ebook 文本中展示分类标签。
- [x] Add quality checkpoints:
  - 章节完整性（`chap_01..14`）；
  - 元数据一致性（title/language/date/source 同步）；
  - 无占位符、可读性基本覆盖率（TL;DR、术语、行动、引用）；
- [ ] Improve UI polish after pipeline stability:
  - 保持“一步生成”体验；
  - 视觉和交互只在可读性/反馈层面优化，不改变流程。
- [ ] Reconnect remaining ingestion flows:
  - 逐步接入 audio upload、平台链接、RSS 链路；
  - 按同一 pipeline 返回统一 artifact。

### Review

 - 已完成用户侧无模板输入的一步提交路径：`extension/sidepanel/sidepanel.js` 与 `sidepanel.html` 现在不再携带/展示模板 ID。
 - 后端 `buildBookletModel` 已开始使用 transcript 源类型 profile（single/interview/discussion）选择 `mergeCaps`，并在最终 normalization 阶段记录 profile 与质量检查结果。
 - 已把 `jobsService.normalizeOutputFormats` 的排序策略固定为 `epub -> pdf -> md`，用于保障当前质量验收优先走 EPUB。
 - 已补齐质量检查闭环：Method A/Method B/C 均输出 `quality_issue_count` 与 `quality_issues`，并增加章节完整性、章节索引/sectionId、元数据一致性、TLDR/术语/行动/引用覆盖等项的检测。
 - 新增 `quality_gate`（阻断项+告警项）规则：当前不阻断作业，但在 inspector 里显式给出 `quality_passed`/`quality_gate`/`quality_blocking_issues`，便于后续接自动重试或阻断策略。

## Current Task: Build 3-Method Ebook Quality Test Harness (2026-03-01)

### Plan

- [x] Add backend generation mode switch (`A` / `B` / `C`) via transcript metadata.
- [x] Implement method behavior:
- [x] `A`: parser/rule-first deterministic booklet (no LLM merge),
- [x] `B`: current semantic plan + LLM merge (baseline),
- [x] `C`: strict-structure LLM prompt profile + merge.
- [x] Expose selected method in inspector stage config for transparency.
- [x] Add a script to run all three methods for one transcript input and collect:
- [x] create-job request payload,
- [x] create-job response payload,
- [x] status/artifacts/inspector payloads,
- [x] generated ebook content (Markdown artifact).
- [x] Generate one webpage per method plus an index page for side-by-side review.
- [x] Run a local smoke run for the harness with sample transcript and report output paths.

### Review

- Backend
- Added `generation_method` routing (`A`/`B`/`C`) from transcript metadata into pipeline execution.
- `A` now skips LLM merge and returns parser/rule-first deterministic booklet.
- `B` keeps current semantic-plan + LLM merge behavior (baseline).
- `C` uses stricter Template-A prompt profile before merge.
- Inspector now includes method info in normalization/transcript configs.
- Files: `backend/src/services/jobsService.ts`, `backend/src/repositories/jobsRepo.ts`, `backend/src/services/bookletLlm.ts`.
- Harness
- Added executable script: `scripts/compare-methods.mjs`.
- For one transcript input, script runs A/B/C jobs and exports:
- one page per method (`method-A.html`, `method-B.html`, `method-C.html`),
- full payload JSON per method,
- `index.html` for navigation,
- includes create request/response, inspector payload, LLM request/response stages, and markdown ebook content.
- Validation
- `cd backend && npm run typecheck` passed.
- Sample run succeeded for all three methods:
- Output dir: `tasks/method-compare/2026-03-02T07-05-42-423Z/index.html`.

## Current Task: Simplify Extension To EPUB-Only Flow (2026-03-01)

### Plan

- [x] Rewrite Side Panel UI to a single workspace view (remove payload tab surface).
- [x] Keep transcript workflow but force output format to EPUB only.
- [x] Update form/button copy to EPUB-only language.
- [x] Keep inspector visibility (`/v1/jobs/:job_id/inspector`) and artifacts panel.
- [x] Remove extension-side payload log complexity from `sidepanel.js`.
- [x] Update extension docs to reflect EPUB-only mode.
- [x] Verify extension script syntax and backend health/startup.

### Review

- Rewrote `extension/sidepanel/sidepanel.html` into a single-page EPUB-focused layout (removed payload tab section and controls).
- Rewrote `extension/sidepanel/sidepanel.js` to a leaner flow:
- kept connection/settings, job submit, status poll, artifacts, inspector;
- removed payload logging/tab state code;
- forced request payload to `output_formats: [\"epub\"]`;
- updated submit copy to `Generate EPUB`.
- Simplified `extension/sidepanel/sidepanel.css` by removing unused payload/tab styles and adding EPUB format hint styling.
- Updated `extension/README.md` to document EPUB-only mode for now.
- Validation:
- `node --check extension/sidepanel/sidepanel.js` passed.
- backend health/startup handled at end of task (see session startup in assistant execution).

## Current Task: Improve EPUB Source Quality (2026-03-01)

### Plan

- [x] Add transcript parser cleanup for markdown headings/list markers before parsing entries.
- [x] Skip heading-only transcript lines so they don’t become quote/point content.
- [x] Remove markdown emphasis markers from normalized sentence text (`##`, `####`, trailing `**`, list bullets).
- [x] Sanitize auto-generated title in sidepanel so markdown-like tokens don’t leak into EPUB `<dc:title>`.
- [x] Run targeted checks (typecheck + transcript sample flow with heading-heavy input) and report results.

### Review

- `backend/src/repositories/jobsRepo.ts`
  - Added markdown/heading/list cleanup in parsing path: `stripTranscriptLineDecorators`, `isMarkdownStructuralLine`, updated `sanitizeSentence`, updated `parseTranscriptEntries` filtering and marker patterns.
  - Fixed fallback timestamp rendering so `--:--` is preserved with `cleanBookletTimestamp`.
- `backend/src/services/jobsService.ts`
  - Added title normalization (`sanitizeArtifactTitle`) before storing and using titles in job records/render.
- `extension/sidepanel/sidepanel.js`
  - Sanitized auto-generated title with markdown/title-marker cleanup before job submission.
- Validation
  - `cd backend && npm run typecheck` passed.
  - Created a heading-heavy sample transcript job and verified generated EPUB metadata/title and Markdown quotes no longer carry raw markdown heading text.

## Current Task: Simplify Backend Pipeline + Add Stage Inspector (2026-03-01)

### Plan

- [x] Remove async queue + synthetic stage/event progression (`jobQueue` + state-machine driven event writes).
- [x] Keep one minimal job record flow, but run generation inline from create endpoint so status is immediate and simple.
- [x] Add an inspector trace model that records end-to-end stage I/O:
- [x] `transcript` input snapshot (size + preview),
- [x] `llm_request` payload (model/config + prompt preview),
- [x] `llm_response` raw/parsed draft preview,
- [x] `normalization` input/output summary,
- [x] `pdf_render` input + render configuration used.
- [x] Persist inspector trace in `job_inputs.metadata` for each run.
- [x] Add backend endpoint `GET /v1/jobs/:job_id/inspector` that returns ordered stage details for UI.
- [x] Update extension inspector view to show the new stage-by-stage trace instead of generic timeline events.
- [x] Keep existing artifact download flow unchanged.
- [x] Run backend typecheck + one smoke run, then record results.

### Review

- Removed async queue/state-machine files and stopped event-based progression.
- Changed job execution to inline pipeline in `jobsService`, while preserving job/artifact records.
- Added persisted inspector trace in `job_inputs.metadata.inspector_trace`.
- Added backend inspector endpoint: `GET /v1/jobs/:job_id/inspector`.
- Captured stage visibility exactly for:
- `transcript` (input snapshot),
- `llm_request` (prompt/model/config),
- `llm_response` (raw preview + parsed counts),
- `normalization` (input/output summary),
- `pdf` (render input/config/output checksum/size).
- Updated sidepanel Inspector card to render stage-by-stage input/config/output blocks from `/inspector`.
- Updated `scripts/dev-smoke.sh` to validate `/inspector` instead of `/events`.
- Validation:
- `cd backend && npm run typecheck` passed.
- End-to-end smoke passed with inline backend run + `./scripts/dev-smoke.sh` (job succeeded, artifacts returned, inspector stages returned).

## Current Task: Rewrite AGENTS.md For Solo, Simple Workflow (2026-03-01)

### Plan

- [x] Replace `AGENTS.md` completely with a shorter, plain-language guide tailored to a single user.
- [x] Add a project TOC tree view that points agents to the right directories/files quickly.
- [x] Include ranked lists for:
  - decision priorities,
  - where to look first by task type,
  - when complexity is warranted.
- [x] Add explicit complexity tradeoff guidance (when to keep simple vs when extra structure is worth it).
- [x] Add collaboration style rules that require teacher-like explanations from fundamentals and terminology.
- [x] Keep instructions minimal, concrete, and execution-focused; remove redundant process overhead.
- [x] Add a short `Review` note for this task after implementation.

### Review

- Rewrote `AGENTS.md` end-to-end for a solo-user workflow with minimal process overhead.
- Added ranked guidance for decisions, file lookup order, and when complexity is warranted.
- Added explicit complexity tradeoff language to bias toward simplest viable solutions.
- Added a practical project TOC tree view so agents can route work quickly.
- Added required teacher-style collaboration rules: fundamentals first, terminology definitions, and research-friendly explanations.

## Current Task: Promote Payload Tab To Top-Level + Improve Readability (2026-03-01)

### Plan

- [x] Move tab controls to the top-level side panel layout (`Workspace` and `Payload Inspector`), not nested inside any card.
- [x] Keep current workflow UI in `Workspace` tab unchanged (connection/form/status/artifacts/timeline).
- [x] Show payload logs only in top-level `Payload Inspector` tab with clearer, human-readable formatting.
- [x] Improve payload rendering readability: labeled request/response sections, pretty JSON, truncated long fields with explicit markers.
- [x] Preserve existing payload capture behavior in `apiRequest()` and keep log controls (`Clear Logs`, capped list).
- [x] Validate extension script syntax and verify tab switching + payload readability behavior.
- [x] Record final behavior and usage notes in `Review`.

## Current Task: Add Payload Inspector Tab In Side Panel (2026-03-01)

### Plan

- [x] Add a new tabbed section in side panel UI with two tabs: `Timeline` and `Payload Inspector`.
- [x] Keep current Timeline behavior unchanged, and render request/response payload logs in the new tab.
- [x] Capture API call metadata in `apiRequest()` (method, path, URL, request body, status, response body/error, timestamp).
- [x] Add lightweight controls: clear logs + capped log length to avoid UI bloat.
- [x] Validate extension script syntax and verify one create/poll flow populates payload logs.
- [x] Record changes and usage notes in `Review`.

## Current Task: Add One-Command Server Runner + Launch It (2026-03-01)

### Plan

- [x] Add a new script `scripts/run-server.sh` for one-command local server startup (with dependency and readiness checks).
- [x] Keep existing scripts/API behavior unchanged; only add the new runner script.
- [x] Run the new script in a background terminal session and keep it alive.
- [x] Verify server health via `http://localhost:8080/healthz`.
- [x] Record usage and run result in `Review`.

## Current Task: Stabilize Dev Startup + Auto-Recover Stale Active Jobs (2026-03-01)

### Plan

- [x] Harden `scripts/dev-up.sh` readiness checks (PostgreSQL + backend `/healthz`) with clear failure hints.
- [x] Add minimal stale-active-job cleanup helper in repository layer (target: old `queued/processing` records only).
- [x] Update active-job quota guard to retry count after stale cleanup before returning `ACTIVE_JOB_LIMIT_EXCEEDED`.
- [x] Run backend typecheck and smoke verification for both connectivity and job creation path.
- [x] Record implementation notes and outcomes in `Review`.

## Current Task: Extension Failed-To-Fetch Root-Cause Recheck After Reset (2026-03-01)

### Plan

- [x] Reproduce current failure from clean `27e197f` state and capture exact layer (`port/listen`, `healthz`, `v1 route`, `auth`, `quota`).
- [x] Verify backend startup stability path in this commit (`./scripts/dev-up.sh`) and confirm whether process stays alive after script exits.
- [x] Check side panel effective config (API Base URL + token) and validate with direct `curl` parity tests.
- [x] Inspect DB active jobs for `cecilia@example.com` to rule in/out `ACTIVE_JOB_LIMIT_EXCEEDED` as secondary blocker after network is restored.
- [x] Propose the smallest safe fix set (startup script hardening first, then optional stale-job handling), with no API contract changes.
- [x] After your approval, implement only the agreed minimal fix and validate with `./scripts/dev-smoke.sh` + side panel flow.

## Current Task: Backend Process Persistence Fix (2026-02-27)

### Plan

- [x] Reproduce why extension still shows network failure after UI-side fetch error improvements.
- [x] Confirm backend process is not staying alive on `:8080` in current startup path.
- [x] Switch dev bootstrap script to use persistent backend start mode (non-watch process).
- [x] Validate health endpoint remains reachable after startup (`localhost` and `127.0.0.1`).
- [x] Record outcome in `Review`.

## Current Task: Backend Local Bind Stability (2026-02-27)

### Plan

- [x] Diagnose local bind behavior when extension reports network-level fetch failure.
- [x] Make backend host binding explicit via config (`HOST`) to avoid IPv6-only ambiguity.
- [x] Keep API contract unchanged; only adjust server listen host wiring.
- [x] Verify both `localhost:8080` and `127.0.0.1:8080` health checks succeed.
- [x] Record outcome in `Review`.

## Current Task: Extension `Failed to fetch` Recovery (2026-02-27)

### Plan

- [x] Reproduce and confirm failure path in Side Panel API requests (`apiRequest` network exception branch).
- [x] Add robust network-error handling in extension:
  - detect fetch `TypeError` and show actionable message (API URL, token, backend health hint),
  - keep existing server error parsing unchanged.
- [x] Add fallback host probing for local dev (`localhost:8080` <-> `127.0.0.1:8080`) when request fails before HTTP response.
- [x] Keep API contract unchanged and minimize UI/code impact (sidepanel only).
- [x] Validate by running one successful transcript job from extension-compatible request path.
- [x] Record outcomes in `Review`.

## Current Task: Phase 2 Chapter Plan + Evidence Map (2026-02-27)

### Plan

- [x] Add explicit in-memory `chapter plan` contract derived from semantic segments (title/range/intent/segment_ids).
- [x] Add `chapter evidence map` (per chapter quote evidence index) and wire it into merge validation.
- [x] Pass chapter-plan hints into LLM prompt to enforce chapter-scoped generation.
- [x] Keep external API/output schema unchanged (`BookletModel` and renderer contracts stay stable).
- [x] Run `npm run typecheck` and one regression job, then record outcomes in `Review`.

## Current Task: Phase 1 Semantic Segmentation + Chapter Planning (2026-02-27)

### Plan

- [x] Implement semantic segment detection over parsed transcript utterances (topic-shift/time-gap/transition cues).
- [x] Replace uniform chunk split with segment-based chapter planning, while keeping chapter count in 5-7 range.
- [x] Keep downstream rendering contract unchanged (`BookletModel` compatible with MD/PDF/EPUB renderers).
- [x] Run `npm run typecheck` and one long-transcript regression job.
- [x] Compare chapter ranges/titles against previous baseline and log observed changes in `Review`.

## Current Task: Transcript Pipeline v2 Blueprint (2026-02-27)

### Plan

- [x] Create `docs/transcript-pipeline-v2.md` with As-Is and To-Be Mermaid flowcharts.
- [x] Map current code path to each As-Is node and identify semantic-understanding gaps.
- [x] Define intermediate contracts for semantic understanding, chapter planning, and evidence-backed writing.
- [x] Define quality gates (evidence coverage, chapter completeness, anti-hallucination fallback).
- [x] Propose phased implementation order with measurable acceptance criteria.
- [x] Record this task summary in `Review`.

## Current Task: Evidence Validation + Chapter Explanation Pilot (2026-02-27)

### Plan

- [x] Add quote-evidence validation against transcript text to filter unsupported LLM quotes before merge.
- [x] Extend LLM draft + internal booklet chapter model with `解释与延展` fields (背景/核心概念/判断标准/常见误解).
- [x] Render the new chapter explanation block in Markdown/PDF/EPUB outputs.
- [x] Keep API and artifact endpoints unchanged (internal model/rendering only).
- [x] Run `npm run typecheck` and one long-transcript regression job for density/quality sanity check.
- [x] Write test outcome and observed quality delta in `Review`.

## Current Task: Loosen Merge Caps For Richer Output (2026-02-27)

### Plan

- [x] Expand merge caps in `backend/src/repositories/jobsRepo.ts` for chapter points/quotes/actions to preserve more LLM detail.
- [x] Expand global caps for `suitableFor/outcomes`, action summary buckets, terms, and appendix themes/quotes.
- [x] Keep changes minimal and backward-compatible (no schema or API contract changes).
- [x] Run `npm run typecheck` and one transcript job to verify chain stability.
- [x] Compare new artifact size/content density vs recent baseline job and log findings in `Review`.

## Current Task: Improve LLM System Prompt (2026-02-27)

### Plan

- [x] Compare current `system` + `user` prompt against booklet contract requirements and identify quality gaps.
- [x] Design a stricter `system prompt` (role, style, evidence grounding, anti-hallucination, actionability constraints).
- [x] Update `backend/src/services/bookletLlm.ts` with minimal prompt changes (keep JSON schema and fallback behavior unchanged).
- [x] Run `npm run typecheck` and one transcript smoke test to verify no regression.
- [x] Add this task outcome to `Review` section.

## Current Task: Transcript Chain Test (2026-02-27)

### Plan

- [x] Confirm local backend/dev dependencies are up and `healthz` is reachable.
- [x] Execute transcript chain smoke test via `./scripts/dev-smoke.sh`.
- [x] Validate job lifecycle output (`created -> processing -> succeeded`), artifacts URLs, and events.
- [x] Record test evidence and outcome in `Review` section.

## Plan

- [x] Add ignore rules for local/generated artifacts that should not be public.
- [x] Remove tracked `backend/.dev-artifacts` files from the current branch state.
- [x] Rewrite Git history to purge `backend/.dev-artifacts` from all commits.
- [x] Update Git author email to GitHub noreply for future commits.
- [x] Force-push rewritten history to GitHub and verify remote state.
- [x] Update this file's Review section after implementation.
- [x] Verify current repository state for GitHub push readiness.
- [x] Initialize Git (if needed) and create a baseline commit for this project.
- [x] Configure `origin` remote to the target GitHub repository.
- [x] Push the current branch to GitHub and confirm remote tracking.
- [x] Update this file's Review section after implementation.
- [x] Implement a shared booklet intermediate model from transcript input.
- [x] Render Markdown from the shared model with chapterized booklet structure.
- [x] Render PDF from the same model (same section order and headings).
- [x] Render EPUB dynamically from the same model (replace static template-copy behavior).
- [x] Verify end-to-end output consistency across EPUB/PDF/Markdown.
- [x] Update this file's Review section after implementation.
- [x] Diagnose quality gap by comparing generated output vs `/Users/cecilia/Downloads/ep36_booklet_v0.md`.
- [x] Improve transcript parsing by stripping metadata preamble (`date/Keywords/Transcript headers`) before chaptering.
- [x] Improve auto-title generation to ignore transcript metadata lines.
- [x] Add rule-based topic/action templates to reduce literal transcript dumping.
- [x] Re-run ep36 transcript regression and capture remaining quality gap.
- [x] Add optional LLM structured-booklet generation stage (JSON contract) before renderer.
- [x] Keep safe fallback: if LLM key/call fails, continue deterministic generation.
- [x] Wire LLM env config (`OPENAI_*`) and document defaults in `.env.example`.
- [x] Verify backend typecheck and smoke after LLM-stage integration.
- [x] Add native `OPENROUTER_*` env support (key/base/model/timeout/input limit) with backward-compatible `OPENAI_*` fallback.
- [x] Update booklet contract scope from EPUB-only to EPUB/PDF/Markdown shared contract.
- [x] Add format-specific rendering requirements while keeping one canonical content structure.
- [x] Update related references in `docs/v1-spec.md`.
- [x] Update this file's Review section after implementation.
- [x] Digest `/Users/cecilia/Downloads/ep36_templateA_v0.epub` structure and placeholder system.
- [x] Compare with `docs/v1-spec.md` and extract a canonical booklet template contract.
- [x] Create `docs/booklet-template-contract.v1.md` (sections, required placeholders, output constraints).
- [x] Create `docs/booklet-template-content.v1.md` (copy-ready generation template with fillable fields).
- [x] Add implementation notes for wiring this template into backend EPUB generation.
- [x] Update this file's Review section after implementation.
- [x] Make `Episode Title` optional in the Side Panel form.
- [x] Add client-side auto title generation when title is empty on submit.
- [x] Show lightweight UI hint: "leave blank to auto-generate."
- [x] Keep backend contract unchanged by always sending a non-empty title from UI.
- [x] Update this file's Review section after implementation.
- [x] Make each Artifact card fully clickable (not only the type text link).
- [x] Keep accessibility and open-in-new-tab behavior.
- [x] Update this file's Review section after implementation.
- [x] Replace placeholder artifact URLs (`downloads.example.com`) with local reachable dev download URLs.
- [x] Add backend download endpoint for dev artifacts.
- [x] Keep minimal scope: no new storage system, only serve generated placeholder files for now.
- [x] Verify end-to-end: create job -> artifacts links -> browser download success.
- [x] Update this file's Review section after implementation.
- [x] Fix PDF Chinese garbled text by using a CJK-capable font in PDF generation.
- [x] Ensure transcript text is written as UTF-8 content path (no re-encoding in pipeline).
- [x] Keep current dev scope simple: improve readability first, no full prompt pipeline rewrite in this step.
- [x] Verify with one Chinese transcript job and confirm PDF/MD readability.
- [x] Update this file's Review section after implementation.

## In Progress

- [x] Implementing shared model + unified renderers for EPUB/PDF/Markdown.

## Done

- [x] Created project rules file.
- [x] Created checklist-based todo template.
- [x] Implemented optional Episode Title with auto-generation on submit.
- [x] Implemented full-card click behavior for Artifact downloads.
- [x] Fixed Artifact links to real local downloads and verified end-to-end.
- [x] Fixed PDF Chinese garbled text by switching to project-level CJK OTF font.
- [x] Produced canonical booklet template docs based on `ep36_templateA_v0.epub` and current V1 spec.
- [x] Expanded booklet contract to apply to EPUB/PDF/Markdown with shared canonical structure.
- [x] Implemented one shared booklet model that now drives Markdown/PDF/EPUB rendering.
- [x] Replaced static EPUB template copy with dynamic EPUB package generation (`chap_01..chap_14` + nav + toc + opf).
- [x] Verified unified output pipeline via backend typecheck and end-to-end smoke run.
- [x] Improved parser and title generation to avoid metadata contamination (`CST/Keywords`) in booklet output.
- [x] Added topic-driven action templates and cleaner TL;DR wording for better baseline readability.
- [x] Added optional LLM JSON generation module for booklet content with auto-fallback.
- [x] Added `OPENAI_*` config support and verified pipeline stability without key.
- [x] Added `OPENROUTER_*` config aliases so provider naming is explicit for OpenRouter usage.
- [x] Initialized this project as a local Git repository and pushed `main` to GitHub (`CeciliaHahan/podcast_to_ebook`).
- [x] Removed `backend/.dev-artifacts` from tracked state and rewrote branch history to keep generated artifacts out of public history.
- [x] Switched Git commit email to GitHub noreply for future commits.

## Review

### Promote Payload Tab To Top-Level + Improve Readability (2026-03-01)

- Converted payload inspector to top-level navigation for the entire side panel:
  - `Workspace` tab
  - `Payload Inspector` tab
- Kept existing workflow unchanged under `Workspace`:
  - Connection / Create Job / Job Status / Artifacts / Timeline.
- Moved payload view out of nested section and into dedicated top-level panel.
- Improved readability in payload list:
  - each entry now shows summary line (time, method/path, status),
  - clear labeled blocks:
    - `Request -> <url>`
    - `Response`
  - pretty JSON is preserved from existing logger formatting, with truncation marker for long payloads.
- Maintained existing payload logging behavior:
  - captures success/error/network failure attempts in `apiRequest()`,
  - keeps capped list and `Clear Logs` action.
- Validation:
  - `node --check extension/sidepanel/sidepanel.js` passed.

### Add Payload Inspector Tab In Side Panel (2026-03-01)

- Added tabbed Activity UI in side panel:
  - `Timeline` tab (existing events list retained).
  - `Payload Inspector` tab (new request/response payload log view).
- Files updated:
  - `extension/sidepanel/sidepanel.html`
  - `extension/sidepanel/sidepanel.css`
  - `extension/sidepanel/sidepanel.js`
- Payload logging behavior:
  - logs each API attempt in `apiRequest()` with:
    - timestamp
    - method/path/url
    - request body preview
    - response body preview or network error message
    - HTTP status (when available)
  - includes both successful and failed HTTP responses, and network-failure attempts.
  - payload list is capped to 80 entries to avoid unbounded growth.
  - each payload preview is capped to 6000 chars (large transcript bodies are truncated safely).
- Added user control:
  - `Clear Logs` button in `Payload Inspector`.
- Validation:
  - extension script syntax check passed: `node --check extension/sidepanel/sidepanel.js`.
  - request/response capture is wired into all sidepanel API calls (`create`, `status`, `events`, `artifacts`) via shared `apiRequest()`.

### Add One-Command Server Runner + Launch It (2026-03-01)

- Added new runner script: `scripts/run-server.sh`.
- Script behavior:
  - ensures PostgreSQL service is running and ready (`pg_isready` wait),
  - ensures DB/env bootstrap and runs migration,
  - installs/builds backend,
  - starts backend in foreground (`node dist/index.js`).
- Safety behavior:
  - if `:8080` is already in use, script exits with a clear hint to run `./scripts/dev-down.sh` first.
- Usage:
  - start server: `./scripts/run-server.sh`
  - stop service stack: `./scripts/dev-down.sh`
- Run result in this session:
  - launched script in background terminal session `16155`,
  - verified health endpoint returns:
    - `{"ok":true,"service":"podcasts-to-ebooks-backend"}`

### Stabilize Dev Startup + Auto-Recover Stale Active Jobs (2026-03-01)

- Root-cause recap from this round:
  - extension `Failed to fetch` occurs when backend is not reachable on `http://localhost:8080`.
  - after network recovery, `ACTIVE_JOB_LIMIT_EXCEEDED` can still block new jobs if stale `queued/processing` rows remain.
- Implemented minimal startup hardening in `scripts/dev-up.sh`:
  - wait for PostgreSQL readiness using `pg_isready` (up to 30s).
  - wait for backend `/healthz` readiness (up to 30s).
  - on health timeout, print `/tmp/podcasts_to_ebooks_backend.log` tail and exit non-zero.
  - backend launch now prefers `setsid + nohup` when `setsid` is available.
- Implemented stale active-job auto-recovery:
  - added `failStaleActiveJobs(userId, staleMinutes)` in `backend/src/repositories/jobsRepo.ts`.
  - only updates old `queued/processing` rows for the user to:
    - `status='failed'`
    - `error_code='STALE_ACTIVE_JOB_RECOVERED'`
  - updated `assertUserQuota()` in `backend/src/services/jobsService.ts`:
    - when active limit is hit, perform stale cleanup (15 minutes),
    - re-count active jobs before deciding whether to throw `ACTIVE_JOB_LIMIT_EXCEEDED`.
- Validation:
  - `npm run typecheck` passed.
  - stale recovery confirmed with live DB state:
    - before create: two active jobs existed for `cecilia@example.com` (one stale from `17:38` and one recent),
    - create request succeeded,
    - stale row was auto-marked failed with `STALE_ACTIVE_JOB_RECOVERED`.
  - smoke run still reaches API/job stages successfully; existing known behavior remains:
    - short polling window can return `JOB_NOT_READY` at artifacts step.

### Extension Failed-To-Fetch Root-Cause Recheck After Reset (2026-03-01)

- Reproduced from reset `27e197f` state:
  - `lsof :8080` empty,
  - `curl http://localhost:8080/healthz` connection refused,
  - `./scripts/dev-smoke.sh` fails at first health check.
- Confirmed sidepanel config path is correct:
  - default API base `http://localhost:8080`,
  - default token `dev:cecilia@example.com`,
  - host permissions include both `localhost` and `127.0.0.1`.
- Confirmed route/auth layer is reachable once backend is up:
  - direct POST to `/v1/jobs/from-transcript` succeeds when backend is running.
- Secondary blocker identified:
  - stale active jobs in DB can trigger `ACTIVE_JOB_LIMIT_EXCEEDED` after network is fixed.
- UX guidance improvement:
  - sidepanel network error message now includes:
    - `./scripts/dev-up.sh`
    - `./scripts/dev-smoke.sh`
    - fallback foreground backend start: `cd backend && npm run start`

### Backend Process Persistence Fix (2026-02-27)

- Root cause confirmed:
  - extension-side error handling was improved, but backend itself was frequently not running.
  - previous bootstrap used `nohup npm run dev` (`tsx watch`) which was not stable as a detached process in this environment.
- Implemented startup fix in `scripts/dev-up.sh`:
  - run backend build during bootstrap (`npm run build`),
  - start persistent runtime with direct `nohup node dist/index.js` (compiled runtime) instead of watch mode.
- Validation:
  - backend process remains listening on `:8080` after startup.
  - `healthz` reachable on both:
    - `http://localhost:8080/healthz`
    - `http://127.0.0.1:8080/healthz`

### Backend Local Bind Stability (2026-02-27)

- Found local connectivity instability root cause:
  - backend process bind behavior could appear IPv6-only in this environment, making `127.0.0.1:8080` unavailable.
- Implemented minimal backend fix:
  - added `host` config in `backend/src/config.ts` (`HOST`, default `0.0.0.0`),
  - updated `backend/src/index.ts` to `app.listen(config.port, config.host, ...)`,
  - documented `HOST=0.0.0.0` in `backend/.env.example`.
- Scope kept minimal:
  - no API schema changes,
  - no route changes,
  - no extension contract changes.
- Verification:
  - `npm run typecheck` passed.
  - backend health check now succeeds on both:
    - `http://localhost:8080/healthz`
    - `http://127.0.0.1:8080/healthz`

### Extension `Failed to fetch` Recovery (2026-02-27)

- Root cause in UI layer:
  - Side Panel `apiRequest()` surfaced raw browser network exception as plain `Failed to fetch`, with no actionable diagnostics.
- Implemented fix in `extension/sidepanel/sidepanel.js`:
  - added explicit network-error classification (`TypeError` / common fetch network patterns),
  - added actionable error message with:
    - exact tried URLs,
    - backend health check hint (`http://localhost:8080/healthz`),
    - API URL/token verification checklist.
- Added local-dev host fallback:
  - when primary base is `localhost:8080`, automatically retry `127.0.0.1:8080` on network failure (and vice versa),
  - on successful fallback, auto-update saved API Base URL and show one-time feedback.
- Kept scope minimal:
  - no backend API change,
  - no schema change,
  - sidepanel request path only.
- Verification:
  - syntax check passed: `node --check extension/sidepanel/sidepanel.js`.
  - end-to-end API flow succeeded using extension-compatible request payload:
    - create job: `job_b51f1501f2d3ae13` (`202` accepted),
    - final state: `succeeded`,
    - artifact returned: `md`.

### Phase 2 Chapter Plan + Evidence Map (2026-02-27)

- Added explicit in-memory chapter planning contract in `backend/src/repositories/jobsRepo.ts`:
  - `ChapterPlanItem` now captures `title/range/intent/segment_ids/signals/start-end`.
  - chapter generation now consumes `chapterPlan` instead of direct chunk mapping.
- Added chapter-scoped evidence map:
  - `buildChapterEvidenceMap(entries, chapterPlan)` builds one evidence index per chapter.
  - chapter quote merge validation now uses chapter-level evidence first (instead of only global transcript evidence).
- Added chapter-plan prompt hints for LLM in `backend/src/services/bookletLlm.ts`:
  - new `chapterPlans` input includes `title/range/intent/signals/context_excerpt/evidence_anchors`.
  - prompt now enforces strict chapter order alignment and disallows cross-chapter quote borrowing.
- Compatibility:
  - external API and output artifacts schema unchanged.
  - renderer contracts unchanged (`BookletModel` still the shared source for MD/PDF/EPUB).
- Verification:
  - `npm run typecheck` passed.
  - long transcript regression succeeded: `job_9c56a530f04fc341` in `47s`.
  - artifacts generated:
    - epub `19,337` bytes
    - pdf `193,899` bytes
    - md `18,672` bytes
- Comparison vs previous semantic baseline `job_e3472488812a8dfd`:
  - runtime: `47s` vs `46s` (stable)
  - chapter headings/ranges: unchanged (semantic boundaries preserved)
  - quote lines in MD: `18` vs `18`
  - `解释与延展` blocks: `7` vs `7`
  - artifact sizes changed slightly only (`MD -71 bytes`, `EPUB -20 bytes`, `PDF -158 bytes`)
- Observation:
  - this phase mainly strengthens chapter-scoped grounding constraints and internal contracts.
  - visible content delta is limited on this transcript; bigger quality lift likely needs next phase evidence binding for TL;DR/points/actions text.

### Phase 1 Semantic Segmentation + Chapter Planning (2026-02-27)

- Replaced uniform chunk splitting with semantic segment-driven chapter planning in `backend/src/repositories/jobsRepo.ts`.
- Added semantic boundary heuristics over parsed utterances:
  - topic transition cues
  - question turns
  - timestamp gap boundaries
- Added chapter planning controls to keep chapter count in the target range (`5-7`) by merge/split of semantic segments.
- Kept downstream model/rendering contract unchanged (`BookletModel` still drives MD/PDF/EPUB without API changes).
- Regression checks:
  - `npm run typecheck` passed.
  - Long transcript regression job succeeded: `job_e3472488812a8dfd` (used `dev:semantic-phase1@example.com` due per-user daily quota cap).
  - Runtime stayed similar: `46s` (same as previous long-run baseline).
- Chapter structure comparison vs previous baseline `job_c0a7cd07b6046979`:
  - chapter count remained `7`
  - chapter ranges changed from near-uniform chunk ranges to semantically shifted ranges:
    - old chapter 2: `10:19 - 28:54` -> new chapter 2: `09:30 - 34:23`
    - old chapter 3/4 ordering adjusted (`内疚...` and `沟通策略...` swapped by detected boundaries)
    - later chapter boundaries moved earlier (`01:20:42` -> `01:18:28` for chapter 7 start)
- Output density stayed stable for this phase:
  - quote lines `18 -> 18`
  - explanation blocks `7 -> 7`
  - markdown size `18,944 -> 18,743` bytes

### Transcript Pipeline v2 Blueprint (2026-02-27)

- Added `docs/transcript-pipeline-v2.md` as the semantic-first pipeline blueprint for transcript quality improvements.
- Included both `As-Is` and `To-Be` Mermaid flowcharts and mapped current code responsibilities to each pipeline node.
- Defined intermediate data contracts for:
  - utterance parse
  - semantic segment
  - chapter plan
  - evidence-backed chapter draft
- Defined pre-render quality gates:
  - evidence coverage
  - chapter completeness
  - anti-hallucination fallback
  - structural compliance
- Added a phased implementation path (Phase 1-4) with acceptance criteria and rollout order.
- Linked this new blueprint from `docs/v1-spec.md` `Related docs` section for discoverability.

### Evidence Validation + Chapter Explanation Pilot (2026-02-27)

- Added quote evidence validation in merge path to keep only transcript-supported LLM quotes before final chapter assembly.
- Extended chapter model with `解释与延展` fields:
  - `background`
  - `coreConcept`
  - `judgmentFramework`
  - `commonMisunderstanding`
- Updated LLM JSON contract (`backend/src/services/bookletLlm.ts`) to request chapter explanation fields.
- Rendered explanation block in all outputs (`Markdown/PDF/EPUB`) under each chapter.
- Kept API endpoints unchanged (internal model + renderer update only).
- Regression verification:
  - `npm run typecheck` passed.
  - Long transcript job `job_c0a7cd07b6046979` succeeded in `46s` (same level as prior long-run baseline).
- Comparison vs previous loosened-merge baseline `job_c11f04bf592f5523`:
  - `MD size`: `18,944` vs `15,377` (increased due added explanation sections).
  - `EPUB size`: `19,492` vs `18,166` (increased).
  - `PDF size`: `196,726` vs `207,628` (slightly decreased due stricter quote filtering).
  - `timestamp quote lines (MD)`: `18` vs `33` (reduced by evidence filter).
  - `解释与延展` blocks: `7` vs `0` (now present per chapter).
- Observation:
  - Evidence validation improved citation strictness but currently drops many non-verbatim LLM quotes.
  - Explanation quality is structurally complete, but some text is still template-like; further quality gains require stronger chapter-level writing prompts and/or multi-step generation.

### Merge Caps Loosened (2026-02-27)

- Updated merge stage in `backend/src/repositories/jobsRepo.ts` to preserve richer LLM output instead of hard-compressing to previous low caps.
- Added `MERGE_CAPS` config for centralized limits and raised caps for:
  - chapter points / quotes / actions,
  - audience/outcomes lists,
  - action summary buckets,
  - terms,
  - appendix per-theme quote count.
- Reworked list merge behavior to avoid forced empty fill and prefer merged unique content from `draft + fallback`.
- Added quote merge helper with de-duplication and safe fallback quote when both sides are empty.
- Verification:
  - `npm run typecheck` passed.
  - Re-ran same transcript (34,448 chars) as baseline:
    - Baseline job: `job_6fef829b02496b3f`
    - New job: `job_c11f04bf592f5523`
    - Runtime stayed similar (45s -> 46s), so no obvious performance regression.
- Density comparison (new vs baseline):
  - `MD size`: `15,377` vs `8,824` bytes
  - `EPUB size`: `18,166` vs `14,715` bytes
  - `PDF size`: `207,628` vs `177,923` bytes
  - `timestamped quote lines (MD)`: `33` vs `18`
  - `chapter points`: `31` vs `21`
  - `chapter actions`: `24` vs `14`
  - `chapter quotes`: `24` vs `14`
  - `appendix quotes`: `14` vs `9`

### LLM Prompt Upgrade (2026-02-27)

- Upgraded `backend/src/services/bookletLlm.ts` `system prompt` to explicitly enforce: transcript faithfulness first, no hallucination, JSON-only output, and conservative fallback phrase (`未在原文中明确说明`).
- Reworked `buildPrompt()` instructions to add strict quality controls:
  - quote fidelity requirements (no paraphrasing inside quote text),
  - chapter-level actionability rules,
  - global pre-output checklist for evidence grounding and noisy transcript handling.
- Kept existing JSON contract shape and fallback behavior compatible with current parser/merge pipeline.
- Regression checks:
  - `npm run typecheck` passed.
  - transcript smoke job `job_850b6d0e59127dac` created at `2026-02-27T08:07:26.388Z`, then reached `succeeded` at `2026-02-27T08:07:40.708Z`.
  - artifacts endpoint returned all formats (`epub/pdf/md`) for that job.
- Note: current downstream merge still compresses some rich output (e.g., per-chapter quotes/actions caps), so prompt升级可提升内容质量，但仍受现有 merge 上限约束。

### Transcript Chain Test (2026-02-27)

- Verified `/healthz` returns `{"ok":true,"service":"podcasts-to-ebooks-backend"}`.
- Executed transcript smoke path using `./scripts/dev-smoke.sh`.
- Observed smoke job `job_f74306cf4f01631c` creation at `2026-02-27T07:51:44.497Z` and stage progression through `input_validation -> normalization -> chapter_structuring -> render_epub -> render_pdf -> render_md -> packaging`.
- Confirmed final job status reached `succeeded` at `2026-02-27T07:52:00.552Z`.
- Confirmed artifact listing returns `epub/pdf/md` for `job_f74306cf4f01631c`.
- Confirmed all artifact download URLs are reachable with `HTTP/1.1 200 OK` and correct content types:
  - `application/epub+zip`
  - `application/pdf`
  - `text/markdown; charset=utf-8`
- Noted current smoke script behavior: fixed polling window may stop before `succeeded`, which can transiently produce `JOB_NOT_READY` for artifacts even when job completes moments later.

### Summary

- Added `AGENTS.md` with the 7 requested overall rules.
- Added this `tasks/todo.md` file as a persistent checklist + review workspace.
- Implemented auto-title enhancement for `Episode Title` in Side Panel.
- Updated Artifact cards so the entire card is clickable for download.
- Diagnosed artifact download failure: backend currently emits placeholder domain links.
- Replaced placeholder download links with working local download URLs.
- Added a backend download route and generated dev artifact files on job completion.
- Diagnosed current output issue: PDF Chinese text renders as garbled characters due to font encoding support.
- Added `NotoSansCJKsc-Regular.otf` and updated PDF rendering to use CJK-capable font first.
- Re-verified Chinese transcript job: status succeeded, PDF/MD artifacts downloadable, no generation failure.
- Collected structure details from both `ep36_templateA_v0.epub` and `ep36_booklet_v0.epub` to prepare canonical template output.
- Added `docs/booklet-template-contract.v1.md` and `docs/booklet-template-content.v1.md` as the canonical booklet template set.
- Updated booklet contract scope to all three outputs (`EPUB/PDF/Markdown`) with renderer-specific constraints.
- Implemented a shared booklet model in backend and rewired all three renderers to consume the same model object.
- Replaced EPUB static copy behavior with dynamic package generation (`mimetype`, `container.xml`, `content.opf`, `nav.xhtml`, `toc.ncx`, `chap_01..chap_14`).
- Updated job queue to pass `templateId`, `sourceType`, and `sourceRef` into artifact rendering for traceability consistency.
- Verified with `npm run typecheck` and `./scripts/dev-smoke.sh` using `dev:render-smoke@example.com`; job `job_44c10d51ac0a3a13` produced downloadable EPUB/PDF/MD successfully.
- Validated that generated EPUB has no unresolved placeholder tokens and includes the full chapter spine order.
- Compared generated file quality against `/Users/cecilia/Downloads/ep36_booklet_v0.md`; confirmed current deterministic heuristics still underperform on semantic summarization quality.
- Implemented parsing fixes to remove `date/Keywords/Transcript` contamination from content extraction.
- Updated side panel auto-title generation so empty title no longer defaults to metadata-like lines.
- Added topic-template actions and TL;DR phrasing to reduce direct raw-line copying.
- Added `backend/src/services/bookletLlm.ts` to request a structured booklet JSON from LLM and merge it into the shared model when available.
- Added optional runtime config keys: `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENAI_TIMEOUT_MS`, `OPENAI_INPUT_MAX_CHARS`.
- Ensured no-regression fallback path: when `OPENAI_API_KEY` is empty or API call fails, generation continues with deterministic logic.
- Verified with `npm run typecheck` and `./scripts/dev-smoke.sh` after integration.
- Added provider-native env support: `OPENROUTER_API_KEY` / `OPENROUTER_BASE_URL` / `OPENROUTER_MODEL` (and timeout/input limits), with automatic fallback to existing `OPENAI_*` names.
- Initialized Git in project root, created baseline commit, and configured `origin` to `git@github.com:CeciliaHahan/podcast_to_ebook.git`.
- Resolved first-push divergence with remote `main` by rebasing and handling `README.md` add/add conflict.
- Successfully pushed local `main` to GitHub and set upstream tracking (`main -> origin/main`).
- Added `.gitignore` rule for `backend/.dev-artifacts/` and removed tracked generated artifacts from `main`.
- Rewrote local `main` history to purge `backend/.dev-artifacts` from commit objects and rewrote prior commit email identity to GitHub noreply.
- Updated local Git identity to `CeciliaHahan@users.noreply.github.com` for all future commits.

### Notes

- Future tasks can follow this flow directly: write plan -> get user verification -> execute with checkboxes -> fill Review.
- UI now allows empty title; submit generates a title from transcript first meaningful line and sends non-empty `title` to backend.
- Artifact links still open in a new tab, but now all card area is interactive (including keyboard focus states).
- Dev artifact behavior:
  - Markdown/PDF/EPUB now all come from one shared booklet model.
  - PDF now follows booklet section order with chapter-level page breaks.
  - EPUB is now generated dynamically and no longer copies `ep36_templateA_v0.epub` directly.
- PDF CJK font fallback order now prefers repository font:
  - `assets/fonts/NotoSansCJKsc-Regular.otf`
  - then system CJK fonts if needed.
- The next engineering step is improving chapter content quality (prompt/system integration) while keeping this shared structure stable.
- Remaining gap: true chapter summarization quality requires an LLM summarization stage with structured JSON output (contract-first), not only heuristic extraction.
- Current local env check shows `OPENAI_API_KEY` is empty, so LLM stage is installed but not active yet.
- The same contract now explicitly governs PDF/Markdown rendering to keep structure parity across formats.

## 2026-03-02 Prompt update (User requested v1)

- [x] 替换 `backend/src/services/bookletLlm.ts` 的 `SYSTEM_PROMPT` 为 v1（更强但兼容的中文硬约束版）。
- [x] 保持现有 `buildPrompt` / JSON contract 不变，仅调整系统约束层。

### Review
- 为什么改：当前 system 提示过短，未能在最上层持续强化“章级对齐、证据边界、兜底完整性”；v1 在不动现有解析链路的前提下显式补齐。
- 风险：严格约束可能在极端噪音转写时触发更多“未在原文中明确说明”，但不影响 JSON 可解析。
