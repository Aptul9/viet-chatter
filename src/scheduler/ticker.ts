// TickerLoop: scans `chat_state` every config.tickIntervalMs and advances
// ACCUMULATING → SCHEDULED and SCHEDULED → SENDING per docs/dev/03-data-flow.md Flow B.
// The actual reply generation is delegated via an injected `runTurn` callback
// to keep the scheduler decoupled from the orchestrator (avoids circular dep).

import type { Sqlite } from '../db/client.js'
import type { ChatStateMachine } from './state.js'
import { activeStates, recentProcessedMessages } from '../db/repo.js'
import { config } from '../config/index.js'
import { log } from '../log.js'
import { PRE_SEND_OUT_MANUAL_WINDOW_MS } from '../config/constants.js'
import type { ChatId, RetryContextDTO } from '../types.js'

export type TurnRunner = (
  chatId: ChatId,
  signal: AbortSignal,
  retryCtx?: RetryContextDTO
) => Promise<void>

export interface TickerDeps {
  sqlite: Sqlite
  state: ChatStateMachine
  runTurn: TurnRunner
  /** Provided so the ticker can register the inflight AbortController per chat. */
  registerInflight: (chatId: ChatId) => AbortSignal
  isConnected: () => boolean
}

let intervalHandle: ReturnType<typeof setInterval> | null = null
let running = false

export function startTicker(deps: TickerDeps): void {
  stopTicker()
  const tick = (): void => {
    if (running) return
    running = true
    try {
      processOnce(deps)
    } catch (err) {
      log.error({ err }, 'ticker tick failed')
    } finally {
      running = false
    }
  }
  intervalHandle = setInterval(tick, config.tickIntervalMs)
  intervalHandle.unref()
}

export function stopTicker(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}

function processOnce(deps: TickerDeps): void {
  if (!deps.isConnected()) return
  const now = Date.now()
  const rows = activeStates(deps.sqlite)

  for (const row of rows) {
    if (row.state === 'ACCUMULATING') {
      const debounceClosed = row.debounceDeadline !== null && now >= row.debounceDeadline
      const hardCapped = row.firstMsgAt !== null && now - row.firstMsgAt >= config.hardCapMs
      if (debounceClosed || hardCapped) {
        deps.state.scheduleDue(row.chatId, now)
      }
      continue
    }

    if (row.state === 'SCHEDULED') {
      if (row.fireAt === null || now < row.fireAt) continue
      if (preSendOutManualPresent(deps, row.chatId, row.fireAt, now)) {
        deps.state.finishSending(row.chatId, 'aborted')
        log.info({ chatId: row.chatId, reason: 'pre_send_out_manual' }, 'reply turn aborted')
        continue
      }
      if (!deps.state.claimSending(row.chatId)) continue

      const signal = deps.registerInflight(row.chatId)
      deps.runTurn(row.chatId, signal).catch((err) => {
        log.error({ err, chatId: row.chatId }, 'runTurn failed')
      })
    }
  }
}

function preSendOutManualPresent(
  deps: TickerDeps,
  chatId: ChatId,
  fireAt: number,
  now: number
): boolean {
  void now
  const rows = recentProcessedMessages(deps.sqlite, chatId, 5)
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (!r) continue
    if (r.direction === 'out_manual' && r.ts > fireAt - PRE_SEND_OUT_MANUAL_WINDOW_MS) {
      return true
    }
  }
  return false
}
