// WhatsApp self-chat channel: send the notification text to the bot's own wid.
// See docs/dev/18-escalation.md "Canale 1: WhatsApp self-chat".

import type { WhatsAppHandle } from '../../whatsapp/client.js'
import type { EscalationChannel } from './index.js'
import type { EscalationChannelName, EscalationPayload } from '../../types.js'
import { config } from '../../config/index.js'
import { log } from '../../log.js'

export class WhatsAppSelfChannel implements EscalationChannel {
  readonly name: EscalationChannelName = 'whatsapp_self'

  constructor(private readonly wa: WhatsAppHandle) {}

  async send(payload: EscalationPayload): Promise<boolean> {
    const target = await this.resolveTargetWid()
    if (!target) {
      log.error({ escId: payload.esc.id }, 'whatsapp self target unresolved, skipping send')
      return false
    }
    try {
      await this.wa.sendMessage(target, payload.text)
      return true
    } catch (err) {
      log.error({ err, escId: payload.esc.id, target }, 'whatsapp self-send failed')
      return false
    }
  }

  private async resolveTargetWid(): Promise<string | null> {
    const configured = config.escalation.whatsappSelfChatId
    if (configured && configured !== 'me') return configured
    try {
      return this.wa.getSelfWid()
    } catch (err) {
      log.error({ err }, 'whatsapp self wid resolve failed')
      return null
    }
  }
}
