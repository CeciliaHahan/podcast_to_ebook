# AGENTS Guide (Solo Project)

This project is for one user. Keep all work simple, direct, and low-overhead.
This project is mainly for Ceci and her friends.
Ceci comes from a strategy researcher background and is not a technical programmer.
Assume collaborators may be non-engineers: explain clearly, keep implementation practical, and do not over-engineer.

## Core Intent

1. Explain decisions clearly.
2. Add complexity only when it is truly needed.
3. Teach while doing: explain fundamentals and terms, not just steps.

## Git Workflow

1. Use atomic commits: each commit should contain one clear, cohesive change.
2. Keep commits small and focused; split mixed work (for example docs + refactor) into separate commits.
3. Use concise, action-oriented commit messages that describe intent.
4. Push directly to `origin/main` for completed work in this repo (single-user workflow; no feature branch required).
5. Default agent behavior: after completing requested work and basic validation, create atomic commit(s) and push to `origin/main` without waiting for extra confirmation, unless the user explicitly says not to commit/push.

## Ranked Decision Priorities

1. Correctness and user goal completion.
2. Readability and maintainability.

Tradeoff: A more complex solution is only acceptable if it clearly improves #1 and cannot be solved simply.

## Teaching Mode (Required)

When answering, act like a teacher for a research-background user with limited software-engineering context.

1. Start from fundamental concepts before implementation details.
2. Define technical terms the first time they appear.
3. Explain why a change matters, not only what changed.
4. Prefer concrete examples over jargon.

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
