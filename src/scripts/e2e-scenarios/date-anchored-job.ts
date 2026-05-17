// Scenario: due date_anchored manual job fires through ManualJobsCron,
// generates one reply, marks the job fired, and re-schedules yearly recurrence.

import { DEFAULT_STUB_RESPONSE, waitFor } from './common.js'
import type { Scenario, ScenarioResult, TestDeps } from './types.js'

export const dateAnchoredJob: Scenario = {
  name: 'date-anchored-job',
  description: 'Due date_anchored manual job fires and yearly recurrence is re-created.',

  async run(deps: TestDeps): Promise<ScenarioResult> {
    const errors: string[] = []
    deps.ai.setNextResponse(DEFAULT_STUB_RESPONSE)

    const now = Date.now()
    deps.sqlite
      .prepare(
        "INSERT INTO manual_jobs (chat_id, kind, fire_at, payload, status, created_at, attempt_count) VALUES (?, 'date_anchored', ?, ?, 'pending', ?, NULL)"
      )
      .run(
        deps.chatId,
        now - 1_000,
        JSON.stringify({ action: 'wish_birthday', fact_id: 123, recurring: 'yearly' }),
        now - 5_000
      )

    const firedOk = await waitFor(() => {
      const row = deps.sqlite
        .prepare(
          "SELECT COUNT(*) AS c FROM manual_jobs WHERE chat_id = ? AND kind = 'date_anchored' AND status = 'fired'"
        )
        .get(deps.chatId) as { c: number }
      return row.c >= 1
    }, 10_000)
    if (!firedOk) errors.push('date_anchored job did not fire within 10s')

    const sentOk = await waitFor(() => deps.sent.length >= 1, 10_000)
    if (!sentOk) errors.push('manual job did not send a reply within 10s')

    const pendingRecurring = deps.sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM manual_jobs WHERE chat_id = ? AND kind = 'date_anchored' AND status = 'pending'"
      )
      .get(deps.chatId) as { c: number }
    if (pendingRecurring.c < 1) errors.push('yearly recurring date_anchored job was not re-created')

    const turn = deps.sqlite
      .prepare(
        'SELECT status, triggered_by FROM turn_log WHERE chat_id = ? ORDER BY id DESC LIMIT 1'
      )
      .get(deps.chatId) as { status: string; triggered_by: string } | undefined
    if (!turn) {
      errors.push('no turn_log row created for date_anchored job')
    } else {
      if (turn.status !== 'sent') errors.push(`turn_log.status=${turn.status}, want 'sent'`)
      if (turn.triggered_by !== 'manual_job') {
        errors.push(`turn_log.triggered_by=${turn.triggered_by}, want 'manual_job'`)
      }
    }

    return { ok: errors.length === 0, errors }
  },
}
