// Thin wrapper around `callOpencodeCli` with retry + backoff.
// In v1 the router has a single backend (OpenCode), but the API stays
// generic so a future swap to another backend is local. See docs/dev/07-ai-integration.md.

import {
  callOpencodeCli,
  ensureOpencodeServer,
  isOpencodeAiModel,
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
      const result = await callOpencodeCli(prompt, `${logPrefix}/OpenCode`, model, signal)
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
