/**
 * Single mono-file repo for all SQL access in viet-chatter.
 *
 * - Synchronous (better-sqlite3) — no async/Promises.
 * - Raw prepared statements (Drizzle reserved for migrations).
 * - Every function takes a `Sqlite` handle as its first arg.
 * - Atomic state transitions via `UPDATE ... WHERE state=?` + `changes > 0`.
 * - JSON columns (`person_profile.languages`, `escalations.notified_channels`)
 *   are stringified on write and parsed on read.
 * - The boolean column `escalations.holding_reply_sent` is INTEGER 0/1.
 */

import type { Sqlite } from './client.js'
import type {
  ChatId,
  ChatState,
  ChatStateRow,
  ChatStateUpdate,
  EngagementState,
  EscalationChannelName,
  EscalationInsert,
  EscalationResolveReason,
  EscalationRow,
  EscalationUrgency,
  FactInsert,
  FactRow,
  ManualJobInsert,
  ManualJobKind,
  ManualJobRow,
  ManualJobStatus,
  PersonProfileRow,
  PersonProfileUpsert,
  ProcessedMessageRow,
  TimestampMs,
  TurnLogInsert,
} from '../types.js'

// ---------------------------------------------------------------------------
// Part 1 — processed_messages
// ---------------------------------------------------------------------------

export function insertProcessedMessage(sqlite: Sqlite, row: ProcessedMessageRow): void {
  sqlite
    .prepare(
      'INSERT OR IGNORE INTO `processed_messages` (`whatsapp_msg_id`, `chat_id`, `direction`, `ts`) VALUES (?, ?, ?, ?)'
    )
    .run(row.whatsappMsgId, row.chatId, row.direction, row.ts)
}

export function getLastSeenTs(sqlite: Sqlite, chatId: ChatId): number | null {
  const r = sqlite
    .prepare('SELECT MAX(`ts`) AS `max_ts` FROM `processed_messages` WHERE `chat_id` = ?')
    .get(chatId) as { max_ts: number | null } | undefined
  if (!r || r.max_ts == null) return null
  return r.max_ts
}

/** Batched MAX(ts) per chat. Returns a Map containing only chats present in `chatIds` with at least one message. */
export function getLastSeenForChats(sqlite: Sqlite, chatIds: ChatId[]): Map<ChatId, number> {
  const out = new Map<ChatId, number>()
  if (chatIds.length === 0) return out
  const placeholders = chatIds.map(() => '?').join(',')
  const rows = sqlite
    .prepare(
      `SELECT \`chat_id\` AS chat_id, MAX(\`ts\`) AS max_ts FROM \`processed_messages\` WHERE \`chat_id\` IN (${placeholders}) GROUP BY \`chat_id\``
    )
    .all(...chatIds) as Array<{ chat_id: string; max_ts: number | null }>
  for (const r of rows) {
    if (r.max_ts != null) out.set(r.chat_id, r.max_ts)
  }
  return out
}

/** Ordered ts ASC — required by `rollingAvgLatency` (see scheduler doc). */
export function recentProcessedMessages(
  sqlite: Sqlite,
  chatId: ChatId,
  limit: number
): ProcessedMessageRow[] {
  const rows = sqlite
    .prepare(
      'SELECT `whatsapp_msg_id`, `chat_id`, `direction`, `ts` FROM `processed_messages` WHERE `chat_id` = ? ORDER BY `ts` DESC LIMIT ?'
    )
    .all(chatId, limit) as Array<Record<string, unknown>>
  // Re-order ASC after limiting from the tail.
  return rows.map(mapProcessedMessage).reverse()
}

// ---------------------------------------------------------------------------
// Part 2 — chat_state
// ---------------------------------------------------------------------------

export function getChatState(sqlite: Sqlite, chatId: ChatId): ChatStateRow | null {
  const r = sqlite
    .prepare(
      'SELECT `chat_id`, `state`, `first_msg_at`, `debounce_deadline`, `fire_at`, `attempt`, `last_event_at` FROM `chat_state` WHERE `chat_id` = ?'
    )
    .get(chatId) as Record<string, unknown> | undefined
  if (!r) return null
  return mapChatState(r)
}

/** Insert a default IDLE row if missing. No-op otherwise. */
export function upsertChatStateIdle(sqlite: Sqlite, chatId: ChatId): void {
  const now = Date.now()
  sqlite
    .prepare(
      'INSERT OR IGNORE INTO `chat_state` (`chat_id`, `state`, `first_msg_at`, `debounce_deadline`, `fire_at`, `attempt`, `last_event_at`) VALUES (?, ?, NULL, NULL, NULL, 0, ?)'
    )
    .run(chatId, 'IDLE', now)
}

