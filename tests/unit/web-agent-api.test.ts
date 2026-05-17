import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AgentExecuteRequestSchema,
  AgentRouteRequestSchema,
  HistoryEntrySchema,
} from '../../web/lib/agent-api.js'

test('agent route request schema accepts bounded session history', () => {
  const historyEntry = {
    prompt: 'send birthday message',
    thinking: 'Need date_anchored job',
    clarificationNeeded: null,
    actions: [
      {
        type: 'createManualJob',
        payload: { chatId: '1', kind: 'date_anchored' },
        preview: 'Create job',
        result: { success: true, message: 'ok' },
      },
    ],
  }

  assert.equal(HistoryEntrySchema.safeParse(historyEntry).success, true)
  assert.equal(
    AgentRouteRequestSchema.safeParse({
      sessionId: 'abc',
      prompt: 'do it',
      history: Array.from({ length: 20 }, () => historyEntry),
    }).success,
    true
  )
  assert.equal(
    AgentRouteRequestSchema.safeParse({
      sessionId: 'abc',
      prompt: 'do it',
      history: Array.from({ length: 21 }, () => historyEntry),
    }).success,
    false
  )
})

test('agent route request schema rejects empty prompt and malformed action result', () => {
  assert.equal(
    AgentRouteRequestSchema.safeParse({
      sessionId: 'abc',
      prompt: '',
    }).success,
    false
  )
  assert.equal(
    HistoryEntrySchema.safeParse({
      prompt: 'x',
      thinking: null,
      clarificationNeeded: null,
      actions: [
        {
          type: 'createManualJob',
          payload: {},
          preview: 'Create job',
          result: { success: 'yes', message: 'ok' },
        },
      ],
    }).success,
    false
  )
})

test('agent execute request schema requires positive action id and confirm=true', () => {
  assert.equal(AgentExecuteRequestSchema.safeParse({ actionId: 1, confirm: true }).success, true)
  assert.equal(AgentExecuteRequestSchema.safeParse({ actionId: 0, confirm: true }).success, false)
  assert.equal(AgentExecuteRequestSchema.safeParse({ actionId: 1, confirm: false }).success, false)
})
