import assert from 'node:assert/strict'
import test from 'node:test'

import { defaults } from '../../config/defaults.js'
import { classifyMediaType, resolveMediaPolicy } from '../../src/dispatcher/media-policy.js'
import { overrideConfigForTest } from './helpers/test-db.js'

test('classifyMediaType normalizes known, grouped, and unknown wweb types', () => {
  assert.equal(classifyMediaType('chat'), 'chat')
  assert.equal(classifyMediaType('multi_vcard'), 'vcard')
  assert.equal(classifyMediaType('poll'), 'unknown')
  assert.equal(classifyMediaType(undefined), 'unknown')
})

test('resolveMediaPolicy downgrades vision when model is not vision-capable', () => {
  overrideConfigForTest({
    aiModel: 'opencode:test/text-only',
    media: { ...defaults.media, image: { strategy: 'vision' }, visionFallback: 'skip' },
  })

  assert.deepEqual(resolveMediaPolicy('image'), {
    strategy: 'skip',
    downgraded: true,
    requested: 'vision',
  })
})

test('resolveMediaPolicy keeps vision for allowlisted models and escalates unknown media', () => {
  overrideConfigForTest({
    aiModel: 'opencode:github-copilot/gpt-5-mini',
    media: { ...defaults.media, image: { strategy: 'vision' }, visionFallback: 'escalate' },
  })

  assert.deepEqual(resolveMediaPolicy('image'), {
    strategy: 'vision',
    downgraded: false,
    requested: 'vision',
  })
  assert.deepEqual(resolveMediaPolicy('unknown'), {
    strategy: 'escalate',
    downgraded: false,
    requested: 'escalate',
  })
})
