// EscalationNotifier: orchestrates per-channel send + rate limit + state update.
// See docs/dev/18-escalation.md "Modulo EscalationNotifier" + Flow H.

import type { Sqlite } from '../db/client.js'
import { countEscalationsLastHour, getEscalation, updateEscalationNotified } from '../db/repo.js'
import { config } from '../config/index.js'
import { log } from '../log.js'
import { formatEscalation } from './format.js'
import type { EscalationChannel } from './channels/index.js'
import type { EscalationChannelName } from '../types.js'
import type { WhatsAppHandle } from '../whatsapp/client.js'

export interface NotifierDeps {
  sqlite: Sqlite
  channels: EscalationChannel[]
  /** Optional: used to resolve `@lid` chatIds to real E.164 phones in the
   * notification header. When absent (test scenarios), the formatter falls
   * back to the raw lid digits. */
  wa?: Pick<WhatsAppHandle, 'resolveLidPhone'>
}

export class EscalationNotifier {
  constructor(private readonly deps: NotifierDeps) {}

  async notify(escId: number): Promise<void> {
    const esc = getEscalation(this.deps.sqlite, escId)
    if (!esc) {
      log.warn({ escId }, 'escalation not found at notify time')
      return
    }

    if (this.rateLimited(esc.urgency)) {
      log.warn({ escId, urgency: esc.urgency, aggregated: true }, 'escalation rate limited')
      return
    }

    const channels = this.deps.channels
    if (channels.length === 0) {
      log.warn({ escId }, 'no escalation channels configured')
      return
    }

    let displayPhone: string | null = null
    if (this.deps.wa && esc.chatId.endsWith('@lid')) {
      try {
        displayPhone = await this.deps.wa.resolveLidPhone(esc.chatId)
        if (!displayPhone) {
          log.info({ escId, chatId: esc.chatId }, 'lid not resolvable for escalation header')
        }
      } catch (err) {
        log.warn(
          { escId, chatId: esc.chatId, err: (err as Error).message },
          'resolveLidPhone failed in notifier'
        )
      }
    }

    const results = await Promise.allSettled(
      channels.map((c) => c.send(formatEscalation(c.name, esc, displayPhone)))
    )

    const ok: EscalationChannelName[] = []
    const failed: EscalationChannelName[] = []
    results.forEach((r, i) => {
      const ch = channels[i]
      if (!ch) return
      if (r.status === 'fulfilled' && r.value) ok.push(ch.name)
      else failed.push(ch.name)
    })

    updateEscalationNotified(this.deps.sqlite, escId, ok)
    log.info({ escId, channelsOk: ok, channelsFailed: failed }, 'escalation notified')
    if (ok.length === 0)
      log.error({ escId, channelsFailed: failed }, 'all escalation channels failed')
  }

  private rateLimited(urgency: 'low' | 'normal' | 'high'): boolean {
    if (!config.escalation.enabled) return true
    if (urgency === 'high' && config.escalation.highUrgencyBypassRateLimit) return false
    const count = countEscalationsLastHour(this.deps.sqlite, Date.now())
    return count >= config.escalation.rateLimitPerHour
  }
}
