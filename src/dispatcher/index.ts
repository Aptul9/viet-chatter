// MessageDispatcher: route every WhatsApp message event through filter,
// dedup, classification, state machine, and inflight cancellation.
// See docs/dev/03-data-flow.md (Flows A, D, E) and docs/dev/05-filter-engine.md.

import type { Sqlite } from '../db/client.js'
import type { WhatsAppHandle } from '../whatsapp/client.js'
import type { ChatStateMachine } from '../scheduler/state.js'
import type { InflightRegistry } from '../orchestrator/inflight.js'
import {
  cancelPendingManualJobsForChat,
  insertProcessedMessage,
  markEscalationsResolved,
} from '../db/repo.js'
import { applyFilter } from './filter.js'
import { log } from '../log.js'
import type {
  ChatContext,
  ChatId,
  Direction,
  ProcessedMessageRow,
  WhatsappMsgId,
} from '../types.js'

// Loose shape for the wweb Message we actually care about. We accept any
// extra wweb fields by widening — keeps us decoupled from wweb's typings.
type MessageLike = {
  id: { _serialized: string }
  from: string
  to?: string
  body?: string
  timestamp: number
  fromMe: boolean
  type?: string
  getChat: () => Promise<ChatLike>
}

type ChatLike = {
  id: { _serialized: string }
  isGroup: boolean
  unreadCount?: number
  lastMessage?: { timestamp: number } | undefined
  getContact: () => Promise<{
    name?: string
    pushname?: string
    number?: string
    isMyContact?: boolean
    id?: { user?: string; _serialized?: string }
  }>
}

export interface DispatcherDeps {
  sqlite: Sqlite
  wa: WhatsAppHandle
  state: ChatStateMachine
  inflight: InflightRegistry
}

export interface DispatchOptions {
  fromBoot?: boolean
}

export class MessageDispatcher {
  constructor(private readonly deps: DispatcherDeps) {}

  start(): void {
    this.deps.wa.onIncoming((msg) => this.safeHandle(msg as MessageLike, {}))
    this.deps.wa.onMessageCreate((msg) => {
      const m = msg as MessageLike
      if (!m.fromMe) return // incoming already handled by onIncoming
      void this.safeHandle(m, {})
    })
  }

  /** Public entrypoint used by BootReconciler. */
  async handleMessage(msg: MessageLike, opts: DispatchOptions = {}): Promise<void> {
    return this.route(msg, opts)
  }

  private async safeHandle(msg: MessageLike, opts: DispatchOptions): Promise<void> {
    try {
      await this.route(msg, opts)
    } catch (err) {
      log.error({ err, msgId: msg.id?._serialized }, 'dispatcher handler failed')
    }
  }

  private async route(msg: MessageLike, opts: DispatchOptions): Promise<void> {
    const chat = await msg.getChat()
    const chatId: ChatId = chat.id._serialized
    const whatsappMsgId: WhatsappMsgId = msg.id?._serialized ?? '<no-id>'

    if (chat.isGroup) {
      log.info({ chatId, msgId: whatsappMsgId, reason: 'group' }, 'msg skipped')
      return
    }

    const direction = this.classify(msg)
    const ts = msg.timestamp * 1000

    const row: ProcessedMessageRow = { whatsappMsgId, chatId, direction, ts }
    insertProcessedMessage(this.deps.sqlite, row) // idempotent on PK

    log.info(
      { chatId, msgId: whatsappMsgId, direction, fromBoot: !!opts.fromBoot },
      'msg received'
    )

    if (direction === 'in') {
      await this.handleIncoming(msg, chat, chatId, ts)
    } else if (direction === 'out_manual') {
      this.handleOutManual(chatId)
    }
    // out_bot: nothing else to do — orchestrator already produced this.
  }

