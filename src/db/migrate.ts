import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { openDb } from './client.js'

const dbPath = process.env['DB_PATH'] ?? './viet-chatter.db'
const { db, sqlite } = openDb(dbPath)
migrate(db, { migrationsFolder: './drizzle' })
sqlite.close()
// eslint-disable-next-line no-console
console.log(JSON.stringify({ level: 'info', msg: 'migrations applied', dbPath }))
