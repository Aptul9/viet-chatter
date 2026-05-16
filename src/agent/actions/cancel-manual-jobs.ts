// Spec D2 — Action: cancel pending manual_jobs by id list / chat / kind.

import type { Sqlite } from '../../db/client.js'
import type { ActionResult } from '../types.js'

export interface CancelManualJobsPayload {
  chatId?: string
  kind?: 'date_anchored' | 'revive' | 're_engage'
  jobIds?: number[]
}

export async function executeCancelManualJobs(
  payload: CancelManualJobsPayload,
  sqlite: Sqlite
): Promise<ActionResult> {
  const conditions: string[] = ["status = 'pending'"]
  const values: unknown[] = []
  if (payload.jobIds && payload.jobIds.length > 0) {
    const placeholders = payload.jobIds.map(() => '?').join(',')
    conditions.push(`id IN (${placeholders})`)
    values.push(...payload.jobIds)
  }
  if (payload.chatId) {
    conditions.push('chat_id = ?')
    values.push(payload.chatId)
  }
  if (payload.kind) {
    conditions.push('kind = ?')
    values.push(payload.kind)
  }
  if (conditions.length === 1) {
    return {
      success: false,
      message:
        'refusing to cancel ALL pending jobs without at least one filter (chatId / kind / jobIds)',
    }
  }
  const sql = `UPDATE manual_jobs SET status = 'cancelled' WHERE ${conditions.join(' AND ')}`
  const result = sqlite.prepare(sql).run(...values)
  return {
    success: true,
    message: `Cancelled ${result.changes} pending manual job(s).`,
    data: { changes: result.changes },
  }
}
