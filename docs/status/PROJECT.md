---
created: 2026-05-16
updated: 2026-05-17
status: active
deadline:
---

# viet-chatter

> **No vault sync.** This project does not persist state to the Obsidian
> vault. All status, log, decisions, blockers, and links live in this file.
> See [`../../CLAUDE.md`](../../CLAUDE.md) for the project-local protocol.

## Status

Bot WhatsApp autonomo per chat 1:1 filtrate. Documentazione precede
implementazione: spec approvato 2026-05-10. Stack: TypeScript +
whatsapp-web.js + SQLite/sqlite-vec + Drizzle + xenova embeddings + OpenCode
AI. Repo locale `~/Downloads/viet-chatter/`.

Aggiunta 2026-05-16: feature "Escalation a umano" (notifica out-of-band
Telegram / WhatsApp self-chat quando AI dichiara incertezza). Doc completa
pre-implementazione. Compatible con design fully-autonomous, non sostituisce
approval flow (out-of-scope).

## Goal

v1 codice working con: filtro per chat, scheduler human-like, KB 3-tier per
persona, single-call AI turn con extracted_facts + tone + escalation, manual
jobs (auguri / revive / re-engage), boot reconciler idempotente, hot-reload
config, escalation notifier multi-canale.

## Log

- 2026-05-17 16:00 - Project docs migrated out of the Obsidian vault into this
  repo. Created `CLAUDE.md` at repo root + this file. Removed
  `01_Projects/viet-chatter.md`, viet-chatter activity entries from
  `05_Daily/2026-05-17.md`, and viet-chatter cards from `01_Projects/Board.md`
  Done lane. Vault Board.md and daily file kept (for other projects).
- 2026-05-17 15:50 - E2E scenarios now self-clean. Root cause of accumulated
  `393999XXX@c.us` chats in prod DB: `tsx src/scripts/test-e2e.ts` opens
  `config.dbPath` (prod), pre-deletes by chatId, but
  `bootstrapScenario.cleanup` never post-deleted — so every run leaked one
  fake chat plus any ad-hoc IDs scenarios spawn (e.g. `failure-tracker-alert`
  creates 3 from a Date.now seed). Fix: extracted `CHAT_SCOPED_TABLES` map
  `[table, column]` (handles `facts.person_id` vs everyone else's
  `chat_id`). Bootstrap pre-deletes via that map; cleanup post-deletes both
  the scenario's chatId AND any row matching `LIKE '393999%@c.us'` to catch
  ad-hoc IDs. Skipped when `BOT_E2E_DB_PATH` is set (e2e/run.ts already uses
  isolated per-scenario files). `npm run test:e2e -- all` end state = 0 rows
  across chat_state/processed_messages/escalations/manual_jobs/turn_log/
  facts/person_profile. `npm run test:unit` 48/48 green.
- 2026-05-17 15:30 - Cleanup pass post-E2E pollution + UX refactor. (a) DB
  data nuke: bot was running locally with file lock on `viet-chatter.db`;
  instead of file delete, truncated all user-data tables via separate handle
  with sqlite-vec loaded (275 rows wiped across agent_commands, turn_log,
  manual_jobs, escalations, facts, facts_vec, chat_state, person_profile,
  processed_messages). Schema + drizzle migrations intatti. Real chat data
  also wiped (acceptable per user). (b) Removed "pending escalation" concept
  from dashboard + agent context: `AgentContext.pendingEscalations` dropped
  (with its query + interface), prompt template + role + examples updated.
  "Awaiting reply" stat card removed from `/dashboard`. "Pending esc" column
  removed from `/dashboard` + `/dashboard/chats`. Bot-side escalation
  pipeline intact: telegram delivery + `pendingEscalationsForRetry` +
  `markEscalationsResolved` on reply all operational; only UI/agent exposure
  removed. `dismissEscalation` action retained in catalog but documented as
  "lookup via SQL first". (c) Column rename: `/dashboard` +
  `/dashboard/chats` now show "Contact | State | Last msg | 24h". New helper
  `web/lib/chat-label.ts` derives label from `display_name` OR JID
  (strip `@c.us`, prefix `+`, fallback for `@lid`). (d) Scroll fix: reverted
  h-dvh flex chain; layout now `min-h-dvh` (body scrolls), `AgentChat`
  removed inner scroll, form `position: fixed bottom-0 left-0 right-0 z-30`
  with backdrop-blur, messages area `space-y-6 pb-24` for clearance. Single
  scrollbar on body edge, form always visible.
- 2026-05-17 14:40 - Expanded mock E2E harness to 10 passing scenarios. Added
  date_anchored fire, reactive retry backoff, reactive retry recovery, and
  failure-tracker alert coverage. Fixed first-retry delay to 5m ±30s.
