# AI integration

## Filosofia

Single-call per turn: una sola invocazione AI produce reply, extracted_facts, tone_update, languages_update. Niente chiamate separate per estrazione (raddoppierebbe costi e latenza).

Output enforced JSON via prompt engineering, parsing + zod validation lato bot. Niente API JSON-mode (non disponibile su tutti i backend OpenCode).

## Backend in v1: solo OpenCode

Configurazione di sicurezza ereditata 1:1 da `linkedin-autoapply`:

### `opencode.json` (root del progetto)

Copia identica:

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

### Vincoli di sicurezza

L'agent `direct-reply` con tutti i permessi a `deny` è una **dipendenza di sicurezza testata**. Modifiche a questo blocco richiedono validazione separata, non sono aggiornamenti di routine.

Senza i `deny`, OpenCode tenterebbe:

- Connettersi a server MCP eventualmente registrati nel sistema dell'utente.
- Leggere `CLAUDE.md` / `AGENTS.md` / `OPENCODE.md` / istruzioni custom dalla cwd e dalle parent.
- Caricare plugin di default che possono triggerare tool use, file write, websearch.
- Esporre il bot a code execution accidentale del LLM.

Anche se il prompt dell'agent dice "single-shot answer engine", senza i permessi negati a livello di config alcuni LLM tentano comunque tool use. I `deny` sono il vero meccanismo di sicurezza.

### `src/ai/opencode.ts`

Copia 1:1 di `src/models/cli/opencodeCli.ts` da `linkedin-autoapply`. Espone:

```ts
export async function callOpencodeCli(
  prompt: string,
  logPrefix: string,
  model: OpencodeAiModel,    // formato: "opencode:provider/modelId" o "opencode/provider/modelId"
  signal?: AbortSignal
): Promise<string | undefined>

export async function ensureOpencodeServer(logPrefix: string): Promise<void>
export async function stopOpencodeServer(): Promise<void>
export function isOpencodeAiModel(model: string): model is OpencodeAiModel
```

Il modulo gestisce:

- Auto-start del server OpenCode (`opencode serve`) all'occorrenza.
- Health check.
- Find free port se quella default è occupata.
- Session create + message + abort + delete.
- Variabili d'ambiente per disabilitare claude-code wrapper e default plugins.

### `src/ai/router.ts`

