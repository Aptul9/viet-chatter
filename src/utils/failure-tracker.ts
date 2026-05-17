// FailureTracker: in-memory ring buffer of recent operation failures.
// Drives two alert triggers and one global dedupe:
//
//   1. PER-OP: when a single operation reaches attempt >= PER_OP_ALERT_AT
//      (default 5 = ~80 min of repeated failure), fire one alert.
//   2. GLOBAL: when >= GLOBAL_ALERT_THRESHOLD distinct operations have
//      failed within GLOBAL_WINDOW_MS, fire one alert.
//   3. DEDUPE: regardless of trigger, never emit more than one alert per
//      ALERT_DEDUPE_MS (default 30 min) — protects the owner from a flood
//      during a multi-hour outage.
//
// In-memory: state resets on process restart. That's OK — restart usually
// clears the underlying cause (process crashes, bad config); if not, the
// next failures will quickly re-trip the threshold.

import { log } from '../log.js'

const PER_OP_ALERT_AT = 5
const GLOBAL_ALERT_THRESHOLD = 3
const GLOBAL_WINDOW_MS = 60 * 60_000
const ALERT_DEDUPE_MS = 30 * 60_000

export type AlertReason = 'per_op_exhaustion' | 'global_rate'

export interface FailureEvent {
  /** Stable id of the operation (typically `${trigger}:${chatId}`). */
  opId: string
  /** Free-text label for log/alert messages (e.g. 'reactive turn'). */
  label: string
  /** 1-indexed attempt number of the failing attempt. */
  attempt: number
  /** Short error description. */
  error: string
  /** When the failure was recorded. */
  ts: number
}

export interface AlertPayload {
  reason: AlertReason
  text: string
  /** Most recent events feeding the alert (for log + Telegram body). */
  events: FailureEvent[]
}

export type AlertSink = (payload: AlertPayload) => void | Promise<void>

export class FailureTracker {
  private readonly events: FailureEvent[] = []
  /** Per-op flag: have we already alerted on this opId reaching the threshold?
   * Reset implicitly on `recordSuccess(opId)`. */
  private readonly perOpAlerted: Set<string> = new Set()
  private lastAlertAt: number = 0
  private sink: AlertSink | null = null

  setAlertSink(sink: AlertSink | null): void {
    this.sink = sink
  }

  /** Record a failure. Triggers an alert if any threshold is crossed and
   * the dedupe window has elapsed. */
  recordFailure(event: Omit<FailureEvent, 'ts'>): void {
    const full: FailureEvent = { ...event, ts: Date.now() }
    this.events.push(full)
    this.pruneOlderThan(full.ts - GLOBAL_WINDOW_MS)
    void this.maybeAlert(full)
  }

  /** Clear per-op state on success. Doesn't touch global counters (those
   * naturally expire via the sliding window). */
  recordSuccess(opId: string): void {
    this.perOpAlerted.delete(opId)
  }

  /** Returns the number of distinct ops with at least one recorded failure
   * inside the global window. Used by tests and metrics. */
  recentDistinctOps(now: number = Date.now()): number {
    const cutoff = now - GLOBAL_WINDOW_MS
    const ids = new Set<string>()
    for (const e of this.events) if (e.ts >= cutoff) ids.add(e.opId)
    return ids.size
  }

  private async maybeAlert(event: FailureEvent): Promise<void> {
    const reasons: AlertReason[] = []
    if (event.attempt >= PER_OP_ALERT_AT && !this.perOpAlerted.has(event.opId)) {
      reasons.push('per_op_exhaustion')
      this.perOpAlerted.add(event.opId)
    }
    if (this.recentDistinctOps(event.ts) >= GLOBAL_ALERT_THRESHOLD) {
      reasons.push('global_rate')
    }
    if (reasons.length === 0) return

    const now = event.ts
    if (now - this.lastAlertAt < ALERT_DEDUPE_MS) {
      log.debug(
        { reasons, lastAlertAgoMs: now - this.lastAlertAt },
        'failure-tracker: alert suppressed by dedupe'
      )
      return
    }
    this.lastAlertAt = now

    // Pick the highest-priority reason for the alert label (per-op wins
    // because it identifies a specific stuck op).
    const primary = reasons[0]!
    const recent = this.events.slice(-10)
    const text = this.formatAlert(primary, event, recent)
    log.warn({ reason: primary, opId: event.opId, attempt: event.attempt }, 'failure alert fired')
    if (!this.sink) {
      log.warn('failure-tracker: alert fired but no sink configured')
      return
    }
    try {
      await this.sink({ reason: primary, text, events: recent })
    } catch (err) {
      log.error({ err: (err as Error).message }, 'failure-tracker: alert sink threw')
    }
  }

  private formatAlert(
    reason: AlertReason,
    triggering: FailureEvent,
    recent: ReadonlyArray<FailureEvent>
  ): string {
    if (reason === 'per_op_exhaustion') {
      return [
        `[viet-chatter] OP STUCK`,
        `Op: ${triggering.label}`,
        `OpId: ${triggering.opId}`,
        `Attempt: ${triggering.attempt}`,
        `Last error: ${triggering.error}`,
      ].join('\n')
    }
    return [
      `[viet-chatter] SYSTEM ALERT`,
      `${GLOBAL_ALERT_THRESHOLD}+ distinct ops failing in the last ${Math.round(
        GLOBAL_WINDOW_MS / 60_000
      )} min.`,
      'Recent failures:',
      ...recent.slice(-5).map((e) => `  - [${e.label}] att=${e.attempt} ${e.error.slice(0, 80)}`),
    ].join('\n')
  }

  private pruneOlderThan(cutoff: number): void {
    while (this.events.length > 0 && this.events[0]!.ts < cutoff) {
      this.events.shift()
    }
  }
}

/** Module-level singleton. Constructed lazily so test code can replace it. */
let _instance: FailureTracker | null = null
export function getFailureTracker(): FailureTracker {
  if (!_instance) _instance = new FailureTracker()
  return _instance
}

/** Test-only: reset the singleton between scenarios. */
export function __resetFailureTrackerForTest(): void {
  _instance = null
}
