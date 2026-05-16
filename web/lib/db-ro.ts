// Read-only DB handle for the dashboard (Spec C).
//
// Next.js runs as a separate process from the bot; we open our own
// better-sqlite3 connection in readonly mode. SQLite WAL is already enabled
// at bot boot (src/db/client.ts), so readers don't block writers.

import Database from 'better-sqlite3'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { repoRoot } from './config-path'

let cached: Database.Database | null = null

/** Default DB path: `<repo-root>/viet-chatter.db`. Overridable via env. */
function resolveDbPath(): string {
  const fromEnv = process.env['VIET_CHATTER_DB_PATH']
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const repoLocal = resolve(repoRoot(), 'viet-chatter.db')
  return repoLocal
}

/** Open or return the cached readonly handle. Lazy + safe to call repeatedly. */
export function getReadOnlyDb(): Database.Database {
  if (cached) return cached
  const path = resolveDbPath()
  if (!existsSync(path)) {
    throw new Error(
      `DB not found at ${path}. Run "npm run db:migrate" and ensure the bot has been started at least once.`
    )
  }
  cached = new Database(path, { readonly: true, fileMustExist: true })
  cached.pragma('busy_timeout = 1000')
  return cached
}

export function getDbPathForDisplay(): string {
  return resolveDbPath()
}
