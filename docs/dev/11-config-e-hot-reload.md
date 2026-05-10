# Config e hot reload

## File principale

`config/index.ts` (root del progetto, fuori da `src/`):

```ts
import type { ChatContext } from '../src/types'

export const config = {
  // WhatsApp
  sessionDir: './.wwebjs_auth',
  timezone: 'Europe/Rome',

  // Scheduler
  debounceMs: 120_000,
  hardCapMs: 600_000,
  minDelayMs: 5 * 60_000,
  maxDelayMs: 2 * 60 * 60_000,
  jitterPct: 0.20,
  nightWindow: { startHour: 22, endHour: 6 },
  rollingLatencyWindow: 5,
  fallbackDelayMs: 30 * 60_000,
  postReconnectSpreadMs: { min: 30_000, max: 180_000 },

  // Boot
  bootMaxChatsToFetch: 50,
  fetchConcurrency: 5,

  // Tick
  tickIntervalMs: 10_000,
  manualJobsTickIntervalMs: 30_000,

  // KB
  ephemeralTtlDays: 7,
  ragTopK: 8,
  embeddingModel: 'Xenova/bge-small-en-v1.5',

  // AI
  aiModel: 'opencode:anthropic/claude-sonnet-4-6',
  aiHistoryLimit: 30,
  aiMaxRetryParseFail: 1,

  // Logging
  logLevel: 'info' as 'trace' | 'debug' | 'info' | 'warn' | 'error',
  logFile: './logs/viet-chatter.log',
  logRotation: 'daily',
  logMaxSize: '50m',

  // Manual jobs
  reEngageDefaultThresholdDays: 14,
  reEngageColdAfterDays: 7,
  reEngageMinOutgoingHistory: 3,

  // DB
  dbPath: './viet-chatter.db',
} as const

export type Config = typeof config

export const shouldReply = (chat: ChatContext): boolean => {
  return chat.phone.startsWith('+84')
      && !['+84111111111', '+84222222222'].includes(chat.phone)
}
```

## Schema zod (`src/config/schema.ts`)

```ts
import { z } from 'zod'

export const ConfigSchema = z.object({
  sessionDir: z.string(),
  timezone: z.string(),
  debounceMs: z.number().int().positive(),
  hardCapMs: z.number().int().positive(),
  minDelayMs: z.number().int().positive(),
  maxDelayMs: z.number().int().positive(),
  jitterPct: z.number().min(0).max(1),
  nightWindow: z.object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
  }),
  rollingLatencyWindow: z.number().int().positive(),
  fallbackDelayMs: z.number().int().positive(),
  postReconnectSpreadMs: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
  }),
  bootMaxChatsToFetch: z.number().int().positive(),
  fetchConcurrency: z.number().int().positive(),
  tickIntervalMs: z.number().int().positive(),
  manualJobsTickIntervalMs: z.number().int().positive(),
  ephemeralTtlDays: z.number().int().positive(),
  ragTopK: z.number().int().positive(),
  embeddingModel: z.string(),
  aiModel: z.string(),
  aiHistoryLimit: z.number().int().positive(),
  aiMaxRetryParseFail: z.number().int().nonnegative(),
  logLevel: z.enum(['trace','debug','info','warn','error']),
  logFile: z.string(),
  logRotation: z.string(),
  logMaxSize: z.string(),
  reEngageDefaultThresholdDays: z.number().int().positive(),
  reEngageColdAfterDays: z.number().int().positive(),
  reEngageMinOutgoingHistory: z.number().int().nonnegative(),
  dbPath: z.string(),
})
```

## Loader con hot reload (`src/config/index.ts`)

```ts
import chokidar from 'chokidar'
import { ConfigSchema } from './schema'
import type { ChatContext } from '../types'
import { log } from '../log'

const CONFIG_PATH = require.resolve('../../config/index.ts')

let _config: Config
let _shouldReply: (c: ChatContext) => boolean

async function loadFresh() {
  // cache busting con query param sull'import dinamico (funziona con tsx/tsm)
  const fresh = await import('../../config/index.ts?v=' + Date.now())
  ConfigSchema.parse(fresh.config)
  // smoke test della predicate function
  fresh.shouldReply({
    phone: '+0', name: undefined, isSavedContact: false,
    lastMessageTs: 0, unreadCount: 0,
  })
  return { config: fresh.config, shouldReply: fresh.shouldReply }
}

export async function initConfig() {
  const fresh = await loadFresh()
  _config = fresh.config
  _shouldReply = fresh.shouldReply

  chokidar.watch(CONFIG_PATH).on('change', async () => {
    try {
      const next = await loadFresh()
      _config = next.config
      _shouldReply = next.shouldReply
      log.info('config reloaded')
    } catch (err) {
      log.error({ err }, 'config reload failed, keeping previous')
    }
  })
}

export const config = new Proxy({} as Config, {
  get: (_, key: string) => (_config as any)[key],
})

export function shouldReply(c: ChatContext): boolean {
  return _shouldReply(c)
}
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

| Caso | Comportamento |
|---|---|
| Edit del file con sintassi TS invalida | Compilazione/import fallisce, log error, config precedente resta. |
| Edit del file con valore zod-invalido | `ConfigSchema.parse` throw, log error, config precedente resta. |
| Edit di `shouldReply` con runtime crash | Smoke test la beccja, log error, predicate precedente resta. |
| Edit di `shouldReply` con cambio significativo (es. blocklist nuova) | Hot reload prende effetto al prossimo evento `message`. Le chat già in stato `ACCUMULATING`/`SCHEDULED` continuano normalmente (non si ri-applica filtro retroattivo). |
| Cambio di `dbPath` o `sessionDir` | NON ha effetto runtime (il DB è già aperto). Richiederebbe restart. Documentare in commento dentro `config/index.ts`. |
| Cambio di `embeddingModel` | NON ha effetto runtime se il modello è già caricato. Il modello in uso resta finchè il bot non riparte. |
| Cambio di `tickIntervalMs` | Effetto al prossimo tick (legge live). |
| Cambio di `nightWindow` | Effetto immediato sui calcoli successivi. |

## Restart-required parameters

Documentare in cima a `config/index.ts`:

```ts
// IMPORTANTE: i seguenti campi richiedono restart dell'app per avere effetto:
// - sessionDir, dbPath, embeddingModel, aiModel
// - logFile, logRotation (file handle aperto al boot)
// Tutti gli altri sono hot-reloadable.
```

## ENV vars

Niente `.env` per la config principale (tutto in `config/index.ts`). Le ENV vars riguardano solo OpenCode e plugin esterni:

- `OPENCODE_DISABLE_CLAUDE_CODE=1`
- `OPENCODE_DISABLE_DEFAULT_PLUGINS=1`

Settate dal modulo `src/ai/opencode.ts` automaticamente prima di lanciare il server.
