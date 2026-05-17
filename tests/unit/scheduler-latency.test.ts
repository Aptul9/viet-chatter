import assert from 'node:assert/strict'
import test from 'node:test'

import { insertProcessedMessage } from '../../src/db/repo.js'
import {
  computeFireAt,
  isInNightWindow,
  nextMorningStart,
  rollingAvgLatency,
} from '../../src/scheduler/latency.js'
import { openTestDb, overrideConfigForTest } from './helpers/test-db.js'

test('night-window helpers use configured timezone boundaries', () => {
  overrideConfigForTest({ timezone: 'Europe/Rome', nightWindow: { startHour: 22, endHour: 6 } })

  assert.equal(isInNightWindow(Date.parse('2026-01-01T21:30:00Z'), 'Europe/Rome'), true)
  assert.equal(isInNightWindow(Date.parse('2026-01-01T11:00:00Z'), 'Europe/Rome'), false)
  assert.equal(
    nextMorningStart(Date.parse('2026-01-01T22:00:00Z'), 'Europe/Rome'),
    Date.parse('2026-01-02T05:00:00Z')
  )
})

test('rolling average uses last completed incoming/outgoing bursts', () => {
  const db = openTestDb()
  try {
    const chatId = '395555555555@c.us'
    const pairs = [
      [1_000, 2_000],
      [3_000, 5_000],
      [7_000, 10_000],
      [12_000, 16_000],
    ] as const
    for (const [inTs, outTs] of pairs) {
      insertProcessedMessage(db.sqlite, {
        whatsappMsgId: `in_${inTs}`,
        chatId,
        direction: 'in',
        ts: inTs,
      })
      insertProcessedMessage(db.sqlite, {
        whatsappMsgId: `out_${outTs}`,
        chatId,
        direction: 'out_manual',
        ts: outTs,
      })
    }

    assert.equal(rollingAvgLatency(db.sqlite, chatId, 3, false), (2000 + 3000 + 4000) / 3)
  } finally {
    db.cleanup()
  }
})

test('computeFireAt is deterministic when jitter is disabled', () => {
  const db = openTestDb()
  try {
    overrideConfigForTest({
      timezone: 'Europe/Rome',
      nightWindow: { startHour: 22, endHour: 6 },
      rollingLatencyWindow: 3,
      minDelayMs: 5_000,
      maxDelayMs: 60_000,
      fallbackDelayMs: 12_000,
      jitterPct: 0,
    })

    const debounceClosed = Date.parse('2026-01-01T10:00:00Z')
    assert.equal(
      computeFireAt(db.sqlite, '396666666666@c.us', debounceClosed),
      debounceClosed + 12_000
    )
  } finally {
    db.cleanup()
  }
})
