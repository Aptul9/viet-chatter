// ChatStateMachine: atomic transitions IDLE → ACCUMULATING → SCHEDULED → SENDING → IDLE.
// All transitions go through repo.transitionChatState() which is an
// UPDATE ... WHERE state=expected for collision-free single-writer behavior.
// See docs/dev/04-scheduler-state-machine.md.

import type { Sqlite } from '../db/client.js'
import { getChatState, setChatState, transitionChatState, upsertChatStateIdle } from '../db/repo.js'
import { config } from '../config/index.js'
import { computeFireAt } from './latency.js'
import { log } from '../log.js'
import type { ChatId, ChatState, ChatStateRow } from '../types.js'

export class ChatStateMachine {
  constructor(private readonly sqlite: Sqlite) {}

  getState(chatId: ChatId): ChatStateRow | null {
    return getChatState(this.sqlite, chatId)
  }

  /** Apply an incoming-message event. Returns the new state for logging. */
  handleIncoming(chatId: ChatId, msgTs: number): ChatState {
    const now = Date.now()
    upsertChatStateIdle(this.sqlite, chatId)
    const current = getChatState(this.sqlite, chatId)
    const prev = current?.state ?? 'IDLE'

    if (prev === 'IDLE') {
      transitionChatState(this.sqlite, chatId, 'IDLE', 'ACCUMULATING', {
        firstMsgAt: msgTs,
        debounceDeadline: now + config.debounceMs,
        fireAt: null,
        attempt: 0,
        lastEventAt: now,
      })
      this.logTransition(chatId, 'IDLE', 'ACCUMULATING')
      return 'ACCUMULATING'
    }

    if (prev === 'ACCUMULATING') {
      setChatState(this.sqlite, chatId, {
        debounceDeadline: now + config.debounceMs,
        lastEventAt: now,
      })
      return 'ACCUMULATING'
    }

    if (prev === 'SCHEDULED') {
      const ok = transitionChatState(this.sqlite, chatId, 'SCHEDULED', 'ACCUMULATING', {
        firstMsgAt: msgTs,
        debounceDeadline: now + config.debounceMs,
        fireAt: null,
        lastEventAt: now,
      })
      if (ok) this.logTransition(chatId, 'SCHEDULED', 'ACCUMULATING')
      return ok ? 'ACCUMULATING' : (getChatState(this.sqlite, chatId)?.state ?? 'IDLE')
    }

    // SENDING: leave the in-flight turn alone; the new incoming will be
    // picked up by the next turn.
    setChatState(this.sqlite, chatId, { lastEventAt: now })
    return 'SENDING'
  }

  /** Apply an out_manual event. Returns true if any state change happened. */
  handleOutgoingManual(chatId: ChatId): { previous: ChatState; aborted: boolean } {
    const now = Date.now()
    const current = getChatState(this.sqlite, chatId)
    const prev = current?.state ?? 'IDLE'

    if (prev === 'ACCUMULATING') {
      transitionChatState(this.sqlite, chatId, 'ACCUMULATING', 'IDLE', this.idleFields(now))
      this.logTransition(chatId, 'ACCUMULATING', 'IDLE')
      return { previous: prev, aborted: false }
    }
    if (prev === 'SCHEDULED') {
      transitionChatState(this.sqlite, chatId, 'SCHEDULED', 'IDLE', this.idleFields(now))
      this.logTransition(chatId, 'SCHEDULED', 'IDLE')
      return { previous: prev, aborted: false }
    }
    if (prev === 'SENDING') {
      // The orchestrator owns the actual abort; we only signal here.
      setChatState(this.sqlite, chatId, { lastEventAt: now })
      return { previous: prev, aborted: true }
    }
    setChatState(this.sqlite, chatId, { lastEventAt: now })
    return { previous: prev, aborted: false }
  }

  /** Promote ACCUMULATING → SCHEDULED, computing fire_at. Returns the fireAt set, or null on race. */
  scheduleDue(chatId: ChatId, debounceCloseTs: number): number | null {
    const fireAt = computeFireAt(this.sqlite, chatId, debounceCloseTs)
    const ok = transitionChatState(this.sqlite, chatId, 'ACCUMULATING', 'SCHEDULED', {
      fireAt,
      debounceDeadline: null,
      lastEventAt: Date.now(),
    })
    if (!ok) return null
    this.logTransition(chatId, 'ACCUMULATING', 'SCHEDULED', { fireAt })
    return fireAt
  }

  /** Atomic claim SCHEDULED → SENDING. Returns true if claim succeeded. */
  claimSending(chatId: ChatId): boolean {
    const ok = transitionChatState(this.sqlite, chatId, 'SCHEDULED', 'SENDING', {
      lastEventAt: Date.now(),
    })
    if (ok) this.logTransition(chatId, 'SCHEDULED', 'SENDING')
    return ok
  }

  /** Finalize a send (success / abort / failure): reset to IDLE. */
  finishSending(
    chatId: ChatId,
    reason: 'sent' | 'aborted' | 'failed' | 'skipped' | 'escalated'
  ): void {
    transitionChatState(this.sqlite, chatId, 'SENDING', 'IDLE', this.idleFields(Date.now()))
    this.logTransition(chatId, 'SENDING', 'IDLE', { reason })
  }

  private idleFields(now: number): Partial<ChatStateRow> {
    return {
      firstMsgAt: null,
      debounceDeadline: null,
      fireAt: null,
      attempt: 0,
      lastEventAt: now,
    }
  }

  private logTransition(
    chatId: ChatId,
    from: ChatState,
    to: ChatState,
    extra?: Record<string, unknown>
  ): void {
    log.info({ chatId, stateFrom: from, stateTo: to, ...extra }, 'state transition')
  }
}
