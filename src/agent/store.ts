// Spec D2 — Persistence layer for `agent_commands`. Read + write.

import type { Sqlite } from '../db/client.js'
import type { AgentActionType, AgentCommandRow } from './types.js'

export interface AgentCommandInsert {
  sessionId: string
  prompt: string
  actionType: AgentActionType
  actionPayload: unknown
  proposedAt: number
}

export function insertAgentCommand(sqlite: Sqlite, insert: AgentCommandInsert): number {
  const payloadJson = JSON.stringify(insert.actionPayload)
  const r = sqlite
    .prepare(
      "INSERT INTO `agent_commands` (`session_id`, `prompt`, `action_type`, `action_payload`, `status`, `proposed_at`) VALUES (?, ?, ?, ?, 'proposed', ?)"
    )
    .run(insert.sessionId, insert.prompt, insert.actionType, payloadJson, insert.proposedAt)
  return Number(r.lastInsertRowid)
}

export function getAgentCommand(sqlite: Sqlite, id: number): AgentCommandRow | null {
  const r = sqlite
    .prepare(
      'SELECT `id`, `session_id` AS sessionId, `prompt`, `action_type` AS actionType, `action_payload` AS actionPayload, `status`, `error_msg` AS errorMsg, `proposed_at` AS proposedAt, `executed_at` AS executedAt FROM `agent_commands` WHERE `id` = ?'
    )
    .get(id) as AgentCommandRow | undefined
  if (!r) return null
  return r
}

export function markAgentCommandExecuted(
  sqlite: Sqlite,
  id: number,
  success: boolean,
  errorMsg: string | null
): void {
  sqlite
    .prepare(
      'UPDATE `agent_commands` SET `status` = ?, `error_msg` = ?, `executed_at` = ? WHERE `id` = ?'
    )
    .run(success ? 'executed' : 'failed', errorMsg, Date.now(), id)
}

export function listRecentAgentCommands(
  sqlite: Sqlite,
  sessionId: string,
  limit: number = 50
): AgentCommandRow[] {
  return sqlite
    .prepare(
      'SELECT `id`, `session_id` AS sessionId, `prompt`, `action_type` AS actionType, `action_payload` AS actionPayload, `status`, `error_msg` AS errorMsg, `proposed_at` AS proposedAt, `executed_at` AS executedAt FROM `agent_commands` WHERE `session_id` = ? ORDER BY `id` DESC LIMIT ?'
    )
    .all(sessionId, limit) as AgentCommandRow[]
}
