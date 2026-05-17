#!/usr/bin/env node
// Pre-launch helper: free the given TCP port by killing whatever listens on it.
// Cross-platform. Used by `predev:web` so `next dev` doesn't bail on EADDRINUSE
// when a previous bot/web run left a Node still bound.
//
// Usage: node scripts/free-port.mjs <port>
// Best-effort: logs + exits 0 even on failure (don't block the actual dev cmd).

import { spawnSync } from 'node:child_process'
import net from 'node:net'

const port = Number(process.argv[2])
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`free-port: invalid port "${process.argv[2]}"`)
  process.exit(0)
}

// Probe every interface a Next.js bind could land on. On Windows the bind
// table is asymmetric: a process listening on `127.0.0.1:p` does NOT block
// `0.0.0.0:p` — so a 0.0.0.0 success means nothing about whether `next dev
// --hostname 127.0.0.1` will be able to claim the port. Test 127.0.0.1
// (and ::1) explicitly since that's the actual target hostname our dev
// script uses; the wildcard checks stay as a belt-and-braces signal for
// anyone running without `--hostname`.
async function isPortFree(p) {
  const tryBind = (host) =>
    new Promise((resolve) => {
      const srv = net.createServer()
      srv.once('error', () => resolve(false))
      srv.once('listening', () => srv.close(() => resolve(true)))
      srv.listen(p, host)
    })
  const hosts = ['127.0.0.1', '::1', '0.0.0.0', '::']
  for (const h of hosts) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await tryBind(h))) return false
  }
  return true
}

function killWindows(p) {
  // Get-NetTCPConnection covers all address families. Some Node + curl flows
  // also wire a v4-only listener separately; we kill any owner without filter.
  const ps = `(Get-NetTCPConnection -LocalPort ${p} -ErrorAction SilentlyContinue | Where-Object { $_.State -eq 'Listen' -or $_.State -eq 'Bound' } | Select-Object -ExpandProperty OwningProcess -Unique) | ForEach-Object { try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Output $_ } catch { Write-Error $_.Exception.Message } }`
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10_000 }
  )
  const stderr = (r.stderr ?? '').trim()
  if (stderr) console.warn(`free-port: ps stderr: ${stderr}`)
  return (r.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+$/.test(l))
}

function killPosix(p) {
  const r = spawnSync('sh', ['-c', `lsof -ti :${p} 2>/dev/null || true`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 10_000,
  })
  const pids = (r.stdout ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^\d+$/.test(l))
  for (const pid of pids) {
    try {
      process.kill(Number(pid), 'SIGKILL')
    } catch {
      /* dead */
    }
  }
  return pids
}

const free = await isPortFree(port)
if (free) process.exit(0)

console.warn(`free-port: ${port} busy, killing holders`)
const pids = process.platform === 'win32' ? killWindows(port) : killPosix(port)
if (pids.length > 0) console.warn(`free-port: killed ${pids.join(', ')}`)

// Brief wait for the OS to release the socket.
await new Promise((r) => setTimeout(r, 500))
const finallyFree = await isPortFree(port)
if (!finallyFree) {
  console.warn(`free-port: ${port} still bound after kill attempt; continuing anyway`)
}
process.exit(0)
