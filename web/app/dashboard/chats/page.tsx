import { getReadOnlyDb } from '@/lib/db-ro'
import { listChatsWithSummary } from '@/lib/repo-bridge'
import { formatRelative, formatTs } from '@/lib/format'
import { chatLabel } from '@/lib/chat-label'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function ChatsPage() {
  let chats: ReturnType<typeof listChatsWithSummary> = []
  let error: string | null = null
  try {
    const sqlite = getReadOnlyDb()
    chats = listChatsWithSummary(sqlite)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">All chats ({chats.length})</h2>
      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground uppercase">
            <th className="py-2">Contact</th>
            <th>State</th>
            <th>Last msg</th>
            <th>24h count</th>
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
    </div>
  )
}
