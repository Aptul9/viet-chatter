'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ProposedAction {
  id: number
  type: string
  payload: unknown
  preview: string
  isReadOnly: boolean
}

interface ActionResult {
  success: boolean
  message: string
  data?: unknown
}

interface AgentTurn {
  prompt: string
  thinking: string | null
  clarificationNeeded: string | null
  actions: ProposedAction[]
  results: Record<number, ActionResult>
  error: string | null
  // True between API call start and response — used to render the typing dots.
  pending: boolean
}

function genSessionId(): string {
  return `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

/** Pulls a markdown summary out of a summarizeChat result, which the bot
 * either returns as a `{summary: string}` object or — on error — a plain
 * string error message. Returns null when the result isn't markdown-ish. */
function asSummaryMarkdown(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) return null
  const s = (data as { summary?: unknown }).summary
  if (typeof s !== 'string' || s.trim().length === 0) return null
  return s
}

export function AgentChat() {
  const [sessionId] = useState<string>(genSessionId)
  const [input, setInput] = useState<string>('')
  const [history, setHistory] = useState<AgentTurn[]>([])
  const [loading, setLoading] = useState<boolean>(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const last = history[history.length - 1]
    if (!last) return
    const pendingReadOnly = last.actions.filter(
      (a) => a.isReadOnly && last.results[a.id] === undefined
    )
    if (pendingReadOnly.length === 0) return
    void Promise.all(pendingReadOnly.map((a) => executeOne(a.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [history.length])

  useEffect(() => {
    // Auto-scroll to bottom on new turn / new result.
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [history])

  async function submitPrompt(e: React.FormEvent) {
    e.preventDefault()
    const prompt = input.trim()
    if (!prompt || loading) return
    setInput('')
    setLoading(true)
    const turnIdx = history.length
    setHistory((h) => [
      ...h,
      {
        prompt,
        thinking: null,
        clarificationNeeded: null,
        actions: [],
        results: {},
        error: null,
        pending: true,
      },
    ])
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
        details?: unknown
      }
      setHistory((h) =>
        h.map((turn, i) =>
          i === turnIdx
            ? {
                ...turn,
                pending: false,
                thinking: res.ok ? (json.thinking ?? null) : null,
                clarificationNeeded: res.ok ? (json.clarificationNeeded ?? null) : null,
                actions: res.ok ? (json.actions ?? []) : [],
                error: res.ok ? null : (json.error ?? `HTTP ${res.status}`),
              }
            : turn
        )
      )
    } catch (err) {
      setHistory((h) =>
        h.map((turn, i) =>
          i === turnIdx
            ? {
                ...turn,
                pending: false,
                error: err instanceof Error ? err.message : String(err),
              }
            : turn
        )
      )
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
                  ? {
                      success: json.success ?? false,
                      message: json.message ?? '',
                      data: json.data,
                    }
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
    <div className="flex flex-col h-[calc(100vh-200px)] min-h-[400px]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-2 py-4 space-y-6">
        {history.length === 0 && (
          <div className="text-center text-sm text-muted-foreground mt-12">
            <p>Tell the agent what you want done.</p>
            <p className="text-xs mt-2">
              Read-only requests (summaries, lists) auto-run. Write actions require Confirm.
            </p>
          </div>
        )}
        {history.map((turn, i) => (
          <TurnView key={i} turn={turn} onConfirm={(id) => void executeOne(id)} />
        ))}
      </div>

      <form
        onSubmit={submitPrompt}
        className="flex gap-2 border-t pt-3 mt-2 bg-background sticky bottom-0"
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="es. manda 'tanti auguri Maria' il 15 maggio alle 9"
          className="flex-1 rounded-lg border bg-background px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-foreground/20"
          disabled={loading}
          autoFocus
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-lg bg-foreground text-background px-5 py-2.5 text-sm font-medium disabled:opacity-40 hover:opacity-90 transition"
        >
          {loading ? '…' : 'Send'}
        </button>
      </form>
    </div>
  )
}

function TurnView({ turn, onConfirm }: { turn: AgentTurn; onConfirm: (id: number) => void }) {
  return (
    <div className="space-y-3">
      <Bubble side="right">
        <div className="whitespace-pre-wrap">{turn.prompt}</div>
      </Bubble>

      {turn.pending ? (
        <Bubble side="left">
          <TypingDots />
        </Bubble>
      ) : (
        <Bubble side="left">
          {turn.error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">
              <span className="font-medium">Error:</span> {turn.error}
            </div>
          )}

          {turn.thinking && (
            <p className="text-xs italic text-muted-foreground mb-2">{turn.thinking}</p>
          )}

          {turn.clarificationNeeded && (
            <div className="text-sm border-l-2 border-amber-400 bg-amber-50 px-3 py-2 rounded-r">
              {turn.clarificationNeeded}
            </div>
          )}

          {turn.actions.length === 0 && !turn.error && !turn.clarificationNeeded && !turn.thinking && (
            <p className="text-sm text-muted-foreground italic">(no actions proposed)</p>
          )}

          <div className="space-y-3">
            {turn.actions.map((a) => (
              <ActionCard
                key={a.id}
                action={a}
                result={turn.results[a.id]}
                onConfirm={() => onConfirm(a.id)}
              />
            ))}
          </div>
        </Bubble>
      )}
    </div>
  )
}

function ActionCard({
  action,
  result,
  onConfirm,
}: {
  action: ProposedAction
  result: ActionResult | undefined
  onConfirm: () => void
}) {
  const [showDetails, setShowDetails] = useState<boolean>(false)
  const summary = result?.success ? asSummaryMarkdown(result.data) : null

  return (
    <div className="rounded-lg border bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-3 py-2 bg-muted/40 border-b">
        <div className="flex items-center gap-2 min-w-0">
          <span className="rounded bg-foreground/10 px-2 py-0.5 text-xs font-mono shrink-0">
            {action.type}
          </span>
          {action.isReadOnly ? (
            <span className="text-[11px] text-muted-foreground shrink-0">read-only · auto</span>
          ) : result === undefined ? (
            <span className="text-[11px] text-amber-700 shrink-0">requires confirm</span>
          ) : null}
        </div>
        {!action.isReadOnly && result === undefined && (
          <button
            type="button"
            onClick={onConfirm}
            className="rounded bg-foreground text-background px-3 py-1 text-xs font-medium hover:opacity-90 shrink-0"
          >
            Confirm
          </button>
        )}
      </div>

      <div className="px-3 py-2 text-sm">{action.preview}</div>

      {result && (
        <div
          className={`px-3 py-2 border-t text-sm ${
            result.success
              ? 'bg-green-50/50 border-green-200'
              : 'bg-red-50/50 border-red-200 text-red-900'
          }`}
        >
          {summary ? (
            <div className="prose prose-sm max-w-none prose-headings:font-semibold prose-headings:mt-2 prose-headings:mb-1 prose-p:my-1 prose-ul:my-1 prose-li:my-0">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{summary}</ReactMarkdown>
            </div>
          ) : (
            <div className="space-y-1">
              <div>{result.message || (result.success ? 'OK' : 'Failed')}</div>
              {result.data !== undefined && result.data !== null && (
                <pre className="text-xs bg-background/60 rounded p-2 overflow-x-auto">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      <details
        className="border-t bg-muted/20"
        open={showDetails}
        onToggle={(e) => setShowDetails((e.target as HTMLDetailsElement).open)}
      >
        <summary className="px-3 py-1.5 text-[11px] text-muted-foreground cursor-pointer select-none hover:text-foreground">
          {showDetails ? 'Hide' : 'Show'} payload
        </summary>
        <pre className="text-[11px] bg-background/60 rounded mx-3 mb-3 mt-1 p-2 overflow-x-auto">
          {JSON.stringify(action.payload, null, 2)}
        </pre>
      </details>
    </div>
  )
}

function Bubble({ side, children }: { side: 'left' | 'right'; children: React.ReactNode }) {
  const isRight = side === 'right'
  return (
    <div className={`flex ${isRight ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
          isRight
            ? 'bg-foreground text-background rounded-tr-sm'
            : 'bg-muted text-foreground rounded-tl-sm'
        }`}
      >
        {children}
      </div>
    </div>
  )
}

function TypingDots() {
  return (
    <div className="flex gap-1 py-1.5">
      <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-1.5 h-1.5 rounded-full bg-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
    </div>
  )
}
