# Progetto layout

```
viet-chatter/
├── package.json
├── tsconfig.json
├── drizzle.config.ts
├── opencode.json                            # config OpenCode (copia 1:1 da linkedin-autoapply)
├── README.md
├── .env                                      # solo se servono variabili runtime, niente segreti hard-coded
├── .gitignore
│
├── config/
│   └── index.ts                              # config user-facing + shouldReply (predicate)
│
├── prompts/
│   └── turn/
│       ├── 00_role.txt
│       ├── 01_persona_kb.txt
│       ├── 02_tone_guidance.txt
│       ├── 03_language_rules.txt
│       ├── 04_extraction_rules.txt
│       ├── 05_revive_and_skip.txt
│       ├── 06_output_schema.txt
│       ├── 07_examples.txt
│       └── 99_context_template.txt           # placeholder {{CONTEXT}}
│
├── drizzle/
│   ├── 0000_init.sql                         # editato a mano per CREATE VIRTUAL TABLE facts_vec
│   └── meta/                                  # generato da drizzle-kit
│
├── docs/
│   ├── README.md
│   ├── utente/                                # documentazione non tecnica
│   │   ├── README.md
│   │   ├── 01-cosa-fa-il-bot.md
│   │   ├── 02-primo-avvio.md
│   │   ├── 03-a-chi-risponde.md
│   │   ├── 04-quando-risponde.md
│   │   ├── 05-cosa-ricorda.md
│   │   ├── 06-tono-e-lingua.md
│   │   ├── 07-cosa-fa-da-solo.md
│   │   ├── 08-quando-non-risponde.md
│   │   ├── 09-privacy-dati.md
│   │   ├── 10-domande-frequenti.md
│   │   └── 11-workflow-e-casi-uso.md
│   └── dev/                                   # documentazione tecnica
│       ├── README.md
│       ├── 01-stack.md
│       ├── 02-architettura.md
│       ├── 03-data-flow.md
│       ├── 04-scheduler-state-machine.md
│       ├── 05-filter-engine.md
│       ├── 06-kb-e-rag.md
│       ├── 07-ai-integration.md
│       ├── 08-persistenza.md
│       ├── 09-boot-reconciler.md
│       ├── 10-manual-jobs.md
│       ├── 11-config-e-hot-reload.md
│       ├── 12-logging-observability.md
│       ├── 13-progetto-layout.md
│       ├── 14-portabilita-postgres.md
│       ├── 15-runbook.md
│       ├── 16-future-enhancements.md
│       ├── 17-out-of-scope.md
│       └── specs/
│           └── 2026-05-10-viet-chatter-design.md
│
├── logs/                                      # gitignored, rotazione giornaliera
│
├── src/
│   ├── index.ts                               # entry point
│   ├── log.ts                                 # pino instance condiviso
│   ├── types.ts                               # tipi cross-modulo
│   │
│   ├── config/
│   │   ├── index.ts                           # loader + hot reload + proxy
│   │   ├── schema.ts                          # zod schema
│   │   └── constants.ts                       # OPENCODE_* + altre costanti AI
│   │
│   ├── db/
│   │   ├── client.ts                          # apertura SQLite + sqlite-vec + pragmas
│   │   ├── schema.ts                          # tabelle Drizzle
│   │   ├── repo.ts                            # funzioni semantiche
│   │   └── migrate.ts                         # script di migration
│   │
│   ├── whatsapp/
│   │   ├── client.ts                          # init whatsapp-web.js, QR, events, helpers
│   │   └── connection.ts                      # state machine connessione
│   │
│   ├── dispatcher/
│   │   ├── index.ts                           # ricezione, dedup, classify, routing
│   │   └── filter.ts                          # wrapper hot-reload su shouldReply
│   │
│   ├── scheduler/
│   │   ├── state.ts                           # state machine per chat
│   │   ├── ticker.ts                          # cron 10s
│   │   ├── latency.ts                         # rolling avg, night-window logic
│   │   └── manual-jobs-cron.ts                # cron 30s + cron giornaliero re-engage
│   │
│   ├── orchestrator/
│   │   ├── index.ts                           # generateAndSend / generateAndSendForManualJob
│   │   ├── context.ts                         # build TurnContext
│   │   └── inflight.ts                        # InflightRegistry (Map<chatId, AbortController>)
│   │
│   ├── kb/
│   │   ├── store.ts                           # CRUD facts + retrieval
│   │   ├── vec.ts                             # interface VecStore + impl SqliteVecStore
│   │   ├── embedding.ts                       # @xenova/transformers wrapper + LRU
│   │   └── pruner.ts                          # cron giornaliero TTL ephemeral
│   │
│   ├── persona/
│   │   └── profile.ts                         # CRUD person_profile
│   │
│   ├── ai/
│   │   ├── router.ts                          # callAiApi (in v1: solo OpenCode)
│   │   ├── opencode.ts                        # backend OpenCode (copia 1:1 da linkedin-autoapply)
│   │   └── turn.ts                            # generateTurn + parse + zod
│   │
│   ├── boot/
│   │   └── reconciler.ts                      # boot + post-reconnect
│   │
│   └── scripts/
│       └── health.ts                          # CLI self-check
│
└── .wwebjs_auth/                              # gitignored, sessione WhatsApp Web
    └── ...
```

## `package.json` script

```json
{
  "scripts": {
    "start": "tsx src/index.ts",
    "build": "tsc -p tsconfig.json",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "tsx src/db/migrate.ts",
    "db:studio": "drizzle-kit studio",
    "health": "tsx src/scripts/health.ts"
  }
}
```

## File da gitignore

```
node_modules/
dist/
logs/
viet-chatter.db
viet-chatter.db-journal
viet-chatter.db-shm
viet-chatter.db-wal
.wwebjs_auth/
.cache/
.env
```

## Tipo entry-point (`src/index.ts`)

Pseudo-flow al boot:

```ts
import { initConfig, config } from './config'
import { openDb } from './db/client'
import { runMigrations } from './db/migrate'
import { initWhatsApp } from './whatsapp/client'
import { initDispatcher } from './dispatcher'
import { initOrchestrator } from './orchestrator'
import { startTicker, startManualJobsCron } from './scheduler'
import { startEphemeralPruner } from './kb/pruner'
import { runReconciler } from './boot/reconciler'
import { ensureOpencodeServer, stopOpencodeServer } from './ai/opencode'
import { log } from './log'

async function main() {
  log.info({ pid: process.pid }, 'boot start')
  await initConfig()
  const { db, sqlite } = openDb(config.dbPath)
  await ensureOpencodeServer('boot')
  const wa = await initWhatsApp(config.sessionDir)
  initDispatcher({ db, wa })
  initOrchestrator({ db, wa })
  await runReconciler(wa, db)
  startTicker()
  startManualJobsCron()
  startEphemeralPruner()
  log.info('boot done')

  process.on('SIGINT', async () => {
    log.info('shutdown')
    await stopOpencodeServer()
    sqlite.close()
    await wa.destroy()
    process.exit(0)
  })
}

main().catch((err) => {
  log.error({ err }, 'fatal boot error')
  process.exit(1)
})
```
