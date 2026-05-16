# Spec D2 — AI command channel (write-capable)

Data: 2026-05-16.
Status: approved (brainstorm 2026-05-16) — autorizzato dall'utente nonostante warning sicurezza.
Lingua: italiano (prosa) + english (technical terms).

## Scopo

Aggiungere alla web UI un canale di chat con l'AI che traduce richieste naturali dell'utente in azioni strutturate eseguite sul bot, esempi:

- "manda 'tanti auguri' a Maria il 15 maggio" → insert in `manual_jobs` (kind=`date_anchored`)
- "tell me what Maria did this week" → equivalente a Spec D1 summary (read-only, riusa pipeline)
- "dismiss l'escalation #42" → update `escalations.status = 'dismissed'`
- "cancella tutti i revive job pending per +84xxx" → update `manual_jobs.status = 'cancelled'`
- "ferma il bot per 2 ore su questa chat" → temporary block via `person_profile` flag (TBD se aggiungere campo)

Estende Spec C (dashboard read-only) con una scrittura DB controllata dall'AI.

## Warning sicurezza (acknowledged)

Questa feature scrive sul DB del bot a partire da input utente parsato da LLM. Mitigazioni:

1. **Binding strict localhost**. Next.js dev bind di default `0.0.0.0`. Per D2, override forzato a `127.0.0.1`. Se l'utente vuole esporre la UI in rete (NAT, port-forward), deve modificare codice esplicito + accettare rischio.
2. **No remote/cloud auth**. Nessuna sessione, nessun cookie. Si fida che chi accede a `localhost:3000` sia l'utente.
3. **Action whitelist**. L'AI puo' emettere solo azioni in un enum chiuso (`AgentActionType`). Output strutturato zod-validated. Mai eval / mai SQL libero / mai shell.
4. **Confirmation step**: per ogni azione write, UI mostra preview + bottone Confirm prima di eseguire. AI puo' solo PROPORRE, non eseguire direttamente.
5. **Audit log**. Ogni esecuzione scrive `agent_commands` row (chi, quando, prompt, action, status, error). Anche refusal AI loggati.
6. **Banner persistente in UI**: "Questa pagina puo' modificare lo stato del bot. Visibile solo da localhost. Non esporre in rete."
7. **Kill switch**: env var `AGENT_DISABLED=1` disabilita totale del canale (route 503).

## Architettura

### Flusso ad alto livello

```
User types "manda auguri a Maria il 15 maggio"
  ↓
POST /api/dashboard/agent { prompt: "..." }
  ↓
buildAgentContext (read DB: list chats by displayName, list pending jobs, etc.)
  ↓
generateAgentTurn (prompt + context → AI call)
  ↓
parse JSON → zod AgentOutputSchema
  ↓
returns to UI: { thinking: "...", proposedActions: [{ type: "createManualJob", payload: {...}, preview: "..." }] }
  ↓
UI renders preview, user clicks Confirm
  ↓
POST /api/dashboard/agent/execute { actionId: "uuid", confirm: true }
  ↓
executeAction (whitelisted handler per action type)
  ↓
audit log + return result
```

### File layout

```
src/agent/
  types.ts                    → AgentOutput, AgentAction zod schemas
  turn.ts                     → generateAgentTurn (parallel to ai/turn.ts)
  context.ts                  → buildAgentContext
  actions/
    index.ts                  → registry + dispatcher
    create-manual-job.ts      → handler per date_anchored
    cancel-manual-jobs.ts     → handler per cancel
    dismiss-escalation.ts     → handler
    summarize-chat.ts         → handler (riusa D1)
    update-engagement.ts      → handler (mark cold/active)
    list-overview.ts          → handler read-only (riusa schedule overview)
  store.ts                    → agent_commands table CRUD
prompts/agent/
  00_role.txt
  01_actions_catalog.txt
  02_output_schema.txt
  03_examples.txt
  99_context_template.txt
web/app/dashboard/agent/
  page.tsx                    → chat UI (prompt input + history + confirm cards)
web/app/api/dashboard/agent/
  route.ts                    → POST: invia prompt, ritorna proposed actions
  execute/route.ts            → POST: esegue azione confermata
web/components/dashboard/
  AgentChat.tsx               → componente chat history + input
  AgentActionCard.tsx         → preview azione + Confirm/Cancel button
src/db/schema.ts              → tabella agent_commands (nuova migration)
drizzle/0001_agent_commands.sql → migration
```

### Tabella `agent_commands`

```typescript
export const agentCommands = sqliteTable(
  'agent_commands',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id').notNull(),     // raggruppa azioni della stessa conversation UI
    prompt: text('prompt').notNull(),
    actionType: text('action_type').notNull(),
    actionPayload: text('action_payload').notNull(),   // JSON
    status: text('status', { enum: ['proposed', 'confirmed', 'executed', 'failed', 'rejected'] })
      .notNull()
      .default('proposed'),
    errorMsg: text('error_msg'),
    proposedAt: integer('proposed_at').notNull(),
    executedAt: integer('executed_at'),
  },
  (t) => ({
    sessionIdx: index('idx_ac_session').on(t.sessionId),
    proposedIdx: index('idx_ac_proposed').on(t.proposedAt),
  })
)
```