/** Raw partial update — no state guard. Always bumps `last_event_at` if not explicitly set. */
export function setChatState(sqlite: Sqlite, chatId: ChatId, partial: ChatStateUpdate): void {
  const sets: string[] = []
  const vals: unknown[] = []
  if (partial.state !== undefined) {
    sets.push('`state` = ?')
    vals.push(partial.state)
  }
  if (partial.firstMsgAt !== undefined) {
    sets.push('`first_msg_at` = ?')
    vals.push(partial.firstMsgAt)
  }
  if (partial.debounceDeadline !== undefined) {
    sets.push('`debounce_deadline` = ?')
    vals.push(partial.debounceDeadline)
  }
  if (partial.fireAt !== undefined) {
    sets.push('`fire_at` = ?')
    vals.push(partial.fireAt)
  }
  if (partial.attempt !== undefined) {
    sets.push('`attempt` = ?')
    vals.push(partial.attempt)
  }
  if (partial.lastEventAt !== undefined) {
    sets.push('`last_event_at` = ?')
    vals.push(partial.lastEventAt)
  } else {
    sets.push('`last_event_at` = ?')
    vals.push(Date.now())
  }
  if (sets.length === 0) return
  vals.push(chatId)
  sqlite.prepare(`UPDATE \`chat_state\` SET ${sets.join(', ')} WHERE \`chat_id\` = ?`).run(...vals)
}

/**
 * Atomic state transition. Returns true iff the row was in `fromState` and was updated.
 * Caller must read `getChatState` afterwards if they need the new full row.
 */
export function transitionChatState(
  sqlite: Sqlite,
  chatId: ChatId,
  fromState: ChatState,
  toState: ChatState,
  fields?: ChatStateUpdate
): boolean {
  const sets: string[] = ['`state` = ?']
  const vals: unknown[] = [toState]
  if (fields) {
    if (fields.firstMsgAt !== undefined) {
      sets.push('`first_msg_at` = ?')
      vals.push(fields.firstMsgAt)
    }
    if (fields.debounceDeadline !== undefined) {
      sets.push('`debounce_deadline` = ?')
      vals.push(fields.debounceDeadline)
    }
    if (fields.fireAt !== undefined) {
      sets.push('`fire_at` = ?')
      vals.push(fields.fireAt)
    }
    if (fields.attempt !== undefined) {
      sets.push('`attempt` = ?')
      vals.push(fields.attempt)
    }
  }
  sets.push('`last_event_at` = ?')
  vals.push(fields?.lastEventAt ?? Date.now())
  vals.push(chatId, fromState)
  const r = sqlite
    .prepare(`UPDATE \`chat_state\` SET ${sets.join(', ')} WHERE \`chat_id\` = ? AND \`state\` = ?`)
    .run(...vals)
  return r.changes > 0
}

export function scheduledOverdue(sqlite: Sqlite, now: TimestampMs): ChatStateRow[] {
  const rows = sqlite
    .prepare(
      "SELECT `chat_id`, `state`, `first_msg_at`, `debounce_deadline`, `fire_at`, `attempt`, `last_event_at` FROM `chat_state` WHERE `state` = 'SCHEDULED' AND `fire_at` < ? ORDER BY `fire_at` ASC"
    )
    .all(now) as Array<Record<string, unknown>>
  return rows.map(mapChatState)
}

/** Rows in ACCUMULATING or SCHEDULED — what the ticker iterates each tick. */
export function activeStates(sqlite: Sqlite): ChatStateRow[] {
  const rows = sqlite
    .prepare(
      "SELECT `chat_id`, `state`, `first_msg_at`, `debounce_deadline`, `fire_at`, `attempt`, `last_event_at` FROM `chat_state` WHERE `state` IN ('ACCUMULATING','SCHEDULED')"
    )
    .all() as Array<Record<string, unknown>>
  return rows.map(mapChatState)
}

// ---------------------------------------------------------------------------
// Part 3 — person_profile
// ---------------------------------------------------------------------------

export function getPersonProfile(sqlite: Sqlite, chatId: ChatId): PersonProfileRow | null {
  const r = sqlite
    .prepare(
      'SELECT `chat_id`, `display_name`, `languages`, `tone_summary`, `re_engage_threshold_days`, `engagement_state`, `created_at`, `updated_at` FROM `person_profile` WHERE `chat_id` = ?'
    )
    .get(chatId) as Record<string, unknown> | undefined
  if (!r) return null
  return mapPersonProfile(r)
}

export function upsertPersonProfile(sqlite: Sqlite, row: PersonProfileUpsert): void {
  const now = Date.now()
  const createdAt = row.createdAt ?? now
  const updatedAt = row.updatedAt ?? now
  const languagesJson = JSON.stringify(row.languages)
  sqlite
    .prepare(
      `INSERT INTO \`person_profile\` (\`chat_id\`, \`display_name\`, \`languages\`, \`tone_summary\`, \`re_engage_threshold_days\`, \`engagement_state\`, \`created_at\`, \`updated_at\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(\`chat_id\`) DO UPDATE SET
         \`display_name\` = excluded.\`display_name\`,
         \`languages\` = excluded.\`languages\`,
         \`tone_summary\` = excluded.\`tone_summary\`,
         \`re_engage_threshold_days\` = excluded.\`re_engage_threshold_days\`,
         \`engagement_state\` = excluded.\`engagement_state\`,
         \`updated_at\` = excluded.\`updated_at\``
    )
    .run(
      row.chatId,
      row.displayName,
      languagesJson,
      row.toneSummary,
      row.reEngageThresholdDays,
      row.engagementState,
      createdAt,
      updatedAt
    )
}

