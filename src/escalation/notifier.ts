// EscalationNotifier: orchestrates per-channel send + rate limit + state update.
// See docs/dev/18-escalation.md "Modulo EscalationNotifier" + Flow H.

import type { Sqlite } from '../db/client.js'
import { countEscalationsLastHour, getEscalation, updateEscalationNotified } from '../db/repo.js'
import { config } from '../config/index.js'
import { log } from '../log.js'
import { formatEscalation } from './format.js'
import type { EscalationChannel } from './channels/index.js'
import type { EscalationChannelName } from '../types.js'

export interface NotifierDeps {
  sqlite: Sqlite
  channels: EscalationChannel[]
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

    const results = await Promise.allSettled(
      channels.map((c) => c.send(formatEscalation(c.name, esc)))
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
