# AI integration

> Status: design; behavior implemented. Default model is now `opencode:github-copilot/gpt-5-mini` (was `claude-sonnet-4-6`). `OPENCODE_DISABLE_DEFAULT_PLUGINS` must stay `false`.

## Philosophy

Single-call per turn: a single AI invocation produces reply, extracted_facts, tone_update, languages_update. No separate calls for extraction (would double costs and latency).

Output enforced JSON via prompt engineering, parsing + zod validation on the bot side. No JSON-mode API (not available on all OpenCode backends).

## Backend in v1: OpenCode only

Security configuration inherited 1:1 from `linkedin-autoapply`:

### `opencode.json` (project root)

Identical copy:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "permission": "allow",
  "plugin": ["opencode-gemini-auth@latest", "@khalilgharbaoui/opencode-claude-code-plugin@latest"],
  "provider": {
    "anthropic": {
      "options": {
        "baseURL": "http://127.0.0.1:3456",
        "apiKey": "x"
      }
    }
  },
  "agent": {
    "direct-reply": {
      "description": "Programmatic single-shot agent. Reply to the prompt only, no tools, no file access.",
      "mode": "primary",
      "prompt": "You are a single-shot answer engine. Reply only to the user's prompt. Do not read files. Do not call tools. Do not ask for permissions. Output the answer text only.",
      "permission": {
        "read": "deny",
        "edit": "deny",
        "bash": "deny",
        "glob": "deny",
        "grep": "deny",
        "task": "deny",
        "skill": "deny",
        "webfetch": "deny",
        "websearch": "deny",
        "external_directory": "deny"
      }
    }
  }
}
```

### Security constraints

The `direct-reply` agent with all permissions set to `deny` is a **tested security dependency**. Changes to this block require separate validation, they are not routine updates.

Without the `deny`, OpenCode would attempt to:

- Connect to any MCP servers registered in the user's system.
- Read `CLAUDE.md` / `AGENTS.md` / `OPENCODE.md` / custom instructions from cwd and parents.
- Load default plugins that can trigger tool use, file write, websearch.
- Expose the bot to accidental code execution from the LLM.

Even though the agent prompt says "single-shot answer engine", without permissions denied at config level some LLMs still attempt tool use. The `deny`s are the real security mechanism.

### `src/ai/opencode.ts`

1:1 copy of `src/models/cli/opencodeCli.ts` from `linkedin-autoapply`. Exposes:

```ts
export async function callOpencodeCli(
  prompt: string,
  logPrefix: string,
  model: OpencodeAiModel, // format: "opencode:provider/modelId" or "opencode/provider/modelId"
  signal?: AbortSignal
): Promise<string | undefined>

export async function ensureOpencodeServer(logPrefix: string): Promise<void>
export async function stopOpencodeServer(): Promise<void>
export function isOpencodeAiModel(model: string): model is OpencodeAiModel
```

The module handles:

- Auto-start of OpenCode server (`opencode serve`) when needed.
- Health check.
- Find free port if the default is occupied.
- Session create + message + abort + delete.
- Environment variables to disable claude-code wrapper and default plugins.

### `src/ai/router.ts`

Minimal wrapper above `callOpencodeCli`. In v1 has only one backend. Defined to be extensible in the future.

```ts
import { callOpencodeCli, ensureOpencodeServer } from './opencode'

const DEFAULT_MODEL: OpencodeAiModel = 'opencode:anthropic/claude-sonnet-4-6'

