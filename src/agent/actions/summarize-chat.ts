// Spec D2 — Action: produce an AI summary of a chat. Read-only.
// Mirrors the logic of `web/app/api/dashboard/summary/route.ts` but reachable
// programmatically through the action registry.

import type { Sqlite } from '../../db/client.js'
import { callAiApi } from '../../ai/router.js'
import { loadAndCombinePrompts } from '../../ai/turn.js'
import type { ActionResult } from '../types.js'

const MAX_RESPONSE_CHARS = 4000

export interface SummarizeChatPayload {
  chatId: string
  days: number
}

export async function executeSummarizeChat(
  payload: SummarizeChatPayload,
  sqlite: Sqlite
): Promise<ActionResult> {
  const days = Math.max(1, Math.min(30, Math.round(payload.days)))
  const now = Date.now()
  const cutoff = now - days * 86_400_000

  const profile = sqlite
    .prepare(
      'SELECT display_name AS displayName, languages, tone_summary AS toneSummary FROM person_profile WHERE chat_id = ?'
    )
    .get(payload.chatId) as { displayName: string | null; languages: string; toneSummary: string | null } | undefined

  let languages: string[] = ['en']
  if (profile?.languages) {
    try {
      const parsed = JSON.parse(profile.languages) as unknown
      if (Array.isArray(parsed)) {
        languages = parsed.filter((x): x is string => typeof x === 'string')
      }
    } catch {
      // keep default
    }
  }

  const messages = (
    sqlite
      .prepare(
        'SELECT direction, ts FROM processed_messages WHERE chat_id = ? AND ts > ? ORDER BY ts ASC LIMIT 500'
      )
      .all(payload.chatId, cutoff) as Array<{ direction: string; ts: number }>
  ).map((m) => ({ direction: m.direction, body: '', tsIso: new Date(m.ts).toISOString() }))

  const facts = (
    sqlite
      .prepare(
        'SELECT tier, content FROM facts WHERE person_id = ? AND superseded_by IS NULL ORDER BY created_at DESC LIMIT 100'
      )
      .all(payload.chatId) as Array<{ tier: string; content: string }>
  ).reduce<{ important: string[]; secondary: string[]; ephemeral: string[] }>(
    (acc, f) => {
      if (f.tier === 'important') acc.important.push(f.content)
      else if (f.tier === 'secondary') acc.secondary.push(f.content)
      else if (f.tier === 'ephemeral') acc.ephemeral.push(f.content)
      return acc
    },
    { important: [], secondary: [], ephemeral: [] }
  )

  const context = {
    chat: { id: payload.chatId, displayName: profile?.displayName ?? null, languages },
    dateRange: { startIso: new Date(cutoff).toISOString(), endIso: new Date(now).toISOString(), days },
    messages,
    facts,
    toneSummary: profile?.toneSummary ?? null,
  }

  const template = await loadAndCombinePrompts('prompts/summary')
  const prompt = template.includes('{{CONTEXT}}')
    ? template.replace('{{CONTEXT}}', JSON.stringify(context, null, 2))
    : `${template}\n\n${JSON.stringify(context, null, 2)}`
  const raw = await callAiApi(prompt, 'agent-summary')
  if (!raw) return { success: false, message: 'AI returned no content for summary' }
  const summary = raw.length > MAX_RESPONSE_CHARS ? raw.slice(0, MAX_RESPONSE_CHARS) + '\n…' : raw
  return { success: true, message: 'Summary generated.', data: { summary } }
}
