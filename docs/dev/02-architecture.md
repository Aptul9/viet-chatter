# Architecture

> Status: design; behavior implemented.

## Component diagram

```
                    ┌──────────────────────┐
                    │  whatsapp-web.js     │
                    │  (Chromium session)  │
                    └──────────┬───────────┘
                               │ events: message, message_create
                               ▼
        ┌────────────────────────────────────────────┐
        │          MessageDispatcher                  │
        │  (filtering, dedup, routing per direction) │
        └─────┬───────────────────┬───────────────────┘
              │ in (filtered)     │ out_manual
              ▼                   ▼
   ┌─────────────────┐   ┌──────────────────┐
   │ ChatStateMachine │   │ CancelScheduled  │
   │ IDLE→ACC→SCH→SND │   │  (revert to IDLE)│
   └────────┬────────┘   └──────────────────┘
            │ debounce close / fire_at hit
            ▼
   ┌─────────────────────────┐
   │   ReplyOrchestrator      │
   │  build context → AI call │
   │  parse JSON output       │
   │  send via WhatsApp       │
   │  persist facts + profile │
   └─────────────────────────┘

   ┌──────────────────┐    ┌──────────────────┐
   │ TickerLoop (10s) │───▶│  state poll      │
   │ scans chat_state │    │  fires due jobs  │
   └──────────────────┘    └──────────────────┘

   ┌──────────────────┐
   │ BootReconciler   │  on startup: catch up missed messages
   └──────────────────┘

    ┌──────────────────┐    ┌──────────────────┐
   │ ManualJobsCron   │───▶│  re_engage scan, │
   │ (daily, morning) │    │  date_anchored   │
   └──────────────────┘    └──────────────────┘

   ┌──────────────────────┐    ┌─────────────────────┐
   │ EscalationNotifier   │───▶│  WhatsApp self-chat │
   │  (out-of-band ping)  │───▶│  Telegram bot       │
   └──────────────────────┘    └─────────────────────┘
```

## Modules

| Module                   | Main file                                                    | Responsibility                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WhatsAppClient`         | `src/whatsapp/client.ts`                                     | Init `whatsapp-web.js`, QR management, events, `sendMessage`, `fetchMessages`.                                                                                            |
| `ConnectionStateMachine` | `src/whatsapp/connection.ts`                                 | States `BOOTING`/`CONNECTING`/`CONNECTED`/`DISCONNECTED`, retry with backoff.                                                                                             |
| `MessageDispatcher`      | `src/dispatcher/index.ts`                                    | Classify direction, dedup via `processed_messages`, apply filter, route.                                                                                                  |
| `FilterEngine`           | `src/dispatcher/filter.ts`                                   | Wrapper on user-defined `shouldReply` predicate, hot-reload via chokidar.                                                                                                 |
| `ChatStateMachine`       | `src/scheduler/state.ts`                                     | Transitions `IDLE` -> `ACCUMULATING` -> `SCHEDULED` -> `SENDING`, debounce/cap.                                                                                           |
| `LatencyEstimator`       | `src/scheduler/latency.ts`                                   | Rolling avg latency, night-window exclusion, jitter.                                                                                                                      |
| `TickerLoop`             | `src/scheduler/ticker.ts`                                    | Internal 10s cron, scans `chat_state`, processes due transitions.                                                                                                         |
| `ReplyOrchestrator`      | `src/orchestrator/index.ts`                                  | Reply pipeline: fetch history -> build context -> AI -> parse -> send -> persist.                                                                                         |
| `InflightRegistry`       | `src/orchestrator/inflight.ts`                               | `Map<chat_id, AbortController>` for cooperative cancellation.                                                                                                             |
| `KBStore`                | `src/kb/store.ts`                                            | CRUD `facts`, retrieval per tier, supersede.                                                                                                                              |
| `VecStore`               | `src/kb/vec.ts`                                              | Abstract interface + impl `SqliteVecStore`.                                                                                                                               |
| `EmbeddingService`       | `src/kb/embedding.ts`                                        | `@xenova/transformers` lazy-load, LRU cache.                                                                                                                              |
| `EphemeralPruner`        | `src/kb/pruner.ts`                                           | Daily ephemeral TTL cron.                                                                                                                                                 |
| `PersonProfileStore`     | `src/persona/profile.ts`                                     | CRUD `person_profile`, languages, tone_summary.                                                                                                                           |
| `AIClient`               | `src/ai/turn.ts` + `src/ai/router.ts` + `src/ai/opencode.ts` | OpenCode wrapper, prompt builder, parse + zod validation.                                                                                                                 |
| `Repo`                   | `src/db/repo.ts`                                             | All semantic DB access functions. No inline SQL outside of here.                                                                                                          |
| `BootReconciler`         | `src/boot/reconciler.ts`                                     | Catch-up at boot and on every reconnect.                                                                                                                                  |
| `ManualJobsCron`         | `src/scheduler/manual-jobs-cron.ts`                          | Daily scan for `re_engage`, fire `date_anchored`/`revive`/`re_engage`.                                                                                                    |
| `EscalationNotifier`     | `src/escalation/notifier.ts`                                 | Send out-of-band notification when the AI declares `escalate_to_human`. Handles multiple channels (WhatsApp self-chat, Telegram), retry, rate limit. See `18-escalation.md`. |
| `EscalationChannel`      | `src/escalation/channels/*.ts`                               | Channel implementations: `WhatsAppSelfChannel`, `TelegramChannel`. Common interface.                                                                                      |
| `Config`                 | `src/config/index.ts`                                        | Loads `config/index.ts`, zod validates, exposes typed + hot reload.                                                                                                       |
| `Logger`                 | `src/log.ts`                                                 | Shared pino instance.                                                                                                                                                     |

## Responsibility boundaries

- `MessageDispatcher` knows nothing about scheduler. Receives events, decides routing.
- `ChatStateMachine` knows nothing about AI. Manages only state + timing.
- `ReplyOrchestrator` is the only one calling the AI and talking to WhatsApp `sendMessage`. When the AI declares `escalate_to_human`, it delegates to `EscalationNotifier` instead of sending the reply.
- `EscalationNotifier` knows nothing about AI or chat state. Receives a payload (escalation row), formats, dispatches on channels. Handles rate limit and retry.
- `Repo` is the only path to talk to the DB. Everything else consumes Repo.
- `VecStore` is the only one knowing the sqlite-vec layout. Replaceable.

## Concurrency

The app is single-threaded (Node event loop). There is no real concurrency, but there are races between:

- Push events from `whatsapp-web.js` (asynchronous).
- TickerLoop every 10s.
- Daily cron jobs.

All state transitions are protected by `UPDATE ... WHERE state=expected` queries, atomic in SQLite. See `04-scheduler-state-machine.md` for details on race protection.

`InflightRegistry` is in-memory, not persisted: lives for the duration of a `SENDING`. A mid-sending crash is handled by boot recovery (see `09-boot-reconciler.md`).
