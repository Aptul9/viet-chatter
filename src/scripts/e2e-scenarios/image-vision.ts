// Scenario: incoming image with media.image.strategy='vision' and a vision-
// capable model → bot calls multimodal AI and replies normally.
//
// We override the model to one in VISION_CAPABLE_MODELS so the policy
// resolver does NOT downgrade to escalate. The fake WhatsApp handle returns
// a canned 1×1 PNG when the dispatcher calls downloadMedia.

import {
  DEFAULT_STUB_RESPONSE,
  makeFakeIncoming,
  setAiModel,
  setMediaPolicy,
  waitFor,
} from './common.js'
import type { Scenario, ScenarioResult, TestDeps } from './types.js'

// 1×1 transparent PNG (base64, no header). Smallest possible "image" payload.
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

export const imageVision: Scenario = {
  name: 'image-vision',
  description: 'Incoming image with vision model → AI multimodal call + reply.',

  async run(deps: TestDeps): Promise<ScenarioResult> {
    const errors: string[] = []
    setAiModel('opencode:openai/gpt-4o-mini')
    setMediaPolicy({ image: { strategy: 'vision' } })
    deps.ai.setNextResponse(
      JSON.stringify({
        reply: 'bella foto!',
        skip: false,
        extracted_facts: [],
        tone_update: null,
        languages_update: null,
        language_used: 'it',
        revive_hint: null,
        escalate_to_human: null,
      })
    )

    // Override the fake WA's downloadMedia by patching the closure: easier to
    // monkey-patch via Object.defineProperty since the handle is opaque.
    ;(deps.wa as unknown as {
      downloadMedia: () => Promise<{ mime: string; base64: string; filename: string | null }>
    }).downloadMedia = async () => ({
      mime: 'image/png',
      base64: TINY_PNG_BASE64,
      filename: null,
    })

    const msgId = `e2e_imgv_${Date.now()}`
    await deps.dispatcher.handleMessage(
      makeFakeIncoming({
        chatId: deps.chatId,
        msgId,
        body: 'guarda qui',
        type: 'image',
      }) as never,
      {}
    )

    const sentOk = await waitFor(() => deps.sent.length >= 1, 20_000)
    if (!sentOk) errors.push(`no fake send within 20s (sent=${deps.sent.length})`)

    const turn = deps.sqlite
      .prepare('SELECT status FROM turn_log WHERE chat_id = ? ORDER BY id DESC LIMIT 1')
      .get(deps.chatId) as { status: string } | undefined
    if (!turn) errors.push('no turn_log row created')
    else if (turn.status !== 'sent') errors.push(`turn_log.status=${turn.status}, want 'sent'`)

    const procIn = deps.sqlite
      .prepare(
        "SELECT COUNT(*) AS c FROM processed_messages WHERE chat_id = ? AND direction = 'in'"
      )
      .get(deps.chatId) as { c: number }
    if (procIn.c < 1) errors.push(`expected >=1 incoming row, got ${procIn.c}`)

    return { ok: errors.length === 0, errors }
  },
}
