# viet-chatter — Design Spec

> Status: HISTORICAL — original brainstorm preceded implementation. Kept for archival. See `docs/dev/19-implementation-notes.md` for current state.

Data: 2026-05-10.
Status: approved.
Lingua: italiano.

Documento di design originale, consolidato dal brainstorming. Per dettagli implementativi rivedere i singoli file in `docs/dev/`.

Aggiornamento 2026-05-16: aggiunta feature "Escalation a umano" (sezione 19). Compatibile con il design fully-autonomous esistente. Vedi `18-escalation.md`.

## 1. Scopo

Bot autonomo che risponde a un sottoinsieme filtrato di chat WhatsApp 1:1 sull'account personale dell'utente, con timing umano-simile, KB per-persona auto-popolato, tono adattivo, lingua dinamica. Esecuzione locale, zero cloud per dati personali.

## 2. Non-obiettivi (out of scope v1)

- Chat di gruppo.
- Multi-account.
- Approval flow / draft.
- CLI / dashboard.
- Backup automatico.
- Sync multi-machine.
- Cifratura applicativa.
- Detection avanzata sticker/audio/video.
- Persistenza sentiment.

Vedi `17-out-of-scope.md` per dettagli.

## 3. Stack

| Layer             | Scelta                                                        |
| ----------------- | ------------------------------------------------------------- |
| Runtime           | Node 20+                                                      |
| Lingua            | TypeScript                                                    |
| WhatsApp          | `whatsapp-web.js`                                             |
| Storage           | SQLite + `sqlite-vec`                                         |
| ORM               | Drizzle                                                       |
| Embedding         | `@xenova/transformers` (`bge-small-en-v1.5`, 384 dim, locale) |
| AI                | OpenCode (config 1:1 da `linkedin-autoapply`)                 |
| Validazione       | zod                                                           |
| Logging           | pino + pino-roll                                              |
| Hot reload config | chokidar                                                      |
| Process           | foreground manuale (`npm start`)                              |

## 4. Architettura

Componenti principali:

- `WhatsAppClient`: init `whatsapp-web.js`, eventi, send/fetch.
- `ConnectionStateMachine`: BOOTING/CONNECTING/CONNECTED/DISCONNECTED.
- `MessageDispatcher`: dedup, classify direction, applica filtro, instrada.
- `FilterEngine`: predicate function user-defined, hot-reload.
- `ChatStateMachine`: IDLE/ACCUMULATING/SCHEDULED/SENDING per chat.
- `LatencyEstimator`: rolling avg, night-window logic.
- `TickerLoop`: cron 10s, processa transizioni.
- `ReplyOrchestrator`: pipeline reply, AI call, parse, send, persist.
- `InflightRegistry`: AbortController per chat.
- `KBStore` + `VecStore` + `EmbeddingService` + `EphemeralPruner`.
- `PersonProfileStore`.
- `AIClient` (turn.ts) + `Router` + `OpenCode`.
- `Repo`: unica via di accesso DB.
- `BootReconciler`: catch-up boot e post-reconnect.
- `ManualJobsCron`: date_anchored / revive / re_engage.

Vedi `02-architettura.md`.

## 5. Filtro

Predicate function in `config/index.ts`:

```ts
export const shouldReply = (chat: ChatContext): boolean => {
  return chat.phone.startsWith('+84') && !['+84111111111', '+84222222222'].includes(chat.phone)
}
```

`ChatContext`: `phone`, `name`, `isSavedContact`, `lastMessageTs`, `unreadCount`. Hot-reload via chokidar + zod validation. Vedi `05-filter-engine.md`.

## 6. Scheduler

State machine per chat. Parametri:

- Debounce: 120s di silenzio chiude raffica. Hard cap 10 min.
- Reply delay: rolling avg ultime 5 latency (escluse cross-night) + jitter ±20%, clamped [5min, 2h]. Fallback 30 min.
- Night window: [22:00, 06:00) tz utente. Fire spostato a `next 06:00 + jitter(0..5min)`.
- Post-reconnect spread: ridistribuisce SCHEDULED overdue con jitter [30s, 180s].

