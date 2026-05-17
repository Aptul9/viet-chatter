import assert from 'node:assert/strict'
import test from 'node:test'

import { TurnOutputSchema } from '../../src/ai/turn.js'

const base = {
  reply: 'ciao',
  skip: false,
  extracted_facts: [],
  tone_update: null,
  languages_update: null,
  language_used: 'it',
  revive_hint: null,
  escalate_to_human: null,
}

test('TurnOutputSchema accepts complete valid output', () => {
  assert.equal(TurnOutputSchema.safeParse(base).success, true)
})

test('TurnOutputSchema rejects invalid fact confidence and anchor date', () => {
  assert.equal(
    TurnOutputSchema.safeParse({
      ...base,
      extracted_facts: [{ tier: 'important', content: 'x', confidence: 1.1 }],
    }).success,
    false
  )
  assert.equal(
    TurnOutputSchema.safeParse({
      ...base,
      extracted_facts: [
        { tier: 'important', content: 'x', confidence: 0.9, anchor_date: 'tomorrow' },
      ],
    }).success,
    false
  )
})

test('TurnOutputSchema requires escalation summaries', () => {
  assert.equal(
    TurnOutputSchema.safeParse({
      ...base,
      escalate_to_human: {
        reason: 'scheduling',
        urgency: 'normal',
        summary: '',
        suggested_holding_reply: null,
      },
    }).success,
    false
  )
})
