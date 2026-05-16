// EscalationChannel interface + factory.
// See docs/dev/18-escalation.md "Canali di notifica".

import type { EscalationChannelName, EscalationPayload } from '../../types.js'
import { config } from '../../config/index.js'
import { log } from '../../log.js'
import { TelegramChannel } from './telegram.js'
import { WhatsAppSelfChannel } from './whatsapp-self.js'
import type { WhatsAppHandle } from '../../whatsapp/client.js'

export interface EscalationChannel {
  readonly name: EscalationChannelName
  send(payload: EscalationPayload): Promise<boolean>
}

export interface EscalationFactoryDeps {
  wa: WhatsAppHandle
}

export function buildEscalationChannels(deps: EscalationFactoryDeps): EscalationChannel[] {
  const enabled = config.escalation.channels
  const channels: EscalationChannel[] = []
  for (const name of enabled) {
    if (name === 'telegram') {
      channels.push(new TelegramChannel())
      continue
    }
    if (name === 'whatsapp_self') {
      channels.push(new WhatsAppSelfChannel(deps.wa))
      continue
    }
    log.warn({ channel: name }, 'unknown escalation channel, skipped')
  }
  return channels
}
