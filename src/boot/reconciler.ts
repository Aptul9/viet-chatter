// BootReconciler: catch-up at boot and on every reconnect.
// See docs/dev/09-boot-reconciler.md for the full algorithm.

import type { Sqlite } from '../db/client.js'
import type { WhatsAppHandle } from '../whatsapp/client.js'
import type { MessageDispatcher } from '../dispatcher/index.js'
import { buildChatContext } from '../dispatcher/index.js'
import { applyFilter } from '../dispatcher/filter.js'
import {
  activeStates,
  getChatState,
  getLastSeenForChats,
  recentProcessedMessages,
  scheduledOverdue,
  setChatState,
  setDisplayNameIfEmpty,
  transitionChatState,
} from '../db/repo.js'
import { config } from '../config/index.js'
import { log } from '../log.js'
import { computeFireAt } from '../scheduler/latency.js'
import type { ChatId } from '../types.js'

// Loose shapes — we accept whatever wweb hands us.
type WAChatLite = {
  id: { _serialized: string }
  isGroup: boolean
  unreadCount?: number
  lastMessage?: { timestamp: number } | undefined
  getContact: () => Promise<{ name?: string; pushname?: string; isMyContact?: boolean }>
  fetchMessages: (opts: { limit: number }) => Promise<unknown[]>
}

export interface ReconcilerDeps {
  sqlite: Sqlite
  wa: WhatsAppHandle
  dispatcher: MessageDispatcher
}

export async function runReconciler(deps: ReconcilerDeps): Promise<void> {
  const startedAt = Date.now()
  log.info({ sinceIso: new Date(startedAt).toISOString() }, 'reconcile start')

  const allChats = (await deps.wa.client.getChats()) as unknown as WAChatLite[]
  const candidates = allChats
    .filter((c) => !c.isGroup)
    .filter((c) => !!c.lastMessage)
    .map((c) => ({
      chat: c,
      lastWhatsAppTs: c.lastMessage!.timestamp * 1000,
      lastSeenInDb: null as number | null,
    }))

  const chatIds: ChatId[] = candidates.map((c) => c.chat.id._serialized)
  const lastSeen = getLastSeenForChats(deps.sqlite, chatIds)
  for (const c of candidates) {
    c.lastSeenInDb = lastSeen.get(c.chat.id._serialized) ?? null
  }

  const toFetch = candidates.filter((c) => {
    if (c.lastSeenInDb === null) return (c.chat.unreadCount ?? 0) > 0
    return c.lastWhatsAppTs > c.lastSeenInDb
  })
  toFetch.sort((a, b) => b.lastWhatsAppTs - a.lastWhatsAppTs)
  const capped = toFetch.slice(0, config.bootMaxChatsToFetch)
  const skippedCap = toFetch.length - capped.length
  if (skippedCap > 0) log.warn({ skipped: skippedCap }, 'boot cap reached, older chats skipped')

  // Apply filter pre-fetch. For @lid-keyed chats, try to resolve the lid
  // to a real phone first (same fix as dispatcher.handleIncoming).
  const filtered: typeof capped = []
  for (const c of capped) {
    try {
      let ctx = await buildChatContext(c.chat as never)
      const chatId = c.chat.id._serialized
      if (chatId.endsWith('@lid')) {
        const realPhone = await deps.wa.resolveLidPhone(chatId)
        if (realPhone) {
          ctx = { ...ctx, phone: realPhone }
          try {
            setDisplayNameIfEmpty(deps.sqlite, chatId, realPhone)
          } catch (err) {
            log.warn(
              { err, chatId },
              'reconcile: failed to persist resolved lid phone to display_name'
            )
          }
        }
      }
      if (applyFilter(ctx)) filtered.push(c)
      else log.debug({ chatId, phone: ctx.phone }, 'reconcile: filter rejected')
    } catch (err) {
      log.warn({ err, chatId: c.chat.id._serialized }, 'reconcile buildChatContext failed')
    }
  }

  let fetched = 0
  await runWithConcurrency(filtered, config.fetchConcurrency, async (c) => {
    const target = (c.chat.unreadCount ?? 0) + 5
    const limit = clamp(target, 10, 50)
    let msgs: unknown[] = []
    try {
      msgs = await c.chat.fetchMessages({ limit })
    } catch (err) {
      log.warn({ err, chatId: c.chat.id._serialized }, 'fetchMessages failed during reconcile')
      return
    }
    for (const raw of msgs) {
      const m = raw as { timestamp?: number }
      if (typeof m.timestamp !== 'number') continue
      const tsMs = m.timestamp * 1000
      const isNew = c.lastSeenInDb === null ? (c.chat.unreadCount ?? 0) > 0 : tsMs > c.lastSeenInDb
      if (!isNew) continue
      try {
        await deps.dispatcher.handleMessage(raw as never, { fromBoot: true })
      } catch (err) {
        log.warn({ err }, 'dispatcher handleMessage failed during reconcile')
      }
    }
    fetched++
  })

  postReconcileRecovery(deps.sqlite)

  log.info(
    {
      candidates: candidates.length,
      fetched,
      skippedCap,
      durationMs: Date.now() - startedAt,
    },
    'reconcile done'
  )
}

function postReconcileRecovery(sqlite: Sqlite): void {
  // 1) SCHEDULED with fire_at in the past → spread.
  const overdue = scheduledOverdue(sqlite, Date.now())
  if (overdue.length > 1) {
    let acc = Date.now()
    const { min, max } = config.postReconnectSpreadMs
    for (const row of overdue) {
      const spread = min + Math.random() * (max - min)
      acc += spread
      setChatState(sqlite, row.chatId, { fireAt: acc, lastEventAt: Date.now() })
    }
    log.info({ chatsRedistributed: overdue.length }, 'post-reconnect spread')
  }

  // 2) SENDING ambiguous → coerce per docs/dev/09-boot-reconciler.md.
  const active = activeStates(sqlite)
  let recoveredSending = 0
  for (const row of active) {
    if (row.state !== ('SENDING' as typeof row.state)) continue
    const recent = recentProcessedMessages(sqlite, row.chatId, 5)
    const last = recent[recent.length - 1]
    const now = Date.now()
    if (last && last.direction === 'out_bot' && now - last.ts < 60_000) {
      transitionChatState(sqlite, row.chatId, 'SENDING', 'IDLE', {
        firstMsgAt: null,
        debounceDeadline: null,
        fireAt: null,
        attempt: 0,
        lastEventAt: now,
      })
    } else {
      transitionChatState(sqlite, row.chatId, 'SENDING', 'ACCUMULATING', {
        firstMsgAt: now,
        debounceDeadline: now + config.debounceMs,
        fireAt: null,
        attempt: 0,
        lastEventAt: now,
      })
    }
    recoveredSending++
  }
  if (recoveredSending > 0) {
    log.info({ recoveredSending }, 'SENDING recovery applied')
  }
  void getChatState // keep import for future per-chat lookups
  void computeFireAt
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let i = 0
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (;;) {
      const idx = i++
      if (idx >= items.length) return
      const item = items[idx]
      if (item === undefined) return
      try {
        await fn(item)
      } catch (err) {
        log.error({ err }, 'reconcile worker failed')
      }
    }
  })
  await Promise.all(workers)
}
