import { getReadOnlyDb } from '@/lib/db-ro'
import { listChatsWithSummary } from '@/lib/repo-bridge'
import { SummaryForm } from '@/components/dashboard/SummaryForm'

export const dynamic = 'force-dynamic'

export default async function SummaryPage() {
  let chats: ReturnType<typeof listChatsWithSummary> = []
  let error: string | null = null
  try {
    const sqlite = getReadOnlyDb()
    chats = listChatsWithSummary(sqlite)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold">AI summary</h2>
        <p className="text-sm text-muted-foreground">
          Pick a chat and a day range. The bot AI returns a free-form digest of
          what happened in that window. Read-only on the DB; the AI provider is
          called once per request.
        </p>
      </header>
      {error ? (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
          {error}
        </div>
      ) : (
        <SummaryForm chats={chats.map((c) => ({ chatId: c.chatId, displayName: c.displayName }))} />
      )}
    </div>
  )
}