export function updateToneSummary(
  sqlite: Sqlite,
  chatId: ChatId,
  toneSummary: string | null
): void {
  sqlite
    .prepare('UPDATE `person_profile` SET `tone_summary` = ?, `updated_at` = ? WHERE `chat_id` = ?')
    .run(toneSummary, Date.now(), chatId)
}

/**
 * Persist a humanized identifier (typically an E.164 phone resolved from an
 * `@lid` chatId via `wa.resolveLidPhone`) into `person_profile.display_name`,
 * **only** if the row's current display_name is NULL or empty. Idempotent;
 * never overwrites an existing name. Creates a minimal profile row if absent.
 * Used by the dispatcher so the dashboard can show real phones instead of
 * the opaque wweb LID digits.
 */
export function setDisplayNameIfEmpty(sqlite: Sqlite, chatId: ChatId, name: string): void {
  const now = Date.now()
  sqlite
    .prepare(
      `INSERT INTO \`person_profile\` (\`chat_id\`, \`display_name\`, \`languages\`, \`tone_summary\`, \`re_engage_threshold_days\`, \`engagement_state\`, \`created_at\`, \`updated_at\`)
       VALUES (?, ?, '["en"]', NULL, 14, 'active', ?, ?)
       ON CONFLICT(\`chat_id\`) DO UPDATE SET
         \`display_name\` = excluded.\`display_name\`,
         \`updated_at\` = excluded.\`updated_at\`
       WHERE \`person_profile\`.\`display_name\` IS NULL
          OR \`person_profile\`.\`display_name\` = ''`
    )
    .run(chatId, name, now, now)
}

/**
 * Upgrade `display_name` from an E.164 fallback (e.g. `+393518347869`) to a
 * proper address-book name. Skips when the current value already looks like a
 * real name (no leading `+` followed by digits-only). Used after a contact
 * name lookup succeeds on a chat that was previously stamped with just the
 * resolved phone.
 */
export function upgradeDisplayNameFromPhone(
  sqlite: Sqlite,
  chatId: ChatId,
  realName: string
): void {
  const now = Date.now()
  sqlite
    .prepare(
      `UPDATE \`person_profile\`
         SET \`display_name\` = ?, \`updated_at\` = ?
       WHERE \`chat_id\` = ?
         AND (
           \`display_name\` IS NULL
           OR \`display_name\` = ''
           OR \`display_name\` GLOB '+[0-9]*'
         )
         AND \`display_name\` IS NOT ?`
    )
    .run(realName, now, chatId, realName)
}

export function updateLanguages(sqlite: Sqlite, chatId: ChatId, languages: string[]): void {
  sqlite
    .prepare('UPDATE `person_profile` SET `languages` = ?, `updated_at` = ? WHERE `chat_id` = ?')
    .run(JSON.stringify(languages), Date.now(), chatId)
}

export function setEngagementState(sqlite: Sqlite, chatId: ChatId, state: EngagementState): void {
  sqlite
    .prepare(
      'UPDATE `person_profile` SET `engagement_state` = ?, `updated_at` = ? WHERE `chat_id` = ?'
    )
    .run(state, Date.now(), chatId)
}

// ---------------------------------------------------------------------------
// Part 4 — facts
// ---------------------------------------------------------------------------

export function loadImportant(sqlite: Sqlite, personId: ChatId): FactRow[] {
  const rows = sqlite
    .prepare(
      "SELECT `id`, `person_id`, `tier`, `content`, `source_msg_id`, `confidence`, `created_at`, `expires_at`, `superseded_by` FROM `facts` WHERE `person_id` = ? AND `tier` = 'important' AND `superseded_by` IS NULL ORDER BY `created_at` ASC"
    )
    .all(personId) as Array<Record<string, unknown>>
  return rows.map(mapFact)
}

export function loadActiveEphemeral(sqlite: Sqlite, personId: ChatId): FactRow[] {
  const now = Date.now()
  const rows = sqlite
    .prepare(
      "SELECT `id`, `person_id`, `tier`, `content`, `source_msg_id`, `confidence`, `created_at`, `expires_at`, `superseded_by` FROM `facts` WHERE `person_id` = ? AND `tier` = 'ephemeral' AND `superseded_by` IS NULL AND (`expires_at` IS NULL OR `expires_at` > ?) ORDER BY `created_at` ASC"
    )
    .all(personId, now) as Array<Record<string, unknown>>
  return rows.map(mapFact)
}

/** Preserves the order of `ids`. Returns empty array if `ids` is empty. */
export function loadFactsByIds(sqlite: Sqlite, ids: number[]): FactRow[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(',')
  const rows = sqlite
    .prepare(
      `SELECT \`id\`, \`person_id\`, \`tier\`, \`content\`, \`source_msg_id\`, \`confidence\`, \`created_at\`, \`expires_at\`, \`superseded_by\` FROM \`facts\` WHERE \`id\` IN (${placeholders})`
    )
    .all(...ids) as Array<Record<string, unknown>>
  const byId = new Map<number, FactRow>()
  for (const r of rows) {
    const f = mapFact(r)
    byId.set(f.id, f)
  }
  const out: FactRow[] = []
  for (const id of ids) {
    const f = byId.get(id)
    if (f) out.push(f)
  }
  return out
}

