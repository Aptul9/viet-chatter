---
created: 2026-05-16
updated: 2026-05-16T16:45:00+02:00
tags: [project/viet-chatter, kanban]
kanban-plugin: board
---

## Not Started

## In Progress

- [ ] **#61** smoke test E2E manuale: avvio bot, scan QR, messaggio test da numero whitelisted, verifica reply arriva con delay corretto, verifica out_manual cancella. Wave 11. Richiede sessione WhatsApp reale + utente.
- [ ] **#62** smoke test E2E manuale: trigger escalation (messaggio "sei libero sabato?" da numero whitelisted), verifica notifica Telegram arriva, verifica holding reply su WhatsApp, verifica out_manual chiude escalation. Wave 11. Richiede sessione WhatsApp reale + Telegram bot + utente.
- [ ] **#63** smoke test E2E manuale: birthday job (insert manuale fact con anchor_date oggi+1min, verifica fire). Wave 11. Richiede sessione WhatsApp reale + utente.
- [ ] **#64** smoke test E2E manuale: reconnect / boot reconciler (stop bot, ricevi 3 messaggi, restart, verifica catch-up con post-reconnect spread). Wave 11. Richiede sessione WhatsApp reale + utente.

## Done

- [x] **#R1** refactor: single-project + YAML config. [[viet-chatter]]
- [x] **#01** init: `package.json`, `tsconfig.json`, `.gitignore` (con `.env`, `.wwebjs_auth/`, `*.db*`, `logs/`, `.cache/`), `.env.example`. [[viet-chatter]]
- [x] **#02** install dependencies (243 packages installed via `npm install`). [[viet-chatter]]
- [x] **#03** scaffold filesystem: `src/`, `prompts/turn/`, `drizzle/`, `logs/`, `config/`. [[viet-chatter]]
- [x] **#04** `src/types.ts`: tipi cross-modulo. [[viet-chatter]]
- [x] **#05** `src/log.ts`: pino + pino-roll + pino-pretty (env-driven, no config import to avoid circular dep). [[viet-chatter]]
- [x] **#06** `config/index.ts` (root): config completa + `shouldReply` predicate. [[viet-chatter]]
- [x] **#07** `src/config/schema.ts`: zod ConfigSchema completo (incluso blocco escalation). [[viet-chatter]]
- [x] **#08** `src/config/index.ts`: loader + chokidar hot-reload + Proxy access pattern. [[viet-chatter]]
- [x] **#09** `src/config/constants.ts`: ENV var names, OPENCODE\_\* + altre costanti AI. [[viet-chatter]]
- [x] **#10** `src/db/client.ts`: openDb con `better-sqlite3` + `sqliteVec.load` + pragmas. [[viet-chatter]]
- [x] **#11** `src/db/schema.ts`: tutte le tabelle Drizzle. [[viet-chatter]]
- [x] **#12** `drizzle.config.ts`. [[viet-chatter]]
- [x] **#13** `drizzle/0000_init.sql` (generato + edit manuale per `facts_vec` virtual table). [[viet-chatter]]
- [x] **#14** `src/db/migrate.ts` runner custom + `npm run db:migrate` verificato. [[viet-chatter]]
- [x] **#15-#20** `src/db/repo.ts` (mono-file, strategy A): 35 funzioni semantiche, tutte le 6 parti (processed_messages, chat_state, person_profile, facts, manual_jobs, turn_log + escalations). [[viet-chatter]]
- [x] **#21** `src/kb/embedding.ts`: EmbeddingService lazy-load + LRU cache 500. [[viet-chatter]]
- [x] **#22** `src/kb/vec.ts`: VecStore interface + SqliteVecStore impl. [[viet-chatter]]
- [x] **#23** `src/kb/store.ts`: persistExtractedFacts pipeline + loadKB retrieval. [[viet-chatter]]
- [x] **#24** `src/kb/pruner.ts`: cron giornaliero TTL ephemeral. [[viet-chatter]]
- [x] **#25** `src/persona/profile.ts`: CRUD person_profile con default `languages: ['en']`. [[viet-chatter]]
- [x] **#26** `src/whatsapp/client.ts`: init wweb, QR, eventi, helpers, id-tracker. [[viet-chatter]]
- [x] **#27** `src/whatsapp/connection.ts`: ConnectionStateMachine + backoff helper. [[viet-chatter]]
- [x] **#28** `src/dispatcher/filter.ts`: wrapper su shouldReply hot-reload. [[viet-chatter]]
- [x] **#29** `src/dispatcher/index.ts`: MessageDispatcher. [[viet-chatter]]
- [x] **#30** `src/scheduler/latency.ts`: rolling avg + night-window + computeFireAt (timezone-aware via Intl.DateTimeFormat). [[viet-chatter]]
- [x] **#31** `src/scheduler/state.ts`: ChatStateMachine con transizioni atomiche. [[viet-chatter]]
- [x] **#32** `src/scheduler/ticker.ts`: TickerLoop ogni 10s, claim atomico, pre-send check, invoke orchestrator via callback. [[viet-chatter]]
- [x] **#33** `src/scheduler/manual-jobs-cron.ts`: cron 30s + cron daily re_engage + markColdAfterReEngageNoReply. [[viet-chatter]]
- [x] **#34** `src/orchestrator/inflight.ts`: InflightRegistry (Map<chatId, AbortController>). [[viet-chatter]]
- [x] **#35** `src/orchestrator/context.ts`: buildTurnContext (history + KB + profile + manualJobContext). [[viet-chatter]]
- [x] **#36** `src/ai/opencode.ts`: copiato 1:1 da `linkedin-autoapply` + adattato imports per il layout di viet-chatter. [[viet-chatter]]
- [x] **#37** `opencode.json` (root): copiato 1:1 da linkedin-autoapply. [[viet-chatter]]
- [x] **#38** `src/ai/router.ts`: callAiApi con retry (3 attempts, backoff 5s). [[viet-chatter]]
- [x] **#39** `src/ai/turn.ts`: generateTurn con prompt builder, extractJson, zod parse, retry. TurnOutputSchema completo. [[viet-chatter]]
- [x] **#40-#49** prompts: 10 .txt files in `prompts/turn/`. [[viet-chatter]]
- [x] **#50** `src/escalation/format.ts`: formatter messaggio per canale. [[viet-chatter]]
- [x] **#51** `src/escalation/channels/index.ts`: interfaccia EscalationChannel + factory. [[viet-chatter]]
- [x] **#52** `src/escalation/channels/whatsapp-self.ts`: WhatsAppSelfChannel. [[viet-chatter]]
- [x] **#53** `src/escalation/channels/telegram.ts`: TelegramChannel via fetch. [[viet-chatter]]
- [x] **#54** `src/escalation/notifier.ts`: EscalationNotifier (rate limit + Promise.allSettled + update notified_channels). [[viet-chatter]]
- [x] **#55** `src/escalation/retry.ts`: cron 5min con max 3 attempts in-memory. [[viet-chatter]]
- [x] **#56** `src/orchestrator/index.ts`: ReplyOrchestrator.generateAndSend (Flow C completo: 4 abort-check + branch escalation + persist facts/tone/languages + turn_log). [[viet-chatter]]
- [x] **#57** `src/orchestrator/index.ts`: generateAndSendForManualJob (riusa pipeline con manualJobContext). [[viet-chatter]]
- [x] **#58** `src/boot/reconciler.ts`: BootReconciler (getChats, filter, last_seen lookup, cap 50, fetch parallelo concurrency 5, dispatch fromBoot, post-reconcile recovery SCHEDULED overdue + SENDING ambiguo). [[viet-chatter]]
- [x] **#59** `src/scripts/health.ts`: CLI self-check verificato (`npm run health` produce JSON corretto). [[viet-chatter]]
- [x] **#60** `src/index.ts`: entry point completo con init order + SIGINT/SIGTERM handlers. [[viet-chatter]]
- [x] **#65** README.md aggiornato (sezione "Stato" + nota su tracking in-repo). [[viet-chatter]]

**Complete**

## Paused

%% kanban:settings

```
{"kanban-plugin":"board","list-collapse":[false,false,false,false]}
```

%%
