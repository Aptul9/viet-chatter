// Scenario: first reactive attempt fails and schedules a retry row; after the
// retry row is forced due and AI starts succeeding, ManualJobsCron replays the
// reactive turn successfully and no new retry chain is created.

import {
  DEFAULT_STUB_RESPONSE,
  INVALID_STUB_RESPONSE,
  makeFakeIncoming,
  waitFor,
} from './common.js'
import type { Scenario, ScenarioResult, TestDeps } from './types.js'

export const retryReactiveRecovery: Scenario = {
  name: 'retry-reactive-recovery',
  description: 'Forced-due retry row replays reactive turn successfully and clears chain.',

  async run(deps: TestDeps): Promise<ScenarioResult> {
    const errors: string[] = []
    deps.ai.setNextResponse(INVALID_STUB_RESPONSE)

    await deps.dispatcher.handleMessage(
      makeFakeIncoming({
        chatId: deps.chatId,
        msgId: `e2e_retry_recover_${Date.now()}`,
        body: 'fail then recover',
        type: 'chat',
      }) as never,
      {}
    )

    const retryRowOk = await waitFor(() => {
      const row = deps.sqlite
        .prepare(
          "SELECT COUNT(*) AS c FROM manual_jobs WHERE chat_id = ? AND kind = 'retry' AND status = 'pending'"
        )
        .get(deps.chatId) as { c: number }
      return row.c >= 1
    }, 20_000)
    if (!retryRowOk) errors.push('initial retry row not created within 20s')

    const retryRow = deps.sqlite
      .prepare(
        "SELECT id FROM manual_jobs WHERE chat_id = ? AND kind = 'retry' ORDER BY id DESC LIMIT 1"
      )
      .get(deps.chatId) as { id: number } | undefined
    if (!retryRow) {
      errors.push('retry row missing before recovery phase')
      return { ok: false, errors }
    }

    deps.ai.setNextResponse(DEFAULT_STUB_RESPONSE)
    deps.sqlite
      .prepare('UPDATE manual_jobs SET fire_at = ? WHERE id = ?')
      .run(Date.now() - 1_000, retryRow.id)

    const sentOk = await waitFor(() => deps.sent.length >= 1, 10_000)
    if (!sentOk) errors.push('forced-due retry did not produce a reply within 10s')

    const latestTurn = deps.sqlite
      .prepare('SELECT status FROM turn_log WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
      .get(deps.chatId) as { status: string } | undefined
    if (!latestTurn) errors.push('missing latest turn_log after retry recovery')
    else if (latestTurn.status !== 'sent')
      errors.push(`turn_log.status=${latestTurn.status}, want 'sent'`)

    const retryRows = deps.sqlite
      .prepare(
        "SELECT id, status, attempt_count FROM manual_jobs WHERE chat_id = ? AND kind = 'retry' ORDER BY id ASC"
      )
      .all(deps.chatId) as Array<{ id: number; status: string; attempt_count: number }>
    if (retryRows.length !== 1) {
      errors.push(`retry row count=${retryRows.length}, want 1`)
    } else {
      if (retryRows[0]?.id !== retryRow.id) errors.push('retry row id changed unexpectedly')
      if (retryRows[0]?.status !== 'fired') {
        errors.push(`retry status=${retryRows[0]?.status}, want 'fired'`)
      }
      if (retryRows[0]?.attempt_count !== 2) {
        errors.push(`retry attempt_count=${retryRows[0]?.attempt_count}, want 2`)
      }
    }

    const pendingRetries = deps.sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM manual_jobs WHERE chat_id = ? AND kind = 'retry' AND status = 'pending'"
      )
      .get(deps.chatId) as { c: number }
    if (pendingRetries.c !== 0) errors.push(`pending retry rows=${pendingRetries.c}, want 0`)

    return { ok: errors.length === 0, errors }
  },
}
