import { getReadOnlyDb } from '@/lib/db-ro'
import { getScheduleOverview } from '@/lib/repo-bridge'
import { escalationStatusLabel, formatRelative, formatTs, shortChatId } from '@/lib/format'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function SchedulePage() {
  let overview: ReturnType<typeof getScheduleOverview> | null = null
  let error: string | null = null
  try {
    const sqlite = getReadOnlyDb()
    overview = getScheduleOverview(sqlite)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  if (error)
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        {error}
      </div>
    )
  if (!overview) return null

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Active chat states ({overview.chatStates.length})
        </h2>
        {overview.chatStates.length === 0 ? (
          <p className="text-sm text-muted-foreground">All chats IDLE.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th className="py-1">Chat</th>
                <th>State</th>
                <th>First msg</th>
                <th>Debounce deadline</th>
                <th>Fire at</th>
              </tr>
            </thead>
            <tbody>
              {overview.chatStates.map((s) => (
                <tr key={s.chatId} className="border-t">
                  <td className="py-1">
                    <Link
                      href={`/dashboard/chats/${encodeURIComponent(s.chatId)}`}
                      className="font-mono hover:underline"
                    >
                      {shortChatId(s.chatId)}
                    </Link>
                  </td>
                  <td>{s.state}</td>
                  <td className="text-muted-foreground" title={formatTs(s.firstMsgAt)}>
                    {s.firstMsgAt != null ? formatRelative(s.firstMsgAt) : '-'}
                  </td>
                  <td className="text-muted-foreground" title={formatTs(s.debounceDeadline)}>
                    {s.debounceDeadline != null ? formatRelative(s.debounceDeadline) : '-'}
                  </td>
                  <td className="text-muted-foreground" title={formatTs(s.fireAt)}>
                    {s.fireAt != null ? formatRelative(s.fireAt) : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Pending manual jobs ({overview.manualJobs.length})
        </h2>
        {overview.manualJobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs queued.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th className="py-1">ID</th>
                <th>Chat</th>
                <th>Kind</th>
                <th>Fire at</th>
                <th>Created</th>
                <th>Payload</th>
              </tr>
            </thead>
            <tbody>
              {overview.manualJobs.map((j) => (
                <tr key={j.id} className="border-t">
                  <td className="py-1">#{j.id}</td>
                  <td>
                    <Link
                      href={`/dashboard/chats/${encodeURIComponent(j.chatId)}`}
                      className="font-mono hover:underline"
                    >
                      {shortChatId(j.chatId)}
                    </Link>
                  </td>
                  <td>{j.kind}</td>
                  <td title={formatTs(j.fireAt)}>{formatRelative(j.fireAt)}</td>
                  <td className="text-muted-foreground" title={formatTs(j.createdAt)}>
                    {formatRelative(j.createdAt)}
                  </td>
                  <td className="font-mono text-muted-foreground max-w-xs truncate">
                    {j.payload ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Open escalations ({overview.escalations.length})
        </h2>
        {overview.escalations.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {overview.escalations.map((e) => (
              <li key={e.id} className="rounded border bg-card p-3">
                <div className="flex items-center justify-between mb-1 text-xs font-mono gap-2">
                  <span>
                    #{e.id} {e.reason}/{e.urgency}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="rounded bg-amber-100 text-amber-900 px-2 py-0.5">
                      {escalationStatusLabel(e)}
                    </span>
                    <Link
                      href={`/dashboard/chats/${encodeURIComponent(e.chatId)}`}
                      className="hover:underline"
                    >
                      {shortChatId(e.chatId)}
                    </Link>
                  </span>
                </div>
                <div>{e.summary}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatRelative(e.createdAt)} (channels: {e.notifiedChannels.join(', ') || 'none'}
                  {e.holdingReplySent ? ', holding sent' : ''})
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
