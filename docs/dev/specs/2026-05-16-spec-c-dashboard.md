# Spec C + D1 — Dashboard read-only + AI summary

Data: 2026-05-16.
Status: approved (brainstorm 2026-05-16).
Lingua: italiano (prosa) + english (technical terms).

## Scopo

Estendere la web UI (`web/`) oltre la pagina config con 4 nuovi tab read-only:

- **C1 — KB Explorer**: vista per-chat di facts (important/secondary/ephemeral), profile, messaggi recenti.
- **C2 — Schedule**: vista delle code attive (chat_state non-IDLE, manual_jobs pending, escalations pending).
- **C3 — Stats**: counter aggregati (messaggi, escalations, turn_log, response time per chat).
- **D1 — AI Summary**: form per generare summary AI di una chat ("tell me what Maria did this week"). Read-only sul DB, l'unica scrittura e' la chiamata AI al provider.

Tutto read-only. Nessuna scrittura su DB dal web. Scritture (Spec D2) sono spec separata.

## Architettura

### Layout file

```
web/app/
  dashboard/
    layout.tsx                       → nav fra config + dashboard subtabs
    page.tsx                         → home dashboard (chat list + counter top)
    chats/
      page.tsx                       → lista chat dettagliata
      [chatId]/
        page.tsx                     → per-chat: profile + facts + history
    schedule/
      page.tsx                       → chat_state non-IDLE + manual_jobs + escalations
    stats/
      page.tsx                       → grid di counter + table per-chat
    summary/
      page.tsx                       → form D1: chat picker + days range + result
  api/dashboard/
    chats/route.ts                   → GET list
    chats/[chatId]/route.ts          → GET detail
    schedule/route.ts                → GET
    stats/route.ts                   → GET (range query param)
    summary/route.ts                 → POST (D1)
web/components/dashboard/
  ChatList.tsx
  FactsTable.tsx
  ScheduleTable.tsx
  StatsCards.tsx
  SummaryForm.tsx
web/lib/
  db-ro.ts                           → open viet-chatter.db readonly + cache
  format.ts                          → helpers (formatDate, formatDuration, ecc.)
prompts/
  summary/                           → cartella nuova
    00_role.txt
    01_format.txt
    99_context_template.txt
src/
  db/repo.ts                         → aggiunge 4 helper read-only
```

### Lettura DB dal Next process

Web e' processo separato (`next dev`). Apre proprio handle `better-sqlite3` con `readonly: true`:

```typescript
// web/lib/db-ro.ts
import Database from 'better-sqlite3'
import { resolve } from 'node:path'

let cached: Database.Database | null = null

export function getReadOnlyDb(): Database.Database {
  if (cached) return cached
  const dbPath = resolve(process.cwd(), 'viet-chatter.db')
  cached = new Database(dbPath, { readonly: true, fileMustExist: true })
  cached.pragma('busy_timeout = 1000')
  return cached
}
```

WAL gia' attivo in `src/db/client.ts:12` → reader concorrenti supportati senza bloccare il writer del bot.

### Repo helpers nuovi (read-only)

In `src/db/repo.ts`, additivi:

```typescript
export interface ChatSummary {
  chatId: ChatId
  displayName: string | null
  lastMsgTs: number | null
  msgCount24h: number
  hasPendingEscalation: boolean
  state: ChatState
}

export function listChatsWithSummary(sqlite: Sqlite): ChatSummary[] { ... }

export interface ChatDetail {
  profile: PersonProfileRow | null
  facts: { important: FactRow[]; secondary: FactRow[]; ephemeral: FactRow[] }
  recentMessages: ProcessedMessageRow[]      // last 50
  recentTurns: TurnLogRow[]                  // last 20
  recentEscalations: EscalationRow[]         // last 10
}

export function getChatDetail(sqlite: Sqlite, chatId: ChatId): ChatDetail { ... }

export interface ScheduleOverview {
  chatStates: ChatStateRow[]                 // state != IDLE
  manualJobs: ManualJobRow[]                 // status = pending
  escalations: EscalationRow[]               // status = pending
}

export function getScheduleOverview(sqlite: Sqlite): ScheduleOverview { ... }

export interface StatsRangeSnapshot {
  range: '24h' | '7d' | 'all'
  totalMessages: { in: number; out_bot: number; out_manual: number }
  turns: { sent: number; skipped: number; failed: number; aborted: number; escalated: number }
  escalations: { pending: number; user_replied: number; superseded: number; dismissed: number }
  avgResponseTimeMs: number | null           // bot reply latency, rolling avg over range
  perChat: Array<{ chatId: string; displayName: string | null; msgCount: number; avgReplyMs: number | null }>
}

export function getStats(sqlite: Sqlite, range: '24h' | '7d' | 'all'): StatsRangeSnapshot { ... }
```

Tutto sync better-sqlite3 (coerente con resto di `repo.ts`). Le route Next li chiamano in handler async, ma le query sono sync sotto.

### API routes

