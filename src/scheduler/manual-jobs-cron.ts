// Manual-jobs cron: 30s tick for due manual_jobs, plus a daily scan that
// creates re_engage jobs and a daily cleanup that marks engagement cold
// when a re_engage went un-answered.
// See docs/dev/10-manual-jobs.md.

import type { Sqlite } from '../db/client.js'
import type { ChatStateMachine } from './state.js'
import {
  activeStates,
  chatsWithSilenceLongerThan,
  countOutgoing,
  getChatState,
  getPersonProfile,
  hasPendingManualJob,
  insertManualJob,
  pendingManualJobs,
  recentProcessedMessages,
  recentReEngagesWithoutReply,
  setEngagementState,
  transitionManualJob,
} from '../db/repo.js'
import { config } from '../config/index.js'
import { isInNightWindow, nextMorningStart } from './latency.js'
import { log } from '../log.js'
import { ONE_DAY_MS, ONE_YEAR_MS, PRE_FIRE_OUT_RECENT_WINDOW_MS } from '../config/constants.js'
import type { ChatId, ManualJobContext, ManualJobRow, RetryContextDTO } from '../types.js'
import { parseRetryPayload } from '../utils/retry.js'

export type ManualJobRunner = (
  chatId: ChatId,
  context: ManualJobContext,
  signal: AbortSignal,
  retryCtx?: RetryContextDTO
) => Promise<void>

export type ReactiveRunner = (
  chatId: ChatId,
  signal: AbortSignal,
  retryCtx?: RetryContextDTO
) => Promise<void>

export interface ManualCronDeps {
  sqlite: Sqlite
  state: ChatStateMachine
  isConnected: () => boolean
  /** Used for kind in ['date_anchored','revive','re_engage'] and for retry
   * jobs whose original trigger was 'manual_job'. */
  runManualJob: ManualJobRunner
  /** Used for retry jobs whose original trigger was 'reactive' — re-fires
   * the reactive orchestrator path (same as the ticker uses). */
  runReactiveTurn: ReactiveRunner
  registerInflight: (chatId: ChatId) => AbortSignal
}

/** Hard ceiling on concurrent AI/wweb operations the cron will spawn.
 * Prevents post-outage burst when many retries are due at the same tick. */
const MAX_CONCURRENT_FIRES = 2
let inflightFires = 0

let mainHandle: ReturnType<typeof setInterval> | null = null
let dailyHandle: ReturnType<typeof setInterval> | null = null
let running = false

export function startManualJobsCron(deps: ManualCronDeps): void {
  stopManualJobsCron()
  const tick = (): void => {
    if (running) return
    running = true
    try {
      processOnce(deps)
    } catch (err) {
      log.error({ err }, 'manual jobs cron failed')
    } finally {
      running = false
    }
  }
  mainHandle = setInterval(tick, config.manualJobsTickIntervalMs)
  mainHandle.unref()

  // Daily scans: re_engage candidate creation + cold marking.
  const daily = (): void => {
    try {
      reEngageScan(deps)
      markColdAfterReEngageNoReply(deps)
    } catch (err) {
      log.error({ err }, 'manual jobs daily scan failed')
    }
  }
  setTimeout(daily, 60_000).unref() // run once shortly after boot
  dailyHandle = setInterval(daily, ONE_DAY_MS)
  dailyHandle.unref()
}

export function stopManualJobsCron(): void {
  if (mainHandle) {
    clearInterval(mainHandle)
    mainHandle = null
  }
  if (dailyHandle) {
    clearInterval(dailyHandle)
    dailyHandle = null
  }
}

