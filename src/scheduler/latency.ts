// Rolling-average reply latency + night-window math.
// See docs/dev/04-scheduler-state-machine.md for the formulas.
//
// Timezone-aware date arithmetic uses Intl.DateTimeFormat — no extra deps.
// All times in ms-since-epoch unless otherwise noted.

import type { Sqlite } from '../db/client.js'
import { recentProcessedMessages } from '../db/repo.js'
import { config } from '../config/index.js'

type TzParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const tzCache = new Map<string, Intl.DateTimeFormat>()

function getFmt(tz: string): Intl.DateTimeFormat {
  let fmt = tzCache.get(tz)
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    tzCache.set(tz, fmt)
  }
  return fmt
}

function partsInTz(tsMs: number, tz: string): TzParts {
  const parts = getFmt(tz).formatToParts(new Date(tsMs))
  const get = (t: Intl.DateTimeFormatPartTypes): number => {
    const p = parts.find((x) => x.type === t)
    if (!p) throw new Error(`tz part missing: ${t}`)
    return Number(p.value)
  }
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  }
}

/** Find the ms-offset of `tz` at `tsMs` (positive for east of UTC). */
function tzOffsetMs(tsMs: number, tz: string): number {
  const p = partsInTz(tsMs, tz)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - tsMs
}

/** Compose a ms-since-epoch for a given local Y/M/D h:m:s in `tz`. */
function tsFromLocal(tz: string, y: number, m: number, d: number, h: number, min: number): number {
  const guess = Date.UTC(y, m - 1, d, h, min, 0)
  const offset = tzOffsetMs(guess, tz)
  return guess - offset
}

export function isInNightWindow(tsMs: number, tz: string): boolean {
  const { hour } = partsInTz(tsMs, tz)
  const startHour: number = config.nightWindow.startHour
  const endHour: number = config.nightWindow.endHour
  if (startHour === endHour) return false
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour
  }
  return hour >= startHour || hour < endHour
}

/** Next local-time start of the morning (config.nightWindow.endHour) on or after `tsMs`. */
export function nextMorningStart(tsMs: number, tz: string): number {
  const endHour = config.nightWindow.endHour
  const p = partsInTz(tsMs, tz)
  let candidate = tsFromLocal(tz, p.year, p.month, p.day, endHour, 0)
  if (candidate <= tsMs) {
    const dayLater = tsMs + 24 * 60 * 60_000
    const q = partsInTz(dayLater, tz)
    candidate = tsFromLocal(tz, q.year, q.month, q.day, endHour, 0)
  }
  return candidate
}

/** True if [inTs, outTs] intersects any night window in `tz`. */
export function crossesNight(inTs: number, outTs: number, tz: string): boolean {
  if (outTs <= inTs) return false
  const ONE_HOUR = 60 * 60_000
  for (let t = inTs; t <= outTs; t += ONE_HOUR) {
    if (isInNightWindow(t, tz)) return true
  }
  return isInNightWindow(outTs, tz)
}

export function rollingAvgLatency(
  sqlite: Sqlite,
  chatId: string,
  windowSize: number,
  excludeNight: boolean
): number | null {
  const rows = recentProcessedMessages(sqlite, chatId, 100)
  const tz = config.timezone
  const latencies: number[] = []
  let lastInTs: number | null = null
  for (const r of rows) {
    if (r.direction === 'in') {
      lastInTs = r.ts
      continue
    }
    if (lastInTs !== null) {
      const lat = r.ts - lastInTs
      if (lat > 0 && (!excludeNight || !crossesNight(lastInTs, r.ts, tz))) {
        latencies.push(lat)
      }
      lastInTs = null
    }
  }
  if (latencies.length < windowSize) return null
  const lastN = latencies.slice(-windowSize)
  const sum = lastN.reduce((a, b) => a + b, 0)
  return sum / lastN.length
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

export function computeFireAt(sqlite: Sqlite, chatId: string, debounceCloseTs: number): number {
  const avg = rollingAvgLatency(sqlite, chatId, config.rollingLatencyWindow, true)
  const baseDelay =
    avg !== null ? clamp(avg, config.minDelayMs, config.maxDelayMs) : config.fallbackDelayMs
  const jitterFactor = 1 + (Math.random() * 2 - 1) * config.jitterPct
  const jittered = baseDelay * jitterFactor
  let fireAt = debounceCloseTs + jittered
  if (isInNightWindow(fireAt, config.timezone)) {
    fireAt = nextMorningStart(fireAt, config.timezone) + Math.random() * config.minDelayMs
  }
  return Math.round(fireAt)
}
