// Orchestrator for e2e scenarios. Boots the bot in test mode, runs a driver
// scenario from a second WhatsApp account, polls the validator, then cleans up.
//
// Usage:
//   npx tsx e2e/run.ts <scenario> [--ai stub|real] [--keep]
//
// Env (loaded from ./.env via dotenv, can also be exported in the shell):
//   BOT_TARGET_NUMBER  E.164 of the bot's WhatsApp account (e.g. 393334445566)
//
// Exit: 0 = pass, 1 = fail, 2 = setup/timeout error.

import 'dotenv/config'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import {
  mkdirSync,
  existsSync,
  copyFileSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import { resolve, dirname, basename } from 'node:path'

const PROJECT_ROOT = process.cwd()
const E2E_DIR = resolve(PROJECT_ROOT, 'e2e')
const SOURCE_CFG = resolve(E2E_DIR, 'config/e2e-config.yaml')
const TARGET_CFG = resolve(PROJECT_ROOT, 'config/user-config.yaml')
const BACKUP_CFG = resolve(PROJECT_ROOT, 'config/user-config.yaml.backup')

const BOOT_TIMEOUT_MS = 90_000
const VALIDATOR_TIMEOUT_MS = 60_000
const VALIDATOR_POLL_MS = 3_000
const BOT_KILL_GRACE_MS = 10_000

interface Args {
  scenario: string
  ai: 'stub' | 'real'
  keep: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  if (argv.length < 1 || argv[0]?.startsWith('--')) {
    console.error('usage: tsx e2e/run.ts <scenario> [--ai stub|real] [--keep]')
    process.exit(2)
  }
  const scenario = argv[0]!
  const ai = argv.includes('--ai')
    ? ((argv[argv.indexOf('--ai') + 1] ?? 'stub') as 'stub' | 'real')
    : 'stub'
  const keep = argv.includes('--keep')
  return { scenario, ai, keep }
}

function ensureDirs(): void {
  mkdirSync(resolve(E2E_DIR, 'logs'), { recursive: true })
  mkdirSync(resolve(E2E_DIR, 'db'), { recursive: true })
}

// We back up only if a real user config exists, so restore can be a no-op
// when the test ran on a fresh checkout. Returning the flag avoids stat races.
function swapConfig(): { backedUp: boolean } {
  let backedUp = false
  if (existsSync(TARGET_CFG)) {
    copyFileSync(TARGET_CFG, BACKUP_CFG)
    backedUp = true
  }
  copyFileSync(SOURCE_CFG, TARGET_CFG)
  return { backedUp }
}

function restoreConfig(backedUp: boolean): void {
  if (backedUp && existsSync(BACKUP_CFG)) {
    renameSync(BACKUP_CFG, TARGET_CFG)
  } else if (existsSync(TARGET_CFG)) {
    unlinkSync(TARGET_CFG)
  }
}

// Per-scenario DBs are deleted before each run, so the file is either missing
// or a freshly-created empty SQLite. Either way, schema must be applied before
// the bot opens it (the bot calls `openDb` directly with no migration step).
function migrateScenarioDb(dbPath: string): void {
  console.log(`[run] migrating scenario DB at ${dbPath}`)
  const result = spawnSync('npx', ['tsx', 'src/db/migrate.ts'], {
    cwd: PROJECT_ROOT,
    env: { ...process.env, DB_PATH: dbPath },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    throw new Error(`migration failed for ${dbPath} (exit=${result.status})`)
  }
}

function spawnBot(
  scenario: string,
  ai: 'stub' | 'real',
  logPath: string,
  dbPath: string
): ChildProcess {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BOT_E2E_MODE: '1',
    BOT_E2E_LOG_PATH: logPath,
    BOT_E2E_DB_PATH: dbPath,
    // src/log.ts reads LOG_FILE directly; mirror so pino transport writes to
    // the scenario-scoped file even if src/index.ts override is not wired yet.
    LOG_FILE: logPath,
  }
  if (ai === 'stub') env['BOT_E2E_STUB_AI'] = '1'
  console.log(`[run] spawning bot (scenario=${scenario}, ai=${ai})`)
  return spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: process.platform === 'win32',
  })
}

