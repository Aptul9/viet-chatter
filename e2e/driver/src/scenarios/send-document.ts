import pkg from 'whatsapp-web.js'
import type { Client as WAClient } from 'whatsapp-web.js'
import type { ScenarioOpts } from '../index.js'
import { resolve } from 'node:path'

const { MessageMedia } = pkg

function chatIdFor(e164: string): string {
  return `${e164.replace(/[^\d]/g, '')}@c.us`
}

export async function run(client: WAClient, opts: ScenarioOpts): Promise<void> {
  const path = opts.file ?? resolve(process.cwd(), '../fixtures/doc.pdf')
  const target = chatIdFor(opts.to)
  const media = MessageMedia.fromFilePath(path)
  const msg = await client.sendMessage(target, media, {
    sendMediaAsDocument: true,
    caption: opts.body,
  })
  console.log(`[driver] sent document (${path}) to ${target} id=${msg.id._serialized}`)
}
