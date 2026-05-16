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
import type { ChatId, ManualJobContext, ManualJobRow } from '../types.js'

export type ManualJobRunner = (
  chatId: ChatId,
  context: ManualJobContext,
  signal: AbortSignal
) => Promise<void>

export interface ManualCronDeps {
  sqlite: Sqlite
  state: ChatStateMachine
  isConnected: () => boolean
  runManualJob: ManualJobRunner
  registerInflight: (chatId: ChatId) => AbortSignal
}

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
    if (!transitionManualJob(deps.sqlite, job.id, 'pending', 'firing')) continue
    if (preFireSupersedes(deps.sqlite, job, now)) {
      transitionManualJob(deps.sqlite, job.id, 'firing', 'superseded')
      log.debug({ jobId: job.id, chatId: job.chatId, kind: job.kind }, 'manual job superseded')
      continue
    }

    const hint = buildHint(job)
    const ctx: ManualJobContext = { kind: job.kind, hint }
    const signal = deps.registerInflight(job.chatId)
    log.info(
      { jobId: job.id, chatId: job.chatId, kind: job.kind, fireAt: job.fireAt },
      'manual job fired'
    )

    deps
      .runManualJob(job.chatId, ctx, signal)
      .then(() => {
        if (job.kind === 'date_anchored' && extractRecurring(job) === 'yearly') {
          insertManualJob(deps.sqlite, {
            chatId: job.chatId,
            kind: 'date_anchored',
            fireAt: job.fireAt + ONE_YEAR_MS,
            payload: job.payload,
            status: 'pending',
            createdAt: Date.now(),
          })
        }
      })
      .catch((err) => {
        log.error({ err, jobId: job.id, chatId: job.chatId }, 'manual job runner failed')
      })
      .finally(() => {
        transitionManualJob(deps.sqlite, job.id, 'firing', 'fired', { firedAt: Date.now() })
      })
  }
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
    const context =
      typeof payload['context'] === 'string'
        ? payload['context']
        : 'previous conversation ended on an inconclusive note'
    return `Revive context: ${context}. Send one light, brief follow-up. Do NOT be needy. Single attempt only.`
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
