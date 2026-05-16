import { getReadOnlyDb } from '@/lib/db-ro'
import { getStats } from '@/lib/repo-bridge'
import { formatDuration, shortChatId } from '@/lib/format'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

const RANGES: Array<'24h' | '7d' | 'all'> = ['24h', '7d', 'all']

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}) {
  const sp = await searchParams
  const range = (RANGES.includes((sp.range as '24h' | '7d' | 'all') ?? '24h')
    ? sp.range
    : '24h') as '24h' | '7d' | 'all'

  let stats: ReturnType<typeof getStats> | null = null
  let error: string | null = null
  try {
    const sqlite = getReadOnlyDb()
    stats = getStats(sqlite, range)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  if (error)
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        {error}
      </div>
    )
  if (!stats) return null

  return (
    <div className="space-y-6">
      <div className="flex gap-2 text-sm">
        <span className="text-muted-foreground">Range:</span>
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`/dashboard/stats?range=${r}`}
            className={`underline-offset-2 ${
              r === stats.range
                ? 'font-bold underline'
                : 'text-muted-foreground hover:underline'
            }`}
          >
            {r}
          </Link>
        ))}
      </div>

      <section className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card label="Messages in" value={stats.totalMessages.in} />
        <Card label="Bot replies" value={stats.totalMessages.out_bot} />
        <Card label="Manual replies" value={stats.totalMessages.out_manual} />
        <Card
          label="Avg turn dur"
          value={stats.avgTurnDurationMs != null ? formatDuration(stats.avgTurnDurationMs) : '-'}
        />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Turns</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
          <Card label="Sent" value={stats.turns.sent} />
          <Card label="Escalated" value={stats.turns.escalated} />
          <Card label="Skipped" value={stats.turns.skipped} />
          <Card label="Failed" value={stats.turns.failed} />
          <Card label="Aborted" value={stats.turns.aborted} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Escalations</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card label="Pending" value={stats.escalations.pending} />
          <Card label="User replied" value={stats.escalations.user_replied} />
          <Card label="Superseded" value={stats.escalations.superseded} />
          <Card label="Dismissed" value={stats.escalations.dismissed} />
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">
          Per chat ({stats.perChat.length})
        </h2>
        {stats.perChat.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity in this range.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th className="py-1">Chat</th>
                <th>Name</th>
                <th>In</th>
                <th>Out bot</th>
                <th>Out manual</th>
                <th>Avg reply</th>
              </tr>
            </thead>
            <tbody>
              {stats.perChat.map((p) => (
                <tr key={p.chatId} className="border-t">
                  <td className="py-1">
                    <Link
                      href={`/dashboard/chats/${encodeURIComponent(p.chatId)}`}
                      className="font-mono hover:underline"
                    >
                      {shortChatId(p.chatId)}
                    </Link>
                  </td>
                  <td>{p.displayName ?? '-'}</td>
                  <td>{p.msgIn}</td>
                  <td>{p.msgOutBot}</td>
                  <td>{p.msgOutManual}</td>
                  <td>{formatDuration(p.avgReplyMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function Card({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded border bg-card p-4">
      <div className="text-xs text-muted-foreground uppercase">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}