export function insertFact(sqlite: Sqlite, insert: FactInsert): number {
  const r = sqlite
    .prepare(
      'INSERT INTO `facts` (`person_id`, `tier`, `content`, `source_msg_id`, `confidence`, `created_at`, `expires_at`, `superseded_by`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      insert.personId,
      insert.tier,
      insert.content,
      insert.sourceMsgId,
      insert.confidence,
      insert.createdAt,
      insert.expiresAt,
      insert.supersededBy ?? null
    )
  return Number(r.lastInsertRowid)
}

export function markSuperseded(sqlite: Sqlite, oldId: number, newId: number): void {
  sqlite.prepare('UPDATE `facts` SET `superseded_by` = ? WHERE `id` = ?').run(newId, oldId)
}

export function expiredEphemeralIds(sqlite: Sqlite, now: TimestampMs): number[] {
  const rows = sqlite
    .prepare(
      "SELECT `id` FROM `facts` WHERE `tier` = 'ephemeral' AND `expires_at` IS NOT NULL AND `expires_at` < ?"
    )
    .all(now) as Array<{ id: number }>
  return rows.map((r) => r.id)
}

export function deleteFact(sqlite: Sqlite, id: number): void {
  sqlite.prepare('DELETE FROM `facts` WHERE `id` = ?').run(id)
}

// ---------------------------------------------------------------------------
// Part 5 — manual_jobs
// ---------------------------------------------------------------------------

export function insertManualJob(sqlite: Sqlite, insert: ManualJobInsert): number {
  const r = sqlite
    .prepare(
      'INSERT INTO `manual_jobs` (`chat_id`, `kind`, `fire_at`, `payload`, `status`, `created_at`, `attempt_count`) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      insert.chatId,
      insert.kind,
      insert.fireAt,
      insert.payload,
      insert.status ?? 'pending',
      insert.createdAt,
      insert.attemptCount ?? null
    )
  return Number(r.lastInsertRowid)
}

export function pendingManualJobs(sqlite: Sqlite, now: TimestampMs): ManualJobRow[] {
  const rows = sqlite
    .prepare(
      "SELECT `id`, `chat_id`, `kind`, `fire_at`, `payload`, `status`, `fired_at`, `created_at`, `attempt_count` FROM `manual_jobs` WHERE `status` = 'pending' AND `fire_at` <= ? ORDER BY `fire_at` ASC"
    )
    .all(now) as Array<Record<string, unknown>>
  return rows.map(mapManualJob)
}

/**
 * Atomic claim/transition. Extra fields (e.g. `firedAt`) applied only on success.
 * Returns true iff a row in `fromStatus` was found and updated.
 */
export function transitionManualJob(
  sqlite: Sqlite,
  id: number,
  fromStatus: ManualJobStatus,
  toStatus: ManualJobStatus,
  extraFields?: { firedAt?: TimestampMs | null }
): boolean {
  const sets: string[] = ['`status` = ?']
  const vals: unknown[] = [toStatus]
  if (extraFields && extraFields.firedAt !== undefined) {
    sets.push('`fired_at` = ?')
    vals.push(extraFields.firedAt)
  } else if (toStatus === 'fired') {
    sets.push('`fired_at` = ?')
    vals.push(Date.now())
  }
  vals.push(id, fromStatus)
  const r = sqlite
    .prepare(`UPDATE \`manual_jobs\` SET ${sets.join(', ')} WHERE \`id\` = ? AND \`status\` = ?`)
    .run(...vals)
  return r.changes > 0
}

export function cancelPendingManualJobsForChat(sqlite: Sqlite, chatId: ChatId): number {
  const r = sqlite
    .prepare(
      "UPDATE `manual_jobs` SET `status` = 'cancelled' WHERE `chat_id` = ? AND `status` = 'pending'"
    )
    .run(chatId)
  return r.changes
}

export function hasPendingManualJob(sqlite: Sqlite, chatId: ChatId, kind: ManualJobKind): boolean {
  const r = sqlite
    .prepare(
      "SELECT 1 AS one FROM `manual_jobs` WHERE `chat_id` = ? AND `kind` = ? AND `status` = 'pending' LIMIT 1"
    )
    .get(chatId, kind) as { one: number } | undefined
  return r !== undefined
}

export function countOutgoing(sqlite: Sqlite, chatId: ChatId): number {
  const r = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM `processed_messages` WHERE `chat_id` = ? AND `direction` IN ('out_bot','out_manual')"
    )
    .get(chatId) as { c: number } | undefined
  return r?.c ?? 0
}

/**
 * `re_engage` jobs fired more than `olderThanDays` ago that have NOT received any
 * incoming reply on that chat since `fired_at`. Used by the cold-engagement cleanup cron.
 */
