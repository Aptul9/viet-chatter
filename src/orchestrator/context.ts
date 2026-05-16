// Build the per-turn `TurnContext` consumed by `generateTurn`.
// See docs/dev/03-data-flow.md (Flow C, steps 2-8) + docs/dev/07-ai-integration.md.
//
// Spec A: optionally accepts a list of `PendingMedia` items drained from the
// MediaQueue. The metadata (type, mime, caption, ts, filename) is included in
// the serialized TurnContext so the AI knows there is media attached. Bytes
// themselves are passed separately as multimodal parts (see orchestrator).

import type { Sqlite } from '../db/client.js'
import type { WhatsAppHandle } from '../whatsapp/client.js'
import type { EmbeddingService } from '../kb/embedding.js'
import type { VecStore } from '../kb/vec.js'
import { loadKB, type KbDeps } from '../kb/store.js'
import { getOrInitProfile } from '../persona/profile.js'
import { config } from '../config/index.js'
import { log } from '../log.js'
import type {
  ChatId,
  Direction,
  ManualJobContext,
  PendingMedia,
  PendingMediaContextItem,
  RecentMessage,
  TurnContext,
  TurnKB,
} from '../types.js'

export interface ContextDeps {
  sqlite: Sqlite
  wa: WhatsAppHandle
  embedding: EmbeddingService
  vecStore: VecStore
}

export async function buildTurnContext(
  deps: ContextDeps,
  chatId: ChatId,
  now: number,
  manualJobContext?: ManualJobContext,
  pendingMedia: PendingMedia[] = []
): Promise<TurnContext> {
  const profile = getOrInitProfile(deps.sqlite, chatId, now)

  const limit = config.aiHistoryLimit
  const raw = await deps.wa.fetchMessages(chatId, limit)
  const recent: RecentMessage[] = raw.map((m) => ({
    direction: classify(deps.wa, m),
    body: typeof m.body === 'string' ? m.body : '',
    ts: m.timestamp * 1000,
  }))

  const lastIncomingBody = pickLastIncomingBody(recent)

  const kbDeps: KbDeps = {
    sqlite: deps.sqlite,
    vecStore: deps.vecStore,
    embedding: deps.embedding,
  }
  const kbBundle = await loadKB(kbDeps, chatId, lastIncomingBody, now)
  const kb: TurnKB = {
    important: kbBundle.important.map((f) => f.content),
    ephemeral: kbBundle.ephemeral.map((f) => f.content),
    secondary: kbBundle.secondary.map((f) => f.content),
  }

  const personLanguages = safeParseLanguages(profile.languages)
  const nowIso = new Date(now).toISOString()

  const ctx: TurnContext = {
    personId: chatId,
    personLanguages,
    personDisplayName: profile.displayName,
    toneSummary: profile.toneSummary,
    recentMessages: recent,
    kb,
    nowIso,
  }
  if (manualJobContext) ctx.manualJobContext = manualJobContext
  if (pendingMedia.length > 0) {
    ctx.pendingMedia = pendingMedia.map<PendingMediaContextItem>((m) => ({
      type: m.type,
      mime: m.mime,
      caption: m.caption,
      tsIso: new Date(m.timestampMs).toISOString(),
      filename: m.filename,
    }))
  }
  return ctx
}

function classify(
  wa: WhatsAppHandle,
  msg: {
    fromMe: boolean
    id: { _serialized: string }
    to?: string
    body?: string
  }
): Direction {
  if (!msg.fromMe) return 'in'
  const body = typeof msg.body === 'string' ? msg.body : undefined
  return wa.isBotSent(msg.id._serialized, msg.to, body) ? 'out_bot' : 'out_manual'
}

function pickLastIncomingBody(history: RecentMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i]
    if (m && m.direction === 'in' && m.body.trim().length > 0) return m.body
  }
  return ''
}

function safeParseLanguages(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed.filter((x): x is string => typeof x === 'string')
  } catch (err) {
    log.warn({ err: (err as Error).message, raw }, 'languages JSON parse failed')
  }
  return ['en']
}
