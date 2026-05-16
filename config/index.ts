// Runtime config + filter predicate.
//
// Defaults live in `config/defaults.ts`. At module load, if
// `config/user-config.yaml` exists its values deep-merge over the defaults
// (arrays REPLACE, objects merge recursively). If `user-config.yaml` is
// missing the example file is tried; if neither exists, defaults stand alone.
//
// The reply filter is YAML-only (no TS escape hatch). The predicate is
// generated from `merged.filter`.
//
// Restart required for: sessionDir, dbPath, embeddingModel, aiModel,
//                       logFile, logRotation.
// Everything else is hot-reloadable via chokidar (see src/config/index.ts).

import { readFileSync, existsSync } from 'node:fs'
import { resolve as resolvePath, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

import { defaults, type Defaults } from './defaults.js'
import type { ChatContext } from '../src/types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const USER_YAML_PATH = resolvePath(__dirname, 'user-config.yaml')
const EXAMPLE_YAML_PATH = resolvePath(__dirname, 'user-config.example.yaml')

export type Config = Defaults

// ---------------------------------------------------------------------------
// Load + merge
// ---------------------------------------------------------------------------

type Json = unknown

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// Deep-merge: arrays in `override` REPLACE; objects merge recursively;
// scalars in `override` win. Unknown keys are stripped by the zod schema
// downstream (in src/config/schema.ts) so leaving them here is fine.
function deepMerge<T>(base: T, override: Json): T {
  if (override === undefined || override === null) return base
  if (!isPlainObject(base) || !isPlainObject(override)) {
    // Scalars or arrays: override wins.
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

function readYamlIfExists(path: string): Json | null {
  if (!existsSync(path)) return null
  try {
    const raw = readFileSync(path, 'utf8')
    return parseYaml(raw) as Json
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'warn',
        msg: 'user-config yaml unreadable, ignoring',
        path,
        err: err instanceof Error ? err.message : String(err),
      })
    )
    return null
  }
}

function loadUserYaml(): Json | null {
  const fromUser = readYamlIfExists(USER_YAML_PATH)
  if (fromUser !== null) return fromUser
  return readYamlIfExists(EXAMPLE_YAML_PATH)
}

const overrides = loadUserYaml()
export const config: Config = deepMerge(defaults, overrides)

// ---------------------------------------------------------------------------
// shouldReply: 100% derived from merged.filter
// ---------------------------------------------------------------------------

export const shouldReply = (chat: ChatContext): boolean => {
  const f = config.filter
  if (f.allowedPrefixes.length > 0) {
    if (!f.allowedPrefixes.some((p) => chat.phone.startsWith(p))) return false
  }
  if (f.blockedNumbers.includes(chat.phone)) return false
  if (f.savedContactsOnly && !chat.isSavedContact) return false
  if (f.unreadOnly && chat.unreadCount <= 0) return false
  return true
}