export function recentReEngagesWithoutReply(sqlite: Sqlite, olderThanDays: number): ManualJobRow[] {
  const cutoff = Date.now() - olderThanDays * 86_400_000
  const rows = sqlite
    .prepare(
      `SELECT mj.\`id\`, mj.\`chat_id\`, mj.\`kind\`, mj.\`fire_at\`, mj.\`payload\`, mj.\`status\`, mj.\`fired_at\`, mj.\`created_at\`, mj.\`attempt_count\`
       FROM \`manual_jobs\` mj
       WHERE mj.\`kind\` = 're_engage'
         AND mj.\`status\` = 'fired'
         AND mj.\`fired_at\` IS NOT NULL
         AND mj.\`fired_at\` < ?
         AND NOT EXISTS (
           SELECT 1 FROM \`processed_messages\` pm
           WHERE pm.\`chat_id\` = mj.\`chat_id\`
             AND pm.\`direction\` = 'in'
             AND pm.\`ts\` > mj.\`fired_at\`
         )`
    )
    .all(cutoff) as Array<Record<string, unknown>>
  return rows.map(mapManualJob)
}

/**
 * Returns chat ids whose MAX(processed_messages.ts) is older than `now - thresholdDays * 86400_000`,
 * using a per-chat threshold from `thresholdMap`. Single SQL pass.
 */
export function chatsWithSilenceLongerThan(
  sqlite: Sqlite,
  thresholdMap: Map<ChatId, number>,
  now: TimestampMs
): ChatId[] {
  if (thresholdMap.size === 0) return []
  const DAY_MS = 86_400_000
  // Build a CTE of (chat_id, threshold_ms) literals.
  const tuples: string[] = []
  const vals: unknown[] = []
  for (const [chatId, days] of thresholdMap) {
    tuples.push('SELECT ? AS chat_id, ? AS threshold_ms')
    vals.push(chatId, days * DAY_MS)
  }
  const cte = tuples.join(' UNION ALL ')
  const sql = `
    WITH th(chat_id, threshold_ms) AS (${cte})
    SELECT th.chat_id AS chat_id
    FROM th
    LEFT JOIN (
      SELECT \`chat_id\` AS pm_chat_id, MAX(\`ts\`) AS max_ts
      FROM \`processed_messages\`
      GROUP BY \`chat_id\`
    ) pm ON pm.pm_chat_id = th.chat_id
    WHERE pm.max_ts IS NOT NULL AND pm.max_ts < (? - th.threshold_ms)
  `
  vals.push(now)
  const rows = sqlite.prepare(sql).all(...vals) as Array<{ chat_id: string }>
  return rows.map((r) => r.chat_id)
}

// ---------------------------------------------------------------------------
// Part 6 — turn_log + escalations
// ---------------------------------------------------------------------------

export function insertTurnLog(sqlite: Sqlite, row: TurnLogInsert): void {
  sqlite
    .prepare(
      'INSERT INTO `turn_log` (`chat_id`, `ts`, `status`, `language_used`, `facts_extracted`, `duration_ms`, `error_msg`, `triggered_by`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      row.chatId,
      row.ts,
      row.status,
      row.languageUsed,
      row.factsExtracted,
      row.durationMs,
      row.errorMsg,
      row.triggeredBy
    )
}

export function insertEscalation(sqlite: Sqlite, insert: EscalationInsert): number {
  const channelsJson = JSON.stringify(insert.notifiedChannels ?? [])
  const r = sqlite
    .prepare(
      'INSERT INTO `escalations` (`chat_id`, `trigger_msg_id`, `reason`, `urgency`, `summary`, `holding_reply_sent`, `status`, `created_at`, `notified_channels`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      insert.chatId,
      insert.triggerMsgId,
      insert.reason,
      insert.urgency,
      insert.summary,
      insert.holdingReplySent ? 1 : 0,
      insert.status ?? 'pending',
      insert.createdAt,
      channelsJson
    )
  return Number(r.lastInsertRowid)
}

export function getEscalation(sqlite: Sqlite, id: number): EscalationRow | null {
  const r = sqlite
    .prepare(
      'SELECT `id`, `chat_id`, `trigger_msg_id`, `reason`, `urgency`, `summary`, `holding_reply_sent`, `status`, `created_at`, `resolved_at`, `notified_channels` FROM `escalations` WHERE `id` = ?'
    )
    .get(id) as Record<string, unknown> | undefined
  if (!r) return null
  return mapEscalation(r)
}

/** Latest pending escalation for a chat (highest id wins). */
export function pendingEscalation(sqlite: Sqlite, chatId: ChatId): EscalationRow | null {
  const r = sqlite
    .prepare(
      "SELECT `id`, `chat_id`, `trigger_msg_id`, `reason`, `urgency`, `summary`, `holding_reply_sent`, `status`, `created_at`, `resolved_at`, `notified_channels` FROM `escalations` WHERE `chat_id` = ? AND `status` = 'pending' ORDER BY `id` DESC LIMIT 1"
    )
    .get(chatId) as Record<string, unknown> | undefined
  if (!r) return null
  return mapEscalation(r)
}

export function updateEscalationSummary(
  sqlite: Sqlite,
  id: number,
  summary: string,
  urgency: EscalationUrgency
): void {
  sqlite
    .prepare('UPDATE `escalations` SET `summary` = ?, `urgency` = ? WHERE `id` = ?')
    .run(summary, urgency, id)
}

export function updateEscalationNotified(
  sqlite: Sqlite,
  id: number,
  channels: EscalationChannelName[]
): void {
  sqlite
    .prepare('UPDATE `escalations` SET `notified_channels` = ? WHERE `id` = ?')
    .run(JSON.stringify(channels), id)
}

