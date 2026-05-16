// Scenario: incoming audio voice note → escalate path, no AI call.

import { makeFakeIncoming, setMediaPolicy, waitFor } from './common.js'
import type { Scenario, ScenarioResult, TestDeps } from './types.js'

export const audioEscalation: Scenario = {
  name: 'audio-escalation',
  description: 'Incoming audio (ptt) → escalation row, no out_bot.',

  async run(deps: TestDeps): Promise<ScenarioResult> {
    const errors: string[] = []
    setMediaPolicy({
      audio: { strategy: 'escalate' },
      ptt: { strategy: 'escalate' },
    })

    const msgId = `e2e_aud_${Date.now()}`
    await deps.dispatcher.handleMessage(
      makeFakeIncoming({
        chatId: deps.chatId,
        msgId,
        body: '',
        type: 'ptt',
      }) as never,
      {}
    )

    const escOk = await waitFor(() => {
      const r = deps.sqlite
        .prepare("SELECT COUNT(*) AS c FROM escalations WHERE chat_id = ? AND status = 'pending'")
        .get(deps.chatId) as { c: number }
      return r.c >= 1
    }, 5_000)
    if (!escOk) errors.push('no pending escalation row within 5s')

    if (deps.sent.length > 0) errors.push(`unexpected send (${deps.sent.length})`)

    const esc = deps.sqlite
      .prepare(
        "SELECT reason, summary FROM escalations WHERE chat_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1"
      )
      .get(deps.chatId) as { reason: string; summary: string } | undefined
    if (!esc) {
      errors.push('escalation row not found')
    } else {
      if (esc.reason !== 'other') errors.push(`escalation reason=${esc.reason}, want 'other'`)
      if (!/vocale|audio/i.test(esc.summary)) {
        errors.push(`escalation summary missing 'vocale|audio': ${esc.summary}`)
      }
    }

    return { ok: errors.length === 0, errors }
  },
}
