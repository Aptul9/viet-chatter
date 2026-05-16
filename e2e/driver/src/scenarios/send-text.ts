import type { Client as WAClient } from 'whatsapp-web.js'
import type { ScenarioOpts } from '../index.js'

function chatIdFor(e164: string): string {
  return `${e164.replace(/[^\d]/g, '')}@c.us`
}

export async function run(client: WAClient, opts: ScenarioOpts): Promise<void> {
  const body = opts.body ?? 'ciao, e2e ping'
  const target = chatIdFor(opts.to)
  const msg = await client.sendMessage(target, body)
  console.log(`[driver] sent text to ${target} id=${msg.id._serialized}`)
}
