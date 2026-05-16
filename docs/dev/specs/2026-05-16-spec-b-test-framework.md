# Spec B — Test framework (B+C hybrid)

Data: 2026-05-16.
Status: approved (brainstorm 2026-05-16).
Lingua: italiano (prosa) + english (technical terms).

## Scopo

Costruire un framework di test end-to-end che combini:

- **C side**: estensione di `src/scripts/test-e2e.ts` in un registry di scenari guidati da mock (fake `WhatsAppHandle`, optional fake AI). Veloce, deterministico, niente QR scan. Copre state machine, dispatcher, orchestrator, escalation, manual_jobs.
- **B side**: nuovo top-level `e2e/` con un secondo client `whatsapp-web.js` (account di test paired separatamente) che invia messaggi reali al numero del bot, e un validator che assertsce comportamento bot leggendo DB e log. Copre quirks wweb-reali (download media, lid resolution, reconnect).

Bot resta single-account in `src/`. Il secondo wweb vive isolato in `e2e/` con package.json e sessionDir propri.

## Non-obiettivi

- Niente CI cloud (real wweb non si pair-ifica in cloud runner, WhatsApp ToS).
- Niente assertion DSL custom: i validator sono script imperativi TS, uno per scenario.
- Niente coverage report (test e2e, non unit).

## Architettura

### C side — scenario registry in `src/scripts/test-e2e.ts`

Refactor da scenario singolo hardcoded a registry.

Layout interno:

```
src/scripts/
  test-e2e.ts                 → CLI entry, parsa scenario name, esegue
  e2e-scenarios/
    types.ts                  → Scenario interface
    basic-reply.ts            → esistente, estratto come modulo
    image-vision.ts           → mock image con downloadMedia stub
    image-escalation-fallback.ts → mock image, model non in allowlist
    audio-escalation.ts       → mock audio, assert escalation row
    skip-output.ts            → stub AI ritorna skip:true
    escalation-output.ts      → stub AI ritorna escalate_to_human
    manual-job-revive.ts      → insert revive job, advance timers, fire
    out-manual-during-sending.ts → simula out_manual mid-AI-call, assert abort
```

`Scenario` interface:

```typescript
export interface Scenario {
  name: string
  description: string
  setup: (deps: TestDeps) => Promise<void>
  run: (deps: TestDeps) => Promise<void>
  assertions: (deps: TestDeps) => Promise<{ ok: boolean; errors: string[] }>
  teardown: (deps: TestDeps) => Promise<void>
}

export interface TestDeps {
  sqlite: Sqlite
  wa: FakeWhatsAppHandle
  state: ChatStateMachine
  inflight: InflightRegistry
  orchestrator: ReplyOrchestrator
  dispatcher: MessageDispatcher
  aiStub: AiStubControl   // permette di registrare risposta canned per turno
}
```

CLI:

```bash
npm run test:e2e                          # esegue 'basic-reply' (default)
npm run test:e2e -- image-vision           # scenario singolo
npm run test:e2e -- all                    # tutti gli scenari in sequenza
npm run test:e2e -- --list                 # elenca scenari disponibili
```

Exit codes: 0 = all pass, 1 = at least one fail, 2 = timeout.

AI stub: `src/ai/router.ts` aggiunge env-driven override:

```typescript
if (process.env['BOT_E2E_STUB_AI'] === '1') {
  const stubbed = readStubResponse() // legge da AI_STUB_RESPONSE env var (JSON)
  return stubbed
}
```

Scenari controllano lo stub settando `AI_STUB_RESPONSE` env var (canned JSON) prima del fire.

### B side — `e2e/` top-level folder

Layout:

