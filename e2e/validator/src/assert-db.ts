// Read-only DB helpers. Uses better-sqlite3 in readonly mode so concurrent
// bot writes never block validator reads (and validator can't accidentally
// mutate state).

import Database from 'better-sqlite3'
import type { Database as DB } from 'better-sqlite3'

export type Direction = 'in' | 'out_manual' | 'out_bot'

export function openReadonly(path: string): DB {
  return new Database(path, { readonly: true, fileMustExist: true })
}

export function countMessages(db: DB, chatId: string, direction?: Direction): number {
  if (direction) {
    const row = db
      .prepare(`SELECT COUNT(*) AS c FROM processed_messages WHERE chat_id = ? AND direction = ?`)
      .get(chatId, direction) as { c: number }
    return row.c
  }
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM processed_messages WHERE chat_id = ?`)
    .get(chatId) as { c: number }
  return row.c
}

export function countOutBotAll(db: DB): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM processed_messages WHERE direction = 'out_bot'`)
    .get() as { c: number }
  return row.c
}

export interface TurnLogRow {
  id: number
  chat_id: string
  ts: number
  status: 'sent' | 'skipped' | 'failed' | 'aborted' | 'escalated'
  language_used: string | null
  facts_extracted: number
  duration_ms: number | null
  error_msg: string | null
  triggered_by: 'reactive' | 'manual_job'
}

export function lastTurnLog(db: DB, chatId?: string): TurnLogRow | undefined {
  if (chatId) {
    return db
      .prepare(`SELECT * FROM turn_log WHERE chat_id = ? ORDER BY id DESC LIMIT 1`)
      .get(chatId) as TurnLogRow | undefined
  }
  return db.prepare(`SELECT * FROM turn_log ORDER BY id DESC LIMIT 1`).get() as TurnLogRow | undefined
}

export interface EscalationRow {
  id: number
  chat_id: string
  trigger_msg_id: string
  reason: 'scheduling' | 'commitment' | 'sensitive' | 'financial' | 'identity' | 'other'
  urgency: 'low' | 'normal' | 'high'
  summary: string
  status: 'pending' | 'user_replied' | 'superseded' | 'dismissed'
  created_at: number
  resolved_at: number | null
  notified_channels: string
}

export function lastEscalation(db: DB, chatId?: string): EscalationRow | undefined {
  if (chatId) {
    return db
      .prepare(`SELECT * FROM escalations WHERE chat_id = ? ORDER BY id DESC LIMIT 1`)
      .get(chatId) as EscalationRow | undefined
  }
  return db.prepare(`SELECT * FROM escalations ORDER BY id DESC LIMIT 1`).get() as
    | EscalationRow
    | undefined
}

export function countEscalations(db: DB, chatId?: string, status?: EscalationRow['status']): number {
  const clauses: string[] = []
  const params: unknown[] = []
  if (chatId) {
    clauses.push('chat_id = ?')
    params.push(chatId)
  }
  if (status) {
    clauses.push('status = ?')
    params.push(status)
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM escalations ${where}`)
    .get(...params) as { c: number }
  return row.c
}

export interface ManualJobRow {
  id: number
  chat_id: string
  kind: 'date_anchored' | 'revive' | 're_engage'
  fire_at: number
  status: 'pending' | 'firing' | 'fired' | 'superseded' | 'cancelled'
}

export function pendingManualJobs(db: DB, chatId?: string): ManualJobRow[] {
  if (chatId) {
    return db
      .prepare(`SELECT * FROM manual_jobs WHERE chat_id = ? AND status = 'pending' ORDER BY fire_at`)
      .all(chatId) as ManualJobRow[]
  }
  return db
    .prepare(`SELECT * FROM manual_jobs WHERE status = 'pending' ORDER BY fire_at`)
    .all() as ManualJobRow[]
}

// Most scenarios target a single chat; this picks the chat that received
// driver traffic so checks don't need to know the bot's number ahead of time.
export function mostRecentChatId(db: DB): string | undefined {
  const row = db
    .prepare(`SELECT chat_id FROM processed_messages ORDER BY ts DESC LIMIT 1`)
    .get() as { chat_id: string } | undefined
  return row?.chat_id
}
