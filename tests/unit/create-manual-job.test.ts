import assert from 'node:assert/strict'
import test from 'node:test'

import { insertProcessedMessage } from '../../src/db/repo.js'
import { executeCreateManualJob } from '../../src/agent/actions/create-manual-job.js'
import { openTestDb } from './helpers/test-db.js'

test('create-manual-job rejects past fireAt values', async () => {
  const db = openTestDb()
  try {
    const result = await executeCreateManualJob(
      {
        chatId: '391111111111@c.us',
        kind: 'revive',
        fireAtIso: '2020-01-01T00:00:00.000Z',
        action: 'ping',
      },
      db.sqlite
    )
    assert.equal(result.success, false)
    assert.match(result.message, /in the past/)
  } finally {
    db.cleanup()
  }
})

test('create-manual-job rejects unknown chats', async () => {
  const db = openTestDb()
  try {
    const result = await executeCreateManualJob(
      {
        chatId: '391111111111@c.us',
        kind: 'revive',
        fireAtIso: '2030-01-01T00:00:00.000Z',
        action: 'ping',
      },
      db.sqlite
    )
    assert.equal(result.success, false)
    assert.match(result.message, /no known chat/)
  } finally {
    db.cleanup()
  }
})

test('create-manual-job inserts pending job for known chat', async () => {
  const db = openTestDb()
  try {
    const chatId = '391111111111@c.us'
    insertProcessedMessage(db.sqlite, {
      whatsappMsgId: 'msg1',
      chatId,
      direction: 'in',
      ts: Date.now(),
    })

    const result = await executeCreateManualJob(
      {
        chatId,
        kind: 'date_anchored',
        fireAtIso: '2030-01-01T00:00:00.000Z',
        action: 'wish birthday',
        recurring: 'yearly',
      },
      db.sqlite
    )

    assert.equal(result.success, true)
    const row = db.sqlite
      .prepare(
        'SELECT kind, status, payload FROM manual_jobs WHERE chat_id = ? ORDER BY id DESC LIMIT 1'
      )
      .get(chatId) as { kind: string; status: string; payload: string }
    assert.equal(row.kind, 'date_anchored')
    assert.equal(row.status, 'pending')
    assert.deepEqual(JSON.parse(row.payload), { action: 'wish birthday', recurring: 'yearly' })
  } finally {
    db.cleanup()
  }
})
