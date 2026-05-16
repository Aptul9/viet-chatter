// Small formatters used by the dashboard UI.

export function formatTs(ts: number | null | undefined): string {
  if (ts == null) return '-'
  const d = new Date(ts)
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'medium' })
}

export function formatRelative(ts: number | null | undefined): string {
  if (ts == null) return '-'
  const diffMs = Date.now() - ts
  const abs = Math.abs(diffMs)
  const sign = diffMs >= 0 ? '' : 'tra '
  const past = diffMs >= 0 ? ' fa' : ''
  if (abs < 60_000) return `${sign}${Math.round(abs / 1000)}s${past}`
  if (abs < 3_600_000) return `${sign}${Math.round(abs / 60_000)}m${past}`
  if (abs < 86_400_000) return `${sign}${Math.round(abs / 3_600_000)}h${past}`
  return `${sign}${Math.round(abs / 86_400_000)}g${past}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60_000).toFixed(1)}m`
}

export function shortChatId(id: string): string {
  // Strip "@c.us" / "@lid" suffix and keep first 12 digits + tail.
  const user = id.split('@')[0] ?? id
  if (user.length <= 12) return user
  return `${user.slice(0, 4)}…${user.slice(-4)}`
}
