# viet-chatter

WhatsApp bot that autonomously replies to a filtered subset of 1:1 chats, with human-like timing, per-person memory, adaptive tone, and dynamic language.

## Status

v1 shipped (2026-05-16). Single Node project, YAML config + web UI, OpenCode AI backend, Telegram multi-recipient escalation. `npm run health` ok, `npm run test:e2e` ok, smoke test #61 (base reply) manually verified. Live smoke tests #62 / #63 / #64 still to be executed.

## Quick start

```bash
npm install                # once, from the root
npm run db:migrate         # creates viet-chatter.db with the initial schema
npm run dev                # starts bot + web UI in parallel
```

On the first run the bot prints a QR code: scan it from `WhatsApp > Settings > Linked devices`. Configuration UI on `http://localhost:3000`.

Other useful commands:

- `npm start` - bot only (the UI is dev-only).
- `npm run health` - JSON self-check: DB counters, pending escalations, embedding model present.
- `npm run test:unit` - deterministic unit tests for scheduler, DB repo, schemas, media policy, escalation formatting, retry, and dashboard helpers.
- `npm run test:e2e` - existing mocked WhatsApp smoke harness, not required for normal code-level verification.
- `npm test` - unit suite.
- `npm run format` / `format:check` - Prettier.

## Configuration

Runtime single source of truth: `config/user-config.yaml` (gitignored). Hot-reload via chokidar on save (except for `RESTART REQUIRED` fields like `dbPath`, `aiModel`, `sessionDir`, `embeddingModel`, `logFile`, `logRotation`).

Edited by hand or via the web UI (`npm run dev` -> `http://localhost:3000`, 8 tabs with per-field tooltips). Defaults in `config/defaults.ts`.

Declarative filter (no more TS predicates): `filter` block in YAML with `allowedPrefixes`, `blockedNumbers`, `savedContactsOnly`, `unreadOnly`.

## ENV vars

Loaded automatically from `.env` (gitignored) via `dotenv/config`:

- `TELEGRAM_BOT_TOKEN` - Telegram bot token for escalation. See `docs/dev/15-runbook.md`.
- `TELEGRAM_USER_CHAT_ID` - destination Telegram chat id. Supports comma-separated (`123,456,789`) for broadcast.
- `LOG_LEVEL` - boot override of the log level (the YAML/UI can then override at runtime).

`.env.example` versioned as a template.

## Documentation

- [User documentation](docs/user/README.md) - non-technical, what it does and how it is used.
- [Technical documentation](docs/dev/README.md) - architecture, DB schema, scheduler, prompts, edge cases.

## Stack

TypeScript, `whatsapp-web.js@1.34.7`, SQLite + `sqlite-vec`, Drizzle ORM, `@xenova/transformers` (local embedding), OpenCode CLI (default model `opencode:github-copilot/gpt-5-mini`), pino + pino-roll for logging, Next.js 15 + Tailwind + shadcn/ui for the web UI.

## License

Not specified.
