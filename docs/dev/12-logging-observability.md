# Logging and observability

> Status: design; behavior implemented. Additional events `wweb event`, `whatsapp paired account`, `whatsapp heartbeat` shipped. Several dispatcher events promoted from `debug` to `info`.

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
          frequency: config.logRotation, // 'daily'
          size: config.logMaxSize, // '50m'
          mkdir: true,
        },
      },
      {
        target: 'pino-pretty',
        level: 'info',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          destination: 1, // stdout
        },
      },
    ],
  },
})
```

File: `./logs/viet-chatter.log`. Daily rotation, cap 50MB per file. The `logs/` folder is gitignored.

## Field convention

Each log line is a JSON object. Standard fields:

- `level`: trace/debug/info/warn/error.
- `time`: ISO8601.
- `msg`: human-readable description.
- `chat_id`: present when applicable.
- `whatsapp_msg_id`: present for events on single message.
- `state_from` / `state_to`: for state machine transitions.
- `fire_at`: for scheduler events.
- `duration_ms`: for measured operations.
- `attempt`: for retry.
- `err`: complete error object (stack, code).

## Logged events (catalog)

| Event                      | Level   | Specific fields                                                                         |
| -------------------------- | ------- | --------------------------------------------------------------------------------------- |
| boot start                 | `info`  | `pid`, `node_version`, `db_path`                                                        |
| boot done                  | `info`  | `chats_seen`, `chats_processed`, `duration_ms`                                          |
| connection state change    | `info`  | `from`, `to`, `reason`                                                                  |
| QR pairing required        | `warn`  | (QR text in stdout, NOT in file)                                                        |
| incoming msg processed     | `debug` | `chat_id`, `msg_id`, `passed_filter`                                                    |
| state transition           | `debug` | `chat_id`, `state_from`, `state_to`, `fire_at?`                                         |
| reply turn started         | `info`  | `chat_id`, `history_size`, `kb_facts_total`, `triggered_by` (`reactive` / `manual_job`) |
| reply turn completed       | `info`  | `chat_id`, `status`, `duration_ms`, `facts_extracted`, `language_used`                  |
| reply turn failed          | `error` | `chat_id`, `err`, `attempt`                                                             |
| reply turn aborted         | `info`  | `chat_id`, `reason` (`user_replied`, `signal`)                                          |
| manual reply detected      | `info`  | `chat_id`, `state_was`, `aborted_inflight`                                              |
| manual job created         | `info`  | `job_id`, `chat_id`, `kind`, `fire_at`                                                  |
| manual job fired           | `info`  | `job_id`, `chat_id`, `kind`, `outcome`                                                  |
| manual job superseded      | `debug` | `job_id`, `chat_id`, `kind`, `reason`                                                   |
| escalation created         | `info`  | `esc_id`, `chat_id`, `reason`, `urgency`, `holding_reply_sent`                          |
| escalation notified        | `info`  | `esc_id`, `channels_ok` (array), `channels_failed` (array)                              |
| escalation rate limited    | `warn`  | `esc_id`, `aggregated`                                                                  |
| escalation resolved        | `info`  | `esc_id`, `chat_id`, `resolution` (`user_replied` / `superseded`)                       |
| escalation dedup hit       | `debug` | `esc_id_existing`, `chat_id`, `urgency_changed`                                         |
| escalation retry           | `info`  | `esc_id`, `attempt`                                                                     |
| escalation retry exhausted | `error` | `esc_id`, `attempts`                                                                    |
| holding reply sent         | `info`  | `esc_id`, `chat_id`                                                                     |
| ephemeral pruner           | `info`  | `deleted_count`, `duration_ms`                                                          |
| reconnect                  | `warn`  | `outage_duration_ms`                                                                    |
| post-reconnect spread      | `info`  | `chats_redistributed`                                                                   |
| config reload              | `info`  | `valid` (true/false)                                                                    |
| AI call                    | `debug` | `prompt_chars`, `response_chars`, `duration_ms`, `attempt`                              |

## Privacy in the logs

| Data                             | Logged in cleartext?                                                  |
| -------------------------------- | --------------------------------------------------------------------- |
| `chat_id` (serialized number)    | Yes (it's the primary identifier, not sensitive in itself)            |
| `phone`                          | Yes in relevant `info` messages, omitted at `debug` if redundant      |
| `display_name`                   | Only at `debug` level                                                 |
| Message body                     | NEVER                                                                 |
| Extracted fact body              | Only at `trace` level (off by default), for deep debug cases          |
| Generated reply                  | NEVER in full (only `chars` count)                                    |
| Escalation `summary`             | Logged only as `chars` count at `info`. Full body only at `trace`.    |
| Telegram bot token               | NEVER. Only presence/absence of the ENV var.                          |
| User Telegram chat_id            | NEVER. Only `chat_id_set: true/false`.                                |

## `turn_log` as second observability channel

DB table `turn_log` traces every turn (reactive or manual_job-driven):

```ts
turnLog(id, chatId, ts, status, languageUsed, factsExtracted, durationMs, errorMsg, triggeredBy)
```

Useful for:

- Historical audit ("why didn't the bot reply to Hoa on May 5?").
- Aggregate analytics (`SELECT chat_id, AVG(duration_ms), COUNT(*) FROM turn_log GROUP BY chat_id`).
- Detect drift of failure rate (`SELECT date(ts/1000, 'unixepoch'), SUM(status='failed') FROM turn_log GROUP BY 1`).

## Self-check command (`npm run health`)

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
  embedding_model_present: /* fs check on .cache/transformers */ ,
  escalations: {
    pending: /* count where status='pending' */ ,
    resolved_24h: /* count user_replied + superseded last 24h */ ,
    failed_to_notify_24h: /* count where notified_channels='[]' AND created_at > now-24h */ ,
  },
  telegram_configured: !!process.env[config.escalation.telegramBotTokenEnv]
                     && !!process.env[config.escalation.telegramChatIdEnv],
})
```

## No HTTP endpoint in v1

- No `/health` HTTP.
- No `/metrics`.
- No Prometheus, no Grafana integration.

Self-check is only via CLI script. Future enhancement: Next.js dashboard.

## Advanced debug

For investigations:

- Set `logLevel: 'debug'` or `'trace'` in `config/index.ts`. Hot reload takes immediate effect.
- Tail logs: `tail -f logs/viet-chatter.log | jq`.
- JSON filters via `jq`: `cat logs/viet-chatter.log | jq 'select(.chat_id == "84xxx")'`.

## Log rotation

`pino-roll` handles:

- New file every day (`viet-chatter.log` -> `viet-chatter.YYYY-MM-DD.log`).
- Cap 50MB per file. If exceeded, anticipated rotation.
- Old files stay in `logs/` folder. No automatic cleanup in v1: the user manages them manually.

Future enhancement: log retention cleanup beyond N days.
