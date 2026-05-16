// Spec D2 — Action: create a manual_jobs row (date_anchored or revive).

import type { Sqlite } from '../../db/client.js'
import { insertManualJob } from '../../db/repo.js'
import type { ActionResult } from '../types.js'

export interface CreateManualJobPayload {
  chatId: string
  kind: 'date_anchored' | 'revive'
  fireAtIso: string
  action: string
  recurring?: 'yearly' | null
}

export async function executeCreateManualJob(
  payload: CreateManualJobPayload,
  sqlite: Sqlite
): Promise<ActionResult> {
  const fireAt = new Date(payload.fireAtIso).getTime()
  if (Number.isNaN(fireAt)) {
    return { success: false, message: `invalid fireAtIso: ${payload.fireAtIso}` }
  }
  if (fireAt < Date.now()) {
    return { success: false, message: `fireAt is in the past: ${payload.fireAtIso}` }
  }
  // Verify chat exists (avoid orphan jobs).
  const exists = sqlite
    .prepare('SELECT 1 AS one FROM processed_messages WHERE chat_id = ? LIMIT 1')
    .get(payload.chatId) as { one: number } | undefined
  if (!exists) {
    return {
      success: false,
      message: `no known chat with id ${payload.chatId}; refusing to create orphan job`,
    }
  }

  const payloadJson = JSON.stringify({
    action: payload.action,
    recurring: payload.recurring ?? null,
  })
  const jobId = insertManualJob(sqlite, {
    chatId: payload.chatId,
    kind: payload.kind,
    fireAt,
    payload: payloadJson,
    status: 'pending',
    createdAt: Date.now(),
  })
  return {
    success: true,
    message: `Created ${payload.kind} job #${jobId} for ${payload.chatId} firing at ${payload.fireAtIso}`,
    data: { jobId, fireAt },
  }
}
