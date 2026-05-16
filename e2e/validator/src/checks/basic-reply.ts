import type { CheckDeps, CheckResult } from '../index.js'
import { openReadonly, countOutBotAll, lastTurnLog } from '../assert-db.js'

export async function check(deps: CheckDeps): Promise<CheckResult> {
  const errors: string[] = []
  const db = openReadonly(deps.db)
  try {
    const outBot = countOutBotAll(db)
    if (outBot < 1) errors.push(`expected >=1 out_bot rows, got ${outBot}`)
    const last = lastTurnLog(db)
    if (!last) {
      errors.push('expected at least 1 turn_log row, found none')
    } else if (last.status !== 'sent') {
      errors.push(`last turn_log status='${last.status}', expected 'sent'`)
    }
    return { ok: errors.length === 0, errors }
  } finally {
    db.close()
  }
}
