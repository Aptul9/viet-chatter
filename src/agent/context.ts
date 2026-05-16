// Spec D2 — Build the AgentContext fed to the planning AI.
//
// We expose enough current state for the model to produce concrete actions
// (real chat ids, real escalation ids, real job ids, real timezones) without
// dumping the whole DB. Cap each list aggressively to keep the prompt under
// a few KB.

import type { Sqlite } from '../db/client.js'
import { config } from '../config/index.js'

const MAX_CHATS = 50
const MAX_ESCALATIONS = 20
const MAX_JOBS = 20

export interface AgentChatEntry {
  chatId: string
  displayName: string | null
  lastMsgIso: string | null
}

export interface AgentEscalationEntry {
  id: number
  chatId: string
  displayName: string | null
  reason: string
  urgency: string
  summary: string
  ageHours: number
}

export interface AgentJobEntry {
  id: number
  chatId: string
  displayName: string | null
  kind: string
  fireAtIso: string
}

export interface AgentContext {
  nowIso: string
  timezone: string
  chats: AgentChatEntry[]
  pendingEscalations: AgentEscalationEntry[]
  pendingManualJobs: AgentJobEntry[]
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

  const pendingEscalations = (
    sqlite
      .prepare(
        `SELECT e.id, e.chat_id AS chat_id, pp.display_name AS display_name, e.reason, e.urgency, e.summary, e.created_at
         FROM escalations e
         LEFT JOIN person_profile pp ON pp.chat_id = e.chat_id
         WHERE e.status = 'pending'
         ORDER BY e.id DESC
         LIMIT ?`
      )
      .all(MAX_ESCALATIONS) as Array<{
      id: number
      chat_id: string
      display_name: string | null
      reason: string
      urgency: string
      summary: string
      created_at: number
    }>
  ).map<AgentEscalationEntry>((r) => ({
    id: r.id,
    chatId: r.chat_id,
    displayName: r.display_name,
    reason: r.reason,
    urgency: r.urgency,
    summary: r.summary,
    ageHours: Math.round((now - r.created_at) / 3_600_000),
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
    pendingEscalations,
    pendingManualJobs,
  }
}
