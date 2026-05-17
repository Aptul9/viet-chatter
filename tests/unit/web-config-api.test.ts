import assert from 'node:assert/strict'
import test from 'node:test'

import { mergeOverDefaults } from '../../web/lib/config-api.js'
import { defaults } from '../../web/lib/config-schema.js'

test('mergeOverDefaults keeps nested defaults when overrides are partial', () => {
  const merged = mergeOverDefaults({
    nightWindow: { startHour: 23 },
    escalation: { rateLimitPerHour: 7 },
    filter: { blockedNumbers: ['+84123'] },
  })

  assert.equal(merged.nightWindow.startHour, 23)
  assert.equal(merged.nightWindow.endHour, defaults.nightWindow.endHour)
  assert.equal(merged.escalation.rateLimitPerHour, 7)
  assert.equal(merged.escalation.enabled, defaults.escalation.enabled)
  assert.deepEqual(merged.filter.blockedNumbers, ['+84123'])
  assert.deepEqual(merged.filter.allowedPrefixes, defaults.filter.allowedPrefixes)
})

test('mergeOverDefaults replaces top-level scalar and media overrides', () => {
  const merged = mergeOverDefaults({
    timezone: 'Asia/Ho_Chi_Minh',
    media: { image: { strategy: 'skip' } },
  })

  assert.equal(merged.timezone, 'Asia/Ho_Chi_Minh')
  assert.equal(merged.media.image.strategy, 'skip')
  assert.equal(merged.media.audio.strategy, defaults.media.audio.strategy)
})