  private async handleIncoming(
    msg: MessageLike,
    chat: ChatLike,
    chatId: ChatId,
    msgTs: number
  ): Promise<void> {
    let ctx = await buildChatContext(chat)

    // If the chat id is a privacy lid AND we have a saved-contact mapping, try
    // to resolve the lid → real E.164 phone via wweb 1.34.x getContactLidAndPhone.
    // Without this, all unsaved-or-lid-keyed contacts always look like "+1799xxx"
    // (the lid digits) and never match a +39/+84/+X prefix.
    if (chatId.endsWith('@lid')) {
      const realPhone = await this.deps.wa.resolveLidPhone(chatId)
      if (realPhone) {
        log.info({ chatId, lidPhone: ctx.phone, realPhone }, 'resolved lid -> phone')
        ctx = { ...ctx, phone: realPhone }
      } else {
        log.info({ chatId }, 'lid not resolvable to phone (unsaved contact)')
      }
    }

    const allowed = applyFilter(ctx)
    if (!allowed) {
      log.info(
        { chatId, phone: ctx.phone, isSavedContact: ctx.isSavedContact, unreadCount: ctx.unreadCount },
        'msg filtered out'
      )
      return
    }
    log.info({ chatId, phone: ctx.phone }, 'msg passed filter, enqueuing')
    cancelPendingManualJobsForChat(this.deps.sqlite, chatId)
    this.deps.state.handleIncoming(chatId, msgTs)
  }

  private handleOutManual(chatId: ChatId): void {
    cancelPendingManualJobsForChat(this.deps.sqlite, chatId)
    markEscalationsResolved(this.deps.sqlite, chatId, 'user_replied')
    const transition = this.deps.state.handleOutgoingManual(chatId)
    if (transition.aborted) {
      const aborted = this.deps.inflight.abort(chatId, 'user_replied')
      log.info(
        { chatId, stateWas: transition.previous, abortedInflight: aborted },
        'manual reply detected'
      )
    } else {
      log.info(
        { chatId, stateWas: transition.previous, abortedInflight: false },
        'manual reply detected'
      )
    }
  }

  private classify(msg: MessageLike): Direction {
    if (!msg.fromMe) return 'in'
    return this.deps.wa.isBotSent(msg.id._serialized) ? 'out_bot' : 'out_manual'
  }
}

export async function buildChatContext(chat: ChatLike): Promise<ChatContext> {
  const contact = await chat.getContact()
  const phone = resolvePhone(chat.id._serialized, contact)
  const name = contact.name ?? contact.pushname ?? undefined
  return {
    phone,
    name,
    isSavedContact: contact.isMyContact === true,
    lastMessageTs: chat.lastMessage?.timestamp ? chat.lastMessage.timestamp * 1000 : 0,
    unreadCount: chat.unreadCount ?? 0,
  }
}

/**
 * Resolve a phone number in E.164 form ("+39...") from whatever WhatsApp gave us.
 *
 * Chat id formats observed:
 *   - "393xxx@c.us"               classic phone-keyed jid
 *   - "393xxx@s.whatsapp.net"     alt phone-keyed jid
 *   - "179...@lid"                privacy identifier (NOT a phone number)
 *
 * For @lid we must consult the Contact API: `contact.number` is the real phone
 * (digits only, no +). Same for `contact.id.user` when number is missing.
 * If we can't resolve it, return "" so the filter rejects deterministically.
 */
function resolvePhone(serialized: string, contact: ChatLike extends { getContact: () => Promise<infer C> } ? C : never): string {
  // 1. Phone-keyed jid: trivial parse.
  const phoneJidMatch = serialized.match(/^(\d+)@(c\.us|s\.whatsapp\.net)$/)
  if (phoneJidMatch && phoneJidMatch[1]) return '+' + phoneJidMatch[1]

  // 2. @lid (or anything else): use Contact API.
  const fromContactNumber = (contact as { number?: string }).number
  if (fromContactNumber && /^\d{5,}$/.test(fromContactNumber)) return '+' + fromContactNumber

  const contactIdUser = (contact as { id?: { user?: string } }).id?.user
  if (contactIdUser && /^\d{5,}$/.test(contactIdUser)) return '+' + contactIdUser

  // 3. Last resort: unresolvable. Filter will deny.
  return ''
}