Wrapper minimo sopra `callOpencodeCli`. In v1 ha un solo backend. Definito per essere estensibile in futuro (vedi `16-future-enhancements.md`).

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
    await new Promise(r => setTimeout(r, 5000))
  }
  return undefined
}
```

`DEFAULT_MODEL` è configurabile in `config/index.ts` (es. `aiModel: 'opencode:anthropic/claude-sonnet-4-6'`).

### `src/ai/turn.ts`

Layer applicativo: build prompt, call, parse, validate.

```ts
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
    try { parsed = JSON.parse(json) } catch { continue }
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
```

## TurnContext schema

```ts
export interface TurnContext {
  personId: string
  personLanguages: string[]
  personDisplayName: string | null
  toneSummary: string | null
  recentMessages: Array<{ direction: 'in' | 'out_manual' | 'out_bot'; body: string; ts: number }>
  kb: { important: string[]; ephemeral: string[]; secondary: string[] }
  nowIso: string                                // ISO8601 con tz utente
  manualJobContext?: {                          // presente solo se invocato da manual_job fire
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
  extracted_facts: z.array(z.object({
    tier: z.enum(['important','secondary','ephemeral']),
    content: z.string().min(1).max(500),
    confidence: z.number().min(0).max(1),
    ttl_days: z.number().int().positive().optional(),
    supersedes_id: z.number().int().positive().optional(),
    anchor_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$|^\d{2}-\d{2}$/).optional(),
    anchor_recurring: z.literal('yearly').nullable().optional(),
    anchor_action: z.string().optional(),
  })),
  tone_update: z.string().nullable(),
  languages_update: z.array(z.string()).nullable(),
  language_used: z.string(),                    // lingua usata in questa reply, per log
  revive_hint: z.object({
    attempt_in_minutes: z.number().int().positive(),
    context: z.string(),
  }).nullable(),
  escalate_to_human: z.object({
    reason: z.enum(['scheduling','commitment','sensitive','financial','identity','other']),
    urgency: z.enum(['low','normal','high']),
    summary: z.string().min(1).max(500),
    suggested_holding_reply: z.string().nullable(),
  }).nullable(),
})
export type TurnOutput = z.infer<typeof TurnOutputSchema>
```

Vedi `18-escalation.md` per il flusso completo di gestione di `escalate_to_human` e i criteri usati dall'AI per emetterlo.

## Prompt structure

Cartella `prompts/turn/`, file `.txt` numerati:

| File | Contenuto |
|---|---|
| `00_role.txt` | Ruolo: AI ghostwriter di chat WhatsApp per conto di un utente. Single-shot, no tool. |
| `01_persona_kb.txt` | Schema KB (3 tier). Come usarlo. |
| `02_tone_guidance.txt` | Adapt tone basato su `toneSummary` + sentiment del messaggio. Conservativo. |
| `03_language_rules.txt` | Scegli da `personLanguages`. Adatta per turn. Suggerisci `languages_update` solo se drift consistente. |
| `04_extraction_rules.txt` | Regole tier (important/secondary/ephemeral). Anti-duplicate. Use `supersedes_id`. Anchor date format. |
| `05_revive_and_skip.txt` | Quando emettere `revive_hint`. Quando settare `skip: true`. |
| `06_escalation_rules.txt` | Quando emettere `escalate_to_human` (categorie reason, livelli urgency, criteri di ingaggio, regole su `suggested_holding_reply`, conflict con `reply`). |
| `07_output_schema.txt` | Schema JSON esatto. Output ONLY JSON. No prose, no fences (ma il bot li striscia comunque). |
| `08_examples.txt` | Few-shot: 3-4 esempi input/output completi, di cui almeno uno con escalation. |
| `99_context_template.txt` | `{{CONTEXT}}` placeholder. |

Concatenati via `loadAndCombinePrompts` (riusato da linkedin-autoapply).

### Note specifiche per `06_escalation_rules.txt`

Contenuto chiave del file:

- **Quando escalare**: scheduling con date/orari futuri, commitment (favori, prestiti, visite), sensitive (lutti, malattie, conflitti recenti), financial, identity (opinioni forti non nel KB), other (qualunque caso dove "tirare a indovinare" rischia di impegnare l'utente o ferire la persona).
- **Quando NON escalare**: convenevoli, info nel KB, continuazioni di thread già chiariti, sticker / emoji / non-text.
- **Conflict rule**: se setti `escalate_to_human` non-null, lascia `reply` vuoto o usa solo `suggested_holding_reply`. Il bot scarta eventuali `reply` simultanee.
- **Holding reply linguaggio**: se viene impostato, dev'essere nella lingua scelta per la persona (`language_used`).
- **Urgency**: `high` solo se la persona necessita risposta entro minuti ("vengo da te tra 10 min, mi apri?"). `normal` di default. `low` per cose dilazionabili (in v1 trattata come normal).
- **Summary**: 1-3 frasi che descrivono cosa chiede e perchè non posso rispondere. In italiano (la summary è leggibile dall'utente, non dalla persona).

## Token budget

- `recentMessages` cap a 30 (config: `aiHistoryLimit`).
- Body messaggi tipici 50-200 chars -> ~6KB chat history.
- KB tipica: 5-15 important, 5-10 ephemeral, 8 secondary -> ~3KB.
- Prompt base (template + schema + examples): ~3KB.
- Totale tipico: ~12KB -> ~3-4K token. Sotto qualunque limite ragionevole.

Cap di sicurezza:
- Se context > 6K token, taglia `recentMessages` a 20 e `secondary` a `ragTopK / 2`.

## Retry e error handling

| Caso | Azione |
|---|---|
| OpenCode server non parte | Crash app, intervento manuale. |
| HTTP error 5xx | Retry up to 3 volte (gestito in `router.ts`). |
| Output empty | Retry. |
| JSON parse fail | Strip code fences + retry. Se di nuovo fail dopo aiMaxRetryParseFail, log error, return null. |
| zod validation fail | Retry una volta con prompt corretto. Se di nuovo fail, return null. |
| AbortSignal triggered | Return early null, niente persist niente send. |
| `signal` aborted mid-network | OpenCode supporta abort della session. La fetch viene cancellata. |
| `escalate_to_human` con `summary` mancante o vuota | zod fallisce, retry. Se persiste, fallback summary "AI ha richiesto escalation senza fornire dettagli. Vai a controllare la chat." applicata lato bot, escalation creata comunque. |
| `escalate_to_human` non null + `reply` non vuoto | Conflict resolved: la reply viene scartata, solo `suggested_holding_reply` (se non null) viene inviato. Log warn. |

Quando `generateTurn` ritorna `null`:
- Niente send.
- Niente persist `extracted_facts`.
- `turn_log` insert con `status='failed'`.
- `state -> IDLE`.
- No spam.
