import type { CheckDeps, CheckResult } from '../index.js'
import { openReadonly, countOutBotAll, lastEscalation } from '../assert-db.js'

export async function check(deps: CheckDeps): Promise<CheckResult> {
  const errors: string[] = []
  const db = openReadonly(deps.db)
  try {
    const outBot = countOutBotAll(db)
    if (outBot !== 0) {
      errors.push(`expected 0 out_bot rows (audio escalates, never replies), got ${outBot}`)
    }
    const last = lastEscalation(db)
    if (!last) {
      errors.push('expected at least 1 escalation row from audio scenario, found none')
    } else {
      if (last.reason !== 'other') {
        errors.push(`escalation reason='${last.reason}', expected 'other'`)
      }
      if (!last.summary.toLowerCase().includes('audio')) {
        errors.push(`escalation summary='${last.summary}' does not mention 'audio'`)
      }
    }
    return { ok: errors.length === 0, errors }
  } finally {
    db.close()
  }
}
