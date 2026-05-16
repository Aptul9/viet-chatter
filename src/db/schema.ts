import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

export const processedMessages = sqliteTable(
  'processed_messages',
  {
    whatsappMsgId: text('whatsapp_msg_id').primaryKey(),
    chatId: text('chat_id').notNull(),
    direction: text('direction', { enum: ['in', 'out_manual', 'out_bot'] }).notNull(),
    ts: integer('ts').notNull(),
  },
  (t) => ({
    chatTsIdx: index('idx_pm_chat_ts').on(t.chatId, t.ts),
  })
)

export const chatState = sqliteTable(
  'chat_state',
  {
    chatId: text('chat_id').primaryKey(),
    state: text('state', {
      enum: ['IDLE', 'ACCUMULATING', 'SCHEDULED', 'SENDING'],
    })
      .notNull()
      .default('IDLE'),
    firstMsgAt: integer('first_msg_at'),
    debounceDeadline: integer('debounce_deadline'),
    fireAt: integer('fire_at'),
    attempt: integer('attempt').notNull().default(0),
    lastEventAt: integer('last_event_at').notNull(),
  },
  (t) => ({
    stateIdx: index('idx_cs_state').on(t.state),
    fireIdx: index('idx_cs_fire').on(t.fireAt),
  })
)

export const personProfile = sqliteTable('person_profile', {
  chatId: text('chat_id').primaryKey(),
  displayName: text('display_name'),
  languages: text('languages').notNull().default('["en"]'),
  toneSummary: text('tone_summary'),
  reEngageThresholdDays: integer('re_engage_threshold_days').notNull().default(14),
  engagementState: text('engagement_state', { enum: ['active', 'cold'] })
    .notNull()
    .default('active'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const facts = sqliteTable(
  'facts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    personId: text('person_id').notNull(),
    tier: text('tier', { enum: ['important', 'secondary', 'ephemeral'] }).notNull(),
    content: text('content').notNull(),
    sourceMsgId: text('source_msg_id'),
    confidence: real('confidence').notNull().default(0.8),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
    supersededBy: integer('superseded_by'),
  },
  (t) => ({
    personTierIdx: index('idx_facts_person_tier').on(t.personId, t.tier),
    expiresIdx: index('idx_facts_expires').on(t.expiresAt),
  })
)

export const manualJobs = sqliteTable(
  'manual_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: text('chat_id').notNull(),
    kind: text('kind', { enum: ['date_anchored', 'revive', 're_engage'] }).notNull(),
    fireAt: integer('fire_at').notNull(),
    payload: text('payload'),
    status: text('status', {
      enum: ['pending', 'firing', 'fired', 'superseded', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    firedAt: integer('fired_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    chatStatusFireIdx: index('idx_mj_chat_status_fire').on(t.chatId, t.status, t.fireAt),
  })
)

export const turnLog = sqliteTable(
  'turn_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: text('chat_id').notNull(),
    ts: integer('ts').notNull(),
    status: text('status', {
      enum: ['sent', 'skipped', 'failed', 'aborted', 'escalated'],
    }).notNull(),
    languageUsed: text('language_used'),
    factsExtracted: integer('facts_extracted').notNull().default(0),
    durationMs: integer('duration_ms'),
    errorMsg: text('error_msg'),
    triggeredBy: text('triggered_by', { enum: ['reactive', 'manual_job'] })
      .notNull()
      .default('reactive'),
  },
  (t) => ({
    chatTsIdx: index('idx_tl_chat_ts').on(t.chatId, t.ts),
  })
)

export const escalations = sqliteTable(
  'escalations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: text('chat_id').notNull(),
    triggerMsgId: text('trigger_msg_id').notNull(),
    reason: text('reason', {
      enum: ['scheduling', 'commitment', 'sensitive', 'financial', 'identity', 'other'],
    }).notNull(),
    urgency: text('urgency', { enum: ['low', 'normal', 'high'] }).notNull(),
    summary: text('summary').notNull(),
    holdingReplySent: integer('holding_reply_sent', { mode: 'boolean' }).notNull().default(false),
    status: text('status', {
      enum: ['pending', 'user_replied', 'superseded', 'dismissed'],
    })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
    notifiedChannels: text('notified_channels').notNull().default('[]'),
  },
  (t) => ({
    chatStatusIdx: index('idx_esc_chat_status').on(t.chatId, t.status),
    createdIdx: index('idx_esc_created').on(t.createdAt),
  })
)

/**
 * Spec D2: audit log + state machine for AI command channel proposals.
 * Created via `ensureAdditiveSchema` in `client.ts`, NOT via a drizzle
 * migration file (single-user project; folded into next db:generate run).
 */
export const agentCommands = sqliteTable(
  'agent_commands',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull(),
    prompt: text('prompt').notNull(),
    actionType: text('action_type').notNull(),
    actionPayload: text('action_payload').notNull(),
    status: text('status', {
      enum: ['proposed', 'confirmed', 'executed', 'failed', 'rejected'],
    })
      .notNull()
      .default('proposed'),
    errorMsg: text('error_msg'),
    proposedAt: integer('proposed_at').notNull(),
    executedAt: integer('executed_at'),
  },
  (t) => ({
    sessionIdx: index('idx_ac_session').on(t.sessionId),
    proposedIdx: index('idx_ac_proposed').on(t.proposedAt),
  })
)
