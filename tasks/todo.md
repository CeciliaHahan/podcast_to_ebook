# TODO

## Plan

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

## Review

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
