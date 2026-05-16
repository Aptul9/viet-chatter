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
  const db = drizzle(sqlite, { schema })
  return { sqlite, db }
}
