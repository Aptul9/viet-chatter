import type { CheckDeps, CheckResult } from '../index.js'
import { openReadonly, countOutBotAll, countEscalations, lastEscalation } from '../assert-db.js'

export async function check(deps: CheckDeps): Promise<CheckResult> {
  const errors: string[] = []
  const db = openReadonly(deps.db)
  try {
    const outBot = countOutBotAll(db)
    if (outBot !== 0) errors.push(`expected 0 out_bot rows (escalation path), got ${outBot}`)
    const pending = countEscalations(db, undefined, 'pending')
    if (pending !== 1) errors.push(`expected 1 pending escalation, got ${pending}`)
    const last = lastEscalation(db)
    if (!last) {
      errors.push('expected at least 1 escalation row, found none')
    } else if (last.reason !== 'other') {
      errors.push(`escalation reason='${last.reason}', expected 'other'`)
    }
    return { ok: errors.length === 0, errors }
  } finally {
    db.close()
  }
}
