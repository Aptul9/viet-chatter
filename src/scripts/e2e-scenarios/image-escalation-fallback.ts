// Scenario: incoming image, vision requested in config but aiModel is NOT in
// VISION_CAPABLE_MODELS → policy resolver downgrades to visionFallback
// ('escalate' by default). Bot creates an escalation row directly, no AI call,
// no out_bot.

import { makeFakeIncoming, setAiModel, setMediaPolicy, waitFor } from './common.js'
import type { Scenario, ScenarioResult, TestDeps } from './types.js'

export const imageEscalationFallback: Scenario = {
  name: 'image-escalation-fallback',
  description: 'Image + non-vision model → fallback to escalate, no AI call.',

  async run(deps: TestDeps): Promise<ScenarioResult> {
    const errors: string[] = []

    // A model id NOT in VISION_CAPABLE_MODELS. The router would still try to
    // call OpenCode but the scenario succeeds before that: the dispatcher hits
    // the escalate branch directly.
    setAiModel('opencode:fake-provider/non-vision-model')
    setMediaPolicy({
      image: { strategy: 'vision' },
      visionFallback: 'escalate',
    })
    // Just in case the dispatcher path ever changed — if AI is called by
    // accident the stub returns a benign skip.
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

    const msgId = `e2e_imgesc_${Date.now()}`
    await deps.dispatcher.handleMessage(
      makeFakeIncoming({
        chatId: deps.chatId,
        msgId,
        body: '',
        type: 'image',
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

    if (deps.sent.length > 0) {
      errors.push(`unexpected out_bot send (${deps.sent.length}); expected escalate path`)
    }

    return { ok: errors.length === 0, errors }
  },
}
