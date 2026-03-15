# Material Quality Test Results

Date: 2026-03-10  
Branch: `test/20260310`  
Prompt baseline: material-first prompt revision in [prompts.js](/Users/cecilia/Desktop/workspace/Podcasts_to_ebooks/extension/sidepanel/prompts.js)

## 1. Summary

I ran the 5 core transcript samples through the current 3-step pipeline with the revised prompts:

- `Transcript -> Working Notes -> Outline -> Draft`

Overall conclusion:

- `prompt-only changes already improved the output a lot`
- the outputs now read more like `materials` and less like generic booklet prose
- `Evidence Retention` and `Material Utility` improved on most samples
- but `Speaker Fidelity` is still unstable on multi-speaker or noisy transcripts
- and the system still depends too heavily on compressed `Working Notes`

Practical conclusion:

- `prompt-only is not enough`
- but it is strong enough to justify one more round of pipeline iteration instead of rolling back

## 2. High-Level Judgment

### What improved clearly

- section headings are more specific
- the outputs now organize around `what this part is about / main viewpoints / reasons / quotes`
- dense transcripts no longer collapse as quickly into vague prose summaries
- short transcripts are still reasonably concise

### What still breaks

- multi-person discussion still gets partially flattened into one explanatory voice
- quotes are better, but not always enough to preserve the best conversational energy
- some outputs still feel more like “explained notes” than “source-grounded materials”
- the draft layer still cannot recover anything that `Working Notes` failed to keep

## 3. Per-Sample Results

## 冷水烫｜No.37：how to 度过AI时代的焦虑和FOMO

### Scores

- Coverage: 4/5
- Structure: 4/5
- Speaker Fidelity: 3/5
- Evidence Retention: 4/5
- Quote Quality: 4/5
- Material Utility: 4/5

### What Worked

- the output stayed proportionate to a short source
- sectioning was clear and usable
- the material preserved the main logic: AI FOMO, AI limits, AI “soul” discussion, and coping strategy
- quotes were useful rather than decorative

### What Broke

- it still leans slightly toward “explained summary” rather than “source-near material”
- speaker identity is preserved only as `Speaker 1/2/3`, with limited differentiation of role

### Judgment

- strong result
- prompt change alone already helps a lot on short, concept-driven transcripts

## Vol.258｜斩首行动之后：美国在划界，伊朗谁接盘？｜嘉宾：施展

### Scores

- Coverage: 4/5
- Structure: 4/5
- Speaker Fidelity: 3/5
- Evidence Retention: 5/5
- Quote Quality: 4/5
- Material Utility: 5/5

### What Worked

- this was one of the best-performing samples
- the reasoning chain survived well: international law, great-power logic, strategic contraction, IRGC structure, and future order
- important conditional logic mostly remained conditional instead of becoming absolute
- this feels close to the target use case: someone could retell the episode after reading it

### What Broke

- still not very speaker-distinctive
- the material is strong on logic, but less strong on preserving live conversational texture

### Judgment

- best sample in the batch
- confirms that the new prompt direction works well for dense, argument-led material

## 071｜Vibe Shift 三部曲：保守女性气质的回潮

### Scores

- Coverage: 4/5
- Structure: 4/5
- Speaker Fidelity: 2/5
- Evidence Retention: 4/5
- Quote Quality: 4/5
- Material Utility: 4/5

### What Worked

- the main thematic arc was preserved well
- several sharp quotes survived
- sections were materially useful and readable
- the output did a better job than before at keeping some “spark”

### What Broke

- multi-speaker texture is still flattened
- the material reads more like a coherent analyst voice summarizing the discussion than an actual layered conversation
- some of the funniest or most alive exchanges are reduced into stable conclusions

### Judgment

- much better than generic booklet prose
- but this sample shows most clearly why `Speaker Fidelity` cannot be solved by prompt alone

## vol.521 对谈嘻哈：三句话，让东亚小孩不再内耗！

### Scores

- Coverage: 3/5
- Structure: 4/5
- Speaker Fidelity: 3/5
- Evidence Retention: 3/5
- Quote Quality: 3/5
- Material Utility: 4/5

### What Worked

- the noisy transcript was cleaned into something readable
- the material remained grounded instead of turning into fully generic self-help prose
- the big themes survived: real emotion, anti-internal-friction stance, energy management, and family background

### What Broke

- some of the raw liveliness got smoothed out
- because the source is noisy, the result also becomes more interpretive and less traceable
- quotes are helpful, but not enough to preserve the original messiness in a productive way

### Judgment

- usable result
- but this sample suggests the current pipeline still struggles when the source is noisy and highly oral

## 85｜金钱心理学｜那些你没花掉的钱，正在扩大你的人生半径

### Scores

- Coverage: 4/5
- Structure: 4/5
- Speaker Fidelity: 3/5
- Evidence Retention: 4/5
- Quote Quality: 4/5
- Material Utility: 4/5

### What Worked

- later parts of the episode were still present, which matters for long transcripts
- sections felt balanced and did not over-focus on the beginning
- the material preserved the core conceptual sequence well: behavior, money map, invisible wealth, compounding, and contentment

### What Broke

- still somewhat compressed for a long episode
- speaker distinction remains weak
- the output is useful, but still a little too “cleaned” for archival confidence

### Judgment

- solid result
- shows that the revised prompt can handle long material better than expected, but it still relies on aggressive compression

## 4. Cross-Sample Pattern

The 5-sample run suggests this pattern:

### Prompt changes alone are enough to improve

- structure
- readability
- evidence framing
- usefulness as a material

### Prompt changes alone are not enough to fix

- multi-speaker preservation
- source-grounded quote retention
- recoverability after `Working Notes` compression

## 5. Main Decision

### What should happen next

1. Keep the new prompt direction.
2. Do not roll back to the old booklet-style prompts.
3. Do not jump to full one-step generation yet.
4. Next iteration should focus on `Working Notes`, not EPUB styling.

### Why

Because the biggest remaining problem is not writing style anymore.

The biggest remaining problem is:

- the system still loses too much source structure before the draft stage

## 6. Recommended Next Product Move

Based on this test run, the most justified next step is:

`enrich Working Notes with more evidence and speaker preservation`

Not necessarily a heavy system.

Just enough to preserve:

- more reliable speaker attribution
- slightly richer evidence traces
- stronger excerpts for later drafting

## 7. Final Call

If the question is:

- `Did prompt-only changes work?`

Answer:

- `Yes, clearly.`

If the question is:

- `Are prompt-only changes sufficient?`

Answer:

- `No.`

The next gains are more likely to come from improving the information that survives `Working Notes`, and possibly reducing the role of `Outline` later.

