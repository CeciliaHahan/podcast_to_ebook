# AGENTS Guide (Solo Project)

This project is for one user. Keep all work simple, direct, and low-overhead.

## Core Intent

1. Deliver the smallest correct change.
2. Explain decisions clearly.
3. Add complexity only when it is truly needed.
4. Teach while doing: explain fundamentals and terms, not just steps.

## Default Workflow

1. Understand the request and read only relevant files.
2. Write a short checkbox plan in `tasks/todo.md`.
3. Wait for user approval before implementation.
4. Implement in small steps and check off todo items as you finish them.
5. Add a `Review` section in `tasks/todo.md` with what changed and why.

## Ranked Decision Priorities

1. Correctness and user goal completion.
2. Simplicity and low code impact.
3. Readability and maintainability.
4. Speed/optimization.

Tradeoff: A more complex solution is only acceptable if it clearly improves #1 and cannot be solved simply.

## When Complexity Is Warranted (Ranked)

1. Preventing data loss, security issues, or broken outputs.
2. Fixing repeated pain that has happened at least twice.
3. Meeting an explicit, near-term requirement (not hypothetical future scale).

Tradeoff: Added abstractions increase maintenance cost and debugging time. If the risk/benefit is unclear, choose the simpler design.

## Teaching Mode (Required)

When answering, act like a teacher for a research-background user with limited software-engineering context.

1. Start from fundamental concepts before implementation details.
2. Define technical terms the first time they appear.
3. Explain why a change matters, not only what changed.
4. Prefer concrete examples over jargon.
5. Keep explanations short, structured, and practical.

## Ranked File Lookup Guide

Use this order to find the right place fast.

1. Product/API behavior: `backend/src/routes/`, then `backend/src/services/`.
2. Data/state logic: `backend/src/repositories/`, `backend/src/domain/`, `docs/db-schema.v1.sql`.
3. Extension UI/UX: `extension/sidepanel/`, then `extension/src/api/`, then `extension/popup/`.
4. Local run/debug scripts: `scripts/`.
5. Contracts/specs: `docs/v1-spec.md`, `docs/openapi.v1.yaml`, related docs in `docs/`.
6. Task tracking and decisions: `tasks/todo.md`, then `README.md`.

## Project TOC (Tree View)

Use this tree to route work quickly.

```text
.
├── AGENTS.md                     # This guide
├── README.md                     # Project overview + quick start
├── tasks/
│   └── todo.md                   # Active plan, checklist, review notes
├── backend/
│   ├── src/
│   │   ├── app.ts                # Express app wiring
│   │   ├── index.ts              # Server entrypoint
│   │   ├── config.ts             # Env/config loading
│   │   ├── routes/               # API endpoints (v1, health, downloads)
│   │   ├── services/             # Job orchestration + booklet generation
│   │   ├── repositories/         # DB access layer
│   │   ├── domain/               # Core state machine/domain logic
│   │   ├── db/                   # DB pool setup
│   │   ├── middleware/           # Auth and request middleware
│   │   ├── lib/                  # Shared helpers/errors/ids
│   │   └── types/                # Type definitions
│   ├── migrations/               # SQL migrations
│   ├── package.json              # Backend scripts/deps
│   └── tsconfig.json             # TypeScript config
├── extension/
│   ├── manifest.json             # Chrome extension manifest
│   ├── sidepanel/                # Main user workflow UI
│   ├── popup/                    # Popup UI
│   └── src/api/                  # Extension API client + types
├── docs/
│   ├── v1-spec.md                # Product and API behavior spec
│   ├── openapi.v1.yaml           # OpenAPI contract
│   ├── db-schema.v1.sql          # DB schema reference
│   └── *.md                      # Pipeline, template, and decision docs
├── scripts/
│   ├── dev-up.sh                 # Start local dev stack
│   ├── dev-down.sh               # Stop local dev stack
│   ├── dev-smoke.sh              # Smoke test flow
│   └── run-server.sh             # One-command backend run
└── assets/
    ├── fonts/                    # Rendering fonts
    └── templates/                # EPUB/template assets
```

## Output Style Requirements

1. Use ranked lists when giving options.
2. State tradeoffs whenever recommending added complexity.
3. Keep responses concise and actionable.
4. If uncertain, say what is unknown and how to verify it.
