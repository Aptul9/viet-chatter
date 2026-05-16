// Validator CLI. Dispatches to checks/<name>.ts which exports `check(deps)`.
//
// Usage:
//   npm run check -- <check-name> --db <abs-path> --logs <abs-path>
//
// Exit: 0 = pass, 1 = fail (errors printed), 2 = bad args.

export interface CheckDeps {
  db: string
  logs: string
}

export interface CheckResult {
  ok: boolean
  errors: string[]
  notes?: string[]
}

export type CheckFn = (deps: CheckDeps) => Promise<CheckResult>

interface Args {
  name: string
  deps: CheckDeps
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  if (argv.length < 1 || argv[0]?.startsWith('--')) {
    console.error('usage: npm run check -- <check> --db <path> --logs <path>')
    process.exit(2)
  }
  const name = argv[0]!
  const dbIdx = argv.indexOf('--db')
  const logsIdx = argv.indexOf('--logs')
  if (dbIdx === -1 || !argv[dbIdx + 1] || logsIdx === -1 || !argv[logsIdx + 1]) {
    console.error('[validator] --db and --logs are required')
    process.exit(2)
  }
  return { name, deps: { db: argv[dbIdx + 1]!, logs: argv[logsIdx + 1]! } }
}

async function main(): Promise<void> {
  const { name, deps } = parseArgs()
  // Dynamic import: a missing check name produces a clear MODULE_NOT_FOUND.
  let mod: { check: CheckFn }
  try {
    mod = (await import(`./checks/${name}.js`)) as { check: CheckFn }
  } catch (err) {
    console.error(
      `[validator] unknown check '${name}': ${err instanceof Error ? err.message : String(err)}`
    )
    process.exit(2)
  }
  const result = await mod.check(deps)
  if (result.notes?.length) {
    for (const n of result.notes) console.log(`[validator] note: ${n}`)
  }
  if (result.ok) {
    console.log(`[validator] PASS ${name}`)
    process.exit(0)
  }
  console.error(`[validator] FAIL ${name}`)
  for (const e of result.errors) console.error(`  - ${e}`)
  process.exit(1)
}

main().catch((err) => {
  console.error(`[validator] fatal: ${err instanceof Error ? err.stack : String(err)}`)
  process.exit(2)
})
