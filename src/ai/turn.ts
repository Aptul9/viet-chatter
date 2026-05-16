// Per-turn AI invocation: load prompt template, inject context, call AI,
// extract JSON, zod-validate, retry on parse fail.
// See docs/dev/07-ai-integration.md.

import { promises as fs } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { z } from 'zod'
import { callAiApi } from './router.js'
import { config } from '../config/index.js'
import { log } from '../log.js'
import { PROMPT_DIR } from '../config/constants.js'

const CONTEXT_TOKEN = '{{CONTEXT}}'

export const ExtractedFactSchema = z.object({
  tier: z.enum(['important', 'secondary', 'ephemeral']),
  content: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  ttl_days: z.number().int().positive().optional(),
  supersedes_id: z.number().int().positive().optional(),
  anchor_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$|^\d{2}-\d{2}$/)
    .optional(),
  anchor_recurring: z.literal('yearly').nullable().optional(),
  anchor_action: z.string().optional(),
})

export const EscalateToHumanSchema = z.object({
  reason: z.enum(['scheduling', 'commitment', 'sensitive', 'financial', 'identity', 'other']),
  urgency: z.enum(['low', 'normal', 'high']),
  summary: z.string().min(1).max(500),
  suggested_holding_reply: z.string().nullable(),
})

export const ReviveHintSchema = z.object({
  attempt_in_minutes: z.number().int().positive(),
  context: z.string(),
})

export const TurnOutputSchema = z.object({
  reply: z.string(),
  skip: z.boolean(),
  extracted_facts: z.array(ExtractedFactSchema),
  tone_update: z.string().nullable(),
  languages_update: z.array(z.string()).nullable(),
  language_used: z.string(),
  revive_hint: ReviveHintSchema.nullable(),
  escalate_to_human: EscalateToHumanSchema.nullable(),
})

export type TurnOutput = z.infer<typeof TurnOutputSchema>

let cachedTemplate: string | null = null

async function loadAndCombinePrompts(dir: string): Promise<string> {
  if (cachedTemplate) return cachedTemplate
  const abs = resolvePath(process.cwd(), dir)
  const entries = await fs.readdir(abs)
  const files = entries.filter((f) => f.endsWith('.txt')).sort()
  const parts: string[] = []
  for (const f of files) {
    const body = await fs.readFile(resolvePath(abs, f), 'utf8')
    parts.push(body)
  }
  cachedTemplate = parts.join('\n\n---\n\n')
  return cachedTemplate
}

function extractJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced && fenced[1]) return fenced[1].trim()
  return s.trim()
}

export async function generateTurn<TCtx>(
  ctx: TCtx,
  signal?: AbortSignal
): Promise<TurnOutput | null> {
  const template = await loadAndCombinePrompts(PROMPT_DIR)
  const serialized = JSON.stringify(ctx, null, 2)
  const finalPrompt = template.includes(CONTEXT_TOKEN)
    ? template.replace(CONTEXT_TOKEN, serialized)
    : `${template}\n\n${serialized}`

  const maxAttempts = 1 + config.aiMaxRetryParseFail
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) return null
    const raw = await callAiApi(finalPrompt, 'turn', signal)
    if (!raw) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(extractJson(raw))
    } catch (err) {
      log.warn({ attempt, err: (err as Error).message }, 'AI output JSON parse failed')
      continue
    }

    const validated = TurnOutputSchema.safeParse(parsed)
    if (validated.success) return validated.data
    log.warn({ attempt, errors: validated.error.flatten() }, 'AI output schema invalid, retrying')
  }
  return null
}
