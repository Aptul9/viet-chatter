// Pre-launch cleanup: kill any stale Chromium puppeteered against our
// `.wwebjs_auth/` userDataDir from a previous run that didn't shut down
// cleanly (terminal closed, kill -9, crash). Remove lock files left behind.
//
// We deliberately do NOT kill arbitrary `chrome.exe` processes — only the
// ones whose command line references THIS project's session path. Killing
// every Chrome would close the user's normal browser, which is hostile.

import { spawnSync, execSync } from 'node:child_process'
import { existsSync, rmSync, readdirSync } from 'node:fs'
import { resolve as resolvePath, join } from 'node:path'
import { log } from '../log.js'

const LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'] as const

/**
 * Ensures no stale browser holds `sessionDir`. Idempotent and safe to call
 * before every `client.initialize()`. Best-effort: errors are logged, not thrown.
 */
export function ensureCleanSession(sessionDir: string): void {
  const absDir = resolvePath(process.cwd(), sessionDir)
  if (!existsSync(absDir)) return // first run, nothing to clean

  killProjectChromium(absDir)
  removeLockFiles(absDir)
}

function killProjectChromium(absSessionDir: string): void {
  const platform = process.platform
  try {
    if (platform === 'win32') {
      killWindows(absSessionDir)
    } else {
      killPosix(absSessionDir)
    }
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'pre-launch chromium kill failed (continuing)')
  }
}

function killWindows(absSessionDir: string): void {
  // Find Chromium processes whose command line references THIS session dir,
  // then Stop-Process by pid. PS single-quoted string is literal, no escaping
  // needed for backslashes; only embedded single-quotes need doubling.
  const needle = absSessionDir.replace(/'/g, "''")
  const ps = `Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='chromium.exe'" | Where-Object { $_.CommandLine -like '*${needle}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Write-Output $_.ProcessId }`
  // spawnSync with arg array avoids cmd.exe parsing the embedded `$_`, `|`, quotes.
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }
  )
  const out = (res.stdout ?? '') + (res.stderr ?? '')
  const pids = out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+$/.test(l))
  if (pids.length > 0) {
    log.warn({ pids, sessionDir: absSessionDir }, 'pre-launch killed stale chromium')
  }
}

function killPosix(absSessionDir: string): void {
  // `pgrep -f` matches against the full command line. -a prints "<pid> <cmd>".
  // We grep both `chrom` (chromium / chrome) and the path to scope the kill.
  const out = execSync(`pgrep -af 'chrom.*${absSessionDir.replace(/'/g, "'\\''")}' || true`, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  })
  const pids = out
    .split('\n')
    .map((l) => l.trim().split(/\s+/)[0])
    .filter((p): p is string => !!p && /^\d+$/.test(p))
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGKILL')
    } catch {
      /* already dead */
    }
  }
  if (pids.length > 0) {
    log.warn({ pids, sessionDir: absSessionDir }, 'pre-launch killed stale chromium')
  }
}

function removeLockFiles(absSessionDir: string): void {
  // Lock files live at the userDataDir root and at any profile subdir.
  // `whatsapp-web.js` uses a `session` subfolder by default (LocalAuth).
  const roots = [absSessionDir, ...listSubdirs(absSessionDir)]
  for (const root of roots) {
    for (const name of LOCK_FILES) {
      const path = join(root, name)
      if (!existsSync(path)) continue
      try {
        rmSync(path, { force: true })
        log.debug({ path }, 'pre-launch removed lock file')
      } catch (err) {
        log.warn({ err: (err as Error).message, path }, 'pre-launch lock removal failed')
      }
    }
  }
}

function listSubdirs(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => join(root, e.name))
  } catch {
    return []
  }
}
