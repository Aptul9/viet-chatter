// Scenario: three distinct reactive failures trip the global FailureTracker
// threshold and emit exactly one system alert via the configured sink.

import { getFailureTracker, type AlertPayload } from '../../utils/failure-tracker.js'
import { INVALID_STUB_RESPONSE, waitFor } from './common.js'
import type { Scenario, ScenarioResult, TestDeps } from './types.js'

export const failureTrackerAlert: Scenario = {
  name: 'failure-tracker-alert',
  description: 'Three distinct failed ops trigger one global FailureTracker alert.',

  async run(deps: TestDeps): Promise<ScenarioResult> {
    const errors: string[] = []
    const alerts: AlertPayload[] = []
    const tracker = getFailureTracker()
    tracker.setAlertSink(async (payload) => {
      alerts.push(payload)
    })

    deps.ai.setNextResponse(INVALID_STUB_RESPONSE)
    const seed = String(Date.now()).slice(-6)
    const chatIds = [`393999${seed}1@c.us`, `393999${seed}2@c.us`, `393999${seed}3@c.us`]
    for (const chatId of chatIds) {
      await deps.orchestrator.generateAndSend(chatId, new AbortController().signal)
    }

    const alertOk = await waitFor(() => alerts.length >= 1, 5_000)
    if (!alertOk) errors.push('failure tracker did not emit an alert within 5s')

    if (alerts.length !== 1) errors.push(`alert count=${alerts.length}, want 1`)
    const first = alerts[0]
    if (first?.reason !== 'global_rate') {
      errors.push(`alert reason=${first?.reason}, want 'global_rate'`)
    }
    if (!first?.text.includes('3+ distinct ops failing')) {
      errors.push(`alert text missing global-rate summary: ${first?.text ?? '<none>'}`)
    }

    const placeholders = chatIds.map(() => '?').join(',')
    const retryCount = deps.sqlite
      .prepare(
        `SELECT COUNT(*) AS c FROM manual_jobs WHERE kind = 'retry' AND chat_id IN (${placeholders})`
      )
      .get(...chatIds) as { c: number }
    if (retryCount.c !== 3) errors.push(`retry row count=${retryCount.c}, want 3`)

    tracker.setAlertSink(null)
    return { ok: errors.length === 0, errors }
  },
}