Tutte sotto `web/app/api/dashboard/`. Pattern coerente con `web/app/api/config/route.ts`:

```typescript
// web/app/api/dashboard/chats/route.ts
import { NextResponse } from 'next/server'
import { getReadOnlyDb } from '@/lib/db-ro'
import { listChatsWithSummary } from '@/lib/repo-bridge'  // re-export from src

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const sqlite = getReadOnlyDb()
  const chats = listChatsWithSummary(sqlite)
  return NextResponse.json({ chats })
}
```

Helper `web/lib/repo-bridge.ts`: thin re-export delle funzioni read-only da `src/db/repo.ts`. Web puo' importare direttamente da `../../src/db/repo.js` ma il bridge tiene la superficie esplicita.

### Pages

Server components dove possibile (data fetch al render).

**`web/app/dashboard/page.tsx`** (home):
- top: 3 stats cards (messaggi 24h, turn sent 24h, escalations pending).
- middle: lista compatta chat (top 10 by recent activity).
- link a `/dashboard/chats`, `/dashboard/schedule`, `/dashboard/stats`, `/dashboard/summary`.

**`web/app/dashboard/chats/page.tsx`**: tabella full di tutte le chat, sortabile (lato client). Click su row → `[chatId]/page.tsx`.

**`web/app/dashboard/chats/[chatId]/page.tsx`**: scheda chat con:
- Profile (displayName, languages, toneSummary, engagement state, threshold)
- Facts in 3 sezioni (important, secondary, ephemeral). Tabella con content, confidence, created.
- Recent messages (last 50). Direction badge, body, ts.
- Recent turns (last 20). Status, language_used, duration, triggered_by.
- Recent escalations (last 10). Reason, urgency, summary, status.

**`web/app/dashboard/schedule/page.tsx`**: 3 sezioni:
- Chat in ACCUMULATING / SCHEDULED / SENDING (con fire_at e debounce_deadline)
- Manual jobs pending (kind, fire_at, chatId, payload sintetico)
- Escalations pending (con created_at, age, reason, urgency, summary truncato)

**`web/app/dashboard/stats/page.tsx`**: range picker (24h / 7d / all). Cards counter top. Tabella per-chat con `msgCount` e `avgReplyMs`.

**`web/app/dashboard/summary/page.tsx`**: form D1.

### D1 — AI Summary flow

Form UI:

```
[Chat selector dropdown]   (popolato da /api/dashboard/chats)
[Days range input]         (default 7, min 1, max 30)
[Generate Summary button]
↓
[Textarea readonly con risultato]
```

Backend `web/app/api/dashboard/summary/route.ts`:

```typescript
POST body: { chatId: string; days: number }
```

1. Validate input (zod: chatId esiste in DB, days in 1..30).
2. Load `processed_messages WHERE chat_id=? AND ts > now - days*86400000`. Cap a 500 messaggi.
3. Load `facts WHERE person_id=?` (tutti i tier non superseded).
4. Load `person_profile WHERE chat_id=?`.
5. Build `SummaryContext`:
   ```typescript
   interface SummaryContext {
     chat: { id: string; displayName: string | null; languages: string[] }
     dateRange: { startIso: string; endIso: string }
     messages: Array<{ direction: Direction; body: string; tsIso: string }>
     facts: { important: string[]; secondary: string[]; ephemeral: string[] }
     toneSummary: string | null
   }
   ```
6. Load summary template via `loadAndCombinePrompts('prompts/summary')` (cache separata, NON reusa `cachedTemplate` di `turn.ts`).
7. Costruisce prompt: template + JSON.stringify(context).
8. Call `callAiApi(prompt, 'summary', signal)`. NO zod validation: output free-form.
9. Cap output a ~4000 chars per safety.
10. Log `summary_request` con `{chatId, days, msgCount, durationMs, responseChars}`.
11. Return `{ summary: string }`.

Errori: validate fail → 400. AI returns null → 500. DB read fail → 500.

### Prompt files

`prompts/summary/00_role.txt`:

```
You are a summarizer of WhatsApp 1:1 chat history for the bot's owner.
You are NOT generating a reply. You are NOT the AI ghostwriter.
You are providing the owner with a digest of what happened in this conversation in the date range provided.
Always respond in the same language(s) the owner uses (see chat.languages).
Be concise, factual, and direct. No filler, no AI-isms.
```

`prompts/summary/01_format.txt`:

```
Output format (markdown):

## Riassunto
<2-3 frasi panoramica generale di quello che e' successo>

## Eventi chiave
- <bullet, in ordine cronologico>
- <data + breve descrizione>

## Tono
<1-2 frasi: sentiment generale, tensioni, riconciliazioni, novita'>

## Da non dimenticare
- <eventuali commitment, date, promesse che l'owner deve ricordare>

If the range contains no messages, output: "Nessun messaggio nel range richiesto."
```

`prompts/summary/99_context_template.txt`: solo `{{CONTEXT}}` placeholder.