/** Returns count of escalations transitioned from 'pending' to `status`. */
export function markEscalationsResolved(
  sqlite: Sqlite,
  chatId: ChatId,
  status: EscalationResolveReason
): number {
  const r = sqlite
    .prepare(
      "UPDATE `escalations` SET `status` = ?, `resolved_at` = ? WHERE `chat_id` = ? AND `status` = 'pending'"
    )
    .run(status, Date.now(), chatId)
  return r.changes
}

/** Pending escalations that still have no successful channel delivery — retry candidates. */
export function pendingEscalationsForRetry(sqlite: Sqlite): EscalationRow[] {
  const rows = sqlite
    .prepare(
      "SELECT `id`, `chat_id`, `trigger_msg_id`, `reason`, `urgency`, `summary`, `holding_reply_sent`, `status`, `created_at`, `resolved_at`, `notified_channels` FROM `escalations` WHERE `status` = 'pending' AND `notified_channels` = '[]'"
    )
    .all() as Array<Record<string, unknown>>
  return rows.map(mapEscalation)
}

export function countEscalationsLastHour(sqlite: Sqlite, now: TimestampMs): number {
  const cutoff = now - 3_600_000
  const r = sqlite
    .prepare(
      "SELECT COUNT(*) AS c FROM `escalations` WHERE `created_at` > ? AND `notified_channels` != '[]'"
    )
    .get(cutoff) as { c: number } | undefined
  return r?.c ?? 0
}

// ---------------------------------------------------------------------------
// Row mappers (snake_case unknown rows -> typed camelCase rows)
// ---------------------------------------------------------------------------

function mapProcessedMessage(r: Record<string, unknown>): ProcessedMessageRow {
  return {
    whatsappMsgId: r.whatsapp_msg_id as string,
    chatId: r.chat_id as string,
    direction: r.direction as ProcessedMessageRow['direction'],
    ts: r.ts as number,
  }
}

function mapChatState(r: Record<string, unknown>): ChatStateRow {
  return {
    chatId: r.chat_id as string,
    state: r.state as ChatState,
    firstMsgAt: (r.first_msg_at as number | null) ?? null,
    debounceDeadline: (r.debounce_deadline as number | null) ?? null,
    fireAt: (r.fire_at as number | null) ?? null,
    attempt: r.attempt as number,
    lastEventAt: r.last_event_at as number,
  }
}

function mapPersonProfile(r: Record<string, unknown>): PersonProfileRow {
  let languages: string[] = ['en']
  const rawLang = r.languages
  if (typeof rawLang === 'string') {
    try {
      const parsed = JSON.parse(rawLang)
      if (Array.isArray(parsed)) languages = parsed.map((x) => String(x))
    } catch {
      // keep default
    }
  }
  return {
    chatId: r.chat_id as string,
    displayName: (r.display_name as string | null) ?? null,
    languages,
    toneSummary: (r.tone_summary as string | null) ?? null,
    reEngageThresholdDays: r.re_engage_threshold_days as number,
    engagementState: r.engagement_state as EngagementState,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  }
}

function mapFact(r: Record<string, unknown>): FactRow {
  return {
    id: r.id as number,
    personId: r.person_id as string,
    tier: r.tier as FactRow['tier'],
    content: r.content as string,
    sourceMsgId: (r.source_msg_id as string | null) ?? null,
    confidence: r.confidence as number,
    createdAt: r.created_at as number,
    expiresAt: (r.expires_at as number | null) ?? null,
    supersededBy: (r.superseded_by as number | null) ?? null,
  }
}

function mapManualJob(r: Record<string, unknown>): ManualJobRow {
  return {
    id: r.id as number,
    chatId: r.chat_id as string,
    kind: r.kind as ManualJobKind,
    fireAt: r.fire_at as number,
    payload: (r.payload as string | null) ?? null,
    status: r.status as ManualJobStatus,
    firedAt: (r.fired_at as number | null) ?? null,
    createdAt: r.created_at as number,
    attemptCount: (r.attempt_count as number | null) ?? null,
  }
}

// ---------------------------------------------------------------------------
// Part 7 — read-only helpers for Spec C dashboard. Additive, no writes.
// ---------------------------------------------------------------------------

export interface ChatSummaryRow {
  chatId: ChatId
  displayName: string | null
  lastMsgTs: number | null
  msgCount24h: number
  hasPendingEscalation: boolean
  state: ChatState
}

export function listChatsWithSummary(sqlite: Sqlite): ChatSummaryRow[] {
  const now = Date.now()
  const cutoff24h = now - 24 * 60 * 60 * 1000
  const rows = sqlite
    .prepare(
      `SELECT
         pm.chat_id AS chat_id,
         pp.display_name AS display_name,
         MAX(pm.ts) AS last_msg_ts,
         SUM(CASE WHEN pm.ts > ? THEN 1 ELSE 0 END) AS count_24h,
         COALESCE(cs.state, 'IDLE') AS state,
         (SELECT 1 FROM escalations e WHERE e.chat_id = pm.chat_id AND e.status = 'pending' LIMIT 1) AS has_esc
       FROM processed_messages pm
       LEFT JOIN person_profile pp ON pp.chat_id = pm.chat_id
       LEFT JOIN chat_state cs ON cs.chat_id = pm.chat_id
       GROUP BY pm.chat_id
       ORDER BY last_msg_ts DESC`
    )
    .all(cutoff24h) as Array<{
    chat_id: string
    display_name: string | null
    last_msg_ts: number | null
    count_24h: number
    state: ChatState
    has_esc: number | null
  }>
  return rows.map((r) => ({
    chatId: r.chat_id,
    displayName: r.display_name,
    lastMsgTs: r.last_msg_ts,
    msgCount24h: r.count_24h ?? 0,
    hasPendingEscalation: r.has_esc === 1,
    state: r.state,
  }))
}