- 2026-05-17 14:30 - Dashboard `/dashboard/agent` upgrades: (a) bottom input
  pinned to viewport via flex chain. (b) ActionCard shows "running…" spinner
  while `executeOne` is in flight (`pending: true` flag in `results[id]` set
  before fetch, overwritten on return). (c) Hybrid architecture: new
  `runReadOnlySql` action (read-only, auto-exec). Handler opens dedicated
  readonly SQLite connection (path from `sqlite.name`), `stmt.reader` check
  rejects UPDATE/INSERT/DELETE, busy_timeout 2s, 200-row cap.
  `AgentContext.schema` added: dump of `sqlite_master` + `PRAGMA table_info`
  for each non-virtual table. `generateAgentTurn` accepts `history` param,
  prompt template has `{{HISTORY}}` placeholder with last N=10 turns (prompt
  + thinking + actions + results truncated to 800 chars). Files:
  `src/agent/{types,context,turn}.ts`,
  `src/agent/actions/run-read-only-sql.ts` (new),
  `src/agent/actions/index.ts`,
  `prompts/agent/{01_actions_catalog,02_output_schema,99_context_template}.txt`,
  `web/lib/agent-api.ts` (new),
  `web/app/api/dashboard/agent/route.ts`,
  `web/app/dashboard/{layout,agent/page}.tsx`,
  `web/components/dashboard/AgentChat.tsx`.
- 2026-05-17 14:00 - Added web-side unit coverage. Covered config merge,
  config-path discovery, and agent route request schemas without browser
  tests. Suite now 47 passing tests.
- 2026-05-17 13:50 - Expanded unit suite to 40 tests. Covered filter,
  notifier, failure tracker, media escalation, manual-job action, state
  machine, web config schema. Fixed test-only config override to refresh
  live predicate.
- 2026-05-17 13:40 - Added unit test harness for core bot logic. Fixed
  ticker manual-cancel path. Real E2E left out-of-scope.
- 2026-05-17 13:30 - Fix 2 bug dashboard `/dashboard/agent`. (1) Read-only
  action result never rendered: `useEffect` auto-exec deps `[history.length]`
  didn't re-fire when API populated `actions` (length unchanged). Changed to
  `[lastActions]` (ref of last turn's actions array) — fires only on API
  response, not on result writes → no double-dispatch on race between
  multiple read-only actions. (2) Nested scroll: chat fixed
  `h-[calc(100vh-200px)]` + `<main>` no height → body + chat both scrolled.
  Refactored to flex chain bound by `min-h-dvh`.
- 2026-05-16 12:30 - Added folder `docs/status/`: board.md kanban (4
  columns, 65 granular tasks). Estimated v1 implementation: 10-12 hours
  wall-clock with max parallelization, realistic 15-20 hours.
- 2026-05-16 10:15 - Added human-escalation feature: new doc
  `dev/18-escalation.md` + `utente/12-quando-ti-chiama.md`, `TurnOutput`
  schema extended with `escalate_to_human`, new `escalations` table,
  `EscalationNotifier` module with WhatsApp self-chat + Telegram channels,
  `escalation.*` config, prompt `06_escalation_rules.txt`, runbook extended
  with Telegram setup + troubleshooting.

## Blockers

- (none)

## Decisions

- 2026-05-10 - Stack v1: SQLite + sqlite-vec, OpenCode with agent direct-reply
  deny-everything, local embedding bge-small-en-v1.5.
- 2026-05-16 - Escalation as v1 feature, not future. Compatible with
  fully-autonomous (AI decides autonomously when to escalate). Pure approval
  flow remains out-of-scope.
- 2026-05-16 - Escalation channels v1: WhatsApp self-chat + Telegram bot,
  configurable. Telegram via HTTPS POST to api.telegram.org, no library
  (Node 20 fetch). Token in `.env` (gitignored).
- 2026-05-17 - Drop "pending escalation" exposure from dashboard + agent
  context. Telegram notification is the user-facing artifact; the
  `pending` lifecycle still exists in the bot for retry logic
  (`pendingEscalationsForRetry`) and for auto-resolve on owner reply
  (`markEscalationsResolved`), but the dashboard and `AgentContext` no
  longer surface it.
- 2026-05-17 - Project docs leave the Obsidian vault. This repo is the sole
  source of truth for viet-chatter status, log, decisions, board. See
  `CLAUDE.md` at repo root.

## Links

- repo: `~/Downloads/viet-chatter/`
- user docs: `docs/user/`
- dev docs: `docs/dev/`
- design spec: `docs/dev/specs/2026-05-10-viet-chatter-design.md`
- escalation doc: `docs/dev/18-escalation.md`
- kanban: `docs/status/board.md`
- runbook: `docs/dev/15-runbook.md`