```
e2e/
  README.md                  → setup driver, target number, comandi
  driver/
    package.json             → separato, minimal: whatsapp-web.js + qrcode-terminal
    tsconfig.json
    src/
      index.ts               → CLI entry per scenari driver
      session.ts             → init wweb separato (sessionDir = e2e/driver/.wwebjs_auth/)
      scenarios/
        send-text.ts
        send-image.ts
        send-audio.ts
        send-document.ts
        send-location.ts
        burst-text.ts        → 5 messaggi consecutivi, test debounce
    fixtures/
      cat.jpg
      voice.ogg
      doc.pdf
  validator/
    package.json             → separato, minimal: better-sqlite3
    tsconfig.json
    src/
      index.ts               → CLI: assert <scenario> --db <path> --logs <path>
      assert-db.ts           → query helpers (countMessages, lastEscalation, ...)
      assert-logs.ts         → grep pattern in pino log (json-lines)
      checks/
        basic-reply.ts
        image-vision.ts
        audio-escalation.ts
        reconnect.ts
  run.ts                     → orchestrator top-level
  config/
    e2e-config.yaml          → config template per bot in test mode (timers brevi)
```

### Orchestrator `e2e/run.ts`

Boot bot in test mode + esegui scenario driver + esegui validator. Tutto in un comando.

```bash
npx tsx e2e/run.ts <scenario> [--ai stub|real] [--keep]
```

Flusso:

