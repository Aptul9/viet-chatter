# Persistenza

## Stack

- Driver: `better-sqlite3` (sincrono, embedded, nativo).
- Estensione: `sqlite-vec` (vector search).
- ORM: Drizzle (`drizzle-orm/better-sqlite3`).
- Migrations: `drizzle-kit`.

## File DB

Default: `./viet-chatter.db` nella root del progetto. Configurabile in `config/index.ts` via campo `dbPath`.

Backup: nessuno automatico. Vedi `09-privacy-dati.md` (utente) e `15-runbook.md` (dev).

## Apertura DB

```ts
// src/db/client.ts
import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'

export function openDb(path: string) {
  const sqlite = new Database(path)
  sqliteVec.load(sqlite)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('synchronous = NORMAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  return { sqlite, db: drizzle(sqlite, { schema }) }
}
```

## Schema completo

```ts
// src/db/schema.ts
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

export const processedMessages = sqliteTable('processed_messages', {
  whatsappMsgId: text('whatsapp_msg_id').primaryKey(),
  chatId: text('chat_id').notNull(),
  direction: text('direction', { enum: ['in','out_manual','out_bot'] }).notNull(),
  ts: integer('ts').notNull(),
}, (t) => ({
  chatTsIdx: index('idx_pm_chat_ts').on(t.chatId, t.ts),
}))

export const chatState = sqliteTable('chat_state', {
  chatId: text('chat_id').primaryKey(),
  state: text('state', {
    enum: ['IDLE','ACCUMULATING','SCHEDULED','SENDING'],
  }).notNull().default('IDLE'),
  firstMsgAt: integer('first_msg_at'),
  debounceDeadline: integer('debounce_deadline'),
  fireAt: integer('fire_at'),
  attempt: integer('attempt').notNull().default(0),
  lastEventAt: integer('last_event_at').notNull(),
}, (t) => ({
  stateIdx: index('idx_cs_state').on(t.state),
  fireIdx: index('idx_cs_fire').on(t.fireAt),
}))

export const personProfile = sqliteTable('person_profile', {
  chatId: text('chat_id').primaryKey(),
  displayName: text('display_name'),
  languages: text('languages').notNull().default('["en"]'),       // JSON array
  toneSummary: text('tone_summary'),
  reEngageThresholdDays: integer('re_engage_threshold_days').notNull().default(14),
  engagementState: text('engagement_state', { enum: ['active','cold'] }).notNull().default('active'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const facts = sqliteTable('facts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  personId: text('person_id').notNull(),
  tier: text('tier', { enum: ['important','secondary','ephemeral'] }).notNull(),
  content: text('content').notNull(),
  sourceMsgId: text('source_msg_id'),
  confidence: real('confidence').notNull().default(0.8),
  createdAt: integer('created_at').notNull(),
  expiresAt: integer('expires_at'),
  supersededBy: integer('superseded_by'),
}, (t) => ({
  personTierIdx: index('idx_facts_person_tier').on(t.personId, t.tier),
  expiresIdx: index('idx_facts_expires').on(t.expiresAt),
}))

export const manualJobs = sqliteTable('manual_jobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: text('chat_id').notNull(),
  kind: text('kind', { enum: ['date_anchored','revive','re_engage'] }).notNull(),
  fireAt: integer('fire_at').notNull(),
  payload: text('payload'),                                       // JSON
  status: text('status', { enum: ['pending','firing','fired','superseded','cancelled'] }).notNull().default('pending'),
  firedAt: integer('fired_at'),
  createdAt: integer('created_at').notNull(),
}, (t) => ({
  chatStatusFireIdx: index('idx_mj_chat_status_fire').on(t.chatId, t.status, t.fireAt),
}))

export const turnLog = sqliteTable('turn_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: text('chat_id').notNull(),
  ts: integer('ts').notNull(),
  status: text('status', { enum: ['sent','skipped','failed','aborted'] }).notNull(),
  languageUsed: text('language_used'),
  factsExtracted: integer('facts_extracted').notNull().default(0),
  durationMs: integer('duration_ms'),
  errorMsg: text('error_msg'),
  triggeredBy: text('triggered_by', { enum: ['reactive','manual_job'] }).notNull().default('reactive'),
}, (t) => ({
  chatTsIdx: index('idx_tl_chat_ts').on(t.chatId, t.ts),
}))
```

Virtual table `facts_vec` non gestita da Drizzle (Drizzle non supporta virtual tables). Definita manualmente in `drizzle/0000_init.sql`:

