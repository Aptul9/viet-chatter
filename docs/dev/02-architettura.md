# Architettura

## Diagramma componenti

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
```

## Moduli

| Modulo | File principale | Responsabilità |
|---|---|---|
| `WhatsAppClient` | `src/whatsapp/client.ts` | Init `whatsapp-web.js`, gestione QR, eventi, `sendMessage`, `fetchMessages`. |
| `ConnectionStateMachine` | `src/whatsapp/connection.ts` | Stati `BOOTING`/`CONNECTING`/`CONNECTED`/`DISCONNECTED`, retry con backoff. |
| `MessageDispatcher` | `src/dispatcher/index.ts` | Classify direction, dedup via `processed_messages`, applica filtro, instrada. |
| `FilterEngine` | `src/dispatcher/filter.ts` | Wrapper su `shouldReply` predicate user-defined, hot-reload via chokidar. |
| `ChatStateMachine` | `src/scheduler/state.ts` | Transizioni `IDLE` -> `ACCUMULATING` -> `SCHEDULED` -> `SENDING`, debounce/cap. |
| `LatencyEstimator` | `src/scheduler/latency.ts` | Rolling avg latency, esclusione night-window, jitter. |
| `TickerLoop` | `src/scheduler/ticker.ts` | Cron interno 10s, scansiona `chat_state`, processa transizioni dovute. |
| `ReplyOrchestrator` | `src/orchestrator/index.ts` | Pipeline reply: fetch history -> build context -> AI -> parse -> send -> persist. |
| `InflightRegistry` | `src/orchestrator/inflight.ts` | `Map<chat_id, AbortController>` per cancellazione cooperativa. |
| `KBStore` | `src/kb/store.ts` | CRUD `facts`, retrieval per tier, supersede. |
| `VecStore` | `src/kb/vec.ts` | Interfaccia astratta + impl `SqliteVecStore`. |
| `EmbeddingService` | `src/kb/embedding.ts` | `@xenova/transformers` lazy-load, cache LRU. |
| `EphemeralPruner` | `src/kb/pruner.ts` | Cron giornaliero TTL ephemeral. |
| `PersonProfileStore` | `src/persona/profile.ts` | CRUD `person_profile`, lingue, tone_summary. |
| `AIClient` | `src/ai/turn.ts` + `src/ai/router.ts` + `src/ai/opencode.ts` | Wrapper su OpenCode, prompt builder, parse + zod validation. |
| `Repo` | `src/db/repo.ts` | Tutte le funzioni semantiche di accesso DB. Niente SQL inline fuori da qui. |
| `BootReconciler` | `src/boot/reconciler.ts` | Catch-up al boot e a ogni reconnect. |
| `ManualJobsCron` | `src/scheduler/manual-jobs-cron.ts` | Scansione giornaliera per `re_engage`, fire `date_anchored`/`revive`/`re_engage`. |
| `Config` | `src/config/index.ts` | Carica `config/index.ts`, valida zod, espone tipato + hot reload. |
| `Logger` | `src/log.ts` | Istanza pino condivisa. |

## Confini di responsabilità

- `MessageDispatcher` non sa di scheduler. Riceve eventi, decide il routing.
- `ChatStateMachine` non sa di AI. Gestisce solo state + timing.
- `ReplyOrchestrator` è l'unico che chiama l'AI e parla con WhatsApp `sendMessage`.
- `Repo` è l'unica via per parlare col DB. Tutto il resto consuma Repo.
- `VecStore` è l'unico che conosce il layout sqlite-vec. Sostituibile.

## Concorrenza

L'app è single-threaded (event loop Node). Non c'è concorrenza reale, ma ci sono race tra:

- Eventi push da `whatsapp-web.js` (asincroni).
- TickerLoop ogni 10s.
- Cron giornalieri.

Tutte le transizioni di stato sono protette da query `UPDATE ... WHERE state=expected`, atomiche in SQLite. Vedi `04-scheduler-state-machine.md` per i dettagli sulla protezione delle race.

`InflightRegistry` è in-memory, non persistito: vive il tempo di una `SENDING`. Un crash mid-sending viene gestito da boot recovery (vedi `09-boot-reconciler.md`).
