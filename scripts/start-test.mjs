// Test-mode launcher. Boots bot (+ optionally web) against an isolated DB
// (`./viet-chatter-test.db`) so manual live testing doesn't pollute the prod
// `./viet-chatter.db`. The wweb session in `./.wwebjs_auth/` is shared with
// prod, so the real WhatsApp account stays paired across both modes.
//
// Usage:
//   node scripts/start-test.mjs            # bot + web (mirrors `npm run dev`)
//   node scripts/start-test.mjs bot        # bot only (mirrors `npm start`)
//   node scripts/start-test.mjs dev        # explicit bot + web
//
// Env vars set:
//   BOT_E2E_MODE=1                 unlocks the override hook in src/index.ts
//   BOT_E2E_DB_PATH=<test-db>      bot writes here instead of viet-chatter.db
//   BOT_E2E_LOG_PATH=<test-log>    bot logs to logs/viet-chatter-test.log
//   VIET_CHATTER_DB_PATH=<test-db> dashboard read/write handles point to test DB

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

const ROOT = process.cwd()
const TEST_DB = resolve(ROOT, 'viet-chatter-test.db')
const TEST_LOG = resolve(ROOT, 'logs/viet-chatter-test.log')

const target = process.argv[2] === 'bot' ? 'start' : 'dev'

mkdirSync(dirname(TEST_LOG), { recursive: true })

if (!existsSync(TEST_DB)) {
  console.log(`[test-mode] test DB missing, running migrations on ${TEST_DB}`)
  const migrate = spawnSync('npx', ['tsx', 'src/db/migrate.ts'], {
    env: { ...process.env, DB_PATH: TEST_DB },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (migrate.status !== 0) {
    console.error('[test-mode] migration failed')
    process.exit(migrate.status ?? 1)
  }
}

console.log(`[test-mode] DB=${TEST_DB} LOG=${TEST_LOG} target=npm run ${target}`)

const env = {
  ...process.env,
  BOT_E2E_MODE: '1',
  BOT_E2E_DB_PATH: TEST_DB,
  BOT_E2E_LOG_PATH: TEST_LOG,
  VIET_CHATTER_DB_PATH: TEST_DB,
}

const child = spawn('npm', ['run', target], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

const forward = (sig) => {
  if (!child.killed) child.kill(sig)
}
process.on('SIGINT', () => forward('SIGINT'))
process.on('SIGTERM', () => forward('SIGTERM'))

child.on('exit', (code, sig) => {
  process.exit(code ?? (sig ? 1 : 0))
})