```sql
CREATE VIRTUAL TABLE facts_vec USING vec0(
  fact_id   INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
```

## Migrations

Workflow:

```
npm run db:generate    # drizzle-kit generate (legge schema.ts, scrive drizzle/NNNN.sql)
# Editare manualmente drizzle/0000_init.sql per aggiungere CREATE VIRTUAL TABLE facts_vec
npm run db:migrate     # applica al DB
```

Drizzle config:

```ts
// drizzle.config.ts
import type { Config } from 'drizzle-kit'

export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: { url: './viet-chatter.db' },
} satisfies Config
```

Migrate runner custom (perché vogliamo loadare sqlite-vec PRIMA di applicare la migration che usa la virtual table):

```ts
// src/db/migrate.ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { openDb } from './client'

const { db } = openDb(process.env.DB_PATH ?? './viet-chatter.db')
migrate(db, { migrationsFolder: './drizzle' })
console.log('migrations applied')
```

## Repo (accesso semantico)

`src/db/repo.ts` espone funzioni semantiche. Niente raw SQL fuori da qui (eccetto `VecStore` che ha la sua interfaccia dedicata).

Esempi:

```ts
export async function getChatState(chatId: string) { ... }
export async function setChatState(chatId: string, state: ChatStateUpdate) { ... }
export async function transitionChatState(
  chatId: string,
  fromState: ChatState,
  toState: ChatState,
  fields?: Partial<ChatStateRow>
): Promise<boolean> { ... }                         // restituisce changes() > 0

export async function insertProcessedMessage(row: ProcessedMessageRow) { ... }
export async function recentProcessedMessages(chatId: string, limit: number) { ... }
export async function getLastSeenTs(chatId: string): Promise<number | null> { ... }

export async function loadImportant(personId: string) { ... }
export async function loadActiveEphemeral(personId: string) { ... }
export async function loadFactsByIds(ids: number[]) { ... }
export async function insertFact(fact: FactInsert): Promise<number> { ... }
export async function markSuperseded(oldId: number, newId: number) { ... }
export async function expiredEphemeralIds(): Promise<number[]> { ... }
export async function deleteFact(id: number) { ... }

export async function getPersonProfile(chatId: string) { ... }
export async function upsertPersonProfile(row: PersonProfileUpsert) { ... }

export async function insertManualJob(row: ManualJobInsert): Promise<number> { ... }
export async function pendingManualJobs(now: number) { ... }
export async function transitionManualJob(id: number, fromStatus: ..., toStatus: ...): Promise<boolean> { ... }
export async function cancelPendingManualJobsForChat(chatId: string) { ... }

export async function insertTurnLog(row: TurnLogInsert) { ... }
```

## Concorrenza e WAL

- WAL mode: writers e readers possono coesistere. Per la nostra app (single process), WAL serve solo per non bloccare brevi reads concorrenti dello stesso process.
- Tutte le transizioni di stato che richiedono atomicità usano UPDATE condizionato (`WHERE state=?`) e leggono `changes()`.
- Niente `BEGIN/COMMIT` esplicite tranne in poche operazioni multi-step (es. insert fact + insert vec). better-sqlite3 supporta transazioni come `db.transaction(() => { ... })()` sincrone.

## Pragmas attivi

| Pragma | Valore | Motivo |
|---|---|---|
| `journal_mode` | `WAL` | Concurrent reads, fewer fsync. |
| `synchronous` | `NORMAL` | Bilanciato. `FULL` sarebbe per durability massima ma non serve. |
| `foreign_keys` | `ON` | Anche se non usiamo molte FK, abilitato per quando lo faremo. |
| `busy_timeout` | `5000` | 5s di attesa su lock prima di errore. |

## Gestione `facts_vec` da Drizzle

Drizzle non genera/gestisce la virtual table. Approccio:

1. La migration `0000_init.sql` la crea manualmente.
2. Il modulo `VecStore` la accede via raw SQL parametrizzato sulla connessione `better-sqlite3` diretta (fuori da Drizzle ORM, ma stesso file `.db`).

## Considerazioni di portabilita

Tutte le query passano per `repo.ts` o `VecStore`. Le query SQLite-specific (pragmas, virtual tables, vec_distance_cosine) sono confinate in:

- `db/client.ts` (apertura, pragmas, load extension).
- `kb/vec.ts` (SqliteVecStore).
- `drizzle/0000_init.sql` (CREATE VIRTUAL TABLE).

Migrazione futura a Postgres -> swap di questi 3 punti. Vedi `14-portabilita-postgres.md`.
