import assert from 'node:assert/strict'
import test from 'node:test'

import { escalationStatusLabel, formatDuration, shortChatId } from '../../web/lib/format.js'

test('dashboard formatters produce compact stable labels', () => {
  assert.equal(formatDuration(null), '-')
  assert.equal(formatDuration(999), '999ms')
  assert.equal(formatDuration(1500), '1.5s')
  assert.equal(formatDuration(90_000), '1.5m')
  assert.equal(shortChatId('1234567890123456@c.us'), '1234…3456')
})

test('escalationStatusLabel splits notification-pending from awaiting-reply', () => {
  assert.equal(
    escalationStatusLabel({ status: 'pending', notifiedChannels: [] }),
    'Notification pending'
  )
  assert.equal(
    escalationStatusLabel({ status: 'pending', notifiedChannels: ['telegram'] }),
    'Awaiting reply'
  )
  assert.equal(escalationStatusLabel({ status: 'user_replied', notifiedChannels: [] }), 'Replied')
})
