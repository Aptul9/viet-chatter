import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getChatState,
  getLastSeenTs,
  insertFact,
  insertManualJob,
  insertProcessedMessage,
  loadFactsByIds,
  recentProcessedMessages,
  transitionChatState,
  upsertChatStateIdle,
} from '../../src/db/repo.js'
import { openTestDb } from './helpers/test-db.js'

test('processed messages are idempotent and recent rows stay ascending', () => {
  const db = openTestDb()
  try {
    const chatId = '391111111111@c.us'
    for (let i = 1; i <= 7; i++) {
      insertProcessedMessage(db.sqlite, {
        whatsappMsgId: `m${i}`,
        chatId,
        direction: i % 2 === 0 ? 'out_manual' : 'in',
        ts: i * 1000,
      })
    }
    insertProcessedMessage(db.sqlite, {
      whatsappMsgId: 'm7',
      chatId,
      direction: 'in',
      ts: 999_999,
    })

    assert.equal(getLastSeenTs(db.sqlite, chatId), 7000)
    assert.deepEqual(
      recentProcessedMessages(db.sqlite, chatId, 3).map((r) => r.whatsappMsgId),
      ['m5', 'm6', 'm7']
    )
  } finally {
    db.cleanup()
  }
})

test('chat state transitions are guarded by expected source state', () => {
  const db = openTestDb()
  try {
    const chatId = '392222222222@c.us'
    upsertChatStateIdle(db.sqlite, chatId)

    assert.equal(
      transitionChatState(db.sqlite, chatId, 'IDLE', 'ACCUMULATING', {
        firstMsgAt: 1000,
        debounceDeadline: 2000,
        fireAt: null,
        lastEventAt: 1000,
      }),
      true
    )
    assert.equal(transitionChatState(db.sqlite, chatId, 'IDLE', 'SCHEDULED'), false)
    assert.equal(getChatState(db.sqlite, chatId)?.state, 'ACCUMULATING')
  } finally {
    db.cleanup()
  }
})

test('loadFactsByIds preserves requested order and ignores missing ids', () => {
  const db = openTestDb()
  try {
    const personId = '393333333333@c.us'
    const first = insertFact(db.sqlite, {
      personId,
      tier: 'important',
      content: 'first',
      sourceMsgId: null,
      confidence: 0.9,
      createdAt: 1000,
      expiresAt: null,
      supersededBy: null,
    })
    const second = insertFact(db.sqlite, {
      personId,
      tier: 'secondary',
      content: 'second',
      sourceMsgId: null,
      confidence: 0.8,
      createdAt: 2000,
      expiresAt: null,
      supersededBy: null,
    })

    assert.deepEqual(
      loadFactsByIds(db.sqlite, [second, 999_999, first]).map((f) => f.content),
      ['second', 'first']
    )
  } finally {
    db.cleanup()
  }
})

test('retry attempt count is persisted on manual jobs', () => {
  const db = openTestDb()
  try {
    const jobId = insertManualJob(db.sqlite, {
      chatId: '394444444444@c.us',
      kind: 'retry',
      fireAt: 123_456,
      payload: JSON.stringify({ trigger: 'reactive', errorSummary: 'x' }),
      status: 'pending',
      createdAt: 1000,
      attemptCount: 3,
    })
    const row = db.sqlite
      .prepare('SELECT attempt_count FROM manual_jobs WHERE id = ?')
      .get(jobId) as { attempt_count: number }
    assert.equal(row.attempt_count, 3)
  } finally {
    db.cleanup()
  }
})
