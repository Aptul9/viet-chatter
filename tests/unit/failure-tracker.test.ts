import assert from 'node:assert/strict'
import test from 'node:test'

import { FailureTracker, type AlertPayload } from '../../src/utils/failure-tracker.js'

async function flush(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

test('per-op exhaustion triggers once for same operation', async () => {
  const tracker = new FailureTracker()
  const alerts: AlertPayload[] = []
  tracker.setAlertSink((payload) => alerts.push(payload))

  tracker.recordFailure({ opId: 'reactive:1', label: 'reactive turn', attempt: 5, error: 'boom' })
  await flush()
  tracker.recordFailure({
    opId: 'reactive:1',
    label: 'reactive turn',
    attempt: 6,
    error: 'boom again',
  })
  await flush()

  assert.equal(alerts.length, 1)
  assert.equal(alerts[0]?.reason, 'per_op_exhaustion')
})

test('global distinct failure threshold triggers system alert', async () => {
  const tracker = new FailureTracker()
  const alerts: AlertPayload[] = []
  tracker.setAlertSink((payload) => alerts.push(payload))

  tracker.recordFailure({ opId: 'a', label: 'a', attempt: 1, error: 'e1' })
  tracker.recordFailure({ opId: 'b', label: 'b', attempt: 1, error: 'e2' })
  tracker.recordFailure({ opId: 'c', label: 'c', attempt: 1, error: 'e3' })
  await flush()

  assert.equal(tracker.recentDistinctOps() >= 3, true)
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0]?.reason, 'global_rate')
})

test('alert dedupe suppresses rapid consecutive alerts', async () => {
  const tracker = new FailureTracker()
  const alerts: AlertPayload[] = []
  tracker.setAlertSink((payload) => alerts.push(payload))

  tracker.recordFailure({ opId: 'a', label: 'a', attempt: 1, error: 'e1' })
  tracker.recordFailure({ opId: 'b', label: 'b', attempt: 1, error: 'e2' })
  tracker.recordFailure({ opId: 'c', label: 'c', attempt: 1, error: 'e3' })
  await flush()

  tracker.recordFailure({ opId: 'd', label: 'd', attempt: 5, error: 'e4' })
  await flush()

  assert.equal(alerts.length, 1)
})
