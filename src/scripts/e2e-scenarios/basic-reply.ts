// Scenario: basic text reply with stubbed AI.
//
// Inject a single text message, expect the dispatcher → state machine →
// orchestrator → fake sendMessage chain to fire exactly one out_bot,
// turn_log row 'sent'.

import { makeFakeIncoming, waitFor, DEFAULT_STUB_RESPONSE } from './common.js'
import type { Scenario, ScenarioResult, TestDeps } from './types.js'

export const basicReply: Scenario = {
  name: 'basic-reply',
  description: 'Single text → 1 out_bot reply, turn_log sent.',

  async run(deps: TestDeps): Promise<ScenarioResult> {
    const errors: string[] = []
    deps.ai.setNextResponse(DEFAULT_STUB_RESPONSE)

    const msgId = `e2e_basic_${Date.now()}`
    const tsMs = Date.now()
    await deps.dispatcher.handleMessage(
      makeFakeIncoming({
        chatId: deps.chatId,
        msgId,
        body: 'ciao come stai?',
        type: 'chat',
        tsMs,
      }) as never,
      {}
    )

    const sentOk = await waitFor(() => deps.sent.length >= 1, 20_000)
    if (!sentOk) errors.push(`no fake send within 20s (sent=${deps.sent.length})`)

    const turnRow = deps.sqlite
      .prepare('SELECT status FROM turn_log WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
      .get(deps.chatId) as { status: string } | undefined
    if (!turnRow) errors.push('no turn_log row created')
    else if (turnRow.status !== 'sent')
      errors.push(`turn_log.status=${turnRow.status}, want 'sent'`)

    const procRow = deps.sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM processed_messages WHERE chat_id = ? AND direction = 'out_bot'"
      )
      .get(deps.chatId) as { c: number }
    if (procRow.c !== 1) errors.push(`out_bot count=${procRow.c}, want 1`)

    return { ok: errors.length === 0, errors }
  },
}
