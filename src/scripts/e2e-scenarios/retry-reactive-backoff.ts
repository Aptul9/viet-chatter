// Scenario: reactive turn fails (invalid AI output) and schedules a retry row
// with exponential backoff attempt 2 at now + 5min +/- 30s.

import { INVALID_STUB_RESPONSE, makeFakeIncoming, waitFor } from './common.js'
import type { Scenario, ScenarioResult, TestDeps } from './types.js'

export const retryReactiveBackoff: Scenario = {
  name: 'retry-reactive-backoff',
  description: 'Reactive failure -> retry manual_job row with attempt_count=2 and 5min backoff.',

  async run(deps: TestDeps): Promise<ScenarioResult> {
    const errors: string[] = []
    deps.ai.setNextResponse(INVALID_STUB_RESPONSE)

    await deps.dispatcher.handleMessage(
      makeFakeIncoming({
        chatId: deps.chatId,
        msgId: `e2e_retry_${Date.now()}`,
        body: 'trigger retry please',
        type: 'chat',
      }) as never,
      {}
    )

    const retryOk = await waitFor(() => {
      const row = deps.sqlite
        .prepare(
          "SELECT COUNT(*) AS c FROM manual_jobs WHERE chat_id = ? AND kind = 'retry' AND status = 'pending'"
        )
        .get(deps.chatId) as { c: number }
      return row.c >= 1
    }, 20_000)
    if (!retryOk) errors.push('no pending retry job row within 20s')

    const row = deps.sqlite
      .prepare(
        "SELECT attempt_count, fire_at, created_at, payload FROM manual_jobs WHERE chat_id = ? AND kind = 'retry' ORDER BY id DESC LIMIT 1"
      )
      .get(deps.chatId) as
      | { attempt_count: number; fire_at: number; created_at: number; payload: string }
      | undefined
    if (!row) {
      errors.push('retry row missing')
    } else {
      if (row.attempt_count !== 2) errors.push(`attempt_count=${row.attempt_count}, want 2`)
      const delayMs = row.fire_at - row.created_at
      if (delayMs < 270_000 || delayMs > 330_000) {
        errors.push(`retry delay=${delayMs}ms, want 270000..330000`)
      }
      const payload = JSON.parse(row.payload) as { trigger?: string }
      if (payload.trigger !== 'reactive') {
        errors.push(`retry payload.trigger=${String(payload.trigger)}, want 'reactive'`)
      }
    }

    const turn = deps.sqlite
      .prepare('SELECT status FROM turn_log WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
      .get(deps.chatId) as { status: string } | undefined
    if (!turn) errors.push('no turn_log row created for failed reactive turn')
    else if (turn.status !== 'failed') errors.push(`turn_log.status=${turn.status}, want 'failed'`)

    if (deps.sent.length !== 0) errors.push(`unexpected send count=${deps.sent.length}`)

    return { ok: errors.length === 0, errors }
  },
}
