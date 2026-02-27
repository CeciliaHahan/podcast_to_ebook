# Job State Machine (V1)

Date: 2026-02-26

## Status Enum

- `queued`
- `processing`
- `succeeded`
- `failed`
- `canceled`

## Stage Enum (recommended)

- `queued`
- `input_validation`
- `ingestion`
- `transcription`
- `normalization`
- `chapter_structuring`
- `render_epub`
- `render_pdf`
- `render_md`
- `packaging`
- `completed`

## Allowed Transitions

1. `queued -> processing`
- Trigger: worker picks job from queue.

2. `processing -> succeeded`
- Trigger: all requested artifacts generated and stored successfully.

3. `processing -> failed`
- Trigger: non-recoverable error or retries exhausted.

4. `queued -> canceled`
- Trigger: user cancels before worker starts.

5. `processing -> canceled`
- Trigger: user/admin cancellation request and worker confirms graceful stop.

No transitions out of terminal states:

- `succeeded`
- `failed`
- `canceled`

## Stage Progression by Input Mode

1. Transcript
- `input_validation -> normalization -> chapter_structuring -> render_epub -> render_pdf -> render_md -> packaging -> completed`

2. Audio
- `input_validation -> ingestion -> transcription -> normalization -> chapter_structuring -> render_epub -> render_pdf -> render_md -> packaging -> completed`

3. RSS
- `input_validation -> ingestion -> (transcription optional) -> normalization -> chapter_structuring -> render_epub -> render_pdf -> render_md -> packaging -> completed`

4. Platform link
- `input_validation -> ingestion -> (transcription optional) -> normalization -> chapter_structuring -> render_epub -> render_pdf -> render_md -> packaging -> completed`

## Progress Mapping (UI-friendly)

- `queued`: 0-5%
- `input_validation`: 5-10%
- `ingestion`: 10-20%
- `transcription`: 20-45%
- `normalization`: 45-55%
- `chapter_structuring`: 55-70%
- `render_epub`: 70-80%
- `render_pdf`: 80-88%
- `render_md`: 88-94%
- `packaging`: 94-99%
- `completed`: 100%

## Retry Policy

- Retryable stages:
  - `ingestion`
  - `transcription`
  - `render_epub`
  - `render_pdf`
  - `render_md`
- Suggested retry strategy:
  - exponential backoff
  - max 3 retries per stage
- On last failure:
  - set `status = failed`
  - set `error_code` and `error_message`
  - append `job_events` record with error details

## Cancellation Semantics

- Cancel request records a `job_events` entry immediately.
- If current stage is safe-stop boundary, stop and mark `canceled`.
- If current stage is non-interruptible, finish current step then mark `canceled` before next stage.
- Partially generated artifacts must not be returned by `/jobs/{job_id}/artifacts`.

## Idempotency + Consistency Rules

- `POST /jobs/*` supports `idempotency_key` (per user unique).
- Repeated create with same key returns existing `job_id`.
- Status updates must be monotonic:
  - do not move terminal -> non-terminal.
- Artifact publish is atomic at job level:
  - only expose artifact list when all requested formats are ready.

## Eventing Contract

For each transition, write one `job_events` record:

- `stage`
- `message`
- optional `details` JSON

Minimum required events:

- accepted
- started
- stage start/end (major stages)
- retry notices
- succeeded/failed/canceled final event

