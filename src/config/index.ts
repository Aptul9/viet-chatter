import { pathToFileURL } from 'node:url'
import { resolve as resolvePath } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import chokidar from 'chokidar'
import { parse as parseYaml } from 'yaml'

import { ConfigSchema } from './schema.js'
import { defaults } from '../../config/defaults.js'
import { setLogLevel } from '../log.js'
import type { ChatContext } from '../types.js'

// NOTE: do NOT import `../log` for the logger instance; only the level setter
// (no circular dep — setLogLevel just mutates pino.level). Config self-events
// still use console.
//
// Restart-required fields are documented in `config/index.ts` (root):
// sessionDir, dbPath, embeddingModel, aiModel, logFile, logRotation.
//
// We watch `config/user-config.yaml` only. The root `config/index.ts` defines
// the merge + shouldReply logic; it does not change at runtime.

type RootConfigModule = {
  config: unknown
  shouldReply: (c: ChatContext) => boolean
}

const ROOT_CONFIG_ABS = resolvePath(process.cwd(), 'config/index.ts')
const USER_YAML_ABS = resolvePath(process.cwd(), 'config/user-config.yaml')
const EXAMPLE_YAML_ABS = resolvePath(process.cwd(), 'config/user-config.example.yaml')

type ConfigRuntime = typeof defaults

let _config: ConfigRuntime | null = null
let _shouldReply: ((c: ChatContext) => boolean) | null = null

async function loadFresh(): Promise<{
  config: ConfigRuntime
  shouldReply: (c: ChatContext) => boolean
}> {
  // Re-import the root config module fresh so changes to `config/index.ts`
  // itself (rare) are picked up too. The module reads the YAML on load.
  const url = pathToFileURL(ROOT_CONFIG_ABS).href + '?v=' + Date.now()
  const fresh = (await import(url)) as RootConfigModule
  ConfigSchema.parse(fresh.config)
  // Smoke-test the predicate.
  fresh.shouldReply({
    phone: '+0',
    name: undefined,
    isSavedContact: false,
    lastMessageTs: 0,
    unreadCount: 0,
  })
  return { config: fresh.config as ConfigRuntime, shouldReply: fresh.shouldReply }
}

// In hot-reload we cannot bust the module cache for the YAML read inside the
// root module easily on every change (Node ESM cache), so we re-parse the YAML
// here, deep-merge over defaults, and re-validate, then swap atomically.
function loadFromYaml(): { config: ConfigRuntime; shouldReply: (c: ChatContext) => boolean } {
  const path = existsSync(USER_YAML_ABS) ? USER_YAML_ABS : EXAMPLE_YAML_ABS
  const overrides = existsSync(path) ? (parseYaml(readFileSync(path, 'utf8')) as unknown) : null
  const merged = deepMerge(defaults, overrides) as ConfigRuntime
  ConfigSchema.parse(merged)
  const pred = (chat: ChatContext): boolean => {
    const f = merged.filter
    if (f.allowedPrefixes.length > 0) {
      if (!f.allowedPrefixes.some((p) => chat.phone.startsWith(p))) return false
    }
    if (f.blockedNumbers.includes(chat.phone)) return false
    if (f.savedContactsOnly && !chat.isSavedContact) return false
    if (f.unreadOnly && chat.unreadCount <= 0) return false
    return true
  }
  // Smoke-test.
  pred({ phone: '+0', name: undefined, isSavedContact: false, lastMessageTs: 0, unreadCount: 0 })
  return { config: merged, shouldReply: pred }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function deepMerge<T>(base: T, override: unknown): T {
  if (override === undefined || override === null) return base
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override as T
  }
  const out: Record<string, unknown> = { ...base }
  for (const key of Object.keys(override)) {
    const b = (base as Record<string, unknown>)[key]
    const o = (override as Record<string, unknown>)[key]
    if (isPlainObject(b) && isPlainObject(o)) {
      out[key] = deepMerge(b, o)
    } else {
      out[key] = o
    }
  }
  return out as T
}

async function reload(source: string): Promise<void> {
  try {
    const next = loadFromYaml()
    _config = next.config
    _shouldReply = next.shouldReply
    setLogLevel(next.config.logLevel)
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        msg: 'config reloaded',
        source,
        logLevel: next.config.logLevel,
      })
    )
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        msg: 'config reload failed, keeping previous',
        source,
        err: err instanceof Error ? err.message : String(err),
      })
    )
  }
}

export async function initConfig(): Promise<void> {
  // First load: use the root module so a faulty defaults file is caught early.
  const fresh = await loadFresh()
  _config = fresh.config
  _shouldReply = fresh.shouldReply

  const watcher = chokidar.watch([USER_YAML_ABS], {
    ignoreInitial: true,
  })
  watcher.on('change', (path) => reload(path))
  watcher.on('add', (path) => reload(path))
  watcher.on('unlink', (path) => reload(path))
}

// Lazy synchronous initialization used by callers that did not run
// `initConfig()` (the Next.js web process, scripts that only need the YAML
// snapshot, etc.). The bot still calls `initConfig()` explicitly to also
// start the chokidar watcher for hot-reload.
function ensureLoadedSync(): void {
  if (_config) return
  const next = loadFromYaml()
  _config = next.config
  _shouldReply = next.shouldReply
  setLogLevel(next.config.logLevel)
}

// Proxy: every access reads the live value so hot-reload propagates without
// callers needing to re-resolve references. Auto-loads from YAML on first
// access if no `initConfig()` was called (web/dashboard path).
export const config = new Proxy({} as ConfigRuntime, {
  get: (_target, key: string | symbol) => {
    if (!_config) ensureLoadedSync()
    return (_config as unknown as Record<string | symbol, unknown>)[key as string]
  },
})

export function shouldReply(c: ChatContext): boolean {
  if (!_shouldReply) ensureLoadedSync()
  return _shouldReply!(c)
}

/**
 * Test-only escape hatch (Spec B). Replaces fields on the live `_config`
 * object so the `config` Proxy reflects them immediately. Gated by
 * `BOT_E2E_MODE=1` env to prevent accidental production use.
 */
export function __overrideConfigForTest(partial: Partial<ConfigRuntime>): void {
  if (process.env['BOT_E2E_MODE'] !== '1' && process.env['NODE_ENV'] !== 'test') {
    throw new Error('__overrideConfigForTest only allowed when BOT_E2E_MODE=1 or NODE_ENV=test')
  }
  if (!_config) {
    throw new Error('config not initialized')
  }
  _config = { ..._config, ...partial } as ConfigRuntime
}

export type { Config } from '../../config/index.js'
