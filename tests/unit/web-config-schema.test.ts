import assert from 'node:assert/strict'
import test from 'node:test'

import { ConfigSchema, defaults } from '../../web/lib/config-schema.js'

test('web config schema accepts canonical defaults', () => {
  const parsed = ConfigSchema.parse(defaults)
  assert.equal(parsed.aiModel, defaults.aiModel)
  assert.deepEqual(parsed.filter, defaults.filter)
})

test('web config schema coerces numeric strings from form payloads', () => {
  const parsed = ConfigSchema.parse({
    ...defaults,
    debounceMs: '1234',
    jitterPct: '0.5',
    escalation: { ...defaults.escalation, rateLimitPerHour: '7' },
  })
  assert.equal(parsed.debounceMs, 1234)
  assert.equal(parsed.jitterPct, 0.5)
  assert.equal(parsed.escalation.rateLimitPerHour, 7)
})
