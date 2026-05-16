// Retry cron for escalations whose notify failed on every channel.
// Runs every config.escalation.retryIntervalMs, max retryMaxAttempts per esc id
// (counter in-memory; resets on process restart per docs/dev/18-escalation.md).

import type { Sqlite } from '../db/client.js'
import { pendingEscalationsForRetry } from '../db/repo.js'
import { config } from '../config/index.js'
import { log } from '../log.js'
import type { EscalationNotifier } from './notifier.js'

let handle: ReturnType<typeof setInterval> | null = null
const attempts = new Map<number, number>()
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
  handle = setInterval(() => {
    void tick()
  }, config.escalation.retryIntervalMs)
  handle.unref()
}

export function stopEscalationRetry(): void {
  if (handle) {
    clearInterval(handle)
    handle = null
  }
  attempts.clear()
}

async function tickOnce(deps: RetryDeps): Promise<void> {
  if (!config.escalation.enabled) return
  const pending = pendingEscalationsForRetry(deps.sqlite)
  for (const esc of pending) {
    const prev = attempts.get(esc.id) ?? 0
    if (prev >= config.escalation.retryMaxAttempts) {
      log.error({ escId: esc.id, attempts: prev }, 'escalation retry exhausted')
      continue
    }
    const attempt = prev + 1
    attempts.set(esc.id, attempt)
    log.info({ escId: esc.id, attempt }, 'escalation retry')
    try {
      await deps.notifier.notify(esc.id)
    } catch (err) {
      log.error({ err, escId: esc.id, attempt }, 'escalation retry notify error')
    }
  }
}
