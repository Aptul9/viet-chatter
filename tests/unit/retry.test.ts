import assert from 'node:assert/strict'
import test from 'node:test'

import { nextFireAt, parseRetryPayload, scheduleRetry } from '../../src/utils/retry.js'
import { openTestDb } from './helpers/test-db.js'

test('nextFireAt applies capped backoff with jitter range', () => {
  const now = Date.parse('2026-01-01T00:00:00Z')
  const attempt1Delay = nextFireAt(1, now) - now
  const attempt2Delay = nextFireAt(2, now) - now
  const attempt99Delay = nextFireAt(99, now) - now

  assert.ok(attempt1Delay >= 4.5 * 60_000 && attempt1Delay < 5.5 * 60_000)
  assert.ok(attempt2Delay >= 9.5 * 60_000 && attempt2Delay < 10.5 * 60_000)
  assert.ok(attempt99Delay >= 29.5 * 60_000 && attempt99Delay < 30.5 * 60_000)
})

test('parseRetryPayload accepts known triggers and rejects bad payloads', () => {
  assert.deepEqual(parseRetryPayload('{"trigger":"reactive","errorSummary":"x"}'), {
    trigger: 'reactive',
    errorSummary: 'x',
  })
  assert.equal(parseRetryPayload('{"trigger":"nope","errorSummary":"x"}'), null)
  assert.equal(parseRetryPayload('not json'), null)
  assert.equal(parseRetryPayload(null), null)
})

test('scheduleRetry stores next attempt number but first backoff bucket', () => {
  const db = openTestDb()
  try {
    const { jobId } = scheduleRetry({
      sqlite: db.sqlite,
      chatId: '391111111111@c.us',
      trigger: 'reactive',
      errorSummary: 'boom',
      previousAttempt: 1,
    })
    const row = db.sqlite
      .prepare('SELECT attempt_count, fire_at, created_at FROM manual_jobs WHERE id = ?')
      .get(jobId) as { attempt_count: number; fire_at: number; created_at: number }
    assert.equal(row.attempt_count, 2)
    const delayMs = row.fire_at - row.created_at
    assert.ok(delayMs >= 4.5 * 60_000 && delayMs < 5.5 * 60_000)
  } finally {
    db.cleanup()
  }
})
