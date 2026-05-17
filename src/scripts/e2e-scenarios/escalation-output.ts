// Scenario: AI emits a scheduling escalate_to_human (non-null) → no full reply,
// no holding reply (scheduling suppression), escalation row created.

import { makeFakeIncoming, waitFor } from './common.js'
import type { Scenario, ScenarioResult, TestDeps } from './types.js'

export const escalationOutput: Scenario = {
  name: 'escalation-output',
  description: 'AI scheduling escalation → escalation row, no holding reply.',

  async run(deps: TestDeps): Promise<ScenarioResult> {
    const errors: string[] = []
    deps.ai.setNextResponse(
      JSON.stringify({
        reply: '',
        skip: false,
        extracted_facts: [],
        tone_update: null,
        languages_update: null,
        language_used: 'it',
        revive_hint: null,
        escalate_to_human: {
          reason: 'scheduling',
          urgency: 'normal',
          summary: 'Chiede se sabato sei libero. Non posso saperlo.',
          suggested_holding_reply: 'aspetta che controllo',
        },
      })
    )

    const msgId = `e2e_esc_${Date.now()}`
    await deps.dispatcher.handleMessage(
      makeFakeIncoming({
        chatId: deps.chatId,
        msgId,
        body: 'sei libero sabato?',
        type: 'chat',
      }) as never,
      {}
    )

    const escOk = await waitFor(() => {
      const r = deps.sqlite
        .prepare(
          "SELECT COUNT(*) AS c FROM escalations WHERE chat_id = ? AND status = 'pending' AND reason = 'scheduling'"
        )
        .get(deps.chatId) as { c: number }
      return r.c >= 1
    }, 20_000)
    if (!escOk) errors.push('no pending scheduling escalation row within 20s')

    const esc = deps.sqlite
      .prepare(
        "SELECT holding_reply_sent FROM escalations WHERE chat_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1"
      )
      .get(deps.chatId) as { holding_reply_sent: number } | undefined
    if (esc && esc.holding_reply_sent !== 0) {
      errors.push(`holding_reply_sent=${esc.holding_reply_sent}, want 0 for scheduling`)
    }

    // Scheduling escalations intentionally stay silent: even a soft holding
    // reply can imply calendar availability.
    if (deps.sent.length !== 0) {
      errors.push(`expected no holding-reply send for scheduling, got ${deps.sent.length}`)
    }

    const turn = deps.sqlite
      .prepare('SELECT status FROM turn_log WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
      .get(deps.chatId) as { status: string } | undefined
    if (turn?.status !== 'escalated') {
      errors.push(`turn_log.status=${turn?.status}, want 'escalated'`)
    }

    return { ok: errors.length === 0, errors }
  },
}
