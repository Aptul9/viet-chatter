import type { CheckDeps, CheckResult } from '../index.js'
import { openReadonly, countOutBotAll, lastTurnLog } from '../assert-db.js'
import { containsMsg } from '../assert-logs.js'

export async function check(deps: CheckDeps): Promise<CheckResult> {
  const errors: string[] = []
  const db = openReadonly(deps.db)
  try {
    const outBot = countOutBotAll(db)
    if (outBot < 1) errors.push(`expected >=1 out_bot rows after vision turn, got ${outBot}`)
    const last = lastTurnLog(db)
    if (!last) {
      errors.push('expected at least 1 turn_log row, found none')
    } else if (last.status !== 'sent') {
      errors.push(`last turn_log status='${last.status}', expected 'sent'`)
    }
    // Marker pino msg from the router when multimodal payload is sent. Exact
    // string is owned by src/ai/router.ts; if that file uses a different msg
    // this check needs to be updated in lockstep.
    if (!containsMsg(deps.logs, 'AI call (multimodal)')) {
      errors.push("expected log msg 'AI call (multimodal)' to be present")
    }
    return { ok: errors.length === 0, errors }
  } finally {
    db.close()
  }
}
