import type { Client as WAClient } from 'whatsapp-web.js'
import type { ScenarioOpts } from '../index.js'

function chatIdFor(e164: string): string {
  return `${e164.replace(/[^\d]/g, '')}@c.us`
}

export async function run(client: WAClient, opts: ScenarioOpts): Promise<void> {
  const body = opts.body ?? 'ciao, e2e ping'
  const fallback = chatIdFor(opts.to)
  // Explicitly resolve the number via WhatsApp's server. If the driver's local
  // cache is stale or the contact has an @lid mapping, this returns the
  // canonical JID and avoids routing the message to a wrong/stale id.
  // Falls back to the constructed `@c.us` form if resolution fails.
  let target = fallback
  try {
    const numberId = (await client.getNumberId(opts.to)) as { _serialized?: string } | null
    if (numberId?._serialized) {
      target = numberId._serialized
    } else {
      console.warn(`[driver] getNumberId returned null for ${opts.to}, using fallback ${fallback}`)
    }
  } catch (err) {
    console.warn(
      `[driver] getNumberId failed: ${err instanceof Error ? err.message : String(err)}; using fallback ${fallback}`
    )
  }
  const msg = await client.sendMessage(target, body)
  console.log(`[driver] sent text to ${target} id=${msg.id._serialized}`)
}
