import { getReadOnlyDb } from '@/lib/db-ro'
import { getChatDetail } from '@/lib/repo-bridge'
import { formatDuration, formatRelative, formatTs, shortChatId } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ChatDetailPage({
  params,
}: {
  params: Promise<{ chatId: string }>
}) {
  const { chatId: rawChatId } = await params
  const chatId = decodeURIComponent(rawChatId)
  let detail: ReturnType<typeof getChatDetail> | null = null
  let error: string | null = null
  try {
    const sqlite = getReadOnlyDb()
    detail = getChatDetail(sqlite, chatId)
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  if (error)
    return (
      <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-900">
        {error}
      </div>
    )
  if (!detail) return null

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold">{detail.profile?.displayName ?? shortChatId(chatId)}</h2>
        <p className="text-xs font-mono text-muted-foreground">{chatId}</p>
      </header>

      {detail.profile ? (
        <section className="rounded border bg-card p-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">Languages</div>
            <div>{detail.profile.languages.join(', ')}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Engagement</div>
            <div>{detail.profile.engagementState}</div>
          </div>
          <div className="col-span-2">
            <div className="text-xs text-muted-foreground">Tone</div>
            <div className="italic">{detail.profile.toneSummary ?? '(not learned yet)'}</div>
          </div>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">No profile yet.</p>
      )}

      <FactSection title="Important" facts={detail.facts.important} />
      <FactSection title="Secondary" facts={detail.facts.secondary} />
      <FactSection title="Ephemeral" facts={detail.facts.ephemeral} />

      <section>
        <h3 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
          Recent turns ({detail.recentTurns.length})
        </h3>
        {detail.recentTurns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No turns yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th className="py-1">When</th>
                <th>Status</th>
                <th>Lang</th>
                <th>Facts</th>
                <th>Duration</th>
                <th>Trigger</th>
              </tr>
            </thead>
            <tbody>
              {detail.recentTurns.map((t) => (
                <tr key={t.id} className="border-t">
                  <td className="py-1" title={formatTs(t.ts)}>
                    {formatRelative(t.ts)}
                  </td>
                  <td>{t.status}</td>
                  <td>{t.languageUsed ?? '-'}</td>
                  <td>{t.factsExtracted}</td>
                  <td>{formatDuration(t.durationMs)}</td>
                  <td>{t.triggeredBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
          Recent escalations ({detail.recentEscalations.length})
        </h3>
        {detail.recentEscalations.length === 0 ? (
          <p className="text-sm text-muted-foreground">None.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {detail.recentEscalations.map((e) => (
              <li key={e.id} className="rounded border bg-card p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-mono">
                    #{e.id} {e.reason}/{e.urgency}
                  </span>
                  <span className="text-xs text-muted-foreground">{e.status}</span>
                </div>
                <div>{e.summary}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {formatRelative(e.createdAt)} (channels: {e.notifiedChannels.join(', ') || 'none'})
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
          Recent messages ({detail.recentMessages.length})
        </h3>
        {detail.recentMessages.length === 0 ? (
          <p className="text-sm text-muted-foreground">No messages yet.</p>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left">
                <th className="py-1">When</th>
                <th>Direction</th>
                <th>Msg id</th>
              </tr>
            </thead>
            <tbody>
              {detail.recentMessages.slice(-50).reverse().map((m) => (
                <tr key={m.whatsappMsgId} className="border-t">
                  <td className="py-1" title={formatTs(m.ts)}>
                    {formatRelative(m.ts)}
                  </td>
                  <td>{m.direction}</td>
                  <td className="font-mono">{m.whatsappMsgId.slice(0, 24)}…</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function FactSection({ title, facts }: { title: string; facts: { id: number; content: string; confidence: number; createdAt: number }[] }) {
  return (
    <section>
      <h3 className="text-sm font-semibold uppercase text-muted-foreground mb-2">
        {title} ({facts.length})
      </h3>
      {facts.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {facts.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-4">
              <span>{f.content}</span>
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                conf {f.confidence.toFixed(2)} • {formatRelative(f.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
