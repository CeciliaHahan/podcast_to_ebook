# TODO

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
