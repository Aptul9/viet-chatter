import type { Client as WAClient } from 'whatsapp-web.js'
import type { ScenarioOpts } from '../index.js'

function chatIdFor(e164: string): string {
  return `${e164.replace(/[^\d]/g, '')}@c.us`
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function run(client: WAClient, opts: ScenarioOpts): Promise<void> {
  const target = chatIdFor(opts.to)
  const base = opts.body ?? 'burst'
  // 5 messages 500ms apart sits well under the e2e debounceMs=2000, so the
  // bot should coalesce them into a single turn. Validator can then assert
  // 5 incoming rows + exactly 1 reply turn.
  for (let i = 1; i <= 5; i += 1) {
    const text = `${base} ${i}/5`
    const msg = await client.sendMessage(target, text)
    console.log(`[driver] burst ${i}/5 id=${msg.id._serialized}`)
    if (i < 5) await sleep(500)
  }
}
