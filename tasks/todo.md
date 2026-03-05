# TODO

## Current Task: Re-merge Discussion Quality Improvements (2026-03-05)

### Plan

- [x] P0: Reintroduce discussion front-matter/body coverage guards and normalization diagnostics.
- [x] P0: Reintroduce low-information title fallback and discussion keyword noise cleanup.
- [x] P0: Reintroduce discussion map/summary/toc/consensus consistency (remove fixed caps).
- [x] P0: Reintroduce upgraded discussion chapter section framing across Markdown/PDF/EPUB.
- [x] Validate with backend typecheck/build and one inline EPUB regression for discussion transcript.

### Review

- Updated `backend/src/repositories/jobsRepo.ts` to merge discussion-quality upgrades:
  - Added discussion render guardrails (`max front-matter`, `min body chapters`, `max body-start coverage`) and emitted render diagnostics into inspector output.
  - Added low-information title fallback and topic keyword normalization/denoise pipeline to reduce broken fragments and generic title tokens.
  - Unified discussion content driver so map/summary/toc/body/consensus are generated from one consistent body-chapter layout.
  - Upgraded discussion chapter framing in Markdown/PDF/EPUB to:
    - `争议命题`
    - `观点分歧（谁在主张什么）`
    - `证据锚点（原句 + 时间戳）`
    - `共识与未决`
    - `讨论后可验证动作`
- Validation:
  - `cd backend && npm run typecheck` passed.
  - `cd backend && npm run build` passed.
  - Inline discussion regression (mini sample) passed: `run_1c4c7c2f31d57c1d`.
  - Inline long discussion regression (method-compare sample) passed: `run_5a2fd8a1923f1747`.
  - Legacy artifact check (`run_db4b996b410fb1e5`) confirms old issues (`交媒体/件事情` fragments, old chapter framing) were pre-merge behavior.