// pino-roll appends a rotation index (`.1`, `.2`, ...) to the configured
// `file` option, so the actual log file is e.g. `send-text.log.1`, not
// `send-text.log`. Collect every file in the parent dir whose name starts
// with the configured basename — covers the rotated suffix and the bare name
// (if pino-roll ever stops appending one).
function readAllLogContents(logPath: string): string {
  const dir = dirname(logPath)
  if (!existsSync(dir)) return ''
  const base = basename(logPath)
  const matches = readdirSync(dir).filter((f) => f === base || f.startsWith(`${base}.`))
  let combined = ''
  for (const f of matches) {
    try {
      combined += readFileSync(resolve(dir, f), 'utf8')
    } catch {
      /* race with rotation, skip */
    }
  }
  return combined
}

// Tail the bot log until both "whatsapp ready" and "boot done" appear. We
// match both because "whatsapp ready" alone is emitted before reconciler +
// ticker start; "boot done" alone could (in principle) precede a reconnect
// blip — requiring both makes the readiness check robust to either ordering.
async function waitForBotReady(logPath: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  let sawWhatsapp = false
  let sawBoot = false
  while (Date.now() - start < timeoutMs) {
    const raw = readAllLogContents(logPath)
    if (raw) {
      if (raw.includes('whatsapp ready')) sawWhatsapp = true
      if (raw.includes('boot done')) sawBoot = true
      if (sawWhatsapp && sawBoot) return
    }
    await sleep(1000)
  }
  throw new Error(
    `bot not ready after ${timeoutMs}ms (whatsapp=${sawWhatsapp}, boot=${sawBoot}). check ${logPath}`
  )
}

