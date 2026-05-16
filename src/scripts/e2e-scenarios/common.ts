// Shared bootstrap + utility helpers for mock-based e2e scenarios (Spec B).

import { initConfig, config, __overrideConfigForTest } from '../../config/index.js'
import { setLogLevel, log } from '../../log.js'
import { openDb, type Sqlite } from '../../db/client.js'
import { MessageDispatcher } from '../../dispatcher/index.js'
import { ChatStateMachine } from '../../scheduler/state.js'
import { InflightRegistry } from '../../orchestrator/inflight.js'
import { MediaQueue } from '../../orchestrator/media-queue.js'
import { ReplyOrchestrator } from '../../orchestrator/index.js'
import { EmbeddingService } from '../../kb/embedding.js'
import { SqliteVecStore } from '../../kb/vec.js'
import { startTicker, stopTicker, type TurnRunner } from '../../scheduler/ticker.js'
import { EscalationNotifier } from '../../escalation/notifier.js'
import { getChatState } from '../../db/repo.js'
import type { ChatState } from '../../types.js'
import type { WhatsAppHandle } from '../../whatsapp/client.js'
import type { AiStubControl, CapturedSend, TestDeps } from './types.js'

let initialized = false

/** Initialize the global config + log subsystem once per process. */
export async function ensureInitialized(): Promise<void> {
  if (initialized) return
  await initConfig()
  setLogLevel(config.logLevel)
  initialized = true
}

/** Default canned AI response — passes zod TurnOutputSchema, simple reply, no facts. */
export const DEFAULT_STUB_RESPONSE = JSON.stringify({
  reply: 'ciao!',
  skip: false,
  extracted_facts: [],
  tone_update: null,
  languages_update: null,
  language_used: 'it',
  revive_hint: null,
  escalate_to_human: null,
})

/** Tighter timers for fast scenarios. Applied via __overrideConfigForTest. */
export function applyTestTimers(): void {
  __overrideConfigForTest({
    debounceMs: 1_500,
    hardCapMs: 8_000,
    minDelayMs: 2_500,
    maxDelayMs: 5_000,
    jitterPct: 0.05,
    fallbackDelayMs: 3_000,
    tickIntervalMs: 500,
    manualJobsTickIntervalMs: 1_000,
    nightWindow: { startHour: 4, endHour: 4 },
  })
}

/** Override the media block (per scenario). */
export function setMediaPolicy(partial: Partial<typeof config.media>): void {
  __overrideConfigForTest({
    media: { ...config.media, ...partial },
  })
}

/** Override the AI model (per scenario, to drive vision-allowlist downgrade). */
export function setAiModel(model: string): void {
  __overrideConfigForTest({ aiModel: model })
}

const aiStub: AiStubControl = {
  setNextResponse(json: string) {
    process.env['BOT_E2E_STUB_AI'] = '1'
    process.env['AI_STUB_RESPONSE'] = json
  },
  reset() {
    delete process.env['BOT_E2E_STUB_AI']
    delete process.env['AI_STUB_RESPONSE']
  },
}

/** Build a stub WA handle. The various closures are scenario-mutable. */
export function makeFakeWa(opts: {
  sent: CapturedSend[]
  /** What `fetchMessages` returns for any chat (caller mutates). */
  history: Array<{
    id: string
    body: string
    tsSec: number
    fromMe: boolean
    type: string
    to?: string
  }>
  /** Result for `downloadMedia` calls; default null (no media). */
  downloadMediaResult?: { mime: string; base64: string; filename: string | null } | null
}): WhatsAppHandle {
  const fake = {
    client: {
      info: { wid: { _serialized: 'me_fake@c.us', user: 'me_fake' } },
    } as never,
    async sendMessage(chatId: string, text: string) {
      const id = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      opts.sent.push({ chatId, text, ts: Date.now() })
      return {
        id: { _serialized: id },
        timestamp: Math.floor(Date.now() / 1000),
        from: 'me_fake@c.us',
        to: chatId,
        body: text,
        fromMe: true,
      } as never
    },
    async fetchMessages(_chatId: string, limit: number) {
      void limit
      return opts.history.map((h) => ({
        id: { _serialized: h.id },
        timestamp: h.tsSec,
        from: h.fromMe ? 'me_fake@c.us' : _chatId,
        to: h.to ?? (h.fromMe ? _chatId : 'me_fake@c.us'),
        body: h.body,
        fromMe: h.fromMe,
        type: h.type,
      })) as never
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
      return opts.downloadMediaResult ?? null
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

/** Build a fake incoming message envelope with the wweb-shaped fields. */
export function makeFakeIncoming(opts: {
  chatId: string
  msgId: string
  body: string
  type: string
  tsMs?: number
}) {
  const ts = opts.tsMs ?? Date.now()
  return {
    id: { _serialized: opts.msgId },
    from: opts.chatId,
    to: 'me_fake@c.us',
    body: opts.body,
    timestamp: Math.floor(ts / 1000),
    fromMe: false,
    type: opts.type,
    async getChat() {
      return makeFakeChat(opts.chatId)
    },
  }
}

export interface ScenarioCtx {
  deps: TestDeps
  cleanup: () => Promise<void>
}

/** Bootstrap every dependency for a single scenario + start the ticker. */
export async function bootstrapScenario(opts: {
  chatId: string
  history?: TestDeps extends { wa: infer _W }
    ? Parameters<typeof makeFakeWa>[0]['history']
    : never
  downloadMediaResult?: Parameters<typeof makeFakeWa>[0]['downloadMediaResult']
}): Promise<ScenarioCtx> {
  await ensureInitialized()
  applyTestTimers()

  const { sqlite } = openDb(config.dbPath)
  sqlite.prepare('DELETE FROM chat_state WHERE chat_id = ?').run(opts.chatId)
  sqlite.prepare('DELETE FROM processed_messages WHERE chat_id = ?').run(opts.chatId)
  sqlite.prepare('DELETE FROM escalations WHERE chat_id = ?').run(opts.chatId)
  sqlite.prepare('DELETE FROM manual_jobs WHERE chat_id = ?').run(opts.chatId)
  sqlite.prepare('DELETE FROM turn_log WHERE chat_id = ?').run(opts.chatId)

  const sent: CapturedSend[] = []
  const history = opts.history ?? []
  const wa = makeFakeWa({ sent, history, downloadMediaResult: opts.downloadMediaResult })

  const inflight = new InflightRegistry()
  const state = new ChatStateMachine(sqlite)
  const mediaQueue = new MediaQueue()
  const embedding = new EmbeddingService(config.embeddingModel)
  const vecStore = new SqliteVecStore(sqlite)
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

  const deps: TestDeps = {
    sqlite,
    wa,
    dispatcher,
    orchestrator,
    state,
    inflight,
    mediaQueue,
    escalationNotifier,
    sent,
    ai: aiStub,
    chatId: opts.chatId,
  }

  const cleanup = async (): Promise<void> => {
    stopTicker()
    aiStub.reset()
    try {
      sqlite.close()
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'sqlite close failed (scenario cleanup)')
    }
  }

  return { deps, cleanup }
}

/** Poll chat_state.state until it equals target OR timeout. */
export async function waitForState(
  sqlite: Sqlite,
  chatId: string,
  target: ChatState,
  timeoutMs: number
): Promise<ChatState | null> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const row = getChatState(sqlite, chatId)
    if (row && row.state === target) return target
    await new Promise((r) => setTimeout(r, 100))
  }
  return null
}

export async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return predicate()
}