Race protection: UPDATE atomici condizionati + `InflightRegistry.abort()` con 4 abort-check points nell'orchestrator. Race window residua mid-send dichiarata accettata.

Cancellazione su `out_manual`: -> IDLE, abort inflight, cancel scheduled.

Vedi `04-scheduler-state-machine.md`.

## 7. KB e RAG

3 tier:

- `important`: eventi che ridefiniscono persona. Sempre full-loaded. No TTL.
- `secondary`: dettagli interessanti. Top-K via RAG semantico. No TTL (salvo supersede).
- `ephemeral`: piani temporanei. TTL 7 giorni default. Sempre full-loaded.

Storage: `facts` table + `facts_vec` virtual table (sqlite-vec).
Embedding: `bge-small-en-v1.5` locale, 384 dim, lazy-load + LRU cache.
Auto-extraction: ogni turn AI emette `extracted_facts[]` nel TurnOutput. Single-call, niente seconda chiamata.
Anti-bloat: prompt instruction + `supersedes_id`. Niente compaction in v1.

Vedi `06-kb-e-rag.md`.

## 8. Persona profile

Per chat: `display_name`, `languages: string[]`, `tone_summary`, `re_engage_threshold_days`, `engagement_state`.

- `languages`: array. AI sceglie dinamicamente per turn quale usare.
- `tone_summary`: aggiornato dall'AI tramite `tone_update` nel TurnOutput.
- `engagement_state`: `active` / `cold` (transitivo dopo re_engage senza risposta in 7 giorni).

## 9. AI integration

Single-call per turn. Output JSON enforced via prompt + parsed/validated con zod. OpenCode con agent `direct-reply` deny-everything (config 1:1 da `linkedin-autoapply`).

`TurnContext` -> AI -> `TurnOutput`:

- `reply: string`
- `skip: boolean`
- `extracted_facts: ExtractedFact[]` (con tier, content, confidence, ttl_days?, supersedes_id?, anchor_date?, anchor_recurring?, anchor_action?)
- `tone_update: string | null`
- `languages_update: string[] | null`
- `language_used: string`
- `revive_hint: { attempt_in_minutes, context } | null`
- `escalate_to_human: { reason, urgency, summary, suggested_holding_reply } | null`

Retry: 1 retry su parse/zod fail. Se fallisce ancora, log + skip turn.

Vedi `07-ai-integration.md` e `18-escalation.md`.

## 10. Manual jobs

3 kind:

- `date_anchored`: creato da `extracted_facts[i].anchor_date`. Fire al `nextOccurrence`. Pre-fire supersede check (out\_\* nelle ultime 12h -> superseded). Yearly recurring: dopo fired, crea nuovo job +1 anno.
- `revive`: creato da `revive_hint` nel TurnOutput. Fire dopo `attempt_in_minutes`. Max 1 pending per chat, max 1 fired per giornata di conversazione.
- `re_engage`: creato da cron giornaliero quando silenzio > soglia (default 14 giorni, override per persona). Solo per chat con storia (>=3 outgoing). Niente re_engage notturni. Dopo fired senza risposta in 7 giorni -> `cold`.

Collision: incoming o out_manual cancellano `pending` jobs della chat.

Vedi `10-manual-jobs.md`.

## 11. Persistenza

Tabelle:

- `processed_messages` (whatsapp_msg_id PK, chat_id, direction, ts).
- `chat_state` (chat_id PK, state, first_msg_at, debounce_deadline, fire_at, attempt, last_event_at).
- `person_profile` (chat_id PK, display_name, languages JSON, tone_summary, re_engage_threshold_days, engagement_state, created_at, updated_at).
- `facts` (id PK, person_id, tier, content, source_msg_id, confidence, created_at, expires_at, superseded_by).
- `facts_vec` virtual (fact_id PK, embedding FLOAT[384]).
- `manual_jobs` (id PK, chat_id, kind, fire_at, payload JSON, status, fired_at, created_at).
- `turn_log` (id PK, chat_id, ts, status, language_used, facts_extracted, duration_ms, error_msg, triggered_by).
- `escalations` (id PK, chat_id, trigger_msg_id, reason, urgency, summary, holding_reply_sent, status, created_at, resolved_at, notified_channels JSON).

