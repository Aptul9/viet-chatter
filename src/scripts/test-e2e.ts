// End-to-end pipeline test with NO WhatsApp client.
//
// Spins up DB + config + opencode + embedding + state machine + orchestrator,
// fakes a `WhatsAppHandle` whose sendMessage logs instead of hitting wweb, then
// pushes a synthetic incoming message through the dispatcher. Watches the state
// machine progression and reports the AI's reply (printed to stdout, also sent
// to your Telegram chats via the escalation channel if you trigger that path).
//
// Usage:
//   npx tsx src/scripts/test-e2e.ts                    # default test message
//   npx tsx src/scripts/test-e2e.ts "ciao come stai?"  # custom
//
// Exit codes:
//   0  reply generated + sent (mock) within timeout
//   1  pipeline failed
//   2  timeout (no reply within 60s)

import 'dotenv/config'
import { initConfig, config } from '../config/index.js'
import { setLogLevel, log } from '../log.js'
import { openDb } from '../db/client.js'
import { MessageDispatcher } from '../dispatcher/index.js'
import { ChatStateMachine } from '../scheduler/state.js'
import { InflightRegistry } from '../orchestrator/inflight.js'
import { MediaQueue } from '../orchestrator/media-queue.js'
import { ReplyOrchestrator } from '../orchestrator/index.js'
import { EmbeddingService } from '../kb/embedding.js'
import { SqliteVecStore } from '../kb/vec.js'
import { startTicker, stopTicker, type TurnRunner } from '../scheduler/ticker.js'
import { ensureOpencodeServer, stopOpencodeServer } from '../ai/opencode.js'
import { EscalationNotifier } from '../escalation/notifier.js'
import type { WhatsAppHandle } from '../whatsapp/client.js'
import { getChatState } from '../db/repo.js'

const TEST_CHAT_ID = '393999000111@c.us' // a +39 Italian number; passes the filter
const TEST_MSG_ID = `e2e_${Date.now()}_msg`
const TIMEOUT_MS = 60_000

type SentLog = { chatId: string; text: string; ts: number }
const SENT: SentLog[] = []

function makeFakeWa(): WhatsAppHandle {
  // Minimal mock: only the surface the orchestrator + dispatcher actually use.
  const fake = {
    client: {
      info: { wid: { _serialized: 'me_fake@c.us', user: 'me_fake' } },
    } as never,
    async sendMessage(chatId: string, text: string) {
      const sent = {
        id: { _serialized: `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` },
        timestamp: Math.floor(Date.now() / 1000),
        from: 'me_fake@c.us',
        to: chatId,
        body: text,
        fromMe: true,
      }
      SENT.push({ chatId, text, ts: Date.now() })
      // eslint-disable-next-line no-console
      console.log(`\n>>> [fake sendMessage] -> ${chatId}\n${text}\n`)
      return sent as never
    },
    async fetchMessages(_chatId: string, limit: number) {
      // Return the in-memory history we've stored on this chat. We use a tiny
      // closure variable to remember the last incoming injected by the test
      // (good enough for one-turn smoke test).
      void limit
      const out: unknown[] = []
      if (LAST_INJECTED) {
        out.push({
          id: { _serialized: LAST_INJECTED.msgId },
          timestamp: Math.floor(LAST_INJECTED.ts / 1000),
          from: LAST_INJECTED.chatId,
          to: 'me_fake@c.us',
          body: LAST_INJECTED.body,
          fromMe: false,
          type: 'chat',
        })
      }
      return out as never
    },
    async getChat(chatId: string) {
      return makeFakeChat(chatId) as never
    },
    getSelfWid() {
      return 'me_fake@c.us'
    },
    isBotSent(_id: string) {
      return false
    },
    async resolveLidPhone(_id: string) {
      return null
    },
    async downloadMedia(_msg: unknown) {
      // The default basic-reply scenario only sends text; no media to download.
      return null
    },
    onIncoming(_h) {
      return () => {}
    },
    onMessageCreate(_h) {
      return () => {}
    },
  } satisfies Partial<WhatsAppHandle> as unknown as WhatsAppHandle
  return fake
}

type Injected = { chatId: string; msgId: string; body: string; ts: number }
let LAST_INJECTED: Injected | null = null