1. Copy `e2e/config/e2e-config.yaml` a `config/user-config.yaml` (backup l'originale a `config/user-config.yaml.backup`).
2. Wipe `viet-chatter.db` → genera fresh via `npm run db:migrate` con `BOT_E2E_DB_PATH`.
3. Spawn bot child process: `tsx src/index.ts` con env:
   ```
   BOT_E2E_STUB_AI=1 (se --ai stub)
   BOT_E2E_LOG_PATH=./e2e/logs/<scenario>.log
   BOT_E2E_DB_PATH=./e2e/db/<scenario>.db
   TELEGRAM_USER_CHAT_ID=<test chat id, optional>
   ```
4. Wait per log match `whatsapp ready` AND `boot done`. Timeout 90s.
5. Exec driver scenario: `cd e2e/driver && npm run scenario <name> -- --to <bot_number>`.
6. Poll validator: `cd e2e/validator && npm run check <name> --db <path> --logs <path>`. Timeout 60s.
7. Report pass/fail con riassunto.
8. Kill bot child process (SIGTERM, fallback SIGKILL dopo 10s).
9. Se `--keep`: lascia DB + log + config in place per debug. Altrimenti cleanup + restore config originale.

### Test mode env vars

Riconosciute da `src/index.ts` e altri moduli al boot:

| Var                    | Effect                                                                  |
| ---------------------- | ----------------------------------------------------------------------- |
| `BOT_E2E_STUB_AI=1`    | `src/ai/router.ts` ritorna canned response da `AI_STUB_RESPONSE` env    |
| `BOT_E2E_LOG_PATH=...` | Override `config.logFile` al boot (validator legge da qui)              |
| `BOT_E2E_DB_PATH=...`  | Override `config.dbPath` al boot                                        |
| `BOT_E2E_MODE=1`       | Marker generale; abilita log extra `e2e: <event>` per facile assertion |

Implementazione: in `src/index.ts` main, dopo `await initConfig()`, apply overrides:

```typescript
if (process.env['BOT_E2E_LOG_PATH']) (config as any).logFile = process.env['BOT_E2E_LOG_PATH']
if (process.env['BOT_E2E_DB_PATH']) (config as any).dbPath = process.env['BOT_E2E_DB_PATH']
```

### Driver `e2e/driver/`

Separate `package.json` minimo:

```json
{
  "name": "viet-chatter-e2e-driver",
  "private": true,
  "type": "module",
  "scripts": {
    "pair": "tsx src/session.ts --pair",
    "scenario": "tsx src/index.ts"
  },
  "dependencies": {
    "whatsapp-web.js": "^1.34.7",
    "qrcode-terminal": "^0.12.0"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "@types/node": "^22.10.5"
  }
}
```

Driver session usa `LocalAuth({ dataPath: './e2e/driver/.wwebjs_auth' })` — completamente isolato da bot.

Comando `npm run pair` apre Chromium, mostra QR, aspetta scan. Da scansionare con SECONDO telefono (account di test).

`npm run scenario send-text -- --to <bot_number> --body "ciao"` invia messaggio al bot's E.164 number e log msgId per validator.

### Validator `e2e/validator/`

Separate `package.json` con `better-sqlite3` readonly.

Ogni check legge bot DB + tail bot log e assertsce condizioni attese per scenario.

Esempio `e2e/validator/src/checks/basic-reply.ts`:

```typescript
export async function check(deps: { db: string; logs: string }): Promise<Result> {
  const sql = new Database(deps.db, { readonly: true })
  const errors: string[] = []
  const r = sql.prepare(`SELECT COUNT(*) AS c FROM processed_messages WHERE direction='out_bot'`).get() as { c: number }
  if (r.c < 1) errors.push(`expected >=1 out_bot, got ${r.c}`)
  const turn = sql.prepare(`SELECT status FROM turn_log ORDER BY id DESC LIMIT 1`).get() as { status: string } | undefined
  if (turn?.status !== 'sent') errors.push(`last turn status=${turn?.status}, expected 'sent'`)
  return { ok: errors.length === 0, errors }
}
```

### Test config `e2e/config/e2e-config.yaml`

Timers ridotti per scenari rapidi:

```yaml
debounceMs: 2000
hardCapMs: 10000
minDelayMs: 5000
maxDelayMs: 15000
nightWindow:
  startHour: 4
  endHour: 4         # disable night window (start==end)
tickIntervalMs: 1000
manualJobsTickIntervalMs: 2000
filter:
  allowedPrefixes: []   # allow all per testing
  blockedNumbers: []
  savedContactsOnly: false
  unreadOnly: false
```

## Hard limits

- **Setup richiede 2 phone reali** + 2 QR scan al primo run (uno per bot, uno per driver). Sessioni persistono in rispettivi `.wwebjs_auth/`.
- **WhatsApp ban risk** se driver invia troppo. Cap implicito: max 1 scenario / 30s, max 50 messaggi/ora.
- **Real-AI mode** consuma quota OpenCode / API key del provider.
- **Bot's Chromium + driver's Chromium** = 2 processi paralleli. RAM tipica: 500MB ognuno. Headless ma comunque pesanti.
- **NO CI**. Local-only, on-demand o nightly via scheduled task.

## Modifiche ai file

| File / Folder                       | Tipo     | Cambiamento                                                |
| ----------------------------------- | -------- | ---------------------------------------------------------- |
| `src/scripts/test-e2e.ts`           | modifica | refactor a scenario registry                               |
| `src/scripts/e2e-scenarios/*.ts`    | nuovo    | scenari modulari                                           |
| `src/ai/router.ts`                  | modifica | env-driven AI stub                                         |
| `src/index.ts`                      | modifica | apply env override per logFile / dbPath in test mode       |
| `e2e/`                              | nuovo    | top-level folder                                           |
| `e2e/run.ts`                        | nuovo    | orchestrator                                               |
| `e2e/driver/package.json`           | nuovo    | minimal wweb driver                                        |
| `e2e/driver/src/**`                 | nuovo    | session + scenarios                                        |
| `e2e/validator/package.json`        | nuovo    | minimal validator                                          |
| `e2e/validator/src/**`              | nuovo    | check helpers                                              |
| `e2e/config/e2e-config.yaml`        | nuovo    | bot test config                                            |
| `e2e/fixtures/**`                   | nuovo    | media samples                                              |
| `e2e/README.md`                     | nuovo    | setup + comandi + troubleshoot                             |
| `package.json` (root)               | modifica | aggiunge `test:e2e:full` → `tsx e2e/run.ts`                |
| `.gitignore`                        | modifica | esclude `e2e/driver/.wwebjs_auth/`, `e2e/db/`, `e2e/logs/` |

## Validation criteria

- `tsc --noEmit` clean su `src/` e su `e2e/` (entrambi gli sub-progetti).
- `npm run test:e2e -- all` con `BOT_E2E_STUB_AI=1`: tutti gli scenari mock pass.
- Manuale: `npm run pair` in `e2e/driver/` apre QR, scan, log "ready".
- Manuale: `npx tsx e2e/run.ts basic-reply --ai stub` → bot riceve, risponde, validator pass.

## Riferimenti

- `docs/dev/15-runbook.md` (sezione test-e2e da estendere)
- `docs/dev/17-out-of-scope.md` (multi-account → carve-out "testing only in e2e/")
