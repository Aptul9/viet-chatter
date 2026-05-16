'use client'

import { useEffect, useState } from 'react'

interface ProposedAction {
  id: number
  type: string
  payload: unknown
  preview: string
  isReadOnly: boolean
}

interface AgentTurn {
  prompt: string
  thinking: string | null
  clarificationNeeded: string | null
  actions: ProposedAction[]
  results: Record<number, { success: boolean; message: string; data?: unknown }>
  error: string | null
}

function genSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

export function AgentChat() {
  const [sessionId] = useState<string>(() => genSessionId())
  const [input, setInput] = useState<string>('')
  const [history, setHistory] = useState<AgentTurn[]>([])
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    // Auto-execute read-only actions for the latest turn that has any.
    const last = history[history.length - 1]
    if (!last) return
    const pendingReadOnly = last.actions.filter(
      (a) => a.isReadOnly && last.results[a.id] === undefined
    )
    if (pendingReadOnly.length === 0) return
    void Promise.all(pendingReadOnly.map((a) => executeOne(a.id)))
    // executeOne is stable-ish; this effect runs once per new turn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.length])

  async function submitPrompt(e: React.FormEvent) {
    e.preventDefault()
    const prompt = input.trim()
    if (!prompt || loading) return
    setInput('')
    setLoading(true)
    try {
      const res = await fetch('/api/dashboard/agent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId, prompt }),
      })
      const json = (await res.json()) as {
        thinking?: string
        clarificationNeeded?: string | null
        actions?: ProposedAction[]
        error?: string
      }
      if (!res.ok) {
        setHistory((h) => [
          ...h,
          {
            prompt,
            thinking: null,
            clarificationNeeded: null,
            actions: [],
            results: {},
            error: json.error ?? `HTTP ${res.status}`,
          },
        ])
      } else {
        setHistory((h) => [
          ...h,
          {
            prompt,
            thinking: json.thinking ?? null,
            clarificationNeeded: json.clarificationNeeded ?? null,
            actions: json.actions ?? [],
            results: {},
            error: null,
          },
        ])
      }
    } catch (err) {
      setHistory((h) => [
        ...h,
        {
          prompt,
          thinking: null,
          clarificationNeeded: null,
          actions: [],
          results: {},
          error: err instanceof Error ? err.message : String(err),
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  async function executeOne(actionId: number) {
    try {
      const res = await fetch('/api/dashboard/agent/execute', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actionId, confirm: true }),
      })
      const json = (await res.json()) as {
        success?: boolean
        message?: string
        data?: unknown
        error?: string
      }
      setHistory((h) =>
        h.map((turn) => ({
          ...turn,
          results: turn.actions.some((a) => a.id === actionId)
            ? {
                ...turn.results,
                [actionId]: res.ok
                  ? { success: json.success ?? false, message: json.message ?? '', data: json.data }
                  : { success: false, message: json.error ?? `HTTP ${res.status}` },
              }
            : turn.results,
        }))
      )
    } catch (err) {
      setHistory((h) =>
        h.map((turn) => ({
          ...turn,
          results: turn.actions.some((a) => a.id === actionId)
            ? {
                ...turn.results,
                [actionId]: {
                  success: false,
                  message: err instanceof Error ? err.message : String(err),
                },
              }
            : turn.results,
        }))
      )
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
        {history.map((turn, i) => (
          <div key={i} className="space-y-2 border-b pb-4 last:border-b-0">
            <div className="rounded bg-muted px-3 py-2 text-sm">
              <span className="text-xs uppercase text-muted-foreground">You</span>
              <div>{turn.prompt}</div>
            </div>
            {turn.error && (
              <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
                {turn.error}
              </div>
            )}
            {turn.thinking && (
              <div className="rounded bg-card px-3 py-2 text-sm italic text-muted-foreground">
                {turn.thinking}
              </div>
            )}
            {turn.clarificationNeeded && (
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {turn.clarificationNeeded}
              </div>
            )}
            {turn.actions.map((a) => (
              <div key={a.id} className="rounded border bg-card p-3 text-sm space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-mono">{a.type}</span>
                    {a.isReadOnly && (
                      <span className="text-xs text-muted-foreground">(read-only, auto)</span>
                    )}
                  </div>
                  {!a.isReadOnly && turn.results[a.id] === undefined && (
                    <button
                      type="button"
                      onClick={() => void executeOne(a.id)}
                      className="rounded bg-foreground text-background px-3 py-1 text-xs font-medium"
                    >
                      Confirm + execute
                    </button>
                  )}
                </div>
                <div>{a.preview}</div>
                <pre className="rounded bg-muted px-2 py-1 text-xs overflow-x-auto">
                  {JSON.stringify(a.payload, null, 2)}
                </pre>
                {turn.results[a.id] && (
                  <div
                    className={`rounded px-2 py-1 text-xs ${
                      turn.results[a.id].success
                        ? 'bg-green-50 text-green-900 border border-green-300'
                        : 'bg-red-50 text-red-900 border border-red-300'
                    }`}
                  >
                    {turn.results[a.id].message}
                    {turn.results[a.id].data ? (
                      <pre className="mt-1 overflow-x-auto">
                        {JSON.stringify(turn.results[a.id].data, null, 2)}
                      </pre>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      <form onSubmit={submitPrompt} className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="es. manda 'tanti auguri Maria' il 15 maggio alle 9"
          className="flex-1 rounded border bg-background px-3 py-2 text-sm"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded bg-foreground text-background px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {loading ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
