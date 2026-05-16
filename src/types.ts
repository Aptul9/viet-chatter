/**
 * Cross-module shared type declarations.
 *
 * No imports from project modules. No runtime code (only types, unions, enums-as-const).
 * Zod schemas live in `src/config/schema.ts` and `src/ai/turn.ts`.
 */

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

/** WhatsApp chat id, e.g. "391234567@c.us". Used as person_id too in v1 (1:1 chats). */
export type ChatId = string

/** WhatsApp message id as returned by whatsapp-web.js (serialized). */
export type WhatsappMsgId = string

/** Unix ms timestamp. */
export type TimestampMs = number

// ---------------------------------------------------------------------------
// Message direction & processed_messages row
// ---------------------------------------------------------------------------

/** Direction of a processed message: incoming, outgoing manual (user), outgoing bot. */
export type Direction = 'in' | 'out_manual' | 'out_bot'

export interface ProcessedMessageRow {
  whatsappMsgId: WhatsappMsgId
  chatId: ChatId
  direction: Direction
  ts: TimestampMs
}

// ---------------------------------------------------------------------------
// Chat state machine
// ---------------------------------------------------------------------------

/** Per-chat scheduler state. */
export type ChatState = 'IDLE' | 'ACCUMULATING' | 'SCHEDULED' | 'SENDING'

export interface ChatStateRow {
  chatId: ChatId
  state: ChatState
  firstMsgAt: TimestampMs | null
  debounceDeadline: TimestampMs | null
  fireAt: TimestampMs | null
  attempt: number
  lastEventAt: TimestampMs
}

/** Partial update payload for chat_state row (used by repo). */
export type ChatStateUpdate = Partial<Omit<ChatStateRow, 'chatId'>>

// ---------------------------------------------------------------------------
// Connection state (whatsapp client)
// ---------------------------------------------------------------------------

export type ConnectionState = 'BOOTING' | 'CONNECTING' | 'CONNECTED' | 'DISCONNECTED'

// ---------------------------------------------------------------------------
// Person profile
// ---------------------------------------------------------------------------

export type EngagementState = 'active' | 'cold'

export interface PersonProfileRow {
  chatId: ChatId
  displayName: string | null
  /** Parsed from JSON column `languages`. */
  languages: string[]
  toneSummary: string | null
  reEngageThresholdDays: number
  engagementState: EngagementState
  createdAt: TimestampMs
  updatedAt: TimestampMs
}

export type PersonProfileUpsert = Omit<PersonProfileRow, 'createdAt' | 'updatedAt'> & {
  createdAt?: TimestampMs
  updatedAt?: TimestampMs
}

// ---------------------------------------------------------------------------
// KB / facts
// ---------------------------------------------------------------------------

/** Three-tier KB classification. */
export type Tier = 'important' | 'secondary' | 'ephemeral'

export interface FactRow {
  id: number
  personId: ChatId
  tier: Tier
  content: string
  sourceMsgId: WhatsappMsgId | null
  confidence: number
  createdAt: TimestampMs
  expiresAt: TimestampMs | null
  supersededBy: number | null
}

export type FactInsert = Omit<FactRow, 'id' | 'supersededBy'> & {
  supersededBy?: number | null
}

/** Shape returned by `loadKB`, consumed when building TurnContext. */
export interface KBBundle {
  important: FactRow[]
  ephemeral: FactRow[]
  secondary: FactRow[]
}

/** Fact extracted by the AI in TurnOutput. Mirrors the zod schema in `src/ai/turn.ts`. */
export interface ExtractedFact {
  tier: Tier
  content: string
  confidence: number
  ttl_days?: number
  supersedes_id?: number
  /** YYYY-MM-DD for fixed, MM-DD for yearly-recurring. */
  anchor_date?: string
  anchor_recurring?: 'yearly' | null
  anchor_action?: string
}

// ---------------------------------------------------------------------------
// Manual jobs
// ---------------------------------------------------------------------------

export type ManualJobKind = 'date_anchored' | 'revive' | 're_engage'

export type ManualJobStatus = 'pending' | 'firing' | 'fired' | 'superseded' | 'cancelled'

export interface ManualJobRow {
  id: number
  chatId: ChatId
  kind: ManualJobKind
  fireAt: TimestampMs
  /** Raw JSON string as persisted. Consumers parse to job-specific payloads. */
  payload: string | null
  status: ManualJobStatus
  firedAt: TimestampMs | null
  createdAt: TimestampMs
}

export type ManualJobInsert = Omit<ManualJobRow, 'id' | 'firedAt' | 'status'> & {
  status?: ManualJobStatus
}

/** Payload for `kind='date_anchored'` jobs. */
export interface DateAnchoredPayload {
  action: string
  fact_id: number
  recurring?: 'yearly' | null
}

/** Payload for `kind='revive'` jobs. */
export interface RevivePayload {
  context: string
}

/** Payload for `kind='re_engage'` jobs. */
export interface ReEngagePayload {
  days_silent: number
  last_seen_iso: string
}

/** Context passed to AI when a turn is triggered by a manual job. */
export interface ManualJobContext {
  kind: ManualJobKind
  hint: string
}

// ---------------------------------------------------------------------------
// Turn log
// ---------------------------------------------------------------------------

export type TurnLogStatus = 'sent' | 'skipped' | 'failed' | 'aborted' | 'escalated'

export type TurnTriggeredBy = 'reactive' | 'manual_job'

