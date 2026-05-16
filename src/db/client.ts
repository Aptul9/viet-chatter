import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema.js'

export type Sqlite = Database.Database
export type Db = ReturnType<typeof drizzle<typeof schema>>

export function openDb(path: string): { sqlite: Sqlite; db: Db } {
  const sqlite = new Database(path)
  sqliteVec.load(sqlite)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  ensureAdditiveSchema(sqlite)
  const db = drizzle(sqlite, { schema })
  return { sqlite, db }
}

/**
 * Apply additive schema migrations not yet committed as drizzle migration
 * files. Idempotent via CREATE IF NOT EXISTS. Used for tables added after
 * v1 ship that are not on the critical-path (currently: agent_commands for
 * Spec D2). A future db:generate run will fold these into a real migration.
 */
function ensureAdditiveSchema(sqlite: Sqlite): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agent_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'proposed',
      error_msg TEXT,
      proposed_at INTEGER NOT NULL,
      executed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_ac_session ON agent_commands (session_id);
    CREATE INDEX IF NOT EXISTS idx_ac_proposed ON agent_commands (proposed_at);
  `)
}
