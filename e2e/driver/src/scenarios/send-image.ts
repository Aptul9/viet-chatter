import pkg from 'whatsapp-web.js'
import type { Client as WAClient } from 'whatsapp-web.js'
import type { ScenarioOpts } from '../index.js'
import { resolve } from 'node:path'

const { MessageMedia } = pkg

function chatIdFor(e164: string): string {
  return `${e164.replace(/[^\d]/g, '')}@c.us`
}

export async function run(client: WAClient, opts: ScenarioOpts): Promise<void> {
  const path = opts.file ?? resolve(process.cwd(), '../fixtures/cat.jpg')
  const caption = opts.body ?? 'che ne pensi di questa foto?'
  const target = chatIdFor(opts.to)
  const media = MessageMedia.fromFilePath(path)
  const msg = await client.sendMessage(target, media, { caption })
  console.log(`[driver] sent image (${path}) to ${target} id=${msg.id._serialized}`)
}
