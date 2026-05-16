// Spec D2 — Action: mark a pending escalation as dismissed.

import type { Sqlite } from '../../db/client.js'
import type { ActionResult } from '../types.js'

export interface DismissEscalationPayload {
  escalationId: number
}

export async function executeDismissEscalation(
  payload: DismissEscalationPayload,
  sqlite: Sqlite
): Promise<ActionResult> {
  const result = sqlite
    .prepare(
      "UPDATE escalations SET status = 'dismissed', resolved_at = ? WHERE id = ? AND status = 'pending'"
    )
    .run(Date.now(), payload.escalationId)
  if (result.changes === 0) {
    return {
      success: false,
      message: `Escalation #${payload.escalationId} not found or not pending.`,
    }
  }
  return { success: true, message: `Escalation #${payload.escalationId} dismissed.` }
}
