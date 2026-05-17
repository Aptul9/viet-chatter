// Spec D2 — Planning turn: user prompt + context → AgentOutput.
//
// Mirrors the structure of `src/ai/turn.ts` but with its own prompt folder
// (`prompts/agent/`) and its own schema (`AgentOutputSchema`). Retries on
// JSON parse / zod fail like the main turn.

import { callAiApi } from '../ai/router.js'
import { loadAndCombinePrompts } from '../ai/turn.js'
import { log } from '../log.js'
import { AgentOutputSchema, type AgentOutput } from './types.js'
import type { AgentContext } from './context.js'

const PROMPT_DIR = 'prompts/agent'
const MAX_ATTEMPTS = 2
const CONTEXT_TOKEN = '{{CONTEXT}}'
const PROMPT_TOKEN = '{{USER_PROMPT}}'
const HISTORY_TOKEN = '{{HISTORY}}'

/** One prior turn from the same agent session, fed back as context.
 * `payload` is optional because zod's `z.unknown()` deserializes as
 * `unknown | undefined` and we don't gain anything by forcing the caller to
 * coerce — the model rarely needs to re-read its own past payloads when the
 * preview + result already describe the action. */
export interface AgentTurnHistoryEntry {
  prompt: string
  thinking: string | null
  clarificationNeeded: string | null
  actions: Array<{
    type: string
    payload?: unknown
    preview: string
    result: { success: boolean; message: string; data?: unknown } | null
  }>
}

function extractJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced && fenced[1]) return fenced[1].trim()
  return s.trim()
}

function formatHistory(history: AgentTurnHistoryEntry[]): string {
  if (history.length === 0) return '(no prior turns in this session)'
  return history
    .map((turn, i) => {
      const parts: string[] = []
      parts.push(`--- Turn ${i + 1} ---`)
      parts.push(`Owner: ${turn.prompt}`)
      if (turn.thinking) parts.push(`Your thinking: ${turn.thinking}`)
      if (turn.clarificationNeeded)
        parts.push(`Clarification requested: ${turn.clarificationNeeded}`)
      for (const a of turn.actions) {
        parts.push(`Action: ${a.type} — ${a.preview}`)
        if (a.result) {
          const dataPreview =
            a.result.data === undefined
              ? ''
              : `\n  data: ${truncate(JSON.stringify(a.result.data), 800)}`
          parts.push(
            `Result: ${a.result.success ? 'ok' : 'fail'} — ${a.result.message}${dataPreview}`
          )
        } else {
          parts.push('Result: (no result recorded)')
        }
      }
      return parts.join('\n')
    })
    .join('\n\n')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return `${s.slice(0, max)}…[truncated, total ${s.length} chars]`
}

export async function generateAgentTurn(
  userPrompt: string,
  ctx: AgentContext,
  history: AgentTurnHistoryEntry[] = [],
  signal?: AbortSignal
): Promise<AgentOutput | null> {
  const template = await loadAndCombinePrompts(PROMPT_DIR)
  const serialized = JSON.stringify(ctx, null, 2)
  const historyBlock = formatHistory(history)
  let basePrompt = template
  basePrompt = basePrompt.includes(CONTEXT_TOKEN)
    ? basePrompt.replace(CONTEXT_TOKEN, serialized)
    : `${basePrompt}\n\n${serialized}`
  basePrompt = basePrompt.includes(HISTORY_TOKEN)
    ? basePrompt.replace(HISTORY_TOKEN, historyBlock)
    : `${basePrompt}\n\nPrior turns:\n${historyBlock}`
  basePrompt = basePrompt.includes(PROMPT_TOKEN)
    ? basePrompt.replace(PROMPT_TOKEN, userPrompt)
    : `${basePrompt}\n\nUser request:\n${userPrompt}`

  let correction: string | null = null
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) return null
    const finalPrompt = correction
      ? `${basePrompt}\n\n=== CORRECTION REQUIRED ===\n${correction}\n\nEmit the corrected JSON only.`
      : basePrompt
    const raw = await callAiApi(finalPrompt, 'agent', signal)
    if (!raw) {
      correction =
        'Your previous response was empty. Re-read the schema and emit a single valid JSON object.'
      continue
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(extractJson(raw))
    } catch (err) {
      const msg = (err as Error).message
      log.warn({ attempt, err: msg }, 'agent JSON parse failed')
      correction = `Your previous response was not valid JSON. Parser error: ${msg}\nYour raw output was:\n${raw.slice(0, 1200)}`
      continue
    }
    const validated = AgentOutputSchema.safeParse(parsed)
    if (validated.success) return validated.data
    const errors = validated.error.flatten()
    log.warn({ attempt, errors }, 'agent schema invalid, retrying')
    // Feed the structured zod errors back so the model can self-correct
    // (e.g. fireAtIso missing a timezone offset, payload missing a field).
    correction = `Your previous JSON did not match the required schema. Errors:\n${JSON.stringify(
      errors,
      null,
      2
    )}\nYour raw output was:\n${raw.slice(0, 1200)}`
  }
  return null
}
