# Transcript Generation Core

Snapshot date: 2026-03-06

This note is intentionally narrow.

It is only about the inner generation loop:

`transcript -> parsed entries -> chapter plan -> LLM draft/patch -> merged booklet model -> EPUB`

If the goal is "make the output better," these are the parts that matter.

## 1. The Short Version

Today, output quality is mostly determined before EPUB rendering.

The biggest truth in this codebase is:

- EPUB is not the main quality bottleneck
- the booklet model is

In practice, the pipeline works like this:

1. turn raw transcript text into `TranscriptEntry[]`
2. split that into semantic segments and chapter plans
3. build a deterministic base booklet model
4. ask the LLM to improve that model
5. merge the LLM output back under strong caps and fallbacks
6. serialize the final model into EPUB

So if the result feels generic, wrong, over-summarized, or structurally awkward, the fix is usually in steps 1-5, not in step 6.

## 2. The Inner Loop

### Stage A: Transcript cleanup and parsing

Main functions:

- [`extractTranscriptBody`](../backend/src/repositories/jobsRepo.ts)
- [`extractDeclaredKeywords`](../backend/src/repositories/jobsRepo.ts)
- [`parseTranscriptEntries`](../backend/src/repositories/jobsRepo.ts)
- [`sanitizeSentence`](../backend/src/repositories/jobsRepo.ts)
- [`isMeaningfulSentence`](../backend/src/repositories/jobsRepo.ts)

What this stage does:

- strips wrapper text like `keywords:` and `transcript:`
- removes markdown-like formatting noise
- tries to detect `speaker + timestamp + utterance`
- falls back to generic `Speaker` and `--:--` when structure is weak

Why it matters:

- every later stage depends on these parsed entries
- bad parsing means weak chapters, weak quotes, weak evidence, weak titles

Current weakness:

- the parser is tolerant, but that means it often collapses messy transcripts into generic fallback entries
- once timestamps or speakers are lost here, quote fidelity gets much worse downstream

Improvement levers:

1. add explicit transcript format adapters before generic parsing
2. preserve more raw line provenance per entry
3. record parse confidence per entry, not just a cleaned final line
4. emit parse diagnostics into inspector so bad inputs are obvious

## 3. Stage B: Chapter planning

Main functions:

- [`classifyTranscriptSourceProfile`](../backend/src/repositories/jobsRepo.ts)
- [`planSemanticSegments`](../backend/src/repositories/jobsRepo.ts)
- [`buildChapterPlan`](../backend/src/repositories/jobsRepo.ts)
- [`chapterTitleFromChunk`](../backend/src/repositories/jobsRepo.ts)

What this stage does:

- guesses whether the transcript is `single`, `interview`, or `discussion`
- splits entries into 5-7 semantic-ish chunks
- creates chapter titles, ranges, intents, and topic keywords

Why it matters:

- the chapter plan is the skeleton of the whole book
- the LLM is explicitly told not to change chapter count or order
- if chapter boundaries are wrong, the whole book is wrong in a very stable way

Current weakness:

- chapter planning still leans heavily on keyword heuristics
- title quality is fragile when transcripts are noisy or keywords are bland
- once a weak chapter plan is created, the prompt locks the LLM into that structure

Improvement levers:

1. persist `chapterPlan` and `plannedSegments` for inspection on every run
2. add a second-pass "chapter boundary repair" before LLM generation
3. rank chapter plans with stronger topic-shift signals, not just keyword frequency
4. make chapter titles evidence-backed instead of mostly keyword-backed

## 4. Stage C: Deterministic base booklet model

Main function:

- [`buildBookletModel`](../backend/src/repositories/jobsRepo.ts)

Sub-functions that matter:

- [`chapterPointsFromChunk`](../backend/src/repositories/jobsRepo.ts)
- [`chapterQuotesFromChunk`](../backend/src/repositories/jobsRepo.ts)
- [`chapterExplanationFromPoints`](../backend/src/repositories/jobsRepo.ts)
- [`chapterActionsFromPoints`](../backend/src/repositories/jobsRepo.ts)
- [`buildTldrFromChapters`](../backend/src/repositories/jobsRepo.ts)
- [`buildTermsFromKeywords`](../backend/src/repositories/jobsRepo.ts)

What this stage does:

