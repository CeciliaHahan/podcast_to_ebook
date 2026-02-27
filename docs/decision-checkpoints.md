# Decision Checkpoints (Founder Involvement)

As of **February 26, 2026**, these are the moments where your decision is required.

## A. Must Decide Before Engineering Sprint (This Week)

1. Compliance policy text (blocking)
- Need your approval on exact user-facing wording:
  - rights/permission declaration
  - personal/authorized-use boundary
  - copyright notice shown before generation and before download
- Why you must decide: legal boundary cannot be guessed by engineering.

2. V1 output template style (blocking)
- Choose one default style for V1:
  - `Structured Notes` (more factual, dense)
  - `Readable Book` (more narrative, smoother)
- Why you must decide: this changes prompt strategy and quality rubric.

3. Input limits policy (blocking)
- Confirm limits:
  - max transcript length
  - max audio size/duration
  - max concurrent jobs per user
- Why you must decide: affects cost control and API validation.

4. Account model (blocking)
- Pick one for V1:
  - Invite code only
  - Email magic link
  - OAuth (Google)
- Why you must decide: influences auth implementation path and timeline.

## B. Decide During Core Build (Week 2-3)

1. Transcription vendor and fallback
- Choose primary STT vendor and backup vendor.
- Why you should decide: quality/cost trade-off is product-defining.

2. Retention policy
- Confirm data retention:
  - source file retention days
  - artifact retention days
  - job log retention days
- Why you should decide: impacts storage cost and privacy expectations.

3. Traceability display level
- Choose default UX:
  - basic source line
  - detailed provenance panel
- Why you should decide: user trust vs UI complexity trade-off.

## C. Decide After Private Beta Starts

1. Quality threshold for "success"
- Define pass/fail rubric:
  - chapter coherence
  - factual fidelity
  - readability score
- Why this timing: real user samples are needed to set realistic thresholds.

2. Pricing and quota strategy
- Decide:
  - free tier limits
  - paid plan triggers
  - overage behavior
- Why this timing: should be based on measured cost per successful job.

3. Platform-link expansion policy
- Decide whether to broaden supported platforms in V1.x.
- Why this timing: highest legal and parser-maintenance risk.

## Recommended Decision Rhythm

- Weekly 30-minute product decision review.
- Engineering prepares 1-page options before each review.
- Your role: only approve/reject high-impact options, not implementation details.

## What You Do Not Need to Decide

- Internal queue/retry mechanics
- Database indexing and worker tuning
- Low-level extension state management

These can stay with engineering unless they affect cost, legal risk, or user promise.

