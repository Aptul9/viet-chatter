# Logging e observability

## Logger: pino

```ts
// src/log.ts
import pino from 'pino'
import { config } from './config'

export const log = pino({
  level: config.logLevel,
  transport: {
    targets: [
      {
        target: 'pino-roll',
        level: config.logLevel,
        options: {
          file: config.logFile,
          frequency: config.logRotation,           // 'daily'
          size: config.logMaxSize,                 // '50m'
          mkdir: true,
        },
      },
      {
        target: 'pino-pretty',
        level: 'info',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          destination: 1,                          // stdout
        },
      },
    ],
  },
})
```

File: `./logs/viet-chatter.log`. Rotation giornaliera, cap 50MB per file. La cartella `logs/` è gitignored.

## Convenzione campi

Ogni log line è un oggetto JSON. Campi standard:

- `level`: trace/debug/info/warn/error.
- `time`: ISO8601.
- `msg`: descrizione human-readable.
- `chat_id`: presente quando applicabile.
- `whatsapp_msg_id`: presente per eventi su singolo messaggio.
- `state_from` / `state_to`: per transizioni state machine.
- `fire_at`: per eventi scheduler.
- `duration_ms`: per operazioni misurate.
- `attempt`: per retry.
- `err`: oggetto error completo (stack, code).

## Eventi loggati (catalogo)

| Evento | Level | Campi specifici |
|---|---|---|
| boot start | `info` | `pid`, `node_version`, `db_path` |
| boot done | `info` | `chats_seen`, `chats_processed`, `duration_ms` |
| connection state change | `info` | `from`, `to`, `reason` |
| QR pairing required | `warn` | (QR text in stdout, NON in file) |
| incoming msg processed | `debug` | `chat_id`, `msg_id`, `passed_filter` |
| state transition | `debug` | `chat_id`, `state_from`, `state_to`, `fire_at?` |
| reply turn started | `info` | `chat_id`, `history_size`, `kb_facts_total`, `triggered_by` (`reactive` / `manual_job`) |
| reply turn completed | `info` | `chat_id`, `status`, `duration_ms`, `facts_extracted`, `language_used` |
| reply turn failed | `error` | `chat_id`, `err`, `attempt` |
| reply turn aborted | `info` | `chat_id`, `reason` (`user_replied`, `signal`) |
| manual reply detected | `info` | `chat_id`, `state_was`, `aborted_inflight` |
| manual job created | `info` | `job_id`, `chat_id`, `kind`, `fire_at` |
| manual job fired | `info` | `job_id`, `chat_id`, `kind`, `outcome` |
| manual job superseded | `debug` | `job_id`, `chat_id`, `kind`, `reason` |
| ephemeral pruner | `info` | `deleted_count`, `duration_ms` |
| reconnect | `warn` | `outage_duration_ms` |
| post-reconnect spread | `info` | `chats_redistributed` |
| config reload | `info` | `valid` (true/false) |
| AI call | `debug` | `prompt_chars`, `response_chars`, `duration_ms`, `attempt` |

## Privacy nei log

| Dato | Loggato in chiaro? |
|---|---|
| `chat_id` (numero serializzato) | Sì (è l'identificatore primario, non sensibile in sé) |
| `phone` | Sì in messaggi `info` rilevanti, omesso a `debug` se ridondante |
| `display_name` | Solo a level `debug` |
| Body messaggio | MAI |
| Body fact estratto | Solo a level `trace` (off di default), in casi di debug profondo |
| Reply generata | MAI per intero (solo `chars` count) |

## `turn_log` come secondo canale di observability

Tabella DB `turn_log` traccia ogni turn (reactive o manual_job-driven):

```ts
turnLog(id, chatId, ts, status, languageUsed, factsExtracted, durationMs, errorMsg, triggeredBy)
```

Utile per:

- Audit storico ("perchè il bot non ha risposto a Hoa il 5 maggio?").
- Analytics aggregate (`SELECT chat_id, AVG(duration_ms), COUNT(*) FROM turn_log GROUP BY chat_id`).
- Detect drift di failure rate (`SELECT date(ts/1000, 'unixepoch'), SUM(status='failed') FROM turn_log GROUP BY 1`).

## Comando di self-check (`npm run health`)

Script `src/scripts/health.ts`:

```ts
import { openDb } from '../db/client'
import { config } from '../config'

const { db } = openDb(config.dbPath)
console.log({
  db_path: config.dbPath,
  chats_total: /* count */ ,
  chat_state_breakdown: /* group by state */ ,
  manual_jobs_pending: /* count */ ,
  last_turn: /* SELECT * FROM turn_log ORDER BY ts DESC LIMIT 1 */ ,
  facts_total: /* count */ ,
  embedding_model_present: /* fs check su .cache/transformers */ ,
})
```

## Nessun endpoint HTTP in v1

- Niente `/health` HTTP.
- Niente `/metrics`.
- Niente Prometheus, niente Grafana integration.

Self-check è only via CLI script. Future enhancement: dashboard Next.js (vedi `16-future-enhancements.md`).

## Debug avanzato

Per investigazioni:

- Set `logLevel: 'debug'` o `'trace'` in `config/index.ts`. Hot reload prende effetto immediato.
- Tail dei log: `tail -f logs/viet-chatter.log | jq`.
- Filtri JSON via `jq`: `cat logs/viet-chatter.log | jq 'select(.chat_id == "84xxx")'`.

## Rotazione log

`pino-roll` gestisce:

- Nuovo file ogni giorno (`viet-chatter.log` -> `viet-chatter.YYYY-MM-DD.log`).
- Cap 50MB per file. Se superato, rotazione anticipata.
- Vecchi file restano in cartella `logs/`. Niente cleanup automatico in v1: l'utente li gestisce manualmente.

Future enhancement: cleanup retention dei log oltre N giorni.