export interface ChatDetail {
  profile: PersonProfileRow | null
  facts: { important: FactRow[]; secondary: FactRow[]; ephemeral: FactRow[] }
  recentMessages: ProcessedMessageRow[]
  recentTurns: Array<{
    id: number
    ts: number
    status: string
    languageUsed: string | null
    factsExtracted: number
    durationMs: number | null
    triggeredBy: string
  }>
  recentEscalations: EscalationRow[]
}

export function getChatDetail(sqlite: Sqlite, chatId: ChatId): ChatDetail {
  const profile = getPersonProfile(sqlite, chatId)
  const factsImportant = loadImportant(sqlite, chatId)
  const factsEphemeral = loadActiveEphemeral(sqlite, chatId)
  const factsSecondary = sqlite
    .prepare(
      "SELECT `id`, `person_id`, `tier`, `content`, `source_msg_id`, `confidence`, `created_at`, `expires_at`, `superseded_by` FROM `facts` WHERE `person_id` = ? AND `tier` = 'secondary' AND `superseded_by` IS NULL ORDER BY `created_at` DESC LIMIT 50"
    )
    .all(chatId) as Array<Record<string, unknown>>
  const recentMessages = recentProcessedMessages(sqlite, chatId, 50)
  const recentTurns = sqlite
    .prepare(
      'SELECT `id`, `ts`, `status`, `language_used` AS languageUsed, `facts_extracted` AS factsExtracted, `duration_ms` AS durationMs, `triggered_by` AS triggeredBy FROM `turn_log` WHERE `chat_id` = ? ORDER BY `id` DESC LIMIT 20'
    )
    .all(chatId) as Array<{
    id: number
    ts: number
    status: string
    languageUsed: string | null
    factsExtracted: number
    durationMs: number | null
    triggeredBy: string
  }>
  const recentEscalations = (
    sqlite
      .prepare(
        'SELECT `id`, `chat_id`, `trigger_msg_id`, `reason`, `urgency`, `summary`, `holding_reply_sent`, `status`, `created_at`, `resolved_at`, `notified_channels` FROM `escalations` WHERE `chat_id` = ? ORDER BY `id` DESC LIMIT 10'
      )
      .all(chatId) as Array<Record<string, unknown>>
  ).map(mapEscalation)
  return {
    profile,
    facts: {
      important: factsImportant,
      secondary: factsSecondary.map(mapFact),
      ephemeral: factsEphemeral,
    },
    recentMessages,
    recentTurns,
    recentEscalations,
  }
}

export interface ScheduleOverview {
  chatStates: ChatStateRow[]
  manualJobs: ManualJobRow[]
  escalations: EscalationRow[]
}

export function getScheduleOverview(sqlite: Sqlite): ScheduleOverview {
  const chatStates = (
    sqlite
      .prepare(
        "SELECT `chat_id`, `state`, `first_msg_at`, `debounce_deadline`, `fire_at`, `attempt`, `last_event_at` FROM `chat_state` WHERE `state` != 'IDLE' ORDER BY COALESCE(`fire_at`, `last_event_at`) ASC"
      )
      .all() as Array<Record<string, unknown>>
  ).map(mapChatState)
  const manualJobs = (
    sqlite
      .prepare(
        "SELECT `id`, `chat_id`, `kind`, `fire_at`, `payload`, `status`, `fired_at`, `created_at`, `attempt_count` FROM `manual_jobs` WHERE `status` = 'pending' ORDER BY `fire_at` ASC LIMIT 100"
      )
      .all() as Array<Record<string, unknown>>
  ).map(mapManualJob)
  const escalations = (
    sqlite
      .prepare(
        "SELECT `id`, `chat_id`, `trigger_msg_id`, `reason`, `urgency`, `summary`, `holding_reply_sent`, `status`, `created_at`, `resolved_at`, `notified_channels` FROM `escalations` WHERE `status` = 'pending' ORDER BY `id` DESC LIMIT 100"
      )
      .all() as Array<Record<string, unknown>>
  ).map(mapEscalation)
  return { chatStates, manualJobs, escalations }
}

export interface StatsSnapshot {
  range: '24h' | '7d' | 'all'
  totalMessages: { in: number; out_bot: number; out_manual: number }
  turns: {
    sent: number
    skipped: number
    failed: number
    aborted: number
    escalated: number
  }
  escalations: {
    pending: number
    user_replied: number
    superseded: number
    dismissed: number
  }
  avgTurnDurationMs: number | null
  perChat: Array<{
    chatId: string
    displayName: string | null
    msgIn: number
    msgOutBot: number
    msgOutManual: number
    avgReplyMs: number | null
  }>
}