function processOnce(deps: ManualCronDeps): void {
  if (!deps.isConnected()) return
  const now = Date.now()
  if (isInNightWindow(now, config.timezone)) return

  const due = pendingManualJobs(deps.sqlite, now)
  for (const job of due) {
    if (inflightFires >= MAX_CONCURRENT_FIRES) {
      log.debug(
        { inflight: inflightFires, cap: MAX_CONCURRENT_FIRES, deferred: due.length - 0 },
        'concurrency cap reached, deferring remaining due jobs to next tick'
      )
      return
    }
    if (!transitionManualJob(deps.sqlite, job.id, 'pending', 'firing')) continue
    if (preFireSupersedes(deps.sqlite, job, now)) {
      transitionManualJob(deps.sqlite, job.id, 'firing', 'superseded')
      log.debug({ jobId: job.id, chatId: job.chatId, kind: job.kind }, 'manual job superseded')
      continue
    }

    const signal = deps.registerInflight(job.chatId)
    log.info(
      {
        jobId: job.id,
        chatId: job.chatId,
        kind: job.kind,
        fireAt: job.fireAt,
        attempt: job.attemptCount ?? 1,
      },
      'manual job fired'
    )

    const runner = buildRunner(deps, job)
    inflightFires++
    runner(signal)
      .then(() => {
        if (job.kind === 'date_anchored' && extractRecurring(job) === 'yearly') {
          insertManualJob(deps.sqlite, {
            chatId: job.chatId,
            kind: 'date_anchored',
            fireAt: job.fireAt + ONE_YEAR_MS,
            payload: job.payload,
            status: 'pending',
            createdAt: Date.now(),
            attemptCount: null,
          })
        }
      })
      .catch((err) => {
        log.error({ err, jobId: job.id, chatId: job.chatId }, 'manual job runner failed')
        // Failure → orchestrator already scheduled the retry via
        // src/utils/retry.ts. We just mark this job 'fired' (no separate
        // 'failed' status in v1; the retry row is the recovery signal).
      })
      .finally(() => {
        inflightFires = Math.max(0, inflightFires - 1)
        transitionManualJob(deps.sqlite, job.id, 'firing', 'fired', { firedAt: Date.now() })
      })
  }
}

/** Returns a closure that calls the right orchestrator path for the job.
 * - `retry` jobs dispatch on `payload.trigger` to either reactive or
 *   manual_job orchestrator entry points; the prior turn's hint is
 *   re-used so the model has the same instruction as the failed try.
 * - All other kinds (date_anchored, revive, re_engage) go through
 *   `runManualJob` with the hint built from `payload`. */
function buildRunner(
  deps: ManualCronDeps,
  job: ManualJobRow
): (signal: AbortSignal) => Promise<void> {
  if (job.kind === 'retry') {
    const payload = parseRetryPayload(job.payload)
    if (!payload) {
      // Defensive: malformed retry payload → no-op so we don't crash the
      // cron. The retry chain effectively dies for this op.
      log.warn({ jobId: job.id, chatId: job.chatId }, 'retry job has unparseable payload, skipping')
      return async () => {}
    }
    const attempt = job.attemptCount ?? 1
    if (payload.trigger === 'reactive') {
      const retryCtx: RetryContextDTO = { trigger: 'reactive', attempt }
      return (signal) => deps.runReactiveTurn(job.chatId, signal, retryCtx)
    }
    if (payload.trigger === 'manual_job') {
      const mjctx = payload.manualJobContext ?? {
        kind: 'revive',
        hint: 'Retry of a previously failed manual job. No additional context available.',
      }
      const ctx: ManualJobContext = {
        kind: mjctx.kind as ManualJobContext['kind'],
        hint: mjctx.hint,
      }
      const retryCtx: RetryContextDTO = {
        trigger: 'manual_job',
        attempt,
        manualJobContext: ctx,
      }
      return (signal) => deps.runManualJob(job.chatId, ctx, signal, retryCtx)
    }
    // 'escalation_notify' retries are handled by escalation/retry.ts, not
    // by this cron. Should not appear here.
    log.warn(
      { jobId: job.id, trigger: payload.trigger },
      'retry job with unexpected trigger landed in manual-jobs-cron'
    )
    return async () => {}
  }
  const hint = buildHint(job)
  const ctx: ManualJobContext = { kind: job.kind, hint }
  return (signal) => deps.runManualJob(job.chatId, ctx, signal)
}

function preFireSupersedes(sqlite: Sqlite, job: ManualJobRow, now: number): boolean {
  const cutoff = now - PRE_FIRE_OUT_RECENT_WINDOW_MS
  const recent = recentProcessedMessages(sqlite, job.chatId, 30)
  for (const r of recent) {
    if ((r.direction === 'out_bot' || r.direction === 'out_manual') && r.ts > cutoff) return true
  }
  const cs = getChatState(sqlite, job.chatId)
  if (cs && cs.state !== 'IDLE') return true
  return false
}

