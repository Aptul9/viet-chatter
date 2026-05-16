'use client'

import { useState } from 'react'

interface ChatOption {
  chatId: string
  displayName: string | null
}

export function SummaryForm({ chats }: { chats: ChatOption[] }) {
  const [chatId, setChatId] = useState<string>(chats[0]?.chatId ?? '')
  const [days, setDays] = useState<number>(7)
  const [loading, setLoading] = useState<boolean>(false)
  const [summary, setSummary] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!chatId) return
    setLoading(true)
    setError(null)
    setSummary('')
    try {
      const res = await fetch('/api/dashboard/summary', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chatId, days }),
      })
      const json = (await res.json()) as { summary?: string; error?: string; details?: unknown }
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`)
      } else {
        setSummary(json.summary ?? '')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="flex gap-4 items-end">
        <label className="flex flex-col gap-1 text-sm flex-1">
          <span className="text-muted-foreground">Chat</span>
          <select
            value={chatId}
            onChange={(e) => setChatId(e.target.value)}
            className="rounded border bg-background px-3 py-2"
          >
            {chats.map((c) => (
              <option key={c.chatId} value={c.chatId}>
                {c.displayName ? `${c.displayName} (${c.chatId})` : c.chatId}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm w-32">
          <span className="text-muted-foreground">Days</span>
          <input
            type="number"
            min={1}
            max={30}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="rounded border bg-background px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={loading || !chatId}
          className="rounded bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? 'Generating…' : 'Generate'}
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          {error}
        </div>
      )}
      {summary && (
        <pre className="whitespace-pre-wrap rounded border bg-card p-4 text-sm font-sans">
          {summary}
        </pre>
      )}
    </form>
  )
}