- creates a complete book-shaped draft without needing the LLM
- fills:
  - title
  - TLDR
  - chapters
  - quotes
  - explanation blocks
  - actions
  - terms
  - appendix themes

Why it matters:

- this is the floor quality of the system
- when the LLM fails, this model becomes the actual output
- even when the LLM succeeds, this model still heavily constrains the final shape

Current weakness:

- some deterministic sections are inherently template-like
- explanations and actions can become generic because they are synthesized from a small set of point heuristics
- appendix and terms are often "structurally complete" but not especially insightful

The most important hidden fact:

- if users say "the result feels like AI mush," the deterministic fallback content is often part of the reason, not just the LLM

Improvement levers:

1. improve deterministic chapter points before touching the prompt
2. stop generating generic explanations unless evidence exists
3. make deterministic actions derive from explicit evidence spans, not just points
4. reduce placeholder-style appendix generation

## 5. Stage D: LLM generation

Main functions:

- [`buildPrompt`](../backend/src/services/bookletLlm.ts)
- [`generateBookletDraftWithLlm`](../backend/src/services/bookletLlm.ts)
- [`generateChapterPatchWithLlm`](../backend/src/services/bookletLlm.ts)

Current behavior:

- full-book path is used only when transcript length is at or below `FULL_BOOK_LLM_MAX_CHARS`
- that threshold is currently `80_000` chars in [`backend/src/repositories/jobsRepo.ts`](../backend/src/repositories/jobsRepo.ts)
- the actual prompt input is also truncated to `config.llmInputMaxChars`, currently `80_000`, in [`backend/src/config.ts`](../backend/src/config.ts)
- long transcripts skip full-book generation and use chapter-level patching instead

What the prompt is trying to enforce:

- strict JSON output
- no hallucinated facts
- no reordering of chapters
- chapter-local evidence only
- 2-4 quotes per chapter
- actionable actions

Why it matters:

- this is the only stage that can add real synthesis beyond heuristics
- it is also the only stage that can radically improve chapter readability

Current weakness:

- the prompt asks for a lot at once
- the model has to produce the whole book shape, maintain chapter alignment, preserve evidence, write clearly, and stay valid JSON
- when it partially fails, the system quietly falls back

Two concrete bottlenecks:

1. full-book generation is all-or-nothing
2. chapter patches only update `points`, `explanation`, and `actions`

That second point matters a lot:

- chapter patch mode does not improve quotes
- it does not improve title quality
- it does not improve TLDR directly
- it does not improve terms directly

So for long transcripts, the highest-value fields remain mostly deterministic.

## 6. Stage E: Merge and fallback

Main functions:

- [`mergeBookletWithLlmDraft`](../backend/src/repositories/jobsRepo.ts)
- [`mergeBookletWithChapterPatches`](../backend/src/repositories/jobsRepo.ts)
- [`chooseListWithFallback`](../backend/src/repositories/jobsRepo.ts)
- [`chooseQuoteListWithFallback`](../backend/src/repositories/jobsRepo.ts)
- [`createFallbackChapterPatch`](../backend/src/repositories/jobsRepo.ts)

What this stage does:

- takes the deterministic base
- overlays LLM content where possible
- keeps deterministic content where the LLM is weak
- removes unsupported quotes
- applies hard caps to list sizes

Why it matters:

- this is where "good raw LLM output" can still get flattened
- it is also where the system protects itself from hallucinations

Current weakness:

- merge logic is conservative, which is good for safety but can reduce specificity
- long lists are clipped aggressively
- chapter patch mode only improves part of the chapter object
- unsupported quotes are removed, but other unsupported summary text is less tightly checked

Important consequence:

- the system is much stricter on quote fidelity than on summary fidelity
- that means non-quote sections can still sound polished but drift semantically

Improvement levers:

1. attach evidence IDs to points, TLDR, and actions
2. score summary claims against transcript evidence before merge
3. make merge decisions quality-aware instead of only shape-aware
4. expose "which fields came from fallback" in inspector output

## 7. Stage F: Quality gate

Main functions:

- [`countModelQualityIssues`](../backend/src/repositories/jobsRepo.ts)
- [`isQualityGatePassed`](../backend/src/repositories/jobsRepo.ts)

What it does:

- counts structural and content issues
- records warning vs blocking issues
- emits results into inspector stages

What it does not do:

- stop rendering

This is the key limitation.

