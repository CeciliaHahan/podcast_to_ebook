# Simple Generation Plan

Snapshot date: 2026-03-06

This plan is for making the transcript-to-EPUB pipeline much simpler.

The guiding idea is:

- fewer hidden heuristics
- fewer fallback layers
- one clear intermediate format
- validation loops that make degradation visible

## 1. Proposed Simplified Flow

Target flow:

`transcript -> one generation run -> intermediate booklet JSON -> EPUB`

If the transcript is too long:

`transcript -> segment only for length -> one run per segment -> stitched intermediate booklet JSON -> EPUB`

That is the whole idea.

## 2. What We Should Remove or De-emphasize

These are the parts most likely making quality worse instead of better:

1. too many pre-LLM content heuristics that over-shape the book before the model sees it
2. multiple hidden fallback layers that quietly turn a weak run into a fake success
3. over-optimized deterministic section generation that creates generic filler
4. merge logic that clips or flattens useful model output before we inspect it
5. evaluation loops that depend on old method labels instead of real pipeline variants

## 3. The New Core Contract

Introduce one intermediate format that is the real product boundary.

Suggested shape:

```json
{
  "meta": {
    "title": "string",
    "language": "zh-CN",
    "source_type": "transcript",
    "source_ref": "string",
    "segmented": false
  },
  "summary": {
    "one_line_conclusion": "string",
    "tldr": ["string"]
  },
  "chapters": [
    {
      "title": "string",
      "range": "00:00 - 12:34",
      "summary": ["string"],
      "quotes": [
        {
          "speaker": "Speaker 1",
          "timestamp": "12:34",
          "text": "string"
        }
      ],
      "insights": ["string"],
      "actions": ["string"]
    }
  ],
  "terms": [
    {
      "term": "string",
      "definition": "string"
    }
  ]
}
```

Important rule:

- EPUB should render from this format only
- it should not need to know whether the book came from one full run or stitched segments

## 4. Simplified Runtime Modes

### Mode 1: Full-run mode

Use when transcript length is within model limits.

Flow:

1. minimal cleanup
2. one prompt
3. one intermediate JSON object
4. schema validation
5. EPUB render

### Mode 2: Segmented mode

Use only when transcript length forces it.

Flow:

1. minimal cleanup
2. deterministic segmentation for token budget only
3. one prompt per segment into segment JSON
4. stitch segment JSON into full booklet JSON
5. schema validation
6. EPUB render

Important:

- segmentation should be a token-budget tool, not a preemptive content-shaping tool
- the stitch step should be explicit and inspectable

## 5. What The Current System Is Doing That We Likely Do Not Want

1. it creates a fairly opinionated deterministic base booklet before the main LLM output exists
2. it generates titles, points, explanations, actions, terms, and appendix content heuristically
3. it then asks the LLM to improve that shape
4. it falls back quietly if the LLM is weak
5. it still renders success even when quality is clearly degraded

This is why simplification matters:

- too much "help" is happening before we can tell whether it is helping

## 6. Validation Loops

We should stop evaluating this as "did an EPUB come out?"

We should evaluate it as:

- did the run complete
- what path did it take
- how degraded was it
- what did the content actually look like

### Loop A: Smoke loop

Purpose:

- catch basic breakage fast

Checks:

1. request succeeds
2. inline EPUB artifact exists
3. EPUB unzips
4. chapter files exist
5. nav and OPF exist

### Loop B: Structure loop

Purpose:

- verify the intermediate JSON is sane

Checks:

1. schema valid
2. chapter count in expected range
3. no empty chapter titles
4. quotes have timestamps where available
5. no unresolved placeholders

### Loop C: Quality regression loop

Purpose:

- compare current vs simplified variants on the same transcript set

Checks:

1. full-book path used or skipped
2. parse failures
3. deterministic fallback count
4. quality issue count
5. weird title count
6. placeholder count
7. boilerplate action count
8. quote timestamp count

### Loop D: Human review loop

Purpose:

- make sure we are not over-trusting metrics

Questions:

1. are chapter boundaries sensible
2. do titles sound human and specific
3. are quotes actually informative
4. do actions come from the episode instead of template filler
5. does the book feel like one coherent artifact

## 7. New Evaluation Script

Use:

- [`scripts/eval-pipeline-variants.mjs`](../scripts/eval-pipeline-variants.mjs)

What it does:

1. calls named pipeline variants against one or more transcript samples
2. downloads the returned EPUB
3. unzips the EPUB
4. extracts chapter text
5. computes comparison metrics
6. writes JSON and HTML reports

Example:

```bash
node scripts/eval-pipeline-variants.mjs \
  --base-url http://localhost:8080 \
  --transcript tasks/transcript-samples/mini-roundtable.txt \
  --variant 'current|/v1/epub/from-transcript|current' \
  --variant 'simple|/v1/epub/from-transcript|simple-v1'
```

Today, the runtime ignores `metadata.pipeline_variant`, so both labels will likely behave the same until we implement the simplified variant.

That is still useful:

- it gives us the exact harness we need before code changes

## 8. Suggested Baseline Transcript Set

Use at least these buckets:

1. short clean roundtable
2. long noisy transcript
3. interview-style transcript
4. single-speaker or essay-style transcript

Current local candidates:

- [`tasks/transcript-samples/mini-roundtable.txt`](../tasks/transcript-samples/mini-roundtable.txt)
- [`data/transcripts/圆桌派 第7季 - 窦文涛:许子东:马家辉:陈鲁豫.txt`](../data/transcripts/%E5%9C%86%E6%A1%8C%E6%B4%BE%20%E7%AC%AC7%E5%AD%A3%20-%20%E7%AA%A6%E6%96%87%E6%B6%9B:%E8%AE%B8%E5%AD%90%E4%B8%9C:%E9%A9%AC%E5%AE%B6%E8%BE%89:%E9%99%88%E9%B2%81%E8%B1%AB.txt)

## 9. Implementation Order

1. Land the evaluation loop first
2. Add one explicit simplified variant flag
3. Build the new intermediate JSON path without removing the old one yet
4. Run current vs simple on the same transcript set
5. Review HTML and EPUB outputs
6. Only then delete old heuristic layers

## 10. The Actual Goal

The goal is not "more optimization."

The goal is:

- fewer hidden transforms
- one understandable content boundary
- visible degradation
- easy before/after comparisons

That is what will let us make the system better without running in the dark.
