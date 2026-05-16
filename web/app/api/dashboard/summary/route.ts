// D1: AI summary endpoint (read-only on bot DB + AI call).
//
// POST { chatId: string; days: number(1..30) }
// Returns { summary: string }

import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getReadOnlyDb } from '@/lib/db-ro'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const RequestSchema = z.object({
  chatId: z.string().min(1).max(120),
  days: z.coerce.number().int().min(1).max(30),
})

const MAX_RESPONSE_CHARS = 4000
const MAX_HISTORY_MESSAGES = 500

interface MessageForCtx {
  direction: string
  body: string
  tsIso: string
}

interface SummaryContext {
  chat: { id: string; displayName: string | null; languages: string[] }
  dateRange: { startIso: string; endIso: string; days: number }
  messages: MessageForCtx[]
  facts: { important: string[]; secondary: string[]; ephemeral: string[] }
  toneSummary: string | null
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const parsed = RequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid params', details: parsed.error.flatten() },
      { status: 400 }
    )
  }
  const { chatId, days } = parsed.data
  const now = Date.now()
  const cutoff = now - days * 24 * 60 * 60 * 1000

  let context: SummaryContext
  try {
    const sqlite = getReadOnlyDb()
    const profileRow = sqlite
      .prepare(
        'SELECT `display_name` AS displayName, `languages`, `tone_summary` AS toneSummary FROM `person_profile` WHERE `chat_id` = ?'
      )
      .get(chatId) as { displayName: string | null; languages: string; toneSummary: string | null } | undefined

    let languages: string[] = ['en']
    if (profileRow?.languages) {
      try {
        const parsedLang = JSON.parse(profileRow.languages) as unknown
        if (Array.isArray(parsedLang)) {
          languages = parsedLang.filter((x): x is string => typeof x === 'string')
        }
      } catch {
        // keep default
      }
    }

    const messages = (
      sqlite
        .prepare(
          'SELECT `direction`, `ts`, `whatsapp_msg_id` FROM `processed_messages` WHERE `chat_id` = ? AND `ts` > ? ORDER BY `ts` ASC LIMIT ?'
        )
        .all(chatId, cutoff, MAX_HISTORY_MESSAGES) as Array<{ direction: string; ts: number; whatsapp_msg_id: string }>
    ).map<MessageForCtx>((m) => ({
      direction: m.direction,
      body: '',
      tsIso: new Date(m.ts).toISOString(),
    }))
    // NOTE: processed_messages does NOT store body in v1 (privacy). The summary
    // works from timestamps + KB facts only. This is a known v1 limitation
    // documented in docs/dev/08-persistenza.md.

    const factsImportant = (
      sqlite
        .prepare(
          "SELECT `content` FROM `facts` WHERE `person_id` = ? AND `tier` = 'important' AND `superseded_by` IS NULL ORDER BY `created_at` ASC"
        )
        .all(chatId) as Array<{ content: string }>
    ).map((f) => f.content)
    const factsSecondary = (
      sqlite
        .prepare(
          "SELECT `content` FROM `facts` WHERE `person_id` = ? AND `tier` = 'secondary' AND `superseded_by` IS NULL ORDER BY `created_at` DESC LIMIT 30"
        )
        .all(chatId) as Array<{ content: string }>
    ).map((f) => f.content)
    const factsEphemeral = (
      sqlite
        .prepare(
          "SELECT `content` FROM `facts` WHERE `person_id` = ? AND `tier` = 'ephemeral' AND `superseded_by` IS NULL AND (`expires_at` IS NULL OR `expires_at` > ?) ORDER BY `created_at` DESC LIMIT 30"
        )
        .all(chatId, now) as Array<{ content: string }>
    ).map((f) => f.content)

    context = {
      chat: {
        id: chatId,
        displayName: profileRow?.displayName ?? null,
        languages,
      },
      dateRange: {
        startIso: new Date(cutoff).toISOString(),
        endIso: new Date(now).toISOString(),
        days,
      },
      messages,
      facts: {
        important: factsImportant,
        secondary: factsSecondary,
        ephemeral: factsEphemeral,
      },
      toneSummary: profileRow?.toneSummary ?? null,
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }

  // Lazy import the bot AI so the web build never bundles opencode internals
  // unless someone actually requests a summary.
  let summary: string
  try {
    const { loadAndCombinePrompts } = await import('../../../../../src/ai/turn')
    const { callAiApi } = await import('../../../../../src/ai/router')
    const template = await loadAndCombinePrompts('prompts/summary')
    const prompt = template.includes('{{CONTEXT}}')
      ? template.replace('{{CONTEXT}}', JSON.stringify(context, null, 2))
      : `${template}\n\n${JSON.stringify(context, null, 2)}`
    const raw = await callAiApi(prompt, 'summary')
    if (!raw) {
      return NextResponse.json({ error: 'AI returned no content' }, { status: 502 })
    }
    summary = raw.length > MAX_RESPONSE_CHARS ? raw.slice(0, MAX_RESPONSE_CHARS) + '\n…' : raw
  } catch (err) {
    return NextResponse.json(
      {
        error: 'summary generation failed',
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    )
  }

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify({
      msg: 'summary generated',
      chatId: chatId.slice(0, 8) + '…',
      days,
      msgCount: context.messages.length,
      responseChars: summary.length,
    })
  )
  return NextResponse.json({ summary })
}