function runDriver(scenario: string, botNumber: string): { ok: boolean } {
  console.log(`[run] driver scenario=${scenario} -> ${botNumber}`)
  const result = spawnSync('npm', ['run', 'scenario', '--', scenario, '--to', botNumber], {
    cwd: resolve(E2E_DIR, 'driver'),
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  return { ok: result.status === 0 }
}

// Scenario name -> validator check name. The validator's checks live under
// `e2e/validator/src/checks/<name>.ts` and are reusable across scenarios (one
// check can validate multiple driver inputs). Per `e2e/README.md` table:
//   send-text   -> basic-reply
//   burst-text  -> basic-reply (debounce coalesces to one turn)
//   send-image  -> image-vision (vision-capable AI assumed by default)
//   send-audio  -> audio-escalation
//   send-document/send-location -> no validator check, manual DB inspection
//   reconnect   -> reconnect
const SCENARIO_CHECK_MAP: Record<string, string> = {
  'send-text': 'basic-reply',
  'burst-text': 'basic-reply',
  'send-image': 'image-vision',
  'send-audio': 'audio-escalation',
  reconnect: 'reconnect',
}

async function pollValidator(
  scenario: string,
  dbPath: string,
  logPath: string,
  timeoutMs: number
): Promise<{ ok: boolean }> {
  const check = SCENARIO_CHECK_MAP[scenario] ?? scenario
  if (check !== scenario) {
    console.log(`[run] scenario=${scenario} -> validator check=${check}`)
  }
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = spawnSync(
      'npm',
      ['run', 'check', '--silent', '--', check, '--db', dbPath, '--logs', logPath],
      {
        cwd: resolve(E2E_DIR, 'validator'),
        stdio: 'inherit',
        shell: process.platform === 'win32',
      }
    )
    if (result.status === 0) return { ok: true }
    await sleep(VALIDATOR_POLL_MS)
  }
  return { ok: false }
}

async function killBot(bot: ChildProcess): Promise<void> {
  if (bot.exitCode !== null || bot.signalCode !== null) return

  // On Windows, SIGTERM to a `npx tsx` chain only kills the npx wrapper; the
  // actual node child (the bot) survives as an orphan. taskkill /F /T walks
  // the process tree by PID and force-kills every descendant.
  if (process.platform === 'win32' && bot.pid !== undefined) {
    spawnSync('taskkill', ['/PID', String(bot.pid), '/F', '/T'], { stdio: 'ignore' })
  } else {
    bot.kill('SIGTERM')
  }

  const start = Date.now()
  while (Date.now() - start < BOT_KILL_GRACE_MS) {
    if (bot.exitCode !== null || bot.signalCode !== null) return
    await sleep(200)
  }
  if (bot.exitCode === null && bot.signalCode === null) {
    console.warn('[run] bot did not exit after kill, escalating')
    if (process.platform === 'win32' && bot.pid !== undefined) {
      spawnSync('taskkill', ['/PID', String(bot.pid), '/F', '/T'], { stdio: 'ignore' })
    } else {
      bot.kill('SIGKILL')
    }
  }
}

function tailLog(path: string, lines: number): void {
  if (!existsSync(path)) {
    console.log(`[run] no log at ${path}`)
    return
  }
  const all = readFileSync(path, 'utf8').split('\n')
  const tail = all.slice(-lines).join('\n')
  console.log(`\n--- last ${lines} lines of ${path} ---\n${tail}\n--- end ---\n`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function main(): Promise<void> {
  const args = parseArgs()
  const botNumber = process.env['BOT_TARGET_NUMBER']
  if (!botNumber) {
    console.error('[run] BOT_TARGET_NUMBER env var is required (E.164, no +)')
    process.exit(2)
  }

  ensureDirs()
  const logPath = resolve(E2E_DIR, 'logs', `${args.scenario}.log`)
  const dbPath = resolve(E2E_DIR, 'db', `${args.scenario}.db`)

  // Reset prior artifacts so the scenario starts clean. We intentionally do
  // NOT touch the .wwebjs_auth/ directory: re-pairing every run is wasteful.
  for (const p of [logPath, dbPath, `${dbPath}-shm`, `${dbPath}-wal`]) {
    if (existsSync(p)) unlinkSync(p)
  }
  // pino-roll writes to `${logPath}.1`, `${logPath}.2`, ... — purge them too
  // so stale lines from prior runs don't satisfy readiness markers.
  const logDir = dirname(logPath)
  const logBase = basename(logPath)
  if (existsSync(logDir)) {
    for (const f of readdirSync(logDir)) {
      if (f.startsWith(`${logBase}.`)) {
        try {
          unlinkSync(resolve(logDir, f))
        } catch {
          /* ignore */
        }
      }
    }
  }

  const { backedUp } = swapConfig()
  let bot: ChildProcess | null = null
  let exitCode = 0

  try {
    migrateScenarioDb(dbPath)
    bot = spawnBot(args.scenario, args.ai, logPath, dbPath)
    bot.on('exit', (code, sig) => {
      console.log(`[run] bot exited code=${code} sig=${sig}`)
    })

    await waitForBotReady(logPath, BOOT_TIMEOUT_MS)
    console.log('[run] bot ready')

    const driver = runDriver(args.scenario, botNumber)
    if (!driver.ok) {
      console.error('[run] driver failed')
      exitCode = 1
    } else {
      const validation = await pollValidator(args.scenario, dbPath, logPath, VALIDATOR_TIMEOUT_MS)
      if (validation.ok) {
        console.log(`[run] PASS scenario=${args.scenario}`)
      } else {
        console.error(`[run] FAIL scenario=${args.scenario}`)
        exitCode = 1
      }
    }
  } catch (err) {
    console.error(`[run] error: ${err instanceof Error ? err.message : String(err)}`)
    exitCode = 2
  } finally {
    if (exitCode !== 0) tailLog(logPath, 50)
    if (bot) await killBot(bot)
    if (!args.keep) restoreConfig(backedUp)
    else console.log(`[run] --keep: leaving ${TARGET_CFG}, ${logPath}, ${dbPath} in place`)
  }

  process.exit(exitCode)
}

main().catch((err) => {
  console.error(`[run] fatal: ${err instanceof Error ? err.stack : String(err)}`)
  process.exit(2)
})
