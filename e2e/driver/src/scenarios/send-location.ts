import pkg from 'whatsapp-web.js'
import type { Client as WAClient } from 'whatsapp-web.js'
import type { ScenarioOpts } from '../index.js'

const { Location } = pkg

function chatIdFor(e164: string): string {
  return `${e164.replace(/[^\d]/g, '')}@c.us`
}

export async function run(client: WAClient, opts: ScenarioOpts): Promise<void> {
  // Hardcoded coords (Rome center) keep the scenario deterministic. Override
  // via --body "<lat>,<lng>" if a different fixture is needed.
  let lat = 41.9028
  let lng = 12.4964
  if (opts.body) {
    const [latStr, lngStr] = opts.body.split(',')
    if (latStr && lngStr) {
      lat = Number.parseFloat(latStr)
      lng = Number.parseFloat(lngStr)
    }
  }
  const target = chatIdFor(opts.to)
  const loc = new Location(lat, lng, { name: 'e2e location ping' })
  const msg = await client.sendMessage(target, loc)
  console.log(`[driver] sent location (${lat},${lng}) to ${target} id=${msg.id._serialized}`)
}