function buildHint(job: ManualJobRow): string {
  let payload: Record<string, unknown> = {}
  if (job.payload) {
    try {
      payload = JSON.parse(job.payload) as Record<string, unknown>
    } catch {
      /* noop */
    }
  }
  if (job.kind === 'date_anchored') {
    const action = typeof payload['action'] === 'string' ? payload['action'] : 'follow_up'
    return `Today's the trigger date for action "${action}" (linked fact_id=${String(payload['fact_id'] ?? 'unknown')}). Open the conversation in a way that fits the action and your established tone.`
  }
  if (job.kind === 'revive') {
    // `action` is what the D2 agent emits via createManualJob; `context` is
    // the older field name kept for backward-compat with any pre-D2 rows.
    // Either provides the per-job instruction we pass to the orchestrator.
    const instr =
      typeof payload['action'] === 'string'
        ? payload['action']
        : typeof payload['context'] === 'string'
          ? payload['context']
          : 'previous conversation ended on an inconclusive note'
    return `Revive instruction: ${instr}. Send one light, brief follow-up. Do NOT be needy. Single attempt only. If the instruction quotes a literal message in double quotes, send exactly that text — do not paraphrase or add greetings.`
  }
  if (job.kind === 're_engage') {
    const daysSilent = typeof payload['days_silent'] === 'number' ? payload['days_silent'] : null
    const last = typeof payload['last_seen_iso'] === 'string' ? payload['last_seen_iso'] : null
    return `Re-engage after long silence${daysSilent ? ` (${daysSilent} days)` : ''}${last ? ` since ${last}` : ''}. Use KB to anchor the opener. Do NOT mention the silence explicitly.`
  }
  return 'Manual job fired.'
}

function extractRecurring(job: ManualJobRow): 'yearly' | null {
  if (!job.payload) return null
  try {
    const p = JSON.parse(job.payload) as Record<string, unknown>
    return p['recurring'] === 'yearly' ? 'yearly' : null
  } catch {
    return null
  }
}

function reEngageScan(deps: ManualCronDeps): void {
  // The doc cites `repo.chatsWithSilenceLongerThan(thresholdMap)`. We feed it
  // with thresholds resolved per-chat from person_profile, falling back to
  // config.reEngageDefaultThresholdDays. We only consider chats we have any
  // state for (i.e. ever-seen) — sourced from `activeStates`.
  const now = Date.now()
  const known = activeStates(deps.sqlite)
  const threshold = new Map<string, number>()
  for (const row of known) {
    const p = getPersonProfile(deps.sqlite, row.chatId)
    if (!p) continue
    if (p.engagementState === 'cold') continue
    threshold.set(row.chatId, p.reEngageThresholdDays || config.reEngageDefaultThresholdDays)
  }
  const candidates = chatsWithSilenceLongerThan(deps.sqlite, threshold, now)
  for (const chatId of candidates) {
    if (hasPendingManualJob(deps.sqlite, chatId, 're_engage')) continue
    if (countOutgoing(deps.sqlite, chatId) < config.reEngageMinOutgoingHistory) continue
    const fireAt = nextMorningWithJitter()
    insertManualJob(deps.sqlite, {
      chatId,
      kind: 're_engage',
      fireAt,
      payload: JSON.stringify({ scheduled_at: now }),
      status: 'pending',
      createdAt: now,
      attemptCount: null,
    })
    log.info({ chatId, fireAt }, 'manual job created (re_engage)')
  }
}

function markColdAfterReEngageNoReply(deps: ManualCronDeps): void {
  const stale = recentReEngagesWithoutReply(deps.sqlite, config.reEngageColdAfterDays)
  for (const job of stale) {
    setEngagementState(deps.sqlite, job.chatId, 'cold')
    log.info({ chatId: job.chatId, jobId: job.id }, 'engagement state -> cold')
  }
}

function nextMorningWithJitter(): number {
  const now = Date.now()
  const base = nextMorningStart(now, config.timezone)
  const jitterMs = Math.floor(Math.random() * 2 * 60 * 60_000) // up to +2h
  return base + jitterMs
}
