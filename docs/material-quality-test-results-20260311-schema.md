# Material Quality Test Results

Date: 2026-03-11  
Branch: `test/20260310`  
Schema revision: `Working Notes -> gist / claims / evidence / sparks` in [local-pipeline.js](/Users/cecilia/Desktop/workspace/2602_Podcasts_to_ebooks/extension/sidepanel/local-pipeline.js)  
Outputs:

- JSON: `/tmp/pte-material-test-20260311-schema`
- EPUB: `/tmp/pte-material-test-20260311-schema-epubs`

## 1. What Changed in This Round

This round did not mainly change EPUB rendering.

It changed the `Working Notes` layer so the middle representation is less like a vague summary bucket and more like a usable material memory layer:

- `gist`
- `claims`
- `evidence`
- `sparks`

That matters because later steps still do not go back to the raw transcript. They only use `Working Notes`.

## 2. Summary Judgment

Overall conclusion:

- `this schema change is worth keeping`
- it improves the quality of `Working Notes` more clearly than it improves the final `Draft`
- the biggest gain is on `multi-speaker` and `noisy` transcripts
- the system now keeps more `who said what`, more `supporting reasons`, and more `memorable lines`
- but the draft layer still flattens some discussion into a stable explanatory voice

Practical conclusion:

- `Working Notes is now closer to the right abstraction`
- the next bottleneck is no longer “notes are too vague”
- the next bottleneck is “draft still compresses interaction too hard”

## 3. High-Level Differences vs the Previous Prompt-Only Round

### What improved clearly

- `Working Notes` sections are now much easier to inspect and trust
- speaker attribution survives more often in evidence lines
- useful quotes are separated from more memorable “spark” lines
- noisy transcripts keep more concrete texture instead of only abstract themes
- multi-speaker transcripts retain more source flavor before the draft stage

### What is still limited

- draft output still often reads like a clear analyst voice rather than a truly layered conversation
- speaker identity is preserved as `发言人1/2/3` or `Speaker 1/2/3/4`, not as meaningful named roles
- interaction structure is still only partially preserved
- long transcript generation still has occasional model-format instability

## 4. Per-Sample Results

## 冷水烫｜No.37：how to 度过AI时代的焦虑和FOMO

### Scores

- Coverage: 4/5
- Structure: 4/5
- Speaker Fidelity: 3/5
- Evidence Retention: 4/5
- Quote Quality: 4/5
- Material Utility: 4/5

### What Worked

- still proportionate to a short source
- notes now preserve clearer `claims + evidence + sparks`
- the draft remains concise and easy to retell

### What Broke

- speaker identity is still generic rather than role-rich
- still slightly more “explained summary” than “source-near material”

### Judgment

- still a strong sample
- schema change does not radically change this case, because it was already relatively easy

## Vol.258｜斩首行动之后：美国在划界，伊朗谁接盘？｜嘉宾：施展

### Scores

- Coverage: 4/5
- Structure: 4/5
- Speaker Fidelity: 3/5
- Evidence Retention: 5/5
- Quote Quality: 4/5
- Material Utility: 5/5

### What Worked

- argument chain remains the strongest in the batch
- `evidence` field gives the reasoning a clearer spine before draft generation
- final material is close to the target use case: read it and roughly retell the episode

### What Broke

- speaker texture is still secondary to argument clarity
- draft is strong on logic, weaker on live conversational feel

### Judgment

- still one of the best samples
- confirms that the new notes schema does not hurt dense argument-led material

## 071｜Vibe Shift 三部曲：保守女性气质的回潮

### Scores

- Coverage: 4/5
- Structure: 4/5
- Speaker Fidelity: 3/5
- Evidence Retention: 4/5
- Quote Quality: 5/5
- Material Utility: 4/5

### What Worked

- `Working Notes` is materially better than before on this sample
- key voices survive more clearly inside `evidence` and `sparks`
- the sharp lines are easier to keep
- the notes layer now feels like it actually remembers the conversation

### What Broke

- the final draft still compresses the roundtable into a neat explanatory voice
- it preserves more quotes, but still not enough of the “who responds to whom” structure
- the conversation is more alive than before, but not yet fully layered

### Judgment

- clear improvement over the prompt-only round
- this is the strongest evidence that `Working Notes` was the right layer to upgrade
- it also shows the next limitation has moved downstream into `Draft`

## vol.521 对谈嘻哈：三句话，让东亚小孩不再内耗！

### Scores

- Coverage: 4/5
- Structure: 4/5
- Speaker Fidelity: 3/5
- Evidence Retention: 4/5
- Quote Quality: 4/5
- Material Utility: 4/5

### What Worked

- this sample improved more than I expected
- noisy oral content now keeps more concrete texture
- the material preserves more of the guest’s force, not just the abstract theme
- memorable lines like “我退一步就是悬崖了” and the dense energy of the speaker are easier to retain

### What Broke

- speaker labels are still generic
- some relationship texture and scene-level details are still smoothed out
- title-level framing around “三句话” is still weaker than the raw episode promise

### Judgment

- clear gain over the previous round
- the schema change helped this sample more than prompt-only changes did

## 85｜金钱心理学｜那些你没花掉的钱，正在扩大你的人生半径

### Scores

- Coverage: 4/5
- Structure: 4/5
- Speaker Fidelity: 3/5
- Evidence Retention: 4/5
- Quote Quality: 4/5
- Material Utility: 4/5

### What Worked

- long-form structure stayed coherent across the episode
- later sections were still present
- richer notes did not break long-input handling

### What Broke

- one working-notes call failed once because the model returned non-JSON output and needed retry
- speaker distinction remains weak
- still somewhat aggressively compressed for archival confidence

### Judgment

- solid result
- content quality is acceptable, but long-input format stability is still a practical risk

## 5. Cross-Sample Pattern

This run suggests a sharper product picture:

### `Working Notes` is now doing more of the right job

It now functions more clearly as:

- a compression layer
- a memory layer
- an evidence-preserving layer

instead of only:

- a summary layer

### The main bottleneck has moved

Before this schema change, the biggest problem was:

- too much source structure disappeared inside `Working Notes`

After this schema change, the biggest problem is more like:

- `Draft` still turns layered discussion into stable explanation too aggressively

That is progress.

It means the system is no longer failing at the same place.

## 6. Main Decision

### Keep

1. Keep the new `Working Notes` schema.
2. Keep the material-first prompt direction.
3. Keep using `evidence` and `sparks` as separate concepts.

### Next

1. Test whether `Draft` can use the richer notes more faithfully.
2. Re-evaluate whether independent `Outline` is still necessary.
3. Do not prioritize EPUB styling yet.

## 7. Final Call

If the question is:

- `Was upgrading Working Notes the right move?`

Answer:

- `Yes. Clearly yes.`

If the question is:

- `Did it fully solve the product quality problem?`

Answer:

- `No.`

What it did solve:

- the notes layer is now much more useful and trustworthy

What it did not solve:

- the final material still loses some interaction structure on the way from notes to draft
