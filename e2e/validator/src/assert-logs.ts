// Pino JSON-lines log helpers. Pino's transport may not flush instantly, so
// callers poll: the orchestrator re-runs validator every few seconds.

import { readFileSync, existsSync } from 'node:fs'

interface PinoLine {
  level?: number
  msg?: string
  [k: string]: unknown
}

function readLines(path: string): PinoLine[] {
  if (!existsSync(path)) return []
  const raw = readFileSync(path, 'utf8')
  const out: PinoLine[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as PinoLine)
    } catch {
      // pino-pretty colorized lines (when bot stdout was merged) won't parse;
      // skip silently so log mixing doesn't break grep.
    }
  }
  return out
}

export function containsMsg(path: string, msg: string): boolean {
  return readLines(path).some((l) => typeof l.msg === 'string' && l.msg.includes(msg))
}

export function countMsgs(path: string, msg: string): number {
  return readLines(path).filter((l) => typeof l.msg === 'string' && l.msg.includes(msg)).length
}

export function lastMatching(path: string, msg: string): PinoLine | undefined {
  const lines = readLines(path)
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const l = lines[i]
    if (l && typeof l.msg === 'string' && l.msg.includes(msg)) return l
  }
  return undefined
}