### `AgentOutput` schema

```typescript
const AgentActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('createManualJob'),
    payload: z.object({
      chatId: z.string(),
      kind: z.enum(['date_anchored', 'revive']),
      fireAtIso: z.string().datetime(),
      action: z.string().min(1).max(200),    // free text describing what to do at fire
      recurring: z.literal('yearly').optional(),
    }),
    preview: z.string(),                      // human-readable summary for UI
  }),
  z.object({
    type: z.literal('cancelManualJobs'),
    payload: z.object({
      chatId: z.string().optional(),
      kind: z.enum(['date_anchored', 'revive', 're_engage']).optional(),
      jobIds: z.array(z.number().int().positive()).optional(),
    }),
    preview: z.string(),
  }),
  z.object({
    type: z.literal('dismissEscalation'),
    payload: z.object({
      escalationId: z.number().int().positive(),
    }),
    preview: z.string(),
  }),
  z.object({
    type: z.literal('summarizeChat'),         // read-only, alias di D1
    payload: z.object({
      chatId: z.string(),
      days: z.number().int().min(1).max(30),
    }),
    preview: z.string(),
  }),
  z.object({
    type: z.literal('updateEngagement'),
    payload: z.object({
      chatId: z.string(),
      state: z.enum(['active', 'cold']),
    }),
    preview: z.string(),
  }),
  z.object({
    type: z.literal('listOverview'),          // read-only catalog
    payload: z.object({
      scope: z.enum(['chats', 'schedule', 'escalations']),
    }),
    preview: z.string(),
  }),
])

export const AgentOutputSchema = z.object({
  thinking: z.string(),                       // chain of thought (for UI display, NOT for execution)
  proposedActions: z.array(AgentActionSchema).max(5),  // cap 5 actions per turn
  clarificationNeeded: z.string().nullable(), // se AI non puo' produrre azione, chiede chiarimento
})
```

Note: alcune azioni (`summarizeChat`, `listOverview`) sono read-only. UI puo' eseguirle senza confirmation (auto-confirm) per ridurre friction. Le write actions richiedono click Confirm.

### Action handlers

Pattern uniforme:

```typescript
export interface ActionHandler<P> {
  type: AgentActionType
  isReadOnly: boolean
  validate: (payload: P, sqlite: Sqlite) => string | null   // null = ok, string = errore
  execute: (payload: P, sqlite: Sqlite) => Promise<ActionResult>
}

interface ActionResult {
  success: boolean
  message: string                              // shown to user in UI
  data?: unknown                               // optional details (e.g. summary text)
}
```

Esempio `createManualJob`:

```typescript
async execute(payload, sqlite) {
  const fireAt = new Date(payload.fireAtIso).getTime()
  if (fireAt < Date.now()) return { success: false, message: 'fireAt is in the past' }
  const jobId = insertManualJob(sqlite, {
    chatId: payload.chatId,
    kind: payload.kind,
    fireAt,
    payload: JSON.stringify({ action: payload.action, recurring: payload.recurring ?? null }),
    status: 'pending',
    createdAt: Date.now(),
  })
  return { success: true, message: `Job #${jobId} scheduled for ${payload.fireAtIso}`, data: { jobId } }
}
```

### Localhost binding enforcement

`package.json` script update:

```json
"dev:web": "node scripts/free-port.mjs 3000 && next dev ./web -p 3000 --hostname 127.0.0.1"
```

Verifica in `web/app/api/dashboard/agent/route.ts`:

```typescript
function ensureLocalhost(req: Request): NextResponse | null {
  const host = req.headers.get('host') ?? ''
  if (!host.startsWith('127.0.0.1') && !host.startsWith('localhost')) {
    return NextResponse.json(
      { error: 'Agent channel is restricted to localhost. Refusing.' },
      { status: 403 }
    )
  }
  return null
}
```

Doppia difesa: bind + runtime check.

### Banner UI

Top di `web/app/dashboard/agent/page.tsx`:

```tsx
<div className="bg-amber-100 border border-amber-300 p-4 rounded mb-4">
  <strong>⚠️ Avviso sicurezza</strong>
  <p className="text-sm">
    Questo canale puo' modificare lo stato del bot (creare job, cancellare escalations, ecc.).
    Accessibile solo da <code>localhost</code>. Non esporre questa UI in rete senza aggiungere autenticazione.
  </p>
