import assert from 'node:assert/strict'
import test from 'node:test'

import {
  insertProcessedMessage,
  getChatState,
  transitionChatState,
  upsertChatStateIdle,
} from '../../src/db/repo.js'
import { ChatStateMachine } from '../../src/scheduler/state.js'
import { startTicker, stopTicker } from '../../src/scheduler/ticker.js'
import { openTestDb, overrideConfigForTest } from './helpers/test-db.js'

test('ticker cancels overdue scheduled reply when recent manual out exists', async () => {
  const db = openTestDb()
  try {
    overrideConfigForTest({ tickIntervalMs: 10 })
    const chatId = '397777777777@c.us'
    const now = Date.now()
    upsertChatStateIdle(db.sqlite, chatId)
    transitionChatState(db.sqlite, chatId, 'IDLE', 'SCHEDULED', {
      fireAt: now - 1000,
      lastEventAt: now - 1000,
    })
    insertProcessedMessage(db.sqlite, {
      whatsappMsgId: 'manual1',
      chatId,
      direction: 'out_manual',
      ts: now,
    })

    let ranTurn = false
    const state = new ChatStateMachine(db.sqlite)
    startTicker({
      sqlite: db.sqlite,
      state,
      runTurn: async () => {
        ranTurn = true
      },
      registerInflight: () => new AbortController().signal,
      isConnected: () => true,
    })

    await new Promise((resolve) => setTimeout(resolve, 80))
    stopTicker()

    assert.equal(ranTurn, false)
    assert.equal(getChatState(db.sqlite, chatId)?.state, 'IDLE')
  } finally {
    stopTicker()
    db.cleanup()
  }
})
