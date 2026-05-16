// End-to-end pipeline test driver (Spec B, C side).
//
// Runs one or more scenarios from `src/scripts/e2e-scenarios/` against a
// bootstrapped bot pipeline with a fake WhatsApp handle and a canned AI
// response. No real OpenCode server, no QR scan, no network.
//
// Usage:
//   npm run test:e2e                        # default: basic-reply
//   npm run test:e2e -- <scenario-name>     # single scenario
//   npm run test:e2e -- all                 # run every registered scenario
//   npm run test:e2e -- --list              # print available scenarios
//
// Exit codes:
//   0  all scenarios passed
//   1  at least one scenario failed
//   2  no scenarios run (bad name / empty registry)

// MUST be set BEFORE any module that consults the gate (config helper).
process.env['BOT_E2E_MODE'] = '1'

import 'dotenv/config'
import { stopOpencodeServer } from '../ai/opencode.js'
import { bootstrapScenario } from './e2e-scenarios/common.js'
import { SCENARIO_BY_NAME, SCENARIOS, type Scenario } from './e2e-scenarios/index.js'

interface RunOutcome {
  name: string
  ok: boolean
  errors: string[]
  durationMs: number
}

async function runOne(scenario: Scenario): Promise<RunOutcome> {
  const startedAt = Date.now()
  const chatId = `393999${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}@c.us`
  const { deps, cleanup } = await bootstrapScenario({ chatId })
  let outcome: RunOutcome
  try {
    const r = await scenario.run(deps)
    outcome = {
      name: scenario.name,
      ok: r.ok,
      errors: r.errors,
      durationMs: Date.now() - startedAt,
    }
  } catch (err) {
    outcome = {
      name: scenario.name,
      ok: false,
      errors: [`uncaught: ${err instanceof Error ? err.message : String(err)}`],
      durationMs: Date.now() - startedAt,
    }
  } finally {
    await cleanup()
  }
  return outcome
}

function formatOutcome(o: RunOutcome): string {
  const tag = o.ok ? 'PASS' : 'FAIL'
  const errs = o.errors.length > 0 ? `\n  - ${o.errors.join('\n  - ')}` : ''
  return `[${tag}] ${o.name} (${o.durationMs}ms)${errs}`
}

async function main(): Promise<void> {
  const arg = process.argv[2]

  if (arg === '--list') {
    console.log(SCENARIOS.map((s) => `${s.name}\n  ${s.description}`).join('\n'))
    process.exit(0)
  }

  const targets: Scenario[] =
    !arg || arg === 'basic-reply'
      ? [SCENARIO_BY_NAME.get('basic-reply')!]
      : arg === 'all'
        ? SCENARIOS
        : [SCENARIO_BY_NAME.get(arg) as Scenario | undefined].filter(Boolean) as Scenario[]

  if (targets.length === 0) {
    console.error(`unknown scenario: ${arg}`)
    console.error(`available: ${SCENARIOS.map((s) => s.name).join(', ')}`)
    await stopOpencodeServer().catch(() => {})
    process.exit(2)
  }

  console.log(`\n=== test-e2e (${targets.length} scenario${targets.length === 1 ? '' : 's'}) ===\n`)
  const results: RunOutcome[] = []
  for (const s of targets) {
    console.log(`\n--- ${s.name} ---`)
    const o = await runOne(s)
    results.push(o)
    console.log(formatOutcome(o))
  }

  await stopOpencodeServer().catch(() => {})

  const failed = results.filter((r) => !r.ok)
  const passed = results.length - failed.length
  console.log(`\n=== summary: ${passed}/${results.length} passed ===`)
  for (const o of results) console.log(formatOutcome(o))

  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.stack : String(err))
  process.exit(1)
})
