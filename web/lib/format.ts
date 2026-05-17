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

/** Human-readable label for an escalation row. The DB stores 'pending' for
 * everything from "just created, not yet notified" through "notified,
 * waiting for the owner to reply" — that single bucket is what the user
 * was seeing as a confusing "pending" tag. Derive a clearer label by also
 * looking at `notifiedChannels`. */
export function escalationStatusLabel(esc: {
  status: string
  notifiedChannels: ReadonlyArray<string>
}): string {
  if (esc.status === 'user_replied') return 'Replied'
  if (esc.status === 'dismissed') return 'Dismissed'
  if (esc.status === 'superseded') return 'Superseded'
  if (esc.status === 'pending') {
    return esc.notifiedChannels.length > 0 ? 'Awaiting reply' : 'Notification pending'
  }
  return esc.status
}