### Estensione `src/ai/turn.ts` (refactor minimal)

`loadAndCombinePrompts` gia' accetta dir param. Caching invalidato per prompt dir diverso (nuova mappa cache):

```typescript
const templateCache = new Map<string, string>()

async function loadAndCombinePrompts(dir: string): Promise<string> {
  const cached = templateCache.get(dir)
  if (cached) return cached
  // ... legge dir, concat, store in map
}
```

### Sicurezza

- Tutte le route GET = read-only sul DB.
- Route summary POST scrive solo log + call AI esterno. NON modifica DB del bot.
- Cap days a 30 + cap messaggi a 500 per evitare prompt giganti.
- Cap response chars a 4000 per evitare abuso del provider come LLM proxy gratuito.
- Log ogni summary request con chatId hash (primi 8 char) + len.
- Dashboard documentato come dev-only nel README. Next.js bind di default a `0.0.0.0`. Per Spec C e' tollerabile (read-only), ma per Spec D2 obbligatorio bind localhost (vedi `2026-05-16-spec-d2-ai-commands.md`).

### Performance

- Repo helpers usano indici esistenti (`idx_pm_chat_ts`, `idx_cs_state`, `idx_esc_chat_status`).
- WAL → reader non blocca writer.
- Liste cappiate (top 50 chats, last 50 messages) → query veloci.
- No caching lato Next: ogni request rilegge DB. Con WAL e SQLite locale, latenza <10ms tipica.

## Modifiche ai file

| File                                          | Tipo     | Cambiamento                                          |
| --------------------------------------------- | -------- | ---------------------------------------------------- |
| `src/db/repo.ts`                              | modifica | 4 helper read-only aggiunti                          |
| `src/ai/turn.ts`                              | modifica | `loadAndCombinePrompts` cache map per dir            |
| `prompts/summary/00_role.txt`                 | nuovo    | role summarizer                                       |
| `prompts/summary/01_format.txt`               | nuovo    | format markdown                                      |
| `prompts/summary/99_context_template.txt`     | nuovo    | placeholder                                          |
| `web/app/dashboard/layout.tsx`                | nuovo    | nav fra config + dashboard subtabs                   |
| `web/app/dashboard/page.tsx`                  | nuovo    | home dashboard                                       |
| `web/app/dashboard/chats/page.tsx`            | nuovo    | lista chat                                           |
| `web/app/dashboard/chats/[chatId]/page.tsx`   | nuovo    | dettaglio chat                                       |
| `web/app/dashboard/schedule/page.tsx`         | nuovo    | schedule view                                        |
| `web/app/dashboard/stats/page.tsx`            | nuovo    | stats view                                           |
| `web/app/dashboard/summary/page.tsx`          | nuovo    | summary form                                         |
| `web/app/api/dashboard/chats/route.ts`        | nuovo    | GET list                                             |
| `web/app/api/dashboard/chats/[chatId]/route.ts` | nuovo  | GET detail                                           |
| `web/app/api/dashboard/schedule/route.ts`     | nuovo    | GET                                                  |
| `web/app/api/dashboard/stats/route.ts`        | nuovo    | GET con range query                                  |
| `web/app/api/dashboard/summary/route.ts`      | nuovo    | POST D1                                              |
| `web/components/dashboard/ChatList.tsx`       | nuovo    | tabella chat                                         |
| `web/components/dashboard/FactsTable.tsx`     | nuovo    | tabella facts 3-tier                                 |
| `web/components/dashboard/ScheduleTable.tsx`  | nuovo    | tabella code                                         |
| `web/components/dashboard/StatsCards.tsx`     | nuovo    | grid counter                                         |
| `web/components/dashboard/SummaryForm.tsx`    | nuovo    | form D1                                              |
| `web/lib/db-ro.ts`                            | nuovo    | helper readonly DB                                   |
| `web/lib/repo-bridge.ts`                      | nuovo    | re-export functions da src/db/repo                   |
| `web/lib/format.ts`                           | nuovo    | helpers formatting                                   |
| `web/app/page.tsx`                            | modifica | link a /dashboard                                    |
| `web/README.md`                               | modifica | sezione dashboard + warning dev-only                 |
| `docs/dev/16-future-enhancements.md`          | modifica | rimuove #7 Dashboard (ora in scope)                  |

## Validation criteria

- `tsc --noEmit` clean.
- `npm run build:web` PASS (Next build).
- `npm run dev` → web parte, `/dashboard` accessibile.
- Test manuale: con DB esistente, ogni tab carica dati senza errore. Summary genera output coerente (controllo qualitativo).

## Riferimenti

- `docs/dev/08-persistenza.md` (schema DB, riusato read-only)
- `docs/dev/16-future-enhancements.md` (#7 era qui, ora promosso in scope)
- `docs/dev/17-out-of-scope.md` (carve-out su "CLI per KB / job management")
- `2026-05-16-spec-d2-ai-commands.md` (estende dashboard con write commands)
