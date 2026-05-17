// Spec D2 — Build the AgentContext fed to the planning AI.
//
// We expose enough current state for the model to produce concrete actions
// (real chat ids, real escalation ids, real job ids, real timezones) without
// dumping the whole DB. Cap each list aggressively to keep the prompt under
// a few KB.

import type { Sqlite } from '../db/client.js'
import { config } from '../config/index.js'

const MAX_CHATS = 50
const MAX_JOBS = 20

// Tables intentionally hidden from the SQL tool's schema dump: drizzle
// migration metadata + sqlite-vec internal shadow tables (vector storage,
// rowid maps, chunk indexes — opaque to the AI and would only clutter the
// prompt).
const SCHEMA_HIDDEN_TABLES = new Set(['__drizzle_migrations', 'sqlite_sequence'])
const SCHEMA_HIDDEN_SUFFIXES = ['_chunks', '_info', '_rowids']
function isHiddenTable(name: string): boolean {
  if (SCHEMA_HIDDEN_TABLES.has(name)) return true
  if (SCHEMA_HIDDEN_SUFFIXES.some((s) => name.endsWith(s))) return true
  if (/_vector_chunks\d+$/.test(name)) return true
  return false
}

export interface AgentChatEntry {
  chatId: string
  displayName: string | null
  lastMsgIso: string | null
}

export interface AgentJobEntry {
  id: number
  chatId: string
  displayName: string | null
  kind: string
  fireAtIso: string
}

export interface AgentSchemaColumn {
  name: string
  type: string
  notNull: boolean
  pk: boolean
}

export interface AgentSchemaTable {
  name: string
  columns: AgentSchemaColumn[]
}

export interface AgentContext {
  nowIso: string
  timezone: string
  chats: AgentChatEntry[]
  pendingManualJobs: AgentJobEntry[]
  schema: AgentSchemaTable[]
}

export function buildAgentContext(sqlite: Sqlite): AgentContext {
  const now = Date.now()
  const nowIso = new Date(now).toISOString()

  const chats = (
    sqlite
      .prepare(
        `SELECT pm.chat_id AS chat_id, pp.display_name AS display_name, MAX(pm.ts) AS last_ts
         FROM processed_messages pm
         LEFT JOIN person_profile pp ON pp.chat_id = pm.chat_id
         GROUP BY pm.chat_id
         ORDER BY last_ts DESC
         LIMIT ?`
      )
      .all(MAX_CHATS) as Array<{
      chat_id: string
      display_name: string | null
      last_ts: number | null
    }>
  ).map<AgentChatEntry>((r) => ({
    chatId: r.chat_id,
    displayName: r.display_name,
    lastMsgIso: r.last_ts != null ? new Date(r.last_ts).toISOString() : null,
  }))

  const pendingManualJobs = (
    sqlite
      .prepare(
        `SELECT mj.id, mj.chat_id AS chat_id, pp.display_name AS display_name, mj.kind, mj.fire_at
         FROM manual_jobs mj
         LEFT JOIN person_profile pp ON pp.chat_id = mj.chat_id
         WHERE mj.status = 'pending'
         ORDER BY mj.fire_at ASC
         LIMIT ?`
      )
      .all(MAX_JOBS) as Array<{
      id: number
      chat_id: string
      display_name: string | null
      kind: string
      fire_at: number
    }>
  ).map<AgentJobEntry>((r) => ({
    id: r.id,
    chatId: r.chat_id,
    displayName: r.display_name,
    kind: r.kind,
    fireAtIso: new Date(r.fire_at).toISOString(),
  }))

  return {
    nowIso,
    timezone: config.timezone,
    chats,
    pendingManualJobs,
    schema: getDbSchema(sqlite),
  }
}

function getDbSchema(sqlite: Sqlite): AgentSchemaTable[] {
  // We deliberately skip virtual tables (sqlite-vec `facts_vec` etc.):
  // PRAGMA table_info() on a virtual table requires the backing module to be
  // loaded into the same connection, and the dashboard's read-only handle
  // does not load `sqlite-vec`. If the AI ever needs to introspect the vec
  // tables directly, we'd need to either load the extension here or feed it
  // the column list from `sqlite_master.sql` parsing.
  const tables = sqlite
    .prepare(
      `SELECT name, sql FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
       ORDER BY name`
    )
    .all() as Array<{ name: string; sql: string | null }>

  const out: AgentSchemaTable[] = []
  for (const row of tables) {
    if (isHiddenTable(row.name)) continue
    if (row.sql && /^\s*CREATE\s+VIRTUAL\s+TABLE/i.test(row.sql)) continue
    const cols = sqlite.prepare(`PRAGMA table_info(${quoteIdent(row.name)})`).all() as Array<{
      cid: number
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }>
    out.push({
      name: row.name,
      columns: cols.map((c) => ({
        name: c.name,
        type: c.type,
        notNull: c.notnull === 1,
        pk: c.pk > 0,
      })),
    })
  }
  return out
}

function quoteIdent(name: string): string {
  // SQLite identifier quoting: wrap in double quotes, escape internal quotes.
  // PRAGMA table_info accepts a bare identifier but quoting is safer if the
  // schema ever grows reserved-word table names.
  return `"${name.replace(/"/g, '""')}"`
}
