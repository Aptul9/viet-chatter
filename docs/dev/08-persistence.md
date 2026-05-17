# Persistence

> Status: design; behavior implemented.

## Stack

- Driver: `better-sqlite3` (synchronous, embedded, native).
- Extension: `sqlite-vec` (vector search).
- ORM: Drizzle (`drizzle-orm/better-sqlite3`).
- Migrations: `drizzle-kit`.

## DB file

Default: `./viet-chatter.db` at project root. Configurable in `config/index.ts` via `dbPath` field.

Backup: no automatic. See user docs and `15-runbook.md` (dev).

## DB opening

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

## Complete schema

```ts
// src/db/schema.ts
import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core'

export const processedMessages = sqliteTable(
  'processed_messages',
  {
    whatsappMsgId: text('whatsapp_msg_id').primaryKey(),
    chatId: text('chat_id').notNull(),
    direction: text('direction', { enum: ['in', 'out_manual', 'out_bot'] }).notNull(),
    ts: integer('ts').notNull(),
  },
  (t) => ({
    chatTsIdx: index('idx_pm_chat_ts').on(t.chatId, t.ts),
  })
)

export const chatState = sqliteTable(
  'chat_state',
  {
    chatId: text('chat_id').primaryKey(),
    state: text('state', {
      enum: ['IDLE', 'ACCUMULATING', 'SCHEDULED', 'SENDING'],
    })
      .notNull()
      .default('IDLE'),
    firstMsgAt: integer('first_msg_at'),
    debounceDeadline: integer('debounce_deadline'),
    fireAt: integer('fire_at'),
    attempt: integer('attempt').notNull().default(0),
    lastEventAt: integer('last_event_at').notNull(),
  },
  (t) => ({
    stateIdx: index('idx_cs_state').on(t.state),
    fireIdx: index('idx_cs_fire').on(t.fireAt),
  })
)

export const personProfile = sqliteTable('person_profile', {
  chatId: text('chat_id').primaryKey(),
  displayName: text('display_name'),
  languages: text('languages').notNull().default('["en"]'), // JSON array
  toneSummary: text('tone_summary'),
  reEngageThresholdDays: integer('re_engage_threshold_days').notNull().default(14),
  engagementState: text('engagement_state', { enum: ['active', 'cold'] })
    .notNull()
    .default('active'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
})

export const facts = sqliteTable(
  'facts',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    personId: text('person_id').notNull(),
    tier: text('tier', { enum: ['important', 'secondary', 'ephemeral'] }).notNull(),
    content: text('content').notNull(),
    sourceMsgId: text('source_msg_id'),
    confidence: real('confidence').notNull().default(0.8),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at'),
    supersededBy: integer('superseded_by'),
  },
  (t) => ({
    personTierIdx: index('idx_facts_person_tier').on(t.personId, t.tier),
    expiresIdx: index('idx_facts_expires').on(t.expiresAt),
  })
)

export const manualJobs = sqliteTable(
  'manual_jobs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: text('chat_id').notNull(),
    kind: text('kind', { enum: ['date_anchored', 'revive', 're_engage'] }).notNull(),
    fireAt: integer('fire_at').notNull(),
    payload: text('payload'), // JSON
    status: text('status', { enum: ['pending', 'firing', 'fired', 'superseded', 'cancelled'] })
      .notNull()
      .default('pending'),
    firedAt: integer('fired_at'),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    chatStatusFireIdx: index('idx_mj_chat_status_fire').on(t.chatId, t.status, t.fireAt),
  })
)

export const turnLog = sqliteTable(
  'turn_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: text('chat_id').notNull(),
    ts: integer('ts').notNull(),
    status: text('status', {
      enum: ['sent', 'skipped', 'failed', 'aborted', 'escalated'],
    }).notNull(),
    languageUsed: text('language_used'),
    factsExtracted: integer('facts_extracted').notNull().default(0),
    durationMs: integer('duration_ms'),
    errorMsg: text('error_msg'),
    triggeredBy: text('triggered_by', { enum: ['reactive', 'manual_job'] })
      .notNull()
      .default('reactive'),
  },
  (t) => ({
    chatTsIdx: index('idx_tl_chat_ts').on(t.chatId, t.ts),
  })
)

export const escalations = sqliteTable(
  'escalations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: text('chat_id').notNull(),
    triggerMsgId: text('trigger_msg_id').notNull(),
    reason: text('reason', {
      enum: ['scheduling', 'commitment', 'sensitive', 'financial', 'identity', 'other'],
    }).notNull(),
    urgency: text('urgency', { enum: ['low', 'normal', 'high'] }).notNull(),
    summary: text('summary').notNull(),
    holdingReplySent: integer('holding_reply_sent', { mode: 'boolean' }).notNull().default(false),
    status: text('status', {
      enum: ['pending', 'user_replied', 'superseded', 'dismissed'],
    })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
    notifiedChannels: text('notified_channels').notNull().default('[]'), // JSON array
  },
  (t) => ({
    chatStatusIdx: index('idx_esc_chat_status').on(t.chatId, t.status),
    createdIdx: index('idx_esc_created').on(t.createdAt),
  })
)
```

