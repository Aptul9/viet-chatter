// Driver CLI. Dispatches to scenarios/<name>.ts.
//
// Usage:
//   npm run scenario -- <scenario> --to <e164> [--body <text>] [--file <path>]

import { initDriverSession } from './session.js'
import type { Client as WAClient } from 'whatsapp-web.js'

export interface ScenarioOpts {
  to: string
  body?: string
  file?: string
}

export type ScenarioFn = (client: WAClient, opts: ScenarioOpts) => Promise<void>

interface ParsedArgs {
  scenario: string
  opts: ScenarioOpts
}

function parseArgs(): ParsedArgs {
  const argv = process.argv.slice(2)
  if (argv.length < 1 || argv[0]?.startsWith('--')) {
    console.error(
      'usage: npm run scenario -- <scenario> --to <e164> [--body <text>] [--file <path>]'
    )
    process.exit(2)
  }
  const scenario = argv[0]!
  const toIdx = argv.indexOf('--to')
  if (toIdx === -1 || !argv[toIdx + 1]) {
    console.error('[driver] --to <e164> is required')
    process.exit(2)
  }
  const opts: ScenarioOpts = { to: argv[toIdx + 1]! }
  const bodyIdx = argv.indexOf('--body')
  if (bodyIdx !== -1) opts.body = argv[bodyIdx + 1]
  const fileIdx = argv.indexOf('--file')
  if (fileIdx !== -1) opts.file = argv[fileIdx + 1]
  return { scenario, opts }
}

async function main(): Promise<void> {
  const { scenario, opts } = parseArgs()
  // Dynamic import so we only pay for the scenario actually being run, and
  // a missing scenario surfaces as a clear MODULE_NOT_FOUND.
  const mod = (await import(`./scenarios/${scenario}.js`)) as { run: ScenarioFn }
  if (typeof mod.run !== 'function') {
    throw new Error(`scenario ${scenario} does not export run()`)
  }
  const client = await initDriverSession()
  try {
    await mod.run(client, opts)
  } finally {
    await client.destroy()
  }
}

main().catch((err) => {
  console.error(`[driver] error: ${err instanceof Error ? err.stack : String(err)}`)
  process.exit(1)
})
