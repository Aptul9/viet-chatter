# Postgres portability

> Status: speculative / forward-looking. Not implemented in v1.

In v1 the DB stack is SQLite + `sqlite-vec`. The design leaves open the door to a future migration to Postgres + `pgvector`. This document lists the abstractions that make it feasible and the points that need to be touched.

## When it makes sense to migrate

All of the following must be true:

- Vector facts volume over 1M (unlikely in the single-user use case).
- Need for multi-machine or multi-process DB access.
- High write concurrency (dozens of parallel writers).
- Availability of a reliable Postgres where to run the bot.

In any other case, SQLite is the best choice. See `01-stack.md` for the rationale.

## Abstractions that make porting accessible

### 1. Drizzle ORM

The same TypeScript schema works (with minor variations) for both `drizzle-orm/better-sqlite3` and `drizzle-orm/postgres-js`.

Typical differences:

- `sqliteTable` -> `pgTable`.
- `text(...)` with `enum: [...]` stays the same (both dialects support literal enums).
- `integer('ts').notNull()` -> in pg might need `bigint('ts').notNull()` for ms timestamps.
- `primaryKey({ autoIncrement: true })` -> in pg `.primaryKey()` with `serial` or `identity` type.

Concrete migrate path: define `src/db/schema.pg.ts` with the small differences, and change import in `client.ts`.

### 2. Repo as the only DB access

All business code calls `repo.getChatState`, `repo.insertFact`, etc. No inline SQL scattered around (except in `VecStore`, see below). Porting `repo.ts` is mechanical: same logic, Drizzle queries.

### 3. Abstract VecStore

```ts
export interface VecStore {
  upsert(factId: number, embedding: Float32Array): Promise<void>
  search(personId: string, qEmb: Float32Array, k: number): Promise<number[]>
  delete(factId: number): Promise<void>
}
```

v1 implementation: `SqliteVecStore`. For Postgres, write `PgvectorStore` with the same interface. One-line swap (the factory at DB opening).

### 4. Isolated DB opening

Pragmas and load extension are only in `src/db/client.ts`. For Postgres that file becomes connection pool opening, no pragmas.

## Points that require modification

| File                                                                                                     | What changes                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/db/client.ts`                                                                                       | Opening: `better-sqlite3` -> `postgres-js`. No `loadExtension`, no pragmas.                                                                                                                                                |
| `src/db/schema.ts`                                                                                       | `sqliteTable` -> `pgTable`. Adapt types `integer/bigint`, `serial`.                                                                                                                                                        |
| `src/kb/vec.ts`                                                                                          | Add `PgvectorStore implements VecStore`. Switch the factory.                                                                                                                                                               |
| `drizzle/0000_init.sql` (and similar)                                                                    | Regenerate with `drizzle-kit` for the new dialect. The sqlite-vec virtual table is replaced by `CREATE EXTENSION vector` + `vector(384)` column on `facts` directly (pgvector allows typed columns without virtual table). |
| `drizzle.config.ts`                                                                                      | `dialect: 'sqlite'` -> `dialect: 'postgresql'`.                                                                                                                                                                            |
| `package.json`                                                                                           | Replace `better-sqlite3` + `sqlite-vec` with `postgres` (or `pg`).                                                                                                                                                         |
| All queries in `repo.ts` with time arithmetic (`expires_at < strftime('%s', 'now') * 1000` if ever used) | Change to `expires_at < extract(epoch from now()) * 1000`. But if we use `Date.now()` on the app side, nothing changes.                                                                                                    |
| `src/db/migrate.ts`                                                                                      | Migrator client changes.                                                                                                                                                                                                   |

## Points that DO NOT change

- All logic of scheduler / state machine / orchestrator / dispatcher / boot reconciler / manual jobs.
- All AI prompts.
- All config.
- Logging.
- whatsapp-web.js integration.
- Embedding service.

In terms of lines touched: estimated 5-10% of the codebase.

## Example: SqliteVecStore vs PgvectorStore

Sqlite (v1):

```ts
search(personId, qEmb, k): number[] {
  return db.prepare(`
    SELECT v.fact_id
    FROM facts_vec v
    JOIN facts f ON f.id = v.fact_id
    WHERE f.person_id = ? AND f.tier = 'secondary' AND f.superseded_by IS NULL
    ORDER BY vec_distance_cosine(v.embedding, ?)
    LIMIT ?
  `).all(personId, Buffer.from(qEmb.buffer), k).map((r: any) => r.fact_id)
}
```

Postgres (future):

```ts
async search(personId, qEmb, k): Promise<number[]> {
  const rows = await sql`
    SELECT id
    FROM facts
    WHERE person_id = ${personId}
      AND tier = 'secondary'
      AND superseded_by IS NULL
    ORDER BY embedding <=> ${qEmb}::vector
    LIMIT ${k}
  `
  return rows.map(r => r.id)
}
```

Differences:

- pgvector doesn't require a separate table for vectors, a `vector(384)` column is enough.
- `<=>` operator for cosine distance (others are `<->` L2 and `<#>` inner product).
- HNSW index on `embedding` for speedup:

```sql
CREATE INDEX ON facts USING hnsw (embedding vector_cosine_ops);
```

## Data migration

Tool: `pgloader` (open source) or custom TS script that reads everything from SQLite and does batch INSERT into Postgres.

Typical sequence:

1. Stop the bot.
2. Backup `viet-chatter.db`.
3. Create Postgres schema with `drizzle-kit migrate`.
4. Run pgloader or migration script.
5. Validate counts (`SELECT COUNT(*)` on both).
6. Switch code (PR with the 5-10% changes, deploy).
7. Start bot pointed at Postgres.

Realistic effort estimate: 1-2 days of work including tests.

## Discipline constraint (to not lose portability)

In v1, avoid:

- SQLite triggers (logic via app code).
- `PRAGMA` read from business code (only in `client.ts`).
- Non-standard SQL functions (`json_extract`, `random()`, `strftime` directly in queries): prefer TS computation on app side.
- FTS5 with custom tokenizer.
- Reliance on `RETURNING` in non-portable ways.

Drizzle hides most of these differences as long as standard query builders are used. Discretion remains on `VecStore` and any raw query.

## Final notes

Porting is not a goal. It's a safety option. Stack v1 (SQLite + sqlite-vec) is designed to remain the production one for years of single-user use.
