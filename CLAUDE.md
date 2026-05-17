# Project-local instructions for viet-chatter

These rules **override** anything in the user-global CLAUDE.md when working on
this repo. They are the canonical project context for any AI agent (Claude
Code, OpenCode, etc.) operating against `~/Downloads/viet-chatter/`.

## 1. No Obsidian vault writes for this project

The global protocol persists project state to the Obsidian vault under
`~/OneDrive/Documenti/Vault/01_Projects/` and to `05_Daily/`. **Do not do that
for viet-chatter.** This project does not use the vault as its source of
truth.

Concretely, when working in this repo:

- Do **not** read `01_Projects/viet-chatter.md`, `01_Projects/Board.md`, or
  `05_Daily/<date>.md` to recover project context.
- Do **not** write to any of the above. No `## Log` appends, no daily note
  entries, no Board.md card moves, no decision files under `02_Areas/`.
- The vault "persistence gate" from the global instructions is **disabled
  for this project**. Completing a task here does not require a vault write
  step.
- The lockbox `02_Areas/_secrets/` still applies for shared credentials that
  span multiple projects, but project-specific secrets belong in this repo's
  `.env` (gitignored).

## 2. Project documentation lives in this repo

Single source of truth = `~/Downloads/viet-chatter/`. Specifically:

- **Status, log, decisions, links** → [`docs/status/PROJECT.md`](docs/status/PROJECT.md).
  Append `## Log` entries here when work produces a decision, an operational
  fact, a blocker, or a state change. Same trigger conditions as the global
  rule, just a different destination.
- **Kanban board** → [`docs/status/board.md`](docs/status/board.md) (Obsidian
  Kanban-compatible markdown; rendered fine in plain editors too).
- **Design & spec** → `docs/dev/`. The v1 design spec is
  `docs/dev/specs/2026-05-10-viet-chatter-design.md`.
- **User-facing docs** → `docs/user/`.
- **Runbooks** → `docs/dev/15-runbook.md` and adjacent files.
- **Architectural decisions** with cross-cutting impact go inline in
  `docs/status/PROJECT.md` under `## Decisions`, not as separate ADR files
  in the vault.

## 3. Migration notes (2026-05-17)

The vault previously held `01_Projects/viet-chatter.md` and the project's
activity bullets in `05_Daily/2026-05-17.md`, plus Done-lane cards in
`01_Projects/Board.md`. All that content has been moved into this repo and
removed from the vault as of 2026-05-17. Don't try to re-create those files.
If the global protocol says "read the project page", read
`docs/status/PROJECT.md` here instead.