export async function callAiApi(
  prompt: string,
  logPrefix: string = 'AI',
  signal?: AbortSignal
): Promise<string | undefined> {
  await ensureOpencodeServer(logPrefix)
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const result = await callOpencodeCli(prompt, `${logPrefix}/OpenCode`, DEFAULT_MODEL, signal)
      if (result) return result
    } catch (err) {
      log.error({ err, attempt }, 'AI call failed')
    }
    if (signal?.aborted) return undefined
    await new Promise((r) => setTimeout(r, 5000))
  }
  return undefined
}
```

`DEFAULT_MODEL` is configurable in `config/index.ts` (e.g. `aiModel: 'opencode:anthropic/claude-sonnet-4-6'`).

### `src/ai/turn.ts`

Application layer: build prompt, call, parse, validate.

````ts
export async function generateTurn(
  ctx: TurnContext,
  signal?: AbortSignal
): Promise<TurnOutput | null> {
  const base = loadAndCombinePrompts('prompts/turn')
  const finalPrompt = base.replace('{{CONTEXT}}', JSON.stringify(ctx, null, 2))

  for (let attempt = 1; attempt <= 1 + config.aiMaxRetryParseFail; attempt++) {
    if (signal?.aborted) return null
    const raw = await callAiApi(finalPrompt, 'turn', signal)
    if (!raw) continue
    const json = extractJson(raw)
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      continue
    }
    const validated = TurnOutputSchema.safeParse(parsed)
    if (validated.success) return validated.data
    log.warn({ errors: validated.error.errors }, 'AI output schema invalid, retrying')
  }
  return null
}

function extractJson(s: string): string {
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1].trim()
  return s.trim()
}
````

## TurnContext schema

```ts
export interface TurnContext {
  personId: string
  personLanguages: string[]
  personDisplayName: string | null
  toneSummary: string | null
  recentMessages: Array<{ direction: 'in' | 'out_manual' | 'out_bot'; body: string; ts: number }>
  kb: { important: string[]; ephemeral: string[]; secondary: string[] }
  nowIso: string // ISO8601 with user tz
  manualJobContext?: {
    // present only if invoked by manual_job fire
    kind: 'date_anchored' | 'revive' | 're_engage'
    hint: string
  }
}
```

## TurnOutput schema (zod)

```ts
const TurnOutputSchema = z.object({
  reply: z.string(),
  skip: z.boolean(),
  extracted_facts: z.array(
    z.object({
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
  ),
  tone_update: z.string().nullable(),
  languages_update: z.array(z.string()).nullable(),
  language_used: z.string(), // language used in this reply, for log
  revive_hint: z
    .object({
      attempt_in_minutes: z.number().int().positive(),
      context: z.string(),
    })
    .nullable(),
  escalate_to_human: z
    .object({
      reason: z.enum(['scheduling', 'commitment', 'sensitive', 'financial', 'identity', 'other']),
      urgency: z.enum(['low', 'normal', 'high']),
      summary: z.string().min(1).max(500),
      suggested_holding_reply: z.string().nullable(),
    })
    .nullable(),
})
export type TurnOutput = z.infer<typeof TurnOutputSchema>
```

See `18-escalation.md` for the complete flow of `escalate_to_human` handling and the criteria used by the AI to emit it.

## Prompt structure

Folder `prompts/turn/`, numbered `.txt` files:

| File                      | Content                                                                                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `00_role.txt`             | Role: AI ghostwriter of WhatsApp chats on behalf of a user. Single-shot, no tool.                                                                        |
| `01_persona_kb.txt`       | KB schema (3 tier). How to use it.                                                                                                                       |
| `02_tone_guidance.txt`    | Adapt tone based on `toneSummary` + message sentiment. Conservative.                                                                                     |
| `03_language_rules.txt`   | Pick from `personLanguages`. Adapt per turn. Suggest `languages_update` only if consistent drift.                                                        |
| `04_extraction_rules.txt` | Tier rules (important/secondary/ephemeral). Anti-duplicate. Use `supersedes_id`. Anchor date format.                                                     |
| `05_revive_and_skip.txt`  | When to emit `revive_hint`. When to set `skip: true`.                                                                                                    |
| `06_escalation_rules.txt` | When to emit `escalate_to_human` (reason categories, urgency levels, engagement criteria, rules on `suggested_holding_reply`, conflict with `reply`).    |
| `07_output_schema.txt`    | Exact JSON schema. Output ONLY JSON. No prose, no fences (but the bot strips them anyway).                                                               |
| `08_examples.txt`         | Few-shot: 3-4 complete input/output examples, of which at least one with escalation.                                                                     |
| `99_context_template.txt` | `{{CONTEXT}}` placeholder.                                                                                                                               |

Concatenated via `loadAndCombinePrompts` (reused from linkedin-autoapply).

### Specific notes for `06_escalation_rules.txt`

Key content of the file:

- **When to escalate**: scheduling with future dates/times, commitment (favors, loans, visits), sensitive (bereavements, illnesses, recent conflicts), financial, identity (strong opinions not in KB), other (any case where "guessing" risks committing the user or hurting the person).
- **When NOT to escalate**: pleasantries, info in KB, continuations of already-clarified threads, sticker / emoji / non-text.
- **Conflict rule**: if you set `escalate_to_human` non-null, leave `reply` empty or use only `suggested_holding_reply`. The bot discards any simultaneous `reply`.
- **Holding reply language**: if set, it must be in the language chosen for the person (`language_used`).
- **Urgency**: `high` only if the person needs a reply within minutes ("I'm coming to your place in 10 min, will you open?"). `normal` by default. `low` for things that can be deferred (in v1 treated as normal).
- **Summary**: 1-3 sentences describing what they're asking and why I can't answer. In Italian (the summary is readable by the user, not by the person).

## Token budget

- `recentMessages` cap at 30 (config: `aiHistoryLimit`).
- Typical message bodies 50-200 chars -> ~6KB chat history.
- Typical KB: 5-15 important, 5-10 ephemeral, 8 secondary -> ~3KB.
- Base prompt (template + schema + examples): ~3KB.
- Typical total: ~12KB -> ~3-4K token. Below any reasonable limit.

Safety cap:

- If context > 6K token, trim `recentMessages` to 20 and `secondary` to `ragTopK / 2`.

## Retry and error handling

| Case                                               | Action                                                                                                                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenCode server doesn't start                      | App crash, manual intervention.                                                                                                                                                    |
| HTTP error 5xx                                     | Retry up to 3 times (handled in `router.ts`).                                                                                                                                      |
| Empty output                                       | Retry.                                                                                                                                                                             |
| JSON parse fail                                    | Strip code fences + retry. If fails again after aiMaxRetryParseFail, log error, return null.                                                                                       |
| zod validation fail                                | Retry once with corrected prompt. If fails again, return null.                                                                                                                     |
| AbortSignal triggered                              | Return early null, no persist no send.                                                                                                                                             |
| `signal` aborted mid-network                       | OpenCode supports session abort. The fetch is cancelled.                                                                                                                           |
| `escalate_to_human` with missing or empty `summary` | zod fails, retry. If it persists, fallback summary "AI requested escalation without providing details. Go check the chat." applied on bot side, escalation created anyway.        |
| `escalate_to_human` not null + `reply` non-empty   | Conflict resolved: the reply is discarded, only `suggested_holding_reply` (if not null) is sent. Log warn.                                                                         |

When `generateTurn` returns `null`:

- No send.
- No persist of `extracted_facts`.
- `turn_log` insert with `status='failed'`.
- `state -> IDLE`.
- No spam.
