// Spec D2 — Action: free-form read-only SQL.
//
// Opens a fresh readonly connection against the same DB file as the
// write handle. The driver itself rejects writes, so even if the AI emits
// `UPDATE ...` or `DELETE ...` we get a SQLITE_READONLY error instead of
// mutating state. Single statement only (better-sqlite3 prepare() enforces
// this — multi-statement scripts must go through .exec()).

import Database from 'better-sqlite3'
import type { Sqlite } from '../../db/client.js'
import type { ActionResult } from '../types.js'

export interface RunReadOnlySqlPayload {
  sql: string
  reason: string
}

const ROW_CAP = 200
const BUSY_TIMEOUT_MS = 2000

export async function executeRunReadOnlySql(
  payload: RunReadOnlySqlPayload,
  sqlite: Sqlite
): Promise<ActionResult> {
  const sql = payload.sql.trim()
  if (sql.length === 0) {
    return { success: false, message: 'empty sql' }
  }

  let ro: Database.Database
  try {
    ro = new Database(sqlite.name, { readonly: true, fileMustExist: true })
    ro.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`)
  } catch (err) {
    return {
      success: false,
      message: `failed to open readonly handle: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  try {
    const stmt = ro.prepare(sql)
    if (!stmt.reader) {
      return {
        success: false,
        message: 'statement is not a reader (only SELECT / PRAGMA read queries / WITH allowed)',
      }
    }
    const rows = stmt.all() as Array<Record<string, unknown>>
    const truncated = rows.length > ROW_CAP
    const out = truncated ? rows.slice(0, ROW_CAP) : rows
    return {
      success: true,
      message: truncated
        ? `${rows.length} rows (capped at ${ROW_CAP}). Reason: ${payload.reason}`
        : `${rows.length} rows. Reason: ${payload.reason}`,
      data: { rows: out, truncated, totalRows: rows.length, sql },
    }
  } catch (err) {
    return {
      success: false,
      message: `sql error: ${err instanceof Error ? err.message : String(err)}`,
    }
  } finally {
    ro.close()
  }
}
