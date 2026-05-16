// Driver wweb session. Lives in its own LocalAuth folder so the bot's session
// (root .wwebjs_auth/) is never touched. Run `npm run pair` once to scan the
// QR with the second phone; afterwards the session persists across runs.

import pkg from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import type { Client as WAClient } from 'whatsapp-web.js'

const { Client, LocalAuth } = pkg

export async function initDriverSession(): Promise<WAClient> {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  })

  client.on('qr', (qr) => {
    qrcode.generate(qr, { small: true })
    console.log('[driver] scan the QR with the SECOND phone (test account)')
  })

  client.on('auth_failure', (msg) => {
    console.error(`[driver] auth_failure: ${msg}`)
  })

  await new Promise<void>((resolve, reject) => {
    client.once('ready', () => {
      console.log('[driver] ready')
      resolve()
    })
    client.once('auth_failure', (m) => reject(new Error(`auth_failure: ${m}`)))
    client.initialize().catch(reject)
  })

  return client
}

async function pairCli(): Promise<void> {
  const client = await initDriverSession()
  console.log('[driver] paired. you can now run scenarios.')
  await client.destroy()
}

// `--pair` is only ever passed by the `npm run pair` script. The flag also
// avoids a Windows path-comparison gotcha (file:// URLs vs argv[1]) since we
// don't need to detect direct invocation when the flag is the gate.
if (process.argv.includes('--pair')) {
  pairCli().catch((err) => {
    console.error(`[driver] pair failed: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