Niente body messaggi salvato. Solo metadata + facts derivati.

Pragmas: WAL, NORMAL, FK ON, busy_timeout 5000.

Vedi `08-persistenza.md`.

## 12. Boot reconciler

Algoritmo idempotente:

1. `getChats()` (gratis, locale).
2. Filter no-gruppi, no-empty.
3. Resolve `last_seen` da DB.
4. Filter chat con materiale nuovo (`lastWhatsAppTs > lastSeenInDb` o `unreadCount > 0` per chat nuove).
5. Sort per recency, cap `bootMaxChatsToFetch = 50`.
6. Apply `shouldReply`.
7. Fetch parallelo (concurrency 5) con limit `clamp(unreadCount + 5, 10, 50)`.
8. Dispatch via `MessageDispatcher.handleMessage(msg, { fromBoot: true })`.

Recovery state machine post-reconcile (SCHEDULED overdue -> spread, SENDING ambiguo -> ACCUMULATING).

Vedi `09-boot-reconciler.md`.

## 13. Logging e observability

- `pino` + `pino-roll` (rotation daily, cap 50MB).
- File: `./logs/viet-chatter.log`.
- JSON strutturato.
- Privacy: niente body messaggi, fact content solo a `trace`.
- `turn_log` table come secondo canale di audit.
- `npm run health` per self-check.
- Niente HTTP endpoint in v1.

Vedi `12-logging-observability.md`.

## 14. Config e hot reload

`config/index.ts` con tutti i parametri runtime + `shouldReply`.

Hot reload via chokidar:

- Re-import dinamico.
- zod validation.
- Smoke test predicate.
- Swap atomico se OK, log error e mantieni precedente se KO.

Restart-required: `sessionDir`, `dbPath`, `embeddingModel`, `aiModel`, `logFile`. Tutti gli altri sono hot-reloadable.

Tutto il codice business legge tramite proxy `config.X`, mai cattura in closure.

Vedi `11-config-e-hot-reload.md`.

## 15. Decisioni chiave consolidate

- Single account WhatsApp.
- Solo chat 1:1.
- Fully autonomous send.
- Cancellazione su out_manual.
- Lingua per-persona come array, AI sceglie dinamicamente.
- Tono dinamico AI-managed (opzione 6a-B).
- Sentiment inline in prompt (opzione 6b-Y), Z futura.
- Auto-extraction KB (opzione domanda 4-B).
- KB su SQLite + sqlite-vec, embedding locale.
- Tutte le query attraverso ORM Drizzle, abstraction `VecStore` per portabilita Postgres.
- AI backend in v1: solo OpenCode, agent direct-reply deny-everything.
- Logging via pino.
- Cap 50 chat al boot.
- Debounce 120s, hard cap 10 min, reply delay rolling avg + jitter ±20% [5min, 2h].

## 16. Future enhancements

8 punti. Vedi `16-future-enhancements.md`.

## 17. Out of scope hard

Vedi `17-out-of-scope.md`.

## 18. Stato del progetto

Spec approvato il 2026-05-10. Codice non ancora scritto. Documentazione precede implementazione.

Prossimo step: implementation plan dettagliato (uso del skill `writing-plans`).

## 19. Escalation a umano

Aggiunta 2026-05-16. L'AI può dichiarare che un turn richiede l'utente reale (impegni, decisioni delicate, opinioni personali) tramite il campo `escalate_to_human` nel `TurnOutput`. Il bot in quel caso:

- Manda eventuale `suggested_holding_reply` su WhatsApp ("aspetta che controllo").
- Crea row in `escalations`.
- Notifica l'utente su canali fuori-banda (Telegram, WhatsApp self-chat, configurabili).
- Non genera reply autonoma.
- Marca `resolved` quando l'utente risponde a mano.

Compatibile con design fully-autonomous: l'AI sceglie autonomamente quando escalare, non è un approval flow di routine. Approval flow puro resta out-of-scope.

Canali in v1: WhatsApp self-chat e/o Telegram bot. Configurabili insieme. Token Telegram in `.env` gitignored.

Vedi `18-escalation.md` per dettagli e `17-out-of-scope.md` per il chiarimento escalation vs approval.
