# Portabilità a Postgres

In v1 lo stack DB è SQLite + `sqlite-vec`. La progettazione lascia aperta la porta a una migrazione futura a Postgres + `pgvector`. Questo documento elenca le astrazioni che la rendono fattibile e i punti che vanno toccati.

## Quando ha senso migrare

Tutti i seguenti devono essere veri:

- Volume facts vettoriali oltre 1M (improbabile nel caso d'uso single-user).
- Necessità di accesso multi-machine o multi-process al DB.
- Concorrenza alta di scrittura (decine di scrittori paralleli).
- Disponibilità di un Postgres affidabile dove far girare il bot.

In ogni altro caso, SQLite è la scelta migliore. Vedi `01-stack.md` per il razionale.

## Astrazioni che rendono il porting accessibile

### 1. Drizzle ORM

Lo stesso schema TypeScript funziona (con minime variazioni) sia per `drizzle-orm/better-sqlite3` che per `drizzle-orm/postgres-js`.

Differenze tipiche:

- `sqliteTable` -> `pgTable`.
- `text(...)` con `enum: [...]` resta uguale (entrambi i dialetti supportano enum literali).
- `integer('ts').notNull()` -> in pg potrebbe servire `bigint('ts').notNull()` per timestamp ms.
- `primaryKey({ autoIncrement: true })` -> in pg `.primaryKey()` con tipo `serial` o `identity`.

Il migrate path concreto: definisci `src/db/schema.pg.ts` con le piccole differenze, e cambi import in `client.ts`.

### 2. Repo come unico accesso al DB

Tutto il codice business chiama `repo.getChatState`, `repo.insertFact`, ecc. Niente SQL inline sparso (eccetto in `VecStore`, vedi sotto). Il porting di `repo.ts` è meccanico: stessa logica, query Drizzle.

### 3. VecStore astratto

```ts
export interface VecStore {
  upsert(factId: number, embedding: Float32Array): Promise<void>
  search(personId: string, qEmb: Float32Array, k: number): Promise<number[]>
  delete(factId: number): Promise<void>
}
```

Implementazione v1: `SqliteVecStore`. Per Postgres si scrive `PgvectorStore` con la stessa interfaccia. Swap di una linea (la factory all'apertura DB).

### 4. Apertura DB isolata

Pragmas e load extension stanno solo in `src/db/client.ts`. Per Postgres quel file diventa apertura connection pool, niente pragmas.

## Punti che richiedono modifica

| File                                                                                                       | Cosa cambia                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/db/client.ts`                                                                                         | Apertura: `better-sqlite3` -> `postgres-js`. Niente `loadExtension`, niente pragmas.                                                                                                                                                |
| `src/db/schema.ts`                                                                                         | `sqliteTable` -> `pgTable`. Adeguare tipi `integer/bigint`, `serial`.                                                                                                                                                               |
| `src/kb/vec.ts`                                                                                            | Aggiungere `PgvectorStore implements VecStore`. Switchare la factory.                                                                                                                                                               |
| `drizzle/0000_init.sql` (e simili)                                                                         | Rigenerare con `drizzle-kit` per il nuovo dialect. La virtual table sqlite-vec viene sostituita da `CREATE EXTENSION vector` + colonna `vector(384)` su `facts` direttamente (pgvector permette colonne typed senza virtual table). |
| `drizzle.config.ts`                                                                                        | `dialect: 'sqlite'` -> `dialect: 'postgresql'`.                                                                                                                                                                                     |
| `package.json`                                                                                             | Sostituire `better-sqlite3` + `sqlite-vec` con `postgres` (o `pg`).                                                                                                                                                                 |
| Tutte le query in `repo.ts` con time arithmetic (`expires_at < strftime('%s', 'now') * 1000` se mai usato) | Cambiano in `expires_at < extract(epoch from now()) * 1000`. Ma se usiamo `Date.now()` lato app, niente cambia.                                                                                                                     |
| `src/db/migrate.ts`                                                                                        | Cambia il migrator client.                                                                                                                                                                                                          |

## Punti che NON cambiano

- Tutta la logica di scheduler / state machine / orchestrator / dispatcher / boot reconciler / manual jobs.
- Tutti i prompt AI.
- Tutta la config.
- Logging.
- whatsapp-web.js integration.
- Embedding service.

In termini di linee toccate: stimato 5-10% del codebase.

## Esempio: SqliteVecStore vs PgvectorStore

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

Postgres (futuro):

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

Differenze:

- pgvector non richiede tabella separata per i vettori, basta una colonna `vector(384)`.
- Operatore `<=>` per cosine distance (gli altri sono `<->` L2 e `<#>` inner product).
- Indice HNSW su `embedding` per velocizzare:

```sql
CREATE INDEX ON facts USING hnsw (embedding vector_cosine_ops);
```

## Migrazione dei dati

Tool: `pgloader` (open source) o script TS custom che legge tutto da SQLite e fa INSERT su Postgres in batch.

Sequenza tipica:

1. Spegni il bot.
2. Backup `viet-chatter.db`.
3. Crea schema Postgres con `drizzle-kit migrate`.
4. Esegui pgloader o script migration.
5. Validare conteggi (`SELECT COUNT(*)` su entrambi).
6. Switch del codice (PR con i 5-10% di cambi, deploy).
7. Avvia bot puntato a Postgres.

Stima di sforzo realistica: 1-2 giorni di lavoro inclusi test.

## Vincolo di disciplina (per non perdere portabilità)

In v1, evitare:

- Triggers SQLite (logica via app code).
- `PRAGMA` letti dal codice business (solo in `client.ts`).
- Funzioni SQL non standard (`json_extract`, `random()`, `strftime` direttamente in query): preferire computazione TS lato app.
- FTS5 con tokenizer custom.
- Ricorso a `RETURNING` in modi non portabili.

Drizzle nasconde gran parte di queste differenze finché si usano query builder standard. La discrezionalità resta su `VecStore` e su eventuali raw query.

## Note finali

Il porting non è un obiettivo. È un'opzione di sicurezza. Stack v1 (SQLite + sqlite-vec) è progettato per restare quello produttivo per anni di uso single-user.
