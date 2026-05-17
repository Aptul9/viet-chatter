import assert from 'node:assert/strict'
import test from 'node:test'

import { defaults } from '../../config/defaults.js'
import { getChatState, transitionChatState, upsertChatStateIdle } from '../../src/db/repo.js'
import { ChatStateMachine } from '../../src/scheduler/state.js'
import { openTestDb, overrideConfigForTest, resetConfigForTest } from './helpers/test-db.js'

test('incoming on idle creates accumulating state with message timestamp', () => {
  resetConfigForTest()
  overrideConfigForTest(defaults)
  const db = openTestDb()
  try {
    const sm = new ChatStateMachine(db.sqlite)
    const chatId = '391111111111@c.us'
    const msgTs = 12_345

    assert.equal(sm.handleIncoming(chatId, msgTs), 'ACCUMULATING')
    const row = getChatState(db.sqlite, chatId)
    assert.equal(row?.state, 'ACCUMULATING')
    assert.equal(row?.firstMsgAt, msgTs)
  } finally {
    db.cleanup()
  }
})

test('incoming on scheduled resets wave back to accumulating', () => {
  const db = openTestDb()
  try {
    const sm = new ChatStateMachine(db.sqlite)
    const chatId = '392222222222@c.us'
    upsertChatStateIdle(db.sqlite, chatId)
    transitionChatState(db.sqlite, chatId, 'IDLE', 'SCHEDULED', {
      fireAt: 50_000,
      firstMsgAt: 10_000,
      lastEventAt: 10_000,
    })

    assert.equal(sm.handleIncoming(chatId, 20_000), 'ACCUMULATING')
    const row = getChatState(db.sqlite, chatId)
    assert.equal(row?.state, 'ACCUMULATING')
    assert.equal(row?.firstMsgAt, 20_000)
    assert.equal(row?.fireAt, null)
  } finally {
    db.cleanup()
  }
})

test('manual outgoing from scheduled resets state to idle', () => {
  const db = openTestDb()
  try {
    const sm = new ChatStateMachine(db.sqlite)
    const chatId = '393333333333@c.us'
    upsertChatStateIdle(db.sqlite, chatId)
    transitionChatState(db.sqlite, chatId, 'IDLE', 'SCHEDULED', {
      fireAt: 50_000,
      lastEventAt: 10_000,
    })

    const result = sm.handleOutgoingManual(chatId)

    assert.deepEqual(result, { previous: 'SCHEDULED', aborted: false })
    assert.equal(getChatState(db.sqlite, chatId)?.state, 'IDLE')
  } finally {
    db.cleanup()
  }
})
