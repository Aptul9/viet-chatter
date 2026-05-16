// ReplyOrchestrator: the per-turn pipeline that owns AI invocation, sending,
// fact persistence, escalation branch, and turn_log audit. See
// docs/dev/03-data-flow.md Flow C (reactive) + Flow G (manual job).
//
// Spec A: drains the MediaQueue at turn-fire time and passes the bytes as
// multimodal parts to `generateTurn` (vision path) when present.

import type { Sqlite } from '../db/client.js'
import type { WhatsAppHandle } from '../whatsapp/client.js'
import type { ChatStateMachine } from '../scheduler/state.js'
import type { InflightRegistry } from './inflight.js'
import type { MediaQueue } from './media-queue.js'
import type { EmbeddingService } from '../kb/embedding.js'
import type { VecStore } from '../kb/vec.js'
import type { EscalationNotifier } from '../escalation/notifier.js'
import {
  insertEscalation,
  insertProcessedMessage,
  insertTurnLog,
  pendingEscalation,
  updateEscalationSummary,
} from '../db/repo.js'
import { buildTurnContext } from './context.js'
import { persistExtractedFacts } from '../kb/store.js'
import { updateLanguages, updateTone } from '../persona/profile.js'
import { generateTurn, type TurnOutput } from '../ai/turn.js'
import type { OpenCodeFilePart } from '../ai/opencode.js'
import { config } from '../config/index.js'
import { log } from '../log.js'
import type {
  ChatId,
  EscalationUrgency,
  ManualJobContext,
  TurnLogStatus,
  TurnTriggeredBy,
} from '../types.js'

export interface OrchestratorDeps {
  sqlite: Sqlite
  wa: WhatsAppHandle
  state: ChatStateMachine
  inflight: InflightRegistry
  mediaQueue: MediaQueue
  embedding: EmbeddingService
  vecStore: VecStore
  escalationNotifier: EscalationNotifier
}

const URGENCY_RANK: Record<EscalationUrgency, number> = { low: 0, normal: 1, high: 2 }

export class ReplyOrchestrator {
  constructor(private readonly deps: OrchestratorDeps) {}

  async generateAndSend(chatId: ChatId, signal: AbortSignal): Promise<void> {
    return this.runTurn(chatId, signal, 'reactive', undefined)
  }

  async generateAndSendForManualJob(
    chatId: ChatId,
    manualJobContext: ManualJobContext,
    signal: AbortSignal
  ): Promise<void> {
    return this.runTurn(chatId, signal, 'manual_job', manualJobContext)
  }

  private async runTurn(
    chatId: ChatId,
    signal: AbortSignal,
    triggeredBy: TurnTriggeredBy,
    manualJobContext: ManualJobContext | undefined
  ): Promise<void> {
    const startedAt = Date.now()
    log.info({ chatId, triggeredBy }, 'reply turn started')

    try {
      if (signal.aborted) return this.finishAborted(chatId, startedAt, triggeredBy)

      const pendingMedia = this.deps.mediaQueue.drain(chatId)
      const mediaParts: OpenCodeFilePart[] = pendingMedia.map((m) => ({
        type: 'file',
        mime: m.mime,
        url: `data:${m.mime};base64,${m.base64}`,
        ...(m.filename ? { filename: m.filename } : {}),
      }))

      const turnCtx = await buildTurnContext(
        {
          sqlite: this.deps.sqlite,
          wa: this.deps.wa,
          embedding: this.deps.embedding,
          vecStore: this.deps.vecStore,
        },
        chatId,
        startedAt,
        manualJobContext,
        pendingMedia
      )
      if (signal.aborted) return this.finishAborted(chatId, startedAt, triggeredBy)

      const out = await generateTurn(
        turnCtx,
        signal,
        mediaParts.length > 0 ? mediaParts : undefined
      )
      if (signal.aborted) return this.finishAborted(chatId, startedAt, triggeredBy)

      if (!out) {
        this.finishFailed(chatId, startedAt, triggeredBy, 'AI returned null')
        return
      }

      // Escalation branch takes precedence per docs/dev/18-escalation.md "conflict rule".
      if (out.escalate_to_human && config.escalation.enabled) {
        await this.handleEscalation(chatId, out, startedAt, triggeredBy)
        return
      }

      // skip:true: persist facts/tone/lang only.
      if (out.skip || out.reply.trim().length === 0) {
        await this.persistSideEffects(chatId, out, startedAt)
        this.finalizeTurn(chatId, startedAt, triggeredBy, 'skipped', out)
        return
      }

      if (signal.aborted) return this.finishAborted(chatId, startedAt, triggeredBy)

      try {
        const sent = await this.deps.wa.sendMessage(chatId, out.reply)
        insertProcessedMessage(this.deps.sqlite, {
          whatsappMsgId: sent.id._serialized,
          chatId,
          direction: 'out_bot',
          ts: sent.timestamp * 1000,
        })
      } catch (err) {
        this.finishFailed(chatId, startedAt, triggeredBy, `send failed: ${(err as Error).message}`)
        return
      }

      await this.persistSideEffects(chatId, out, startedAt)
      this.finalizeTurn(chatId, startedAt, triggeredBy, 'sent', out)
    } catch (err) {
      this.finishFailed(chatId, startedAt, triggeredBy, (err as Error).message)
    } finally {
      this.deps.inflight.unregister(chatId)
    }
  }

