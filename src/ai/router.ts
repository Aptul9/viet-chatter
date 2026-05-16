// Thin wrapper around `callOpencodeCli` with retry + backoff.
// In v1 the router has a single backend (OpenCode), but the API stays
// generic so a future swap to another backend is local. See docs/dev/07-ai-integration.md.
//
// Spec A: exposes both text-only `callAiApi` and multimodal `callAiApiWithParts`.

import {
  callOpencodeCli,
  callOpencodeCliText,
  ensureOpencodeServer,
  isOpencodeAiModel,
  type OpenCodePart,
  type OpencodeAiModel,
} from './opencode.js'
import { config } from '../config/index.js'
import { log } from '../log.js'

const MAX_ATTEMPTS = 3
const RETRY_BASE_MS = 5_000

export async function callAiApi(
  prompt: string,
  logPrefix: string = 'AI',
  signal?: AbortSignal
): Promise<string | undefined> {
  const stub = maybeStub(logPrefix, prompt.length)
  if (stub !== undefined) return stub

  const modelRaw = config.aiModel
  if (!isOpencodeAiModel(modelRaw)) {
    log.error({ aiModel: modelRaw }, 'invalid aiModel format, expected "opencode:provider/modelId"')
    return undefined
  }
  const model: OpencodeAiModel = modelRaw

  await ensureOpencodeServer(logPrefix)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) return undefined
    const startedAt = Date.now()
    try {
      const result = await callOpencodeCliText(
        prompt,
        `${logPrefix}/OpenCode`,
        model,
        signal
      )
      log.debug(
        {
          attempt,
          durationMs: Date.now() - startedAt,
          promptChars: prompt.length,
          responseChars: result?.length ?? 0,
        },
        'AI call'
      )
      if (result) return result
    } catch (err) {
      log.error({ err, attempt, durationMs: Date.now() - startedAt }, 'AI call failed')
    }
    if (signal?.aborted) return undefined
    if (attempt < MAX_ATTEMPTS) {
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_BASE_MS))
    }
  }
  return undefined
}

/**
 * Multimodal entry point (Spec A): send a prompt + attached file parts
 * (typically a single image) to OpenCode. Same retry / backoff as text path.
 */
export async function callAiApiWithParts(
  parts: OpenCodePart[],
  logPrefix: string = 'AI',
  signal?: AbortSignal
): Promise<string | undefined> {
  // Stub bypass: the text part (assumed to be the first) is enough for stubs.
  const textPart = parts.find((p): p is { type: 'text'; text: string } => p.type === 'text')
  const stub = maybeStub(logPrefix, textPart?.text.length ?? 0)
  if (stub !== undefined) return stub

  const modelRaw = config.aiModel
  if (!isOpencodeAiModel(modelRaw)) {
    log.error({ aiModel: modelRaw }, 'invalid aiModel format, expected "opencode:provider/modelId"')
    return undefined
  }
  const model: OpencodeAiModel = modelRaw

  await ensureOpencodeServer(logPrefix)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) return undefined
    const startedAt = Date.now()
    try {
      const result = await callOpencodeCli(parts, `${logPrefix}/OpenCode`, model, signal)
      log.debug(
        {
          attempt,
          durationMs: Date.now() - startedAt,
          parts: parts.length,
          fileParts: parts.filter((p) => p.type === 'file').length,
          responseChars: result?.length ?? 0,
        },
        'AI call (multimodal)'
      )
      if (result) return result
    } catch (err) {
      log.error({ err, attempt, durationMs: Date.now() - startedAt }, 'AI multimodal call failed')
    }
    if (signal?.aborted) return undefined
    if (attempt < MAX_ATTEMPTS) {
      await new Promise<void>((resolve) => setTimeout(resolve, RETRY_BASE_MS))
    }
  }
  return undefined
}

/**
 * E2E stub hook (Spec B): when `BOT_E2E_STUB_AI=1`, return the canned JSON
 * from `AI_STUB_RESPONSE` instead of calling the real provider. Returns
 * `undefined` to signal "not stubbed".
 */
function maybeStub(logPrefix: string, promptChars: number): string | undefined {
  if (process.env['BOT_E2E_STUB_AI'] !== '1') return undefined
  const canned = process.env['AI_STUB_RESPONSE']
  if (!canned) {
    log.warn({ logPrefix }, 'BOT_E2E_STUB_AI=1 but AI_STUB_RESPONSE empty')
    return undefined
  }
  log.info({ logPrefix, promptChars, stubChars: canned.length }, 'AI call stubbed (e2e)')
  return canned
}