</div>
```

(Nota: emoji ⚠️ violerebbe lo style del progetto. Rimpiazzato con testo plain "WARNING" in implementazione.)

### Kill switch

In `web/app/api/dashboard/agent/route.ts` (entrambi POST):

```typescript
if (process.env['AGENT_DISABLED'] === '1') {
  return NextResponse.json({ error: 'Agent disabled by env' }, { status: 503 })
}
```

## Prompt structure

`prompts/agent/00_role.txt`:

```
You are the operations assistant for the viet-chatter bot owner.
The owner manages a WhatsApp bot that responds autonomously to a filtered set of 1:1 chats.
You translate the owner's natural-language requests into structured actions that the bot infrastructure will execute.
You NEVER execute anything yourself. You only PROPOSE actions in the strict JSON schema below.
You ALWAYS include a human-readable `preview` field for each action so the owner can review before confirming.
```

`prompts/agent/01_actions_catalog.txt`: enumera tutti gli action types con esempi prompt → output.

`prompts/agent/02_output_schema.txt`: JSON schema esatto.

`prompts/agent/03_examples.txt`: 5-7 few-shot esempi.

`prompts/agent/99_context_template.txt`: `{{CONTEXT}}` placeholder.

### AgentContext

```typescript
interface AgentContext {
  nowIso: string
  chats: Array<{ chatId: string; displayName: string | null; lastMsgIso: string | null }>
  pendingEscalations: Array<{ id: number; chatId: string; displayName: string | null; reason: string; urgency: string; summary: string; ageHours: number }>
  pendingManualJobs: Array<{ id: number; chatId: string; displayName: string | null; kind: string; fireAtIso: string }>
}
```

Carica al massimo top 50 chat + top 20 escalations + top 20 jobs per evitare prompt giganti.

## API surface

### POST `/api/dashboard/agent`

Request: `{ sessionId: string; prompt: string }`.

Process:

1. Kill switch + localhost check.
2. Build agent context.
3. Generate agent turn (AI call).
4. Validate output.
5. Per ogni proposedAction, persist in `agent_commands` con status=`proposed`.
6. Return `{ sessionId, thinking, actions: [{ id, type, payload, preview, isReadOnly }] }`.

### POST `/api/dashboard/agent/execute`

Request: `{ actionId: number; confirm: true }`.

Process:

1. Kill switch + localhost check.
2. Load `agent_commands` row. Verify status=`proposed`.
3. Validate payload via handler.
4. Execute via handler.
5. Update row status (executed / failed).
6. Return `{ success, message, data? }`.

Idempotente: tentare la stessa action 2 volte ritorna l'esito della prima (lookup by id).

### UI chat

`web/app/dashboard/agent/page.tsx`:

- Storico messaggi (user prompt + AI thinking + action cards).
- Input box in basso.
- Ogni action card mostra preview + bottone Confirm (write) o auto-execute (read-only).
- Risultato dell'execute renderizzato sotto la card.

## Vincoli e fuori-scope

- **No multi-step orchestration**. Una azione per turn. Per task complessi (es. "manda auguri e poi pulisci la chat di X") l'utente fa 2 prompt separati.
- **No undo automatico**. Una volta executed, l'utente deve undo manualmente (es. cancellando il job da Schedule view).
- **No streaming response**. Risposta one-shot, latenza 5-30s.
- **No autenticazione vera**. Solo localhost. Per esporre in rete: spec separata.
- **No write su `processed_messages` o `chat_state`** dall'agent (potrebbe corrompere lo stato della pipeline live). Solo `manual_jobs`, `escalations`, `person_profile`, `facts` (futuro).

## Validation criteria

- `tsc --noEmit` clean.
- `npm run build:web` PASS.
- Test manuale: prompt "manda 'auguri' a +841234567 il 2026-12-25" → action card con preview corretto → Confirm → job creato in DB.
- Test manuale: con `AGENT_DISABLED=1`, route ritorna 503.
- Test manuale: curl da IP non-localhost (simulato modificando host header) ritorna 403.

## Migration

Nuovo file migration `drizzle/0001_agent_commands.sql`:

```sql
CREATE TABLE `agent_commands` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `session_id` text NOT NULL,
  `prompt` text NOT NULL,
  `action_type` text NOT NULL,
  `action_payload` text NOT NULL,
  `status` text NOT NULL DEFAULT 'proposed',
  `error_msg` text,
  `proposed_at` integer NOT NULL,
  `executed_at` integer
);
CREATE INDEX `idx_ac_session` ON `agent_commands` (`session_id`);
CREATE INDEX `idx_ac_proposed` ON `agent_commands` (`proposed_at`);
```

`drizzle/meta/_journal.json` aggiornato.

`npm run db:migrate` da eseguire al deploy.

## Riferimenti

- `2026-05-16-spec-c-dashboard.md` (dashboard parent)
- `docs/dev/17-out-of-scope.md` (carve-out su "CLI per KB / job management" e "Self-chat command channel")
- `docs/dev/07-ai-integration.md` (riusa OpenCode wrapper + router)
- `docs/dev/04-scheduler-state-machine.md` (interazione con manual_jobs)