function makeFakeChat(chatId: string) {
  return {
    id: { _serialized: chatId },
    isGroup: false,
    unreadCount: 1,
    lastMessage: { timestamp: Math.floor(Date.now() / 1000) },
    async getContact() {
      const user = chatId.split('@')[0]
      return {
        name: 'TestSender',
        pushname: 'TestSender',
        number: user,
        isMyContact: false,
        id: { user, _serialized: chatId },
      }
    },
  }
}

function makeFakeMessage(chatId: string, body: string) {
  const msgId = TEST_MSG_ID
  const ts = Date.now()
  LAST_INJECTED = { chatId, msgId, body, ts }
  return {
    id: { _serialized: msgId },
    from: chatId,
    to: 'me_fake@c.us',
    body,
    timestamp: Math.floor(ts / 1000),
    fromMe: false,
    type: 'chat',
    async getChat() {
      return makeFakeChat(chatId)
    },
  }
}

async function main(): Promise<void> {
  const body = process.argv[2] ?? 'ciao! come stai oggi?'
  // eslint-disable-next-line no-console
  console.log(`\n=== test-e2e ===\nchatId: ${TEST_CHAT_ID}\nbody:   ${body}\n`)

  await initConfig()
  setLogLevel(config.logLevel)

  // Wipe any prior state for this chat so the test is deterministic.
  const { sqlite } = openDb(config.dbPath)
  sqlite.prepare('DELETE FROM chat_state WHERE chat_id = ?').run(TEST_CHAT_ID)
  sqlite.prepare('DELETE FROM processed_messages WHERE chat_id = ?').run(TEST_CHAT_ID)

  await ensureOpencodeServer('e2e')
  const wa = makeFakeWa()

  const inflight = new InflightRegistry()
  const state = new ChatStateMachine(sqlite)
  const mediaQueue = new MediaQueue()
  const embedding = new EmbeddingService(config.embeddingModel)
  const vecStore = new SqliteVecStore(sqlite)
  // Stub escalation notifier — never used in this happy path, but the
  // orchestrator constructor wants one.
  const escalationNotifier = new EscalationNotifier({ sqlite, channels: [] })

  const orchestrator = new ReplyOrchestrator({
    sqlite,
    wa,
    state,
    inflight,
    mediaQueue,
    embedding,
    vecStore,
    escalationNotifier,
  })

  const dispatcher = new MessageDispatcher({
    sqlite,
    wa,
    state,
    inflight,
    mediaQueue,
    escalationNotifier,
  })

  const registerInflight = (chatId: string): AbortSignal => inflight.register(chatId).signal
  const isConnected = (): boolean => true
  const runTurn: TurnRunner = (chatId, signal) => orchestrator.generateAndSend(chatId, signal)
  startTicker({ sqlite, state, runTurn, registerInflight, isConnected })

  // Inject the synthetic incoming message.
  log.info({ chatId: TEST_CHAT_ID }, 'e2e: injecting synthetic message')
  await dispatcher.handleMessage(makeFakeMessage(TEST_CHAT_ID, body) as never, {})

  // Wait for the state machine to walk through ACCUMULATING → SCHEDULED → SENDING → IDLE.
  const startedAt = Date.now()
  let lastState = 'UNKNOWN'
  while (Date.now() - startedAt < TIMEOUT_MS) {
    const row = getChatState(sqlite, TEST_CHAT_ID)
    const s = row?.state ?? 'NONE'
    if (s !== lastState) {
      log.info({ state: s, elapsedMs: Date.now() - startedAt }, 'e2e: chat_state progressed')
      lastState = s
    }
    if (SENT.length > 0 && s === 'IDLE') {
      log.info({ elapsedMs: Date.now() - startedAt, replies: SENT.length }, 'e2e: pipeline completed')
      // Best-effort cleanup, then success.
      stopTicker()
      try { await stopOpencodeServer() } catch { /* noop */ }
      sqlite.close()
      process.exit(0)
    }
    await new Promise((r) => setTimeout(r, 250))
  }

  // Timed out.
  log.error({ lastState, sent: SENT.length, timeoutMs: TIMEOUT_MS }, 'e2e: TIMEOUT — pipeline did not complete')
  stopTicker()
  try { await stopOpencodeServer() } catch { /* noop */ }
  sqlite.close()
  process.exit(2)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('FATAL:', err instanceof Error ? err.stack : String(err))
  process.exit(1)
})