export interface TurnLogRow {
  id: number
  chatId: ChatId
  ts: TimestampMs
  status: TurnLogStatus
  languageUsed: string | null
  factsExtracted: number
  durationMs: number | null
  errorMsg: string | null
  triggeredBy: TurnTriggeredBy
}

export type TurnLogInsert = Omit<TurnLogRow, 'id'>

// ---------------------------------------------------------------------------
// Escalation
// ---------------------------------------------------------------------------

export type EscalationReason =
  | 'scheduling'
  | 'commitment'
  | 'sensitive'
  | 'financial'
  | 'identity'
  | 'other'

export type EscalationUrgency = 'low' | 'normal' | 'high'

export type EscalationStatus = 'pending' | 'user_replied' | 'superseded' | 'dismissed'

/** Channel identifier strings used in `escalations.notified_channels`. */
export type EscalationChannelName = 'whatsapp_self' | 'telegram' | 'rate_limited'

export interface EscalationRow {
  id: number
  chatId: ChatId
  triggerMsgId: WhatsappMsgId
  reason: EscalationReason
  urgency: EscalationUrgency
  summary: string
  holdingReplySent: boolean
  status: EscalationStatus
  createdAt: TimestampMs
  resolvedAt: TimestampMs | null
  /** Parsed from JSON column `notified_channels`. */
  notifiedChannels: EscalationChannelName[]
}

export type EscalationInsert = Omit<
  EscalationRow,
  'id' | 'resolvedAt' | 'status' | 'notifiedChannels'
> & {
  status?: EscalationStatus
  notifiedChannels?: EscalationChannelName[]
}

/** Resolution reasons supported by `repo.markEscalationsResolved`. */
export type EscalationResolveReason = 'user_replied' | 'superseded'

/** Payload passed to escalation channels for formatting/sending. */
export interface EscalationPayload {
  esc: EscalationRow
  text: string
}

// ---------------------------------------------------------------------------
// Sentiment / Urgency hints (used in tone guidance & light NLP heuristics)
// ---------------------------------------------------------------------------

export type Sentiment = 'positive' | 'neutral' | 'negative' | 'mixed'

/** General urgency label (distinct from `EscalationUrgency` which is escalation-specific). */
export type Urgency = 'low' | 'normal' | 'high'

// ---------------------------------------------------------------------------
// TurnContext (AI input)
// ---------------------------------------------------------------------------

export interface RecentMessage {
  direction: Direction
  body: string
  ts: TimestampMs
}

export interface TurnKB {
  important: string[]
  ephemeral: string[]
  secondary: string[]
}

export interface TurnContext {
  personId: ChatId
  personLanguages: string[]
  personDisplayName: string | null
  toneSummary: string | null
  recentMessages: RecentMessage[]
  kb: TurnKB
  /** ISO8601 with user timezone offset. */
  nowIso: string
  /** Present only when invoked by a manual_job fire. */
  manualJobContext?: ManualJobContext
}

// ---------------------------------------------------------------------------
// TurnOutput (AI output) -- mirrors zod schema in `src/ai/turn.ts`
// ---------------------------------------------------------------------------

export interface ReviveHint {
  attempt_in_minutes: number
  context: string
}

export interface EscalateToHuman {
  reason: EscalationReason
  urgency: EscalationUrgency
  summary: string
  suggested_holding_reply: string | null
}

export interface TurnOutput {
  reply: string
  skip: boolean
  extracted_facts: ExtractedFact[]
  tone_update: string | null
  languages_update: string[] | null
  /** Language actually used in this reply, for logging. */
  language_used: string
  revive_hint: ReviveHint | null
  escalate_to_human: EscalateToHuman | null
}

// ---------------------------------------------------------------------------
// Dispatcher / ChatContext
// ---------------------------------------------------------------------------

/**
 * Lightweight chat snapshot passed to the user-defined `shouldReply` filter
 * in `config/index.ts`. Built by the dispatcher for every incoming message.
 *
 * Field shape MUST match what the filter predicate signature expects in the
 * spec (see `docs/dev/05-filter-engine.md`). The predicate is pure, sync,
 * fast (<1ms), and sees only chat metadata, not message body.
 */
export interface ChatContext {
  /** E.164 phone number with leading '+'. */
  phone: string
  /** Saved-contact display name; `undefined` when not saved. */
  name: string | undefined
  /** True when the WhatsApp contact is in the user's address book. */
  isSavedContact: boolean
  /** Timestamp (ms) of the last message in the chat (incoming or outgoing). */
  lastMessageTs: number
  /** Number of unread messages on this chat at the moment of the snapshot. */
  unreadCount: number
}

/** Predicate signature for the user-defined `shouldReply` filter. Pure, sync. */
export type ShouldReplyPredicate = (ctx: ChatContext) => boolean

// ---------------------------------------------------------------------------
// AI model id
// ---------------------------------------------------------------------------

/**
 * OpenCode model identifier. Format: "opencode:provider/modelId" or
 * "opencode/provider/modelId". Validated by `isOpencodeAiModel` in `src/ai/opencode.ts`.
 */
export type OpencodeAiModel = `opencode:${string}/${string}` | `opencode/${string}/${string}`

// ---------------------------------------------------------------------------
// Night window
// ---------------------------------------------------------------------------

export interface NightWindow {
  startHour: number
  endHour: number
}

// ---------------------------------------------------------------------------
// Post-reconnect spread config shape
// ---------------------------------------------------------------------------

export interface SpreadRange {
  min: number
  max: number
}