Today, the quality gate is observability, not enforcement.

That means the system can produce:

- structurally valid
- technically successful
- quality-questionable

EPUBs

Improvement levers:

1. make a subset of issues truly blocking
2. trigger targeted retries for specific weak fields
3. fail loud when fallback density is too high

Best first move:

- make "too many deterministic fallback chapters" a blocking or retry-causing condition

## 8. Stage G: EPUB rendering

Main functions:

- [`buildEpubChapterFiles`](../backend/src/repositories/jobsRepo.ts)
- [`buildEpubChapterXhtml`](../backend/src/repositories/jobsRepo.ts)
- [`buildEpubNavXhtml`](../backend/src/repositories/jobsRepo.ts)
- [`buildEpubContentOpf`](../backend/src/repositories/jobsRepo.ts)
- [`writeEpubArtifact`](../backend/src/repositories/jobsRepo.ts)

What this stage does:

- maps the booklet model to XHTML chapters
- builds nav, TOC, OPF, CSS
- zips everything into a valid EPUB package

Why it matters less than earlier stages:

- this renderer is fairly direct
- it mostly reflects the booklet model it is given
- if chapter content is weak, the renderer will faithfully preserve that weakness

Current weakness:

- renderer structure is rigid
- there is little post-model editorial shaping before EPUB serialization
- discussion layout and non-discussion layout are hardcoded

But this is still secondary.

If the content is bad, changing CSS or chapter XHTML will not save it.

## 9. What Is Actually Making Output Worse

These are the biggest current quality drags, in order.

### 9.1 Weak chapter planning locks in weak books

Because the LLM must keep chapter count and order fixed, a weak chapter plan poisons everything downstream.

### 9.2 Long transcripts lose the strongest LLM path

Once transcript length crosses `80_000`, the system stops using full-book generation and falls back to chapter patches.

That reduces LLM influence on:

- titles
- quotes
- TLDR
- terms
- appendix themes

### 9.3 Fallback content is too acceptable

The system is good at staying alive.
It is not yet good enough at saying:

- this run degraded badly
- this chapter is mostly deterministic filler
- this book should be retried

### 9.4 Evidence checks are uneven

Quotes are checked hard.
Other fields are checked much less hard.

So the system is safer than a naive summarizer, but still not tight enough on summary truthfulness.

### 9.5 Too much quality-critical logic lives in one giant file

`jobsRepo.ts` currently mixes:

- parsing
- planning
- book assembly
- quality checks
- render layout
- artifact persistence

That makes it harder to improve one stage cleanly.

## 10. If I Were Improving This Next

This is the order I would recommend.

### Priority 1: Make intermediate artifacts visible

Before changing behavior, make every run inspectable.

Add inspector snapshots for:

- parsed entries
- planned segments
- chapter plan
- base model
- raw LLM JSON
- merged model
- fallback density

Without this, quality work becomes guessing.

### Priority 2: Improve chapter planning

This is the highest-leverage improvement.

Specifically:

- make boundaries more topic-shift aware
- score chapter coherence
- allow chapter plan repair before full generation

### Priority 3: Strengthen summary evidence binding

Add evidence references for:

- TLDR
- points
- actions

Not just quotes.

### Priority 4: Make fallback visible and costly

Do not silently treat "book generated with 4 deterministic fallback chapters" as success.

At minimum:

- surface fallback counts in the response
- mark the run degraded
- optionally fail or retry

### Priority 5: Split generation core into real modules

Only after the above.

Suggested split:

- `transcriptParsing.ts`
- `chapterPlanning.ts`
- `bookletDrafting.ts`
- `bookletMerge.ts`
- `bookletQuality.ts`
- `epubRenderer.ts`

That would make iteration much faster.

## 11. The Fastest Things to Change First

If you want short-cycle improvements, start here:

1. log and inspect `chapterPlan` on every run
2. log whether the run used full-book LLM or chapter patch mode
3. log deterministic fallback chapter count
4. block or retry when fallback count is high
5. add evidence IDs to TLDR and points before merge

These are small enough to be realistic and high enough leverage to matter.

## 12. The One-Sentence Diagnosis

The current system is best described as:

"a solid deterministic transcript-to-booklet scaffold with useful LLM enrichment, but the strongest quality bottlenecks are chapter planning, uneven evidence binding, and silent fallback acceptance, not EPUB packaging."
