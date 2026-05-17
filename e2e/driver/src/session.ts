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
  console.log('[driver] paired. waiting for initial sync to settle...')
  // `ready` fires before WhatsApp finishes streaming the initial state (chats,
  // contacts, LID resolutions). If we destroy() too early, the persisted
  // session is half-synced and later sends resolve recipients via stale or
  // missing LID entries, so messages are dispatched to the wrong JID and
  // silently dropped by the server.
  //
  // Wait until `getChats()` reports a non-empty list AND stays stable for
  // ~5s, then add a generous tail to let contact metadata catch up.
  await waitForSyncSettled(client)
  console.log('[driver] sync settled. you can now run scenarios.')
  await client.destroy()
}

async function waitForSyncSettled(client: WAClient): Promise<void> {
  const MAX_WAIT_MS = 60_000
  const STABLE_REQUIRED_MS = 5_000
  const POLL_MS = 1_000
  const TAIL_MS = 10_000

  const start = Date.now()
  let lastChatCount = -1
  let stableSince = 0

  while (Date.now() - start < MAX_WAIT_MS) {
    let count = 0
    try {
      const chats = (await client.getChats()) as unknown as unknown[]
      count = chats.length
    } catch {
      count = lastChatCount
    }
    if (count > 0 && count === lastChatCount) {
      if (stableSince === 0) stableSince = Date.now()
      if (Date.now() - stableSince >= STABLE_REQUIRED_MS) {
        console.log(`[driver] sync stable: ${count} chats. tail wait ${TAIL_MS}ms...`)
        await new Promise((r) => setTimeout(r, TAIL_MS))
        return
      }
    } else {
      stableSince = 0
      lastChatCount = count
      console.log(`[driver] syncing... chats=${count}`)
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
  console.log(`[driver] sync wait timed out after ${MAX_WAIT_MS}ms, proceeding anyway`)
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
