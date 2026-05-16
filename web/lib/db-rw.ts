// Spec D2 — Read-write DB handle for agent actions.
//
// Separate from `db-ro.ts` so the dashboard's read-only routes never
// accidentally open a writable connection. Used only by the agent endpoints.

import Database from 'better-sqlite3'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

import { repoRoot } from './config-path'

let cached: Database.Database | null = null

function resolveDbPath(): string {
  const fromEnv = process.env['VIET_CHATTER_DB_PATH']
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  return resolve(repoRoot(), 'viet-chatter.db')
}

/**
 * Lazy read-write connection. WAL is already enabled on the file by the bot,
 * so the writer (bot) and this writer (agent) coexist via SQLite's busy
 * handler; agent writes are short transactions and acceptable to interleave.
 */
export function openWriteDb(): Database.Database {
  if (cached) return cached
  const path = resolveDbPath()
  if (!existsSync(path)) {
    throw new Error(
      `DB not found at ${path}. Run "npm run db:migrate" and start the bot at least once.`
    )
  }
  cached = new Database(path)
  cached.pragma('busy_timeout = 3000')
  return cached
}
