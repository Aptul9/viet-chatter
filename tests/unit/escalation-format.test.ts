import assert from 'node:assert/strict'
import test from 'node:test'

import { formatEscalation } from '../../src/escalation/format.js'
import type { EscalationRow } from '../../src/types.js'

const esc: EscalationRow = {
  id: 1,
  chatId: '179123456789@lid',
  triggerMsgId: 'msg1',
  reason: 'scheduling',
  urgency: 'high',
  summary: 'Hoa_ asks [when] to meet',
  holdingReplySent: false,
  status: 'pending',
  createdAt: 1000,
  resolvedAt: null,
  notifiedChannels: [],
}

test('plain escalation format strips whatsapp suffix and uses ASCII urgency marker', () => {
  const payload = formatEscalation('whatsapp_self', esc)
  assert.match(payload.text, /\[viet-chatter\] !! SCHEDULING/)
  assert.match(payload.text, /Da: \+179123456789/)
  assert.doesNotMatch(payload.text, /@lid/)
})

test('telegram format escapes markdown and prefers resolved display phone', () => {
  const payload = formatEscalation('telegram', esc, '+391234567890')
  assert.match(payload.text, /\*Da:\* \+391234567890/)
  assert.match(payload.text, /Hoa\\_ asks \\\[when\\\]/)
})
