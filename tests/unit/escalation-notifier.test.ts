import assert from 'node:assert/strict'
import test from 'node:test'

import { defaults } from '../../config/defaults.js'
import { insertEscalation, getEscalation } from '../../src/db/repo.js'
import { EscalationNotifier } from '../../src/escalation/notifier.js'
import type { EscalationChannel } from '../../src/escalation/channels/index.js'
import { openTestDb, overrideConfigForTest, resetConfigForTest } from './helpers/test-db.js'

function makeEscalation(
  sqlite: import('../../src/db/client.js').Sqlite,
  partial?: Partial<{
    chatId: string
    urgency: 'low' | 'normal' | 'high'
    notifiedChannels: Array<'telegram' | 'whatsapp_self' | 'rate_limited'>
  }>
) {
  return insertEscalation(sqlite, {
    chatId: partial?.chatId ?? '391111111111@c.us',
    triggerMsgId: 'msg1',
    reason: 'other',
    urgency: partial?.urgency ?? 'normal',
    summary: 'Need human input',
    holdingReplySent: false,
    status: 'pending',
    createdAt: Date.now(),
    notifiedChannels: partial?.notifiedChannels ?? [],
  })
}

test('notifier stores only successful channels', async () => {
  resetConfigForTest()
  overrideConfigForTest({
    escalation: { ...defaults.escalation, enabled: true, rateLimitPerHour: 99 },
  })
  const db = openTestDb()
  try {
    const sent: string[] = []
    const channels: EscalationChannel[] = [
      { name: 'telegram', send: async (payload) => (sent.push(payload.text), true) },
      { name: 'whatsapp_self', send: async () => false },
    ]
    const notifier = new EscalationNotifier({ sqlite: db.sqlite, channels })
    const escId = makeEscalation(db.sqlite)

    await notifier.notify(escId)

    assert.equal(sent.length, 1)
    assert.deepEqual(getEscalation(db.sqlite, escId)?.notifiedChannels, ['telegram'])
  } finally {
    db.cleanup()
  }
})

test('normal urgency is blocked by rate limit', async () => {
  resetConfigForTest()
  overrideConfigForTest({
    escalation: { ...defaults.escalation, enabled: true, rateLimitPerHour: 1 },
  })
  const db = openTestDb()
  try {
    makeEscalation(db.sqlite, { notifiedChannels: ['telegram'] })
    let calls = 0
    const notifier = new EscalationNotifier({
      sqlite: db.sqlite,
      channels: [{ name: 'telegram', send: async () => (++calls, true) }],
    })
    const escId = makeEscalation(db.sqlite, { chatId: '392222222222@c.us', urgency: 'normal' })

    await notifier.notify(escId)

    assert.equal(calls, 0)
    assert.deepEqual(getEscalation(db.sqlite, escId)?.notifiedChannels, [])
  } finally {
    db.cleanup()
  }
})

test('high urgency bypasses rate limit when configured', async () => {
  resetConfigForTest()
  overrideConfigForTest({
    escalation: {
      ...defaults.escalation,
      enabled: true,
      rateLimitPerHour: 1,
      highUrgencyBypassRateLimit: true,
    },
  })
  const db = openTestDb()
  try {
    makeEscalation(db.sqlite, { notifiedChannels: ['telegram'] })
    let calls = 0
    const notifier = new EscalationNotifier({
      sqlite: db.sqlite,
      channels: [{ name: 'telegram', send: async () => (++calls, true) }],
    })
    const escId = makeEscalation(db.sqlite, { chatId: '393333333333@c.us', urgency: 'high' })

    await notifier.notify(escId)

    assert.equal(calls, 1)
    assert.deepEqual(getEscalation(db.sqlite, escId)?.notifiedChannels, ['telegram'])
  } finally {
    db.cleanup()
  }
})
