import { getReadOnlyDb, getDbPathForDisplay } from '@/lib/db-ro'
import { getStats, listChatsWithSummary } from '@/lib/repo-bridge'
import { formatRelative, formatTs } from '@/lib/format'
import { chatLabel } from '@/lib/chat-label'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function DashboardHome() {
  let stats: ReturnType<typeof getStats> | null = null
  let chats: ReturnType<typeof listChatsWithSummary> = []
  let error: string | null = null
  try {
    const sqlite = getReadOnlyDb()
    stats = getStats(sqlite, '24h')
    chats = listChatsWithSummary(sqlite).slice(0, 10)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {error}
          <p className="mt-2 text-xs">DB path: {getDbPathForDisplay()}</p>
        </div>
      )}

      {stats && (
        <section>
          <h2 className="text-lg font-semibold mb-3">Last 24h</h2>
          <div className="grid grid-cols-3 gap-4">
            <Card label="Messages in" value={stats.totalMessages.in} />
            <Card label="Bot replies" value={stats.totalMessages.out_bot} />
            <Card label="Manual replies" value={stats.totalMessages.out_manual} />
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">Recent chats</h2>
          <Link href="/dashboard/chats" className="text-sm text-muted-foreground hover:underline">
            View all
          </Link>
        </div>
        {chats.length === 0 ? (
          <p className="text-sm text-muted-foreground">No chats yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground uppercase">
                <th className="py-2">Contact</th>
                <th>State</th>
                <th>Last msg</th>
                <th>24h</th>
              </tr>
            </thead>
            <tbody>
              {chats.map((c) => (
                <tr key={c.chatId} className="border-t">
                  <td className="py-2">
                    <Link
                      href={`/dashboard/chats/${encodeURIComponent(c.chatId)}`}
                      className="hover:underline"
                    >
                      {chatLabel(c)}
                    </Link>
                  </td>
                  <td className="text-xs">{c.state}</td>
                  <td className="text-xs text-muted-foreground" title={formatTs(c.lastMsgTs)}>
                    {formatRelative(c.lastMsgTs)}
                  </td>
                  <td>{c.msgCount24h}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function Card({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-card p-4">
      <div className="text-xs text-muted-foreground uppercase">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  )
}
