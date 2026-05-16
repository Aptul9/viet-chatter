import type { CheckDeps, CheckResult } from '../index.js'

export async function check(_deps: CheckDeps): Promise<CheckResult> {
  // Reconnect cannot be triggered automatically from the driver (would need
  // to forcibly kill the bot's puppeteer socket mid-run). Manual procedure:
  //   1. start `npx tsx e2e/run.ts reconnect --keep`
  //   2. while bot is up, run `pkill -f "tsx src/index.ts"` then re-start
  //   3. confirm log shows `runReconciler` catching up + no duplicate replies
  return {
    ok: true,
    errors: [],
    notes: ['reconnect is a manual test; see check source for procedure'],
  }
}
