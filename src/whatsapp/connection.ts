/**
 * ConnectionStateMachine.
 *
 * Pure state container for the WhatsApp Web connection lifecycle. Does NOT
 * depend on `whatsapp-web.js`. The consumer (the wweb client wrapper) drives
 * state transitions by calling `setState(...)` when underlying events fire
 * (`ready`, `disconnected`, `auth_failure`, ...).
 *
 * Responsibilities:
 *   - track the current `ConnectionState` (`BOOTING|CONNECTING|CONNECTED|DISCONNECTED`)
 *   - log every transition per `docs/dev/12-logging-observability.md`
 *     ("connection state change" with `from`, `to`, `reason`)
 *   - fire registered `onReconnected` handlers on `DISCONNECTED -> CONNECTED`
 *     (sequentially, awaited; log `reconnect` with `outage_duration_ms`)
 *   - expose a pure exponential-backoff helper for the consumer to schedule
 *     retry attempts (no `setTimeout` inside this module)
 *
 * See `docs/dev/03-data-flow.md` Flow F (post-reconnect) for the high-level
 * sequence: on reconnect the BootReconciler is re-run by the listener.
 */

import { log } from '../log.js'
import type { ConnectionState } from '../types.js'

export type ReconnectedHandler = () => void | Promise<void>

export class ConnectionStateMachine {
  private state: ConnectionState = 'BOOTING'
  private disconnectedAt: number | null = null
  private readonly reconnectedHandlers: Set<ReconnectedHandler> = new Set()

  /** Current state snapshot. */
  getState(): ConnectionState {
    return this.state
  }

  /**
   * Move the machine to `BOOTING -> CONNECTING`. Callable once at startup.
   * Subsequent transitions go through `setState` driven by client events.
   */
  start(): void {
    if (this.state === 'BOOTING') {
      this.setState('CONNECTING', 'start')
    }
  }

  /**
   * Apply a state transition. Idempotent on `next === current`.
   *
   * Side effects:
   *  - logs `connection state change` (info) with `from`, `to`, `reason`
   *  - on `DISCONNECTED -> CONNECTED`, computes `outage_duration_ms` (if a
   *    `disconnectedAt` was recorded) and fires all `onReconnected` handlers
   *    sequentially, awaiting each. A handler error is logged and swallowed
   *    so subsequent handlers still run.
   *  - on any `* -> DISCONNECTED`, records `disconnectedAt = Date.now()`
   */
  setState(next: ConnectionState, reason?: string): void {
    const prev = this.state
    if (prev === next) return
    this.state = next
    log.info({ from: prev, to: next, reason: reason ?? null }, 'connection state change')

    if (next === 'DISCONNECTED') {
      this.disconnectedAt = Date.now()
      return
    }

    if (prev === 'DISCONNECTED' && next === 'CONNECTED') {
      const outageMs = this.disconnectedAt != null ? Date.now() - this.disconnectedAt : null
      this.disconnectedAt = null
      log.warn({ outage_duration_ms: outageMs }, 'reconnect')
      // Fire-and-forget the async chain so callers of setState (sync event
      // handlers from whatsapp-web.js) don't block. Errors are logged inside.
      void this.fireReconnected()
    }
  }

  private async fireReconnected(): Promise<void> {
    for (const handler of this.reconnectedHandlers) {
      try {
        await handler()
      } catch (err) {
        log.error({ err }, 'onReconnected handler threw')
      }
    }
  }

  /**
   * Register a handler invoked on every `DISCONNECTED -> CONNECTED` transition.
   * Returns an unsubscribe function.
   */
  onReconnected(handler: ReconnectedHandler): () => void {
    this.reconnectedHandlers.add(handler)
    return () => {
      this.reconnectedHandlers.delete(handler)
    }
  }

  /**
   * Exponential backoff helper. Returns the delay (ms) for the given attempt.
   * Pure: the consumer is responsible for scheduling the actual retry.
   *
   * Formula: `min(60_000, 2_000 * 2 ** attempt)`.
   * attempt=0 -> 2s, 1 -> 4s, 2 -> 8s, ..., capped at 60s.
   */
  scheduleReconnectAttempt(attempt: number): number {
    const n = Math.max(0, Math.floor(attempt))
    return Math.min(60_000, 2_000 * 2 ** n)
  }
}
