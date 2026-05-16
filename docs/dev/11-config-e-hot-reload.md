# Config e hot reload

> **Source of truth**: `config/user-config.example.yaml` (committato) e `config/defaults.ts` (defaults TS tipati). Comportamento canonico in `19-implementation-notes.md` §2.

## Source of truth

Lo stato runtime e' definito da due file:

- `config/defaults.ts`: defaults TypeScript (un solo `export const defaults = { ... }`, niente IO, niente filter logic).
- `config/user-config.yaml`: overrides utente in YAML (opzionale, gitignored). Se assente si tenta `config/user-config.example.yaml`; se anche questo manca si usano i defaults nudi.

Il file `config/index.ts` (root) carica defaults + YAML, fa deep-merge (arrays REPLACE, objects merge ricorsivo) ed espone `config` + `shouldReply`. La predicate e' generata 100% dal blocco `filter` del YAML: non esiste piu' un escape hatch TS.

## `config/defaults.ts`

```ts
export const defaults = {
  // WhatsApp
  sessionDir: './.wwebjs_auth',
  timezone: 'Europe/Rome',

  // Scheduler
  debounceMs: 120_000,
  hardCapMs: 600_000,
  minDelayMs: 5 * 60_000,
  maxDelayMs: 2 * 60 * 60_000,
  jitterPct: 0.2,
  nightWindow: { startHour: 22, endHour: 6 },
  rollingLatencyWindow: 5,
  fallbackDelayMs: 30 * 60_000,
  postReconnectSpreadMs: { min: 30_000, max: 180_000 },

  // ... (vedi file per il blocco completo: boot, tick, KB, AI, logging, manual jobs, escalation, dbPath)

  // Filter (declarative)
  filter: {
    allowedPrefixes: ['+84'] as string[],
    blockedNumbers: [] as string[],
    savedContactsOnly: false,
    unreadOnly: false,
  },
}

export type Defaults = typeof defaults
```

## `config/user-config.example.yaml`

YAML pienamente popolato con commenti inline per ogni campo: unita' (`ms`, `seconds`, `days`, `chars`), descrizione one-liner, marker `# RESTART REQUIRED` sui campi che richiedono restart del processo (`sessionDir`, `dbPath`, `embeddingModel`, `aiModel`, `logFile`, `logRotation`).

Estratto (vedi file per il dump completo):

```yaml
# viet-chatter user config. Overrides defaults from `config/defaults.ts`.
# Hot-reloaded by the bot via chokidar. Saved by the web UI (`npm run dev:web`)
# but safe to edit by hand too. Copy this file to `user-config.yaml` to enable.

sessionDir: './.wwebjs_auth' # directory wweb.js auth state; RESTART REQUIRED
timezone: 'Europe/Rome' # IANA tz for night-window and scheduling math

debounceMs: 120000 # ms; quiet window before considering a burst closed
# ...

filter:
  allowedPrefixes:
    - '+84'
  blockedNumbers: []
  savedContactsOnly: false
  unreadOnly: false
```

## Schema zod (`src/config/schema.ts`)

Validazione runtime di tutto il config, incluso il blocco `filter`:

```ts
filter: z.object({
  allowedPrefixes: z.array(z.string()),
  blockedNumbers: z.array(z.string()),
  savedContactsOnly: z.boolean(),
  unreadOnly: z.boolean(),
}),
```

Lo schema completo include tutti gli altri campi (scheduler, KB, AI, logging, escalation, ecc.).

## Loader con hot reload (`src/config/index.ts`)

```ts
import chokidar from 'chokidar'
import { parse as parseYaml } from 'yaml'
import { ConfigSchema } from './schema'
import { defaults } from '../../config/defaults'
import type { ChatContext } from '../types'

let _config: typeof defaults
let _shouldReply: (c: ChatContext) => boolean

function loadFromYaml() {
  const path = existsSync(USER_YAML_ABS) ? USER_YAML_ABS : EXAMPLE_YAML_ABS
  const overrides = existsSync(path) ? parseYaml(readFileSync(path, 'utf8')) : null
  const merged = deepMerge(defaults, overrides)
  ConfigSchema.parse(merged)
  const pred = (chat) => {
    /* generato dal blocco filter */
  }
  return { config: merged, shouldReply: pred }
}

export async function initConfig() {
  const fresh = loadFromYaml()
  _config = fresh.config
  _shouldReply = fresh.shouldReply
  chokidar.watch(USER_YAML_ABS).on('change' /* re-load + swap atomico */)
}

export const config = new Proxy({} as typeof defaults, {
  get: (_, key) => _config[key],
})
```