  private async handleEscalation(
    chatId: ChatId,
    out: TurnOutput,
    startedAt: number,
    triggeredBy: TurnTriggeredBy
  ): Promise<void> {
    const esc = out.escalate_to_human
    if (!esc) return // narrowed; should not happen

    const existing = pendingEscalation(this.deps.sqlite, chatId)
    if (existing) {
      updateEscalationSummary(
        this.deps.sqlite,
        existing.id,
        esc.summary,
        URGENCY_RANK[esc.urgency] > URGENCY_RANK[existing.urgency] ? esc.urgency : existing.urgency
      )
      if (URGENCY_RANK[esc.urgency] > URGENCY_RANK[existing.urgency]) {
        void this.deps.escalationNotifier
          .notify(existing.id)
          .catch((err) => log.error({ err, escId: existing.id }, 'escalation re-notify failed'))
      }
      log.debug(
        { escIdExisting: existing.id, chatId, urgencyChanged: esc.urgency !== existing.urgency },
        'escalation dedup hit'
      )
      await this.persistSideEffects(chatId, out, startedAt)
      this.finalizeTurn(chatId, startedAt, triggeredBy, 'escalated', out)
      return
    }

    // Find the triggering incoming msg id from the turn context (last `in`).
    const triggerMsgId = await this.findLastIncomingMsgId(chatId)

    let holdingReplySent = false
    if (esc.suggested_holding_reply && esc.suggested_holding_reply.trim().length > 0) {
      try {
        const sent = await this.deps.wa.sendMessage(chatId, esc.suggested_holding_reply)
        insertProcessedMessage(this.deps.sqlite, {
          whatsappMsgId: sent.id._serialized,
          chatId,
          direction: 'out_bot',
          ts: sent.timestamp * 1000,
        })
        holdingReplySent = true
        log.info({ chatId }, 'holding reply sent')
      } catch (err) {
        log.error({ err, chatId }, 'holding reply send failed')
      }
    }

    const now = Date.now()
    const escId = insertEscalation(this.deps.sqlite, {
      chatId,
      triggerMsgId: triggerMsgId ?? '',
      reason: esc.reason,
      urgency: esc.urgency,
      summary: esc.summary,
      holdingReplySent,
      status: 'pending',
      createdAt: now,
      notifiedChannels: [],
    })
    log.info(
      { escId, chatId, reason: esc.reason, urgency: esc.urgency, holdingReplySent },
      'escalation created'
    )

    void this.deps.escalationNotifier
      .notify(escId)
      .catch((err) => log.error({ err, escId }, 'escalation notify failed'))

    await this.persistSideEffects(chatId, out, startedAt)
    this.finalizeTurn(chatId, startedAt, triggeredBy, 'escalated', out)
  }

  private async findLastIncomingMsgId(chatId: ChatId): Promise<string | null> {
    try {
      const msgs = await this.deps.wa.fetchMessages(chatId, 20)
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]
        if (m && !m.fromMe) return m.id._serialized
      }
    } catch (err) {
      log.debug({ err, chatId }, 'findLastIncomingMsgId failed')
    }
    return null
  }

  private async persistSideEffects(chatId: ChatId, out: TurnOutput, now: number): Promise<void> {
    try {
      await persistExtractedFacts(
        {
          sqlite: this.deps.sqlite,
          vecStore: this.deps.vecStore,
          embedding: this.deps.embedding,
        },
        chatId,
        out.extracted_facts,
        now
      )
    } catch (err) {
      log.error({ err, chatId }, 'persist extracted_facts failed')
    }
    if (out.tone_update !== null) {
      try {
        updateTone(this.deps.sqlite, chatId, out.tone_update)
      } catch (err) {
        log.error({ err, chatId }, 'updateTone failed')
      }
    }
    if (out.languages_update !== null) {
      try {
        updateLanguages(this.deps.sqlite, chatId, out.languages_update)
      } catch (err) {
        log.error({ err, chatId }, 'updateLanguages failed')
      }
    }
  }

  private finalizeTurn(
    chatId: ChatId,
    startedAt: number,
    triggeredBy: TurnTriggeredBy,
    status: TurnLogStatus,
    out: TurnOutput
  ): void {
    const durationMs = Date.now() - startedAt
    insertTurnLog(this.deps.sqlite, {
      chatId,
      ts: startedAt,
      status,
      languageUsed: out.language_used,
      factsExtracted: out.extracted_facts.length,
      durationMs,
      errorMsg: null,
      triggeredBy,
    })
    log.info(
      {
        chatId,
        status,
        durationMs,
        factsExtracted: out.extracted_facts.length,
        languageUsed: out.language_used,
      },
      'reply turn completed'
    )
    this.deps.state.finishSending(
      chatId,
      status === 'sent'
        ? 'sent'
        : status === 'escalated'
          ? 'escalated'
          : status === 'skipped'
            ? 'skipped'
            : 'failed'
    )
  }

  private finishAborted(chatId: ChatId, startedAt: number, triggeredBy: TurnTriggeredBy): void {
    const durationMs = Date.now() - startedAt
    insertTurnLog(this.deps.sqlite, {
      chatId,
      ts: startedAt,
      status: 'aborted',
      languageUsed: null,
      factsExtracted: 0,
      durationMs,
      errorMsg: null,
      triggeredBy,
    })
    log.info({ chatId, reason: 'aborted', durationMs }, 'reply turn aborted')
    this.deps.state.finishSending(chatId, 'aborted')
  }

  private finishFailed(
    chatId: ChatId,
    startedAt: number,
    triggeredBy: TurnTriggeredBy,
    errorMsg: string
  ): void {
    const durationMs = Date.now() - startedAt
    insertTurnLog(this.deps.sqlite, {
      chatId,
      ts: startedAt,
      status: 'failed',
      languageUsed: null,
      factsExtracted: 0,
      durationMs,
      errorMsg,
      triggeredBy,
    })
    log.error({ chatId, errorMsg, durationMs }, 'reply turn failed')
    this.deps.state.finishSending(chatId, 'failed')
  }
}
