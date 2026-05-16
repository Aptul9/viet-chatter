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
  let finalPrompt = template
  finalPrompt = finalPrompt.includes(CONTEXT_TOKEN)
    ? finalPrompt.replace(CONTEXT_TOKEN, serialized)
    : `${finalPrompt}\n\n${serialized}`
  finalPrompt = finalPrompt.includes(PROMPT_TOKEN)
    ? finalPrompt.replace(PROMPT_TOKEN, userPrompt)
    : `${finalPrompt}\n\nUser request:\n${userPrompt}`

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) return null
    const raw = await callAiApi(finalPrompt, 'agent', signal)
    if (!raw) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(extractJson(raw))
    } catch (err) {
      log.warn({ attempt, err: (err as Error).message }, 'agent JSON parse failed')
      continue
    }
    const validated = AgentOutputSchema.safeParse(parsed)
    if (validated.success) return validated.data
    log.warn({ attempt, errors: validated.error.flatten() }, 'agent schema invalid, retrying')
  }
  return null
}
