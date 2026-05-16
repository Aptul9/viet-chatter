// One-shot AI smoke test. Invokes the same pipeline as the bot (OpenCode
// server boot + callAiApi). Prints the model's reply or the error.
//
// Usage: npx tsx src/scripts/test-ai.ts ["custom prompt here"]

import 'dotenv/config'
import { initConfig, config } from '../config/index.js'
import { callAiApi } from '../ai/router.js'
import { stopOpencodeServer } from '../ai/opencode.js'

async function main(): Promise<void> {
  await initConfig()
  const prompt = process.argv[2] ?? 'Reply with exactly the word: hello'
  // eslint-disable-next-line no-console
  console.log('--- test-ai start ---')
  console.log('model:', config.aiModel)
  console.log('prompt:', prompt)
  const startedAt = Date.now()
  const out = await callAiApi(prompt, 'test-ai')
  const durationMs = Date.now() - startedAt
  console.log('--- response ---')
  console.log(out ?? '<no response>')
  console.log('--- meta ---')
  console.log('durationMs:', durationMs)
  console.log('responseChars:', out?.length ?? 0)
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('FATAL:', err instanceof Error ? err.stack : String(err))
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await stopOpencodeServer()
    } catch {
      /* noop */
    }
    process.exit(process.exitCode ?? 0)
  })