## Pattern di consumo

Tutto il codice business legge tramite `config.X` (il proxy), mai catturare in closure:

```ts
// SI
function tick() {
  if (Date.now() < lastTick + config.tickIntervalMs) return
}

// NO (cattura il valore al boot, niente hot reload)
const interval = config.tickIntervalMs
function tick() {
  if (Date.now() < lastTick + interval) return
}
```

## Edge case dell'hot reload

| Caso                                                              | Comportamento                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit di `config/user-config.yaml` con YAML invalido               | Parse fallisce, log error, config precedente resta in memoria.                                                                                                                                                    |
| Edit con valore zod-invalido                                      | `ConfigSchema.parse` throw, log error, config precedente resta.                                                                                                                                                   |
| Edit del blocco `filter`                                          | Hot reload prende effetto al prossimo evento `message`. Le chat gia' in stato `ACCUMULATING`/`SCHEDULED` continuano normalmente (non si ri-applica filtro retroattivo).                                           |
| Cambio di `dbPath` o `sessionDir`                                 | NON ha effetto runtime (il DB e' gia' aperto). Richiede restart. Marker `# RESTART REQUIRED` nel YAML.                                                                                                            |
| Cambio di `embeddingModel`                                        | NON ha effetto runtime se il modello e' gia' caricato. Restart richiesto.                                                                                                                                         |
| Cambio di `tickIntervalMs`                                        | Effetto al prossimo tick (legge live).                                                                                                                                                                            |
| Cambio di `nightWindow`                                           | Effetto immediato sui calcoli successivi.                                                                                                                                                                         |
| Cambio di `escalation.enabled` (true → false)                     | Effetto immediato: escalations gia' pendenti restano in DB ma non vengono piu' rinotificate. Nuovi turn non emettono escalation (l'AI riceve hint nel context per disattivare).                                   |
| Cambio di `escalation.channels`                                   | Effetto immediato sul prossimo notify. Escalations gia' notificate non si rinotificano automaticamente sul nuovo canale.                                                                                          |
| Cambio di `escalation.telegramBotTokenEnv`                        | NON ha effetto: la ENV var viene letta a ogni notify dal nome configurato, ma il nome stesso cambia solo a hot-reload, e poi viene letto live. Funziona se aggiungi una nuova ENV var prima di salvare il config. |
| Salvataggio del file `user-config.yaml` da parte della UI Next.js | chokidar vede il change, re-parse + re-validate + swap. La UI mostra toast "Bot will hot-reload from YAML.".                                                                                                      |

## Restart-required parameters

Marker `# RESTART REQUIRED` inline nel YAML su:

- `sessionDir`, `dbPath`, `embeddingModel`, `aiModel`
- `logFile`, `logRotation` (file handle aperto al boot)

Tutti gli altri sono hot-reloadable.

## ENV vars

Niente `.env` per la config principale (tutto in `config/defaults.ts` + `config/user-config.yaml`).

Le ENV vars sono usate per:

- **OpenCode**:
  - `OPENCODE_DISABLE_CLAUDE_CODE=1` (default true: blocca CLAUDE.md / AGENTS.md auto-injection).
  - `OPENCODE_DISABLE_DEFAULT_PLUGINS=false` (NON flippare a `1`: rompe i provider plugin. Vedi `19-implementation-notes.md` §8).
  - `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_LSP`.
  - Settate dal modulo `src/ai/opencode.ts` automaticamente prima di lanciare il server.
- **Escalation (Telegram)**:
  - `TELEGRAM_BOT_TOKEN`: token del bot Telegram.
  - `TELEGRAM_USER_CHAT_ID`: chat_id Telegram dell'utente. Supporta comma-separated per broadcast multi-recipient (vedi `19-implementation-notes.md` §6).
  - Lette a ogni notify (live, non cached).

`.env` (gitignored) di esempio:

```
TELEGRAM_BOT_TOKEN=123456789:AAA-bbb-ccc-ddd-eee
TELEGRAM_USER_CHAT_ID=987654321
# Oppure broadcast: TELEGRAM_USER_CHAT_ID=987654321,123456,789012
```

`.env` viene caricato automaticamente via `import 'dotenv/config'` in cima a `src/index.ts` e `src/scripts/{health,test-e2e}.ts`.

Vedi anche `15-runbook.md` per setup Telegram step-by-step.
