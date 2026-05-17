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

function extractJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced && fenced[1]) return fenced[1].trim()
  return s.trim()
}

export async function generateAgentTurn(
  userPrompt: string,
  ctx: AgentContext,
  signal?: AbortSignal
): Promise<AgentOutput | null> {
  const template = await loadAndCombinePrompts(PROMPT_DIR)
  const serialized = JSON.stringify(ctx, null, 2)
  let basePrompt = template
  basePrompt = basePrompt.includes(CONTEXT_TOKEN)
    ? basePrompt.replace(CONTEXT_TOKEN, serialized)
    : `${basePrompt}\n\n${serialized}`
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
      correction = 'Your previous response was empty. Re-read the schema and emit a single valid JSON object.'
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
