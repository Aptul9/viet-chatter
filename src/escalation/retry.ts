// Retry cron for escalations whose notify failed on every channel.
//
// v2: switched from fixed `retryIntervalMs` ticks to per-escalation
// exponential backoff via shared `nextFireAt` schedule, with random jitter
// and integration with FailureTracker for systemic alerting. Each
// escalation's next-attempt time is held in memory (resets on restart;
// after restart the next tick will re-attempt immediately, which is the
// safe behavior for time-sensitive notifications).

import type { Sqlite } from '../db/client.js'
import { pendingEscalationsForRetry } from '../db/repo.js'
import { config } from '../config/index.js'
import { log } from '../log.js'
import { nextFireAt } from '../utils/retry.js'
import { getFailureTracker } from '../utils/failure-tracker.js'
import type { EscalationNotifier } from './notifier.js'

let handle: ReturnType<typeof setInterval> | null = null
interface RetryState {
  attempts: number
  nextEligibleAt: number
}
const state = new Map<number, RetryState>()
let running = false

export interface RetryDeps {
  sqlite: Sqlite
  notifier: EscalationNotifier
}

export function startEscalationRetry(deps: RetryDeps): void {
  stopEscalationRetry()
  const tick = async (): Promise<void> => {
    if (running) return
    running = true
    try {
      await tickOnce(deps)
    } catch (err) {
      log.error({ err }, 'escalation retry tick failed')
    } finally {
      running = false
    }
  }
  // Tick every 60s. Backoff scheduling decides whether a given pending
  // escalation is actually eligible at this tick.
  handle = setInterval(() => {
    void tick()
  }, 60_000)
  handle.unref()
}

export function stopEscalationRetry(): void {
  if (handle) {
    clearInterval(handle)
    handle = null
  }
  state.clear()
}

async function tickOnce(deps: RetryDeps): Promise<void> {
  if (!config.escalation.enabled) return
  const now = Date.now()
  const pending = pendingEscalationsForRetry(deps.sqlite)
  for (const esc of pending) {
    const cur = state.get(esc.id) ?? { attempts: 0, nextEligibleAt: now }
    if (cur.nextEligibleAt > now) continue // backoff not elapsed yet
    const attempt = cur.attempts + 1
    log.info({ escId: esc.id, attempt }, 'escalation retry')
    try {
      await deps.notifier.notify(esc.id)
      // notify() updates notified_channels on success; pendingEscalationsForRetry
      // returns only escalations still failing every channel, so if this id
      // shows up next tick it means notify still failed. We schedule the
      // next backoff window unconditionally and rely on the DB filter.
      const next = nextFireAt(attempt, Date.now())
      state.set(esc.id, { attempts: attempt, nextEligibleAt: next })
      getFailureTracker().recordFailure({
        opId: `escalation_notify:${esc.id}`,
        label: `escalation #${esc.id} notify`,
        attempt,
        error: 'all channels failed (caller logged details)',
      })
    } catch (err) {
      log.error({ err, escId: esc.id, attempt }, 'escalation retry notify error')
      const next = nextFireAt(attempt, Date.now())
      state.set(esc.id, { attempts: attempt, nextEligibleAt: next })
      getFailureTracker().recordFailure({
        opId: `escalation_notify:${esc.id}`,
        label: `escalation #${esc.id} notify`,
        attempt,
        error: (err as Error).message,
      })
    }
  }
}
