# Config and hot reload

> **Source of truth**: `config/user-config.example.yaml` (committed) and `config/defaults.ts` (typed TS defaults).

## Source of truth

The runtime state is defined by two files:

- `config/defaults.ts`: TypeScript defaults (single `export const defaults = { ... }`, no IO, no filter logic).
- `config/user-config.yaml`: user overrides in YAML (optional, gitignored). If absent, `config/user-config.example.yaml` is tried; if that's also missing, bare defaults are used.

The `config/index.ts` file (root) loads defaults + YAML, performs deep-merge (arrays REPLACE, objects merge recursively) and exposes `config` + `shouldReply`. The predicate is generated 100% from the `filter` block of the YAML: there is no longer a TS escape hatch.

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

  // ... (see file for the complete block: boot, tick, KB, AI, logging, manual jobs, escalation, dbPath)

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

YAML fully populated with inline comments for each field: units (`ms`, `seconds`, `days`, `chars`), one-liner description, `# RESTART REQUIRED` marker on fields that require process restart (`sessionDir`, `dbPath`, `embeddingModel`, `aiModel`, `logFile`, `logRotation`).

Extract (see file for the complete dump):

```yaml
# viet-chatter user config. Overrides defaults from `config/defaults.ts`.
# Hot-reloaded by the bot via chokidar. Saved by the web UI (`npm run dev:web`)
# but safe to edit by hand too. Copy this file to `user-config.yaml` to enable.

sessionDir: './.wwebjs_auth' # wweb.js auth state directory; RESTART REQUIRED
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

## Zod schema (`src/config/schema.ts`)

Runtime validation of all config, including the `filter` block:

```ts
filter: z.object({
  allowedPrefixes: z.array(z.string()),
  blockedNumbers: z.array(z.string()),
  savedContactsOnly: z.boolean(),
  unreadOnly: z.boolean(),
}),
```

The complete schema includes all other fields (scheduler, KB, AI, logging, escalation, etc.).

## Loader with hot reload (`src/config/index.ts`)

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
    /* generated from the filter block */
  }
  return { config: merged, shouldReply: pred }
}

export async function initConfig() {
  const fresh = loadFromYaml()
  _config = fresh.config
  _shouldReply = fresh.shouldReply
  chokidar.watch(USER_YAML_ABS).on('change' /* re-load + atomic swap */)
}

export const config = new Proxy({} as typeof defaults, {
  get: (_, key) => _config[key],
})
```

## Consumption pattern

All business code reads through `config.X` (the proxy), never capture in closure:

```ts
// YES
function tick() {
  if (Date.now() < lastTick + config.tickIntervalMs) return
}

// NO (captures the value at boot, no hot reload)
const interval = config.tickIntervalMs
function tick() {
  if (Date.now() < lastTick + interval) return
}
```

## Hot reload edge cases

| Case                                                              | Behavior                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit of `config/user-config.yaml` with invalid YAML               | Parse fails, log error, previous config stays in memory.                                                                                                                                                          |
| Edit with zod-invalid value                                       | `ConfigSchema.parse` throws, log error, previous config stays.                                                                                                                                                    |
| Edit of `filter` block                                            | Hot reload takes effect at next `message` event. Chats already in `ACCUMULATING`/`SCHEDULED` state continue normally (no retroactive filter re-application).                                                      |
| Change of `dbPath` or `sessionDir`                                | NO runtime effect (the DB is already open). Requires restart. `# RESTART REQUIRED` marker in YAML.                                                                                                                |
| Change of `embeddingModel`                                        | NO runtime effect if the model is already loaded. Restart required.                                                                                                                                               |
| Change of `tickIntervalMs`                                        | Effect at next tick (read live).                                                                                                                                                                                  |
| Change of `nightWindow`                                           | Immediate effect on subsequent calculations.                                                                                                                                                                      |
| Change of `escalation.enabled` (true -> false)                    | Immediate effect: already pending escalations stay in DB but are no longer re-notified. New turns don't emit escalation (the AI receives hint in context to disable).                                             |
| Change of `escalation.channels`                                   | Immediate effect on next notify. Already-notified escalations are not automatically re-notified on the new channel.                                                                                               |
| Change of `escalation.telegramBotTokenEnv`                        | NO effect: the ENV var is read at each notify from the configured name, but the name itself changes only on hot-reload, and then is read live. Works if you add a new ENV var before saving the config.           |
| File `user-config.yaml` saved by the Next.js UI                   | chokidar sees the change, re-parse + re-validate + swap. The UI shows "Bot will hot-reload from YAML." toast.                                                                                                     |

## Restart-required parameters

`# RESTART REQUIRED` marker inline in YAML on:

- `sessionDir`, `dbPath`, `embeddingModel`, `aiModel`
- `logFile`, `logRotation` (file handle opened at boot)

All others are hot-reloadable.

## ENV vars

No `.env` for the main config (everything in `config/defaults.ts` + `config/user-config.yaml`).

ENV vars are used for:

- **OpenCode**:
  - `OPENCODE_DISABLE_CLAUDE_CODE=1` (default true: blocks CLAUDE.md / AGENTS.md auto-injection).
  - `OPENCODE_DISABLE_DEFAULT_PLUGINS=false` (do NOT flip to `1`: breaks provider plugins).
  - `OPENCODE_DISABLE_AUTOUPDATE`, `OPENCODE_DISABLE_LSP`.
  - Set automatically by `src/ai/opencode.ts` module before launching the server.
- **Escalation (Telegram)**:
  - `TELEGRAM_BOT_TOKEN`: Telegram bot token.
  - `TELEGRAM_USER_CHAT_ID`: user's Telegram chat_id. Supports comma-separated for multi-recipient broadcast.
  - Read at each notify (live, not cached).

Example `.env` (gitignored):

```
TELEGRAM_BOT_TOKEN=123456789:AAA-bbb-ccc-ddd-eee
TELEGRAM_USER_CHAT_ID=987654321
# Or broadcast: TELEGRAM_USER_CHAT_ID=987654321,123456,789012
```

`.env` is loaded automatically via `import 'dotenv/config'` at the top of `src/index.ts` and `src/scripts/{health,test-e2e}.ts`.

See also `15-runbook.md` for step-by-step Telegram setup.