Notes on `escalations`:

- One escalation per `triggerMsgId` (the incoming message that triggered it). If the AI escalates twice on the same message (pathological case), dedup is applied on app side via `repo.pendingEscalation(chatId)`.
- `notifiedChannels` is a JSON array of channel strings (`['whatsapp_self','telegram']`). Empty if no channel confirmed delivery.
- `status='superseded'` indicates a new turn generated a new escalation or an autonomous reply, making this one stale.

Virtual table `facts_vec` is not managed by Drizzle (Drizzle does not support virtual tables). Defined manually in `drizzle/0000_init.sql`:

```sql
CREATE VIRTUAL TABLE facts_vec USING vec0(
  fact_id   INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
```

## Migrations

Workflow:

```
npm run db:generate    # drizzle-kit generate (reads schema.ts, writes drizzle/NNNN.sql)
# Manually edit drizzle/0000_init.sql to add CREATE VIRTUAL TABLE facts_vec
npm run db:migrate     # apply to DB
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

Custom migrate runner (because we want to load sqlite-vec BEFORE applying the migration that uses the virtual table):

```ts
// src/db/migrate.ts
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { openDb } from './client'

const { db } = openDb(process.env.DB_PATH ?? './viet-chatter.db')
migrate(db, { migrationsFolder: './drizzle' })
console.log('migrations applied')
```

## Repo (semantic access)

`src/db/repo.ts` exposes semantic functions. No raw SQL outside of here (except `VecStore` which has its dedicated interface).

Examples:

```ts
export async function getChatState(chatId: string) { ... }
export async function setChatState(chatId: string, state: ChatStateUpdate) { ... }
export async function transitionChatState(
  chatId: string,
  fromState: ChatState,
  toState: ChatState,
  fields?: Partial<ChatStateRow>
): Promise<boolean> { ... }                         // returns changes() > 0

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

export async function insertEscalation(row: EscalationInsert): Promise<number> { ... }
export async function getEscalation(id: number) { ... }
export async function pendingEscalation(chatId: string) { ... }                  // dedup lookup, returns only status='pending'
export async function updateEscalationSummary(id: number, summary: string, urgency: ...) { ... }
export async function updateEscalationNotified(id: number, channels: string[]) { ... }
export async function markEscalationsResolved(chatId: string, status: 'user_replied' | 'superseded') { ... }
export async function pendingEscalationsForRetry(): Promise<EscalationRow[]> { ... }   // for notify retry job
export async function countEscalationsLastHour(): Promise<number> { ... }              // for rate limit
```

## Concurrency and WAL

- WAL mode: writers and readers can coexist. For our app (single process), WAL is only needed to avoid blocking short concurrent reads of the same process.
- All state transitions requiring atomicity use conditional UPDATE (`WHERE state=?`) and read `changes()`.
- No explicit `BEGIN/COMMIT` except in few multi-step operations (e.g. insert fact + insert vec). better-sqlite3 supports transactions as synchronous `db.transaction(() => { ... })()`.

## Active pragmas

| Pragma         | Value    | Reason                                                       |
| -------------- | -------- | ------------------------------------------------------------ |
| `journal_mode` | `WAL`    | Concurrent reads, fewer fsync.                               |
| `synchronous`  | `NORMAL` | Balanced. `FULL` would be for max durability but not needed. |
| `foreign_keys` | `ON`     | Even though we don't use many FK, enabled for when we will.  |
| `busy_timeout` | `5000`   | 5s wait on lock before error.                                |

## `facts_vec` management from Drizzle

Drizzle does not generate/manage the virtual table. Approach:

1. The `0000_init.sql` migration creates it manually.
2. The `VecStore` module accesses it via parametrized raw SQL on the direct `better-sqlite3` connection (outside Drizzle ORM, but same `.db` file).

## Portability considerations

All queries pass through `repo.ts` or `VecStore`. SQLite-specific queries (pragmas, virtual tables, vec_distance_cosine) are confined to:

- `db/client.ts` (opening, pragmas, load extension).
- `kb/vec.ts` (SqliteVecStore).
- `drizzle/0000_init.sql` (CREATE VIRTUAL TABLE).

Future migration to Postgres -> swap of these 3 points. See `14-postgres-portability.md`.
