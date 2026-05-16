// Scenario: AI returns skip:true for an incoming text → no out_bot, turn_log
// status='skipped', facts persisted (extracted_facts still go through).

import { makeFakeIncoming, waitFor } from './common.js'
import type { Scenario, ScenarioResult, TestDeps } from './types.js'

export const skipOutput: Scenario = {
  name: 'skip-output',
  description: 'AI emits skip:true → no send, turn_log skipped.',

  async run(deps: TestDeps): Promise<ScenarioResult> {
    const errors: string[] = []
    deps.ai.setNextResponse(
      JSON.stringify({
        reply: '',
        skip: true,
        extracted_facts: [],
        tone_update: null,
        languages_update: null,
        language_used: 'it',
        revive_hint: null,
        escalate_to_human: null,
      })
    )

    const msgId = `e2e_skip_${Date.now()}`
    await deps.dispatcher.handleMessage(
      makeFakeIncoming({
        chatId: deps.chatId,
        msgId,
        body: '👍',
        type: 'chat',
      }) as never,
      {}
    )

    const turnOk = await waitFor(() => {
      const r = deps.sqlite
        .prepare(
          "SELECT COUNT(*) AS c FROM turn_log WHERE chat_id = ? AND status = 'skipped'"
        )
        .get(deps.chatId) as { c: number }
      return r.c >= 1
    }, 20_000)
    if (!turnOk) errors.push('no skipped turn_log row within 20s')

    if (deps.sent.length > 0) errors.push(`unexpected send (${deps.sent.length})`)

    return { ok: errors.length === 0, errors }
  },
}
