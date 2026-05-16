---
created: 2026-05-16
updated: 2026-05-16T12:29:00+02:00
tags: [project/viet-chatter, kanban]
kanban-plugin: board
---

## Not Started

- [ ] **#01** init: `package.json`, `tsconfig.json`, `.gitignore` (con `.env`, `.wwebjs_auth/`, `*.db*`, `logs/`, `.cache/`), `.env.example`. Vedi `dev/13-progetto-layout.md`. Wave 1.
- [ ] **#02** install dependencies: `whatsapp-web.js`, `qrcode-terminal`, `better-sqlite3`, `sqlite-vec`, `drizzle-orm`, `@xenova/transformers`, `zod`, `pino`, `pino-roll`, `pino-pretty`, `chokidar`. Dev: `typescript`, `tsx`, `drizzle-kit`, `@types/node`. Wave 1.
- [ ] **#03** scaffold filesystem: tutta la struttura `src/` vuota da `dev/13-progetto-layout.md` (cartelle: config, db, whatsapp, dispatcher, scheduler, orchestrator, kb, persona, ai, escalation, escalation/channels, boot, scripts) + `prompts/turn/`. Wave 1.
- [ ] **#04** `src/types.ts`: tipi cross-modulo (`ChatContext`, `Direction`, `ChatState`, `ManualJobKind`, `EscalationReason`, ...). Wave 1.
- [ ] **#05** `src/log.ts`: pino instance condiviso con pino-roll + pino-pretty. Vedi `dev/12-logging-observability.md`. Wave 1.
- [ ] **#06** `config/index.ts` (root, fuori da `src/`): config completa + `shouldReply` predicate. Vedi `dev/11-config-e-hot-reload.md`. Wave 2.
- [ ] **#07** `src/config/schema.ts`: zod ConfigSchema completo (incluso blocco `escalation`). Wave 2.
- [ ] **#08** `src/config/index.ts`: loader + chokidar hot-reload + Proxy access pattern. Wave 2.
- [ ] **#09** `src/config/constants.ts`: ENV var names (`OPENCODE_DISABLE_*`), costanti AI fisse. Wave 2.
- [ ] **#10** `src/db/client.ts`: openDb con `better-sqlite3` + `sqliteVec.load` + pragmas (WAL/NORMAL/FK ON/busy_timeout). Wave 3.
- [ ] **#11** `src/db/schema.ts`: tutte le tabelle Drizzle (`processed_messages`, `chat_state`, `person_profile`, `facts`, `manual_jobs`, `turn_log`, `escalations`). Vedi `dev/08-persistenza.md`. Wave 3.
- [ ] **#12** `drizzle.config.ts` + script `npm run db:generate`. Wave 3.
- [ ] **#13** generate `drizzle/0000_init.sql` + edit manuale per `CREATE VIRTUAL TABLE facts_vec USING vec0(...)`. Wave 3.
- [ ] **#14** `src/db/migrate.ts` runner custom + script `npm run db:migrate`. Wave 3.
- [ ] **#15** `src/db/repo.ts` parte 1: `processed_messages` (insert, getLastSeenTs, recentProcessedMessages, batch lookup). Wave 4.
- [ ] **#16** `src/db/repo.ts` parte 2: `chat_state` (get, set, transitionChatState atomico con changes()). Wave 4.
- [ ] **#17** `src/db/repo.ts` parte 3: `person_profile` (get, upsert, update tone_summary / languages). Wave 4.
- [ ] **#18** `src/db/repo.ts` parte 4: `facts` (loadImportant, loadActiveEphemeral, loadFactsByIds, insertFact, markSuperseded, expiredEphemeralIds, deleteFact). Wave 4.
- [ ] **#19** `src/db/repo.ts` parte 5: `manual_jobs` (insert, pendingManualJobs, transitionManualJob, cancelPendingManualJobsForChat). Wave 4.
- [ ] **#20** `src/db/repo.ts` parte 6: `turn_log` (insert) + `escalations` (insert, get, pendingEscalation, updateSummary, updateNotified, markEscalationsResolved, pendingEscalationsForRetry, countEscalationsLastHour). Wave 4.
- [ ] **#21** `src/kb/embedding.ts`: `EmbeddingService` lazy-load `Xenova/bge-small-en-v1.5` + LRU cache 500. Wave 5.
- [ ] **#22** `src/kb/vec.ts`: interfaccia `VecStore` + impl `SqliteVecStore` (upsert, search con `vec_distance_cosine`, delete). Wave 5.
- [ ] **#23** `src/kb/store.ts`: pipeline insert facts (con embedding per `secondary` + supersede + creazione `manual_jobs` da `anchor_date`), retrieval per turno (`loadKB`). Wave 6.
- [ ] **#24** `src/kb/pruner.ts`: cron giornaliero TTL ephemeral. Wave 6.
- [ ] **#25** `src/persona/profile.ts`: CRUD person_profile con default `languages: ['en']`, helpers per parse JSON languages. Wave 5.
- [ ] **#26** `src/whatsapp/client.ts`: init `whatsapp-web.js`, gestione QR via `qrcode-terminal`, eventi `message` e `message_create`, helpers `sendMessage` / `fetchMessages` / `getChat`, set in-memory id-tracker per distinguere out_bot da out_manual. Wave 5.
- [ ] **#27** `src/whatsapp/connection.ts`: `ConnectionStateMachine` (BOOTING/CONNECTING/CONNECTED/DISCONNECTED) con retry backoff + emit eventi reconnect. Wave 5.
- [ ] **#28** `src/dispatcher/filter.ts`: wrapper su `shouldReply` con hot-reload (riusato dal config loader). Wave 6.
- [ ] **#29** `src/dispatcher/index.ts`: `MessageDispatcher` con buildChatContext, dedup via `processed_messages`, classify direction, applica filtro, instrada a state machine, handler `out_manual` (cancella manual_jobs + escalations + abort inflight). Wave 7.
- [ ] **#30** `src/scheduler/latency.ts`: rolling avg latency con esclusione night-window, `crossesNight`, `isInNightWindow`, `nextMorningStart`. Wave 6.
- [ ] **#31** `src/scheduler/state.ts`: `ChatStateMachine` con transizioni atomiche IDLE/ACCUMULATING/SCHEDULED/SENDING + `computeFireAt` con jitter + clamp + night-shift. Wave 7.
- [ ] **#32** `src/scheduler/ticker.ts`: `TickerLoop` ogni 10s, claim atomico `SCHEDULED -> SENDING`, pre-send check su `out_manual` recente, invoca orchestrator. Wave 8.
- [ ] **#33** `src/scheduler/manual-jobs-cron.ts`: cron 30s per manual_jobs + cron giornaliero re_engage scan + `markColdAfterReEngageNoReply`. Vedi `dev/10-manual-jobs.md`. Wave 8.
- [ ] **#34** `src/orchestrator/inflight.ts`: `InflightRegistry` (Map<chatId, AbortController>). Wave 5.
- [ ] **#35** `src/orchestrator/context.ts`: build `TurnContext` (ultime N messages, KB 3-tier, profile, manualJobContext opzionale). Wave 7.
- [ ] **#36** `src/ai/opencode.ts`: copia 1:1 da `linkedin-autoapply` di `opencodeCli.ts` (callOpencodeCli, ensureOpencodeServer, stopOpencodeServer, isOpencodeAiModel). Vedi `dev/07-ai-integration.md`. Wave 5.
- [ ] **#37** `opencode.json` (root): copia 1:1 da `linkedin-autoapply` con agent `direct-reply` deny-everything. Wave 5.
- [ ] **#38** `src/ai/router.ts`: `callAiApi` con retry (3 attempt, backoff). Wave 6.
- [ ] **#39** `src/ai/turn.ts`: `generateTurn` con build prompt da template + extractJson + zod parse + retry. Schema TurnOutput zod completo (incluso `escalate_to_human`). Wave 7.
- [ ] **#40** prompts: `prompts/turn/00_role.txt`. Wave 6 (parallelo con altri prompts).
- [ ] **#41** prompts: `prompts/turn/01_persona_kb.txt` (schema KB 3-tier, come usarlo). Wave 6.
- [ ] **#42** prompts: `prompts/turn/02_tone_guidance.txt` (adattamento tono basato su toneSummary + sentiment). Wave 6.
- [ ] **#43** prompts: `prompts/turn/03_language_rules.txt` (scelta lingua dinamica + drift detection). Wave 6.
- [ ] **#44** prompts: `prompts/turn/04_extraction_rules.txt` (regole tier important/secondary/ephemeral, anti-duplicate, supersedes_id, anchor_date format). Wave 6.
- [ ] **#45** prompts: `prompts/turn/05_revive_and_skip.txt` (quando emettere revive_hint, quando skip:true). Wave 6.
- [ ] **#46** prompts: `prompts/turn/06_escalation_rules.txt` (categorie reason, urgency levels, conflict rule reply vs escalate, holding reply guidelines). Vedi `dev/18-escalation.md` sezione "Note specifiche". Wave 6.
- [ ] **#47** prompts: `prompts/turn/07_output_schema.txt` (schema JSON esatto, output ONLY JSON). Wave 6.
- [ ] **#48** prompts: `prompts/turn/08_examples.txt` (3-4 few-shot, almeno uno con escalation). Wave 6.
- [ ] **#49** prompts: `prompts/turn/99_context_template.txt` ({{CONTEXT}} placeholder). Wave 6.
- [ ] **#50** `src/escalation/format.ts`: formatter del messaggio per canale (whatsapp self-chat senza emoji + telegram con/senza markdown). Wave 6.
- [ ] **#51** `src/escalation/channels/index.ts`: interfaccia `EscalationChannel` + factory che registra i canali abilitati da config. Wave 6.
- [ ] **#52** `src/escalation/channels/whatsapp-self.ts`: `WhatsAppSelfChannel` con resolve `client.info.wid` lazy + sendMessage. Wave 7.
- [ ] **#53** `src/escalation/channels/telegram.ts`: `TelegramChannel` con HTTPS POST a `api.telegram.org/bot<token>/sendMessage`, fail-soft se ENV vars mancano. Wave 6.
- [ ] **#54** `src/escalation/notifier.ts`: `EscalationNotifier.notify(escId)` con rate limit + Promise.allSettled multi-canale + update `notified_channels`. Wave 8.
- [ ] **#55** `src/escalation/retry.ts`: cron 5min per escalations con `notified_channels='[]'`, max 3 attempts, in-memory counter. Wave 8.
- [ ] **#56** `src/orchestrator/index.ts`: `ReplyOrchestrator.generateAndSend` con 4 abort-check + branch escalation + persist extracted_facts/tone/languages + turn_log. Wave 9.
- [ ] **#57** `src/orchestrator/index.ts`: `generateAndSendForManualJob` (riusa pipeline ma con manualJobContext). Wave 9.
- [ ] **#58** `src/boot/reconciler.ts`: BootReconciler completo (getChats, filter, last_seen lookup, cap 50, fetch parallelo concurrency 5, dispatch fromBoot, post-reconcile recovery state machine SCHEDULED overdue + SENDING ambiguo). Vedi `dev/09-boot-reconciler.md`. Wave 9.
- [ ] **#59** `src/scripts/health.ts`: CLI self-check con tutti i count + `escalations` + `telegram_configured`. Wave 8.
- [ ] **#60** `src/index.ts`: entry point completo con init order, SIGINT handler. Vedi `dev/13-progetto-layout.md`. Wave 10.
- [ ] **#61** smoke test E2E manuale: avvio bot, scan QR, messaggio test da numero whitelisted, verifica reply arriva con delay corretto, verifica out_manual cancella. Wave 11.
- [ ] **#62** smoke test E2E manuale: trigger escalation (messaggio "sei libero sabato?" da numero whitelisted), verifica notifica Telegram arriva, verifica holding reply su WhatsApp, verifica out_manual chiude escalation. Wave 11.
- [ ] **#63** smoke test E2E manuale: birthday job (insert manuale fact con anchor_date oggi+1min, verifica fire). Wave 11.
- [ ] **#64** smoke test E2E manuale: reconnect / boot reconciler (stop bot, ricevi 3 messaggi, restart, verifica catch-up con post-reconnect spread). Wave 11.
- [ ] **#65** README.md aggiornato (sezione "Stato" da "v1 in definizione" a "v1 in sviluppo / running"). Wave 11.


## In Progress



## Done

**Complete**



## Paused



%% kanban:settings
```
{"kanban-plugin":"board","list-collapse":[false,false,false,false]}
```
%%
