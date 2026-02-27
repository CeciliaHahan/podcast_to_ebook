# Founder Decisions for V1

Date: 2026-02-26
Status: Approved

Approval record:

- 2026-02-26: Founder approved #2 (book-like template baseline using `templateA-v0-book`).
- 2026-02-26: Founder approved #1, #3, #4.

This document covers the 4 blocking decisions required before sprint start.

## 1) Compliance Policy Text (Blocking)

Recommended default:

- Usage boundary:
  - "Generated outputs are for personal use or explicitly authorized use only."
- Copyright notice (shown before generate and before download):
  - "For personal use only. No commercial usage is allowed here."

Reason:
- Clear user responsibility language with low ambiguity.
- Works across transcript/audio/rss/link sources.

## 2) V1 Output Template Style (Blocking)

Recommended default:

- Default style: `Book-like` (reads like a short practical book, not just bullet notes).
- Initial template asset:
  - `assets/templates/ep36_templateA_v0.epub`
- Runtime `template_id` default:
  - `templateA-v0-book`
- Optional style switch in V1 UI: not included (single default only).

Reason:
- Matches your target reading experience immediately.
- Gives the team a concrete baseline for formatting and chapter structure.
- Prompt/system tuning can iterate later without changing the product promise.

## 3) Input Limits Policy (Blocking)

Recommended default:

- Transcript:
  - max 120,000 characters per job
- Audio upload:
  - max file size 300 MB
  - max duration 180 minutes
  - supported types: `mp3`, `m4a`, `wav`
- Concurrency:
  - max 2 active jobs per user
- Daily quota (beta):
  - max 10 jobs per user per day

Reason:
- Strong enough for long-form podcasts while protecting cost and queue latency.

## 4) Account Model (Blocking)

Recommended default:

- V1 private beta: `Email magic link`
- No social OAuth in first sprint.
- Invite list control is handled server-side (allowlist emails).

Reason:
- Faster to ship than full OAuth integration.
- Lower friction than invite codes.
- Good enough control for private beta rollout.

## Execution Note

Approved values should be copied into:

- API constraints and validation rules
- Extension UI copy
- Backend policy configs