function rangeCutoff(range: '24h' | '7d' | 'all'): number {
  if (range === 'all') return 0
  const now = Date.now()
  const days = range === '24h' ? 1 : 7
  return now - days * 24 * 60 * 60 * 1000
}

export function getStats(sqlite: Sqlite, range: '24h' | '7d' | 'all'): StatsSnapshot {
  const cutoff = rangeCutoff(range)

  const pmRows = sqlite
    .prepare(
      'SELECT `direction`, COUNT(*) AS c FROM `processed_messages` WHERE `ts` > ? GROUP BY `direction`'
    )
    .all(cutoff) as Array<{ direction: string; c: number }>
  const totalMessages = { in: 0, out_bot: 0, out_manual: 0 }
  for (const r of pmRows) {
    if (r.direction === 'in' || r.direction === 'out_bot' || r.direction === 'out_manual') {
      totalMessages[r.direction] = r.c
    }
  }

  const turnRows = sqlite
    .prepare('SELECT `status`, COUNT(*) AS c FROM `turn_log` WHERE `ts` > ? GROUP BY `status`')
    .all(cutoff) as Array<{ status: string; c: number }>
  const turns = { sent: 0, skipped: 0, failed: 0, aborted: 0, escalated: 0 }
  for (const r of turnRows) {
    if (r.status in turns) (turns as Record<string, number>)[r.status] = r.c
  }

  const escRows = sqlite
    .prepare(
      'SELECT `status`, COUNT(*) AS c FROM `escalations` WHERE `created_at` > ? GROUP BY `status`'
    )
    .all(cutoff) as Array<{ status: string; c: number }>
  const escalations = { pending: 0, user_replied: 0, superseded: 0, dismissed: 0 }
  for (const r of escRows) {
    if (r.status in escalations) (escalations as Record<string, number>)[r.status] = r.c
  }

  const avgRow = sqlite
    .prepare(
      "SELECT AVG(`duration_ms`) AS avg_dur FROM `turn_log` WHERE `ts` > ? AND `duration_ms` IS NOT NULL AND `status` IN ('sent', 'escalated')"
    )
    .get(cutoff) as { avg_dur: number | null } | undefined
  const avgTurnDurationMs = avgRow && avgRow.avg_dur != null ? Math.round(avgRow.avg_dur) : null

  const perChatRows = sqlite
    .prepare(
      `SELECT
         pm.chat_id AS chat_id,
         pp.display_name AS display_name,
         SUM(CASE WHEN pm.direction = 'in' THEN 1 ELSE 0 END) AS msg_in,
         SUM(CASE WHEN pm.direction = 'out_bot' THEN 1 ELSE 0 END) AS msg_out_bot,
         SUM(CASE WHEN pm.direction = 'out_manual' THEN 1 ELSE 0 END) AS msg_out_manual,
         (SELECT AVG(duration_ms) FROM turn_log tl WHERE tl.chat_id = pm.chat_id AND tl.ts > ? AND tl.duration_ms IS NOT NULL AND tl.status IN ('sent', 'escalated')) AS avg_reply_ms
       FROM processed_messages pm
       LEFT JOIN person_profile pp ON pp.chat_id = pm.chat_id
       WHERE pm.ts > ?
       GROUP BY pm.chat_id
       ORDER BY (msg_in + msg_out_bot + msg_out_manual) DESC
       LIMIT 100`
    )
    .all(cutoff, cutoff) as Array<{
    chat_id: string
    display_name: string | null
    msg_in: number
    msg_out_bot: number
    msg_out_manual: number
    avg_reply_ms: number | null
  }>

  const perChat = perChatRows.map((r) => ({
    chatId: r.chat_id,
    displayName: r.display_name,
    msgIn: r.msg_in ?? 0,
    msgOutBot: r.msg_out_bot ?? 0,
    msgOutManual: r.msg_out_manual ?? 0,
    avgReplyMs: r.avg_reply_ms != null ? Math.round(r.avg_reply_ms) : null,
  }))

  return {
    range,
    totalMessages,
    turns,
    escalations,
    avgTurnDurationMs,
    perChat,
  }
}

function mapEscalation(r: Record<string, unknown>): EscalationRow {
  let notifiedChannels: EscalationChannelName[] = []
  const rawCh = r.notified_channels
  if (typeof rawCh === 'string') {
    try {
      const parsed = JSON.parse(rawCh)
      if (Array.isArray(parsed)) {
        notifiedChannels = parsed.map((x) => String(x) as EscalationChannelName)
      }
    } catch {
      // keep empty
    }
  }
  return {
    id: r.id as number,
    chatId: r.chat_id as string,
    triggerMsgId: r.trigger_msg_id as string,
    reason: r.reason as EscalationRow['reason'],
    urgency: r.urgency as EscalationUrgency,
    summary: r.summary as string,
    holdingReplySent: Boolean(r.holding_reply_sent),
    status: r.status as EscalationRow['status'],
    createdAt: r.created_at as number,
    resolvedAt: (r.resolved_at as number | null) ?? null,
    notifiedChannels,
  }
}
