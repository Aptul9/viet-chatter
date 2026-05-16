// Spec D2 — Action: toggle person_profile.engagement_state.

import type { Sqlite } from '../../db/client.js'
import { setEngagementState } from '../../db/repo.js'
import type { ActionResult } from '../types.js'

export interface UpdateEngagementPayload {
  chatId: string
  state: 'active' | 'cold'
}

export async function executeUpdateEngagement(
  payload: UpdateEngagementPayload,
  sqlite: Sqlite
): Promise<ActionResult> {
  const exists = sqlite
    .prepare('SELECT 1 AS one FROM person_profile WHERE chat_id = ?')
    .get(payload.chatId) as { one: number } | undefined
  if (!exists) {
    return {
      success: false,
      message: `no person_profile row for ${payload.chatId}; cannot update engagement state`,
    }
  }
  setEngagementState(sqlite, payload.chatId, payload.state)
  return {
    success: true,
    message: `Engagement state for ${payload.chatId} set to ${payload.state}.`,
  }
}
