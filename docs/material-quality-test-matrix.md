# Material Quality Test Matrix

Date: 2026-03-10  
Scope: evaluate the new "material-first" prompt direction against the 5 core local transcript samples

## 1. Why This Doc Exists

We are no longer optimizing mainly for "book-like prose."

The current target is:

- a readable material
- good enough that the reader usually does not need to listen to the whole podcast
- easy to store and refer back to later
- able to preserve key viewpoints, supporting reasons, speaker attribution, and memorable quotes

This matrix defines how to test that target consistently across the 5 main transcript samples.

## 2. Core Evaluation Dimensions

Use the same dimensions for every sample.

### `Coverage`

Question:

- does the material cover the major parts of the source, including the later sections, without obvious drop-off

### `Structure`

Question:

- does the output feel like a clear material with usable sections, rather than a blob of summary prose

### `Speaker Fidelity`

Question:

- are the key speakers preserved correctly when it matters
- does the text avoid flattening multi-person discussion into one anonymous voice

### `Evidence Retention`

Question:

- are important arguments supported by reasons, examples, or contrasting views
- does the material keep enough of the "why" instead of only the final conclusion

### `Quote Quality`

Question:

- are the preserved quotes genuinely useful
- do they sound like the source rather than generic AI paraphrase

### `Material Utility`

Question:

- after reading this, could someone roughly retell the episode without going back to the full audio

## 3. Simple Rating Scale

Use a 1-5 scale for each dimension.

| Score | Meaning |
| --- | --- |
| 1 | poor; major failure |
| 2 | weak; visible issues |
| 3 | usable; mixed quality |
| 4 | strong; only minor issues |
| 5 | excellent; clearly meets target |

## 4. Global Failure Signals

If any of these happen, note them explicitly even if the average score looks fine:

- later parts of the transcript disappear
- several speakers get merged into one voice
- quotes feel invented, generic, or detached from the transcript
- the material becomes essay-like but loses evidence
- the material becomes too compressed to support retelling
- noisy transcript text leaks into the final output without useful cleanup

## 5. Test Matrix

| Sample | Source Trait | Main Risk | What Good Looks Like | Priority Dimensions |
| --- | --- | --- | --- | --- |
| `85 金钱心理学` | long | later sections get dropped; section balance collapses | the material stays coherent across the full episode and does not over-focus on the opening | `Coverage`, `Structure`, `Material Utility` |
| `Vol.258 伊朗` | high density | argument chain gets flattened into vague summary | the material keeps the logic, conditions, and main reasons behind the conclusions | `Evidence Retention`, `Coverage`, `Material Utility` |
| `071 Vibe Shift` | many speaker shifts | distinctive voices get flattened; great lines disappear | the material preserves angle changes, representative quotes, and at least some conversational spark | `Speaker Fidelity`, `Quote Quality`, `Evidence Retention` |
| `vol.521 东亚小孩` | noisy | messy transcript contaminates the output; cleanup fails | the material reads cleanly while still keeping the useful substance and memorable expressions | `Structure`, `Quote Quality`, `Material Utility` |
| `冷水烫 AI 焦虑` | short | over-expansion; output becomes padded | the material stays concise, complete, and proportionate to the source | `Structure`, `Coverage`, `Material Utility` |

## 6. Sample-by-Sample Test Notes

### `85｜金钱心理学｜那些你没花掉的钱，正在扩大你的人生半径`

What to inspect:

- whether later sections of the transcript still appear in the output
- whether the section split feels natural instead of arbitrary
- whether the material resists becoming repetitive on long input

Questions to ask:

- after reading it, do I still know the full arc of the episode
- is the output balanced, or does it spend too much space on the opening

### `Vol.258｜斩首行动之后：美国在划界，伊朗谁接盘？｜嘉宾：施展`

What to inspect:

- whether the output preserves not just conclusions, but also the reasoning chain
- whether conditional arguments remain conditional instead of becoming absolute statements
- whether dense geopolitical logic stays readable

Questions to ask:

- can I explain why the guest thinks this, not just what he thinks
- are there enough supporting reasons to retell the episode faithfully

### `071｜Vibe Shift 三部曲：保守女性气质的回潮`

What to inspect:

- whether the output keeps who is saying what when the discussion shifts
- whether it preserves memorable expressions and lively moments
- whether it captures disagreement, layering, and tone changes

Questions to ask:

- do the sections still feel like a conversation rather than a single anonymous summary
- are the best lines kept, or did the material flatten them away

### `vol.521 对谈嘻哈：三句话，让东亚小孩不再内耗！`

What to inspect:

- whether noisy formatting gets cleaned up without deleting the useful content
- whether casual or messy language can still yield a useful material
- whether the final output stays grounded instead of becoming generic self-help language

Questions to ask:

- does the material feel cleaner than the source without becoming bland
- are the memorable expressions preserved where they help

### `冷水烫｜No.37：how to 度过AI时代的焦虑和FOMO`

What to inspect:

- whether the system keeps the output proportionate to a short source
- whether it avoids unnecessary expansion or repeated framing
- whether the material still feels complete

Questions to ask:

- does this read like a sharp brief, or like a padded essay
- could I send this to someone instead of the episode itself

## 7. Recommended Test Order

Use this order:

1. `冷水烫 AI 焦虑`
2. `Vol.258 伊朗`
3. `071 Vibe Shift`
4. `vol.521 东亚小孩`
5. `85 金钱心理学`

Why this order:

- start with the easiest sample to catch obvious prompt regression
- move next to dense reasoning
- then test speaker handling
- then test noisy cleanup
- finish with the longest sample once earlier issues are known

## 8. Recording Template

Copy this block once per sample during testing.

```md
## [Sample Name]

### Scores
- Coverage: /5
- Structure: /5
- Speaker Fidelity: /5
- Evidence Retention: /5
- Quote Quality: /5
- Material Utility: /5

### What Worked
- 

### What Broke
- 

### Notable Examples
- 

### Decision
- Keep as is
- Needs prompt adjustment
- Needs schema / pipeline adjustment
```

## 9. What We Are Testing Right Now

At this stage, the most important question is not "is this beautifully written."

The main question is:

- does the new prompt direction produce a materially better archive document for the 5 core sample types

If the answer is yes on most samples, then the next step is to decide whether:

- prompt changes are enough
- or the pipeline should also change, for example by reducing the role of `Outline` or enriching `Working Notes`

