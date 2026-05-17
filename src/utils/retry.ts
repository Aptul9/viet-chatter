// Persistent retry queue helpers.
//
// On a failed unit-of-work (orchestrator turn, escalation notify) we
// schedule a re-attempt by inserting a `manual_jobs` row with `kind='retry'`
// and `fire_at = now + backoff(attempt) + jitter`. The existing
// manual-jobs cron picks the row up like any other due job; jitter prevents
// post-outage synchronized bursts.
//
// We never drop a retry. The schedule caps each interval at 30 min but
// repeats that cap indefinitely — the unit of work keeps trying until it
// succeeds or the user cancels it. Per-op alerting (see
// `failure-tracker.ts`) is the safety net for genuinely broken state.

import type { Sqlite } from '../db/client.js'
import { insertManualJob } from '../db/repo.js'
import { log } from '../log.js'
import type { ChatId } from '../types.js'

/** Backoff intervals in milliseconds, applied to attempt 1, 2, 3, 4. Attempt
 * 5+ all use the last entry (30 min). Matches the user's stated cap. */
const BACKOFF_SCHEDULE_MS: ReadonlyArray<number> = [
  5 * 60_000,
  10 * 60_000,
  20 * 60_000,
  30 * 60_000,
]

/** Random ±30s spread so multiple ops requeued at the same wall-clock
 * moment don't fire simultaneously after backoff elapses. */
const JITTER_RANGE_MS = 30_000

export type RetryTrigger = 'reactive' | 'manual_job' | 'escalation_notify'

export interface RetryPayload {
  /** Which code path to re-fire when the retry job comes due. */
  trigger: RetryTrigger
  /** Original failure summary, included in alerts and logs. */
  errorSummary: string
  /** Optional payload to re-hydrate manual-job context (kind + hint). Only
   * relevant when trigger='manual_job'. */
  manualJobContext?: {
    kind: string
    hint: string
  }
  /** Optional escalation id for trigger='escalation_notify'. */
  escalationId?: number
}

/** Returns the wall-clock ms at which the next attempt should fire. */
export function nextFireAt(attempt: number, now: number = Date.now()): number {
  const idx = Math.min(attempt - 1, BACKOFF_SCHEDULE_MS.length - 1)
  const base = BACKOFF_SCHEDULE_MS[idx] ?? BACKOFF_SCHEDULE_MS[BACKOFF_SCHEDULE_MS.length - 1]!
  const jitter = Math.floor((Math.random() * 2 - 1) * JITTER_RANGE_MS)
  return now + base + jitter
}

export interface ScheduleRetryArgs {
  sqlite: Sqlite
  chatId: ChatId
  trigger: RetryTrigger
  errorSummary: string
  /** 1-indexed attempt number of the FAILED attempt. Pass 1 for the
   * original try. Backoff is based on this failed attempt number, while the
   * persisted retry row stores `previousAttempt + 1` as the next attempt to
   * execute. Example: original try (1) fails -> retry row stores attempt 2,
   * but delay uses the first bucket (5 min). */
  previousAttempt: number
  manualJobContext?: RetryPayload['manualJobContext']
  escalationId?: number
}

/** Insert the next retry job. Returns the new job id and its fireAt. */
export function scheduleRetry(args: ScheduleRetryArgs): { jobId: number; fireAt: number } {
  const nextAttempt = args.previousAttempt + 1
  const now = Date.now()
  const fireAt = nextFireAt(args.previousAttempt, now)
  const payload: RetryPayload = {
    trigger: args.trigger,
    errorSummary: args.errorSummary.slice(0, 500),
    ...(args.manualJobContext ? { manualJobContext: args.manualJobContext } : {}),
    ...(args.escalationId !== undefined ? { escalationId: args.escalationId } : {}),
  }
  const jobId = insertManualJob(args.sqlite, {
    chatId: args.chatId,
    kind: 'retry',
    fireAt,
    payload: JSON.stringify(payload),
    status: 'pending',
    createdAt: now,
    attemptCount: nextAttempt,
  })
  log.info(
    {
      chatId: args.chatId,
      trigger: args.trigger,
      attempt: nextAttempt,
      jobId,
      fireAt,
      delayMs: fireAt - now,
    },
    'retry scheduled'
  )
  return { jobId, fireAt }
}

/** Parse the JSON payload stored on a retry job back into a typed object.
 * Returns null on parse fail (caller should log + skip). */
export function parseRetryPayload(payloadJson: string | null): RetryPayload | null {
  if (!payloadJson) return null
  try {
    const p = JSON.parse(payloadJson) as RetryPayload
    if (typeof p !== 'object' || p === null) return null
    if (
      p.trigger !== 'reactive' &&
      p.trigger !== 'manual_job' &&
      p.trigger !== 'escalation_notify'
    ) {
      return null
    }
    return p
  } catch {
    return null
  }
}
