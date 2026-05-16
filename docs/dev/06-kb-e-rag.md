# KB e RAG

## Modello a 3 tier

| Tier        | Descrizione                                                                                                                   | Embedding | Caricamento prompt | TTL                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------ | ----------------------- |
| `important` | Eventi che ridefiniscono la persona (lutti, malattie, separazioni, traguardi). Pochi per persona (5-20 stabili).              | NO        | Sempre tutti       | Mai                     |
| `secondary` | Dettagli interessanti (lavoro, hobby, gusti, dettagli ricorrenti). Crescono nel tempo (potenzialmente centinaia per persona). | SÌ        | Top-K via RAG      | Mai (se non superseded) |
| `ephemeral` | Fatti time-limited (piani, appuntamenti, stati temporanei).                                                                   | NO        | Sempre tutti       | 7 giorni default        |

## Schema (Drizzle)

```ts
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
```

Virtual table sqlite-vec (manuale in migration `0000_init.sql`):

```sql
CREATE VIRTUAL TABLE facts_vec USING vec0(
  fact_id   INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
```

## Estrazione (output AI)

L'AI nel `TurnOutput` produce `extracted_facts: ExtractedFact[]`:

```ts
type ExtractedFact = {
  tier: 'important' | 'secondary' | 'ephemeral'
  content: string // 1-2 frasi inglese
  confidence: number // 0..1
  ttl_days?: number // solo per ephemeral, default 7
  supersedes_id?: number // sostituisce fatto esistente
  anchor_date?: string // YYYY-MM-DD per data fissa, MM-DD per ricorrente annuale
  anchor_recurring?: 'yearly' | null
  anchor_action?: 'wish_birthday' | 'follow_up' | string
}
```

## Pipeline insert

```ts
async function persistExtractedFacts(personId: string, facts: ExtractedFact[]) {
  for (const f of facts) {
    const id = await repo.insertFact({
      personId,
      tier: f.tier,
      content: f.content,
      confidence: f.confidence,
      createdAt: now,
      expiresAt: f.tier === 'ephemeral' ? now + (f.ttl_days ?? 7) * 86400_000 : null,
    })
    if (f.tier === 'secondary') {
      const emb = await embedding.embed(f.content)
      await vecStore.upsert(id, emb)
    }
    if (f.supersedes_id) {
      await repo.markSuperseded(f.supersedes_id, id)
    }
    if (f.anchor_date) {
      await repo.insertManualJob({
        chatId: personId,
        kind: 'date_anchored',
        fireAt: nextOccurrence(f.anchor_date, f.anchor_recurring),
        payload: JSON.stringify({ action: f.anchor_action, fact_id: id }),
      })
    }
  }
}
```

## Retrieval per turno

```ts
async function loadKB(personId: string, recentIncomingBody: string) {
  const important = await repo.loadImportant(personId) // tutti
  const ephemeral = await repo.loadActiveEphemeral(personId) // tutti non scaduti
  const qEmb = await embedding.embed(recentIncomingBody)
  const secondaryIds = await vecStore.search(personId, qEmb, config.ragTopK)
  const secondary = await repo.loadFactsByIds(secondaryIds)
  return { important, ephemeral, secondary }
}
```

## VecStore (interfaccia)

```ts
export interface VecStore {
  upsert(factId: number, embedding: Float32Array): Promise<void>
  search(personId: string, qEmb: Float32Array, k: number): Promise<number[]>
  delete(factId: number): Promise<void>
}
```

Implementazione concreta `SqliteVecStore`:

```ts
export class SqliteVecStore implements VecStore {
  constructor(private db: BetterSqlite3.Database) {}

  upsert(factId: number, embedding: Float32Array) {
    this.db
      .prepare(
        `
      INSERT OR REPLACE INTO facts_vec(fact_id, embedding) VALUES (?, ?)
    `
      )
      .run(factId, Buffer.from(embedding.buffer))
  }

  search(personId: string, qEmb: Float32Array, k: number): number[] {
    return this.db
      .prepare(
        `
      SELECT v.fact_id
      FROM facts_vec v
      JOIN facts f ON f.id = v.fact_id
      WHERE f.person_id = ? AND f.tier = 'secondary' AND f.superseded_by IS NULL
      ORDER BY vec_distance_cosine(v.embedding, ?)
      LIMIT ?
    `
      )
      .all(personId, Buffer.from(qEmb.buffer), k)
      .map((r: any) => r.fact_id)
  }

  delete(factId: number) {
    this.db.prepare(`DELETE FROM facts_vec WHERE fact_id = ?`).run(factId)
  }
}
```

## Embedding service

```ts
import { pipeline } from '@xenova/transformers'

export class EmbeddingService {
  private model: any | null = null
  private cache = new LRU<string, Float32Array>(500)

  async embed(text: string): Promise<Float32Array> {
    const cached = this.cache.get(text)
    if (cached) return cached
    if (!this.model) {
      this.model = await pipeline('feature-extraction', config.embeddingModel)
    }
    const out = await this.model(text, { pooling: 'mean', normalize: true })
    const vec = new Float32Array(out.data)
    this.cache.set(text, vec)
    return vec
  }
}
```

Lazy-load: il modello (~80MB) viene scaricato in `.cache/transformers/` al primo `embed()`. Avvii successivi riusano la cache.

Modello consigliato: `Xenova/bge-small-en-v1.5` (384 dim, EN-focused, alta qualita per semantic similarity di testi corti come fatti KB).

## Supersede e soft delete

`supersedes_id` indica che un fatto vecchio è stato aggiornato. Nuovo fatto inserito, vecchio marcato:

```sql
UPDATE facts SET superseded_by = ? WHERE id = ?
```

Le query di lettura escludono `superseded_by IS NOT NULL`.

Soft delete: niente eliminazione fisica per `important` e `secondary`. Per `ephemeral`, eliminazione fisica al pruning quotidiano.

## Pruner ephemeral

Cron giornaliero (es. ogni 24h da boot, oppure ogni mattina alle 04:00):

```ts
async function pruneEphemeral() {
  const expiredIds = await repo.expiredEphemeralIds() // SELECT id FROM facts WHERE expires_at < NOW
  for (const id of expiredIds) {
    await vecStore.delete(id) // facts_vec è nullo per ephemeral, ma chiamata idempotente
    await repo.deleteFact(id)
  }
  log.info({ deleted: expiredIds.length }, 'ephemeral pruner done')
}
```

## Anti-bloat

Strategie per evitare crescita incontrollata di `secondary`:

1. **Prompt instruction**: l'AI ha istruzione di non emettere fatti già presenti, e di preferire `supersedes_id` quando aggiorna.
2. **Confidence threshold**: si potrebbe scartare auto fatti con `confidence < 0.5`. Non implementato in v1, future enhancement.
3. **Periodic compaction**: non in v1. Possibile future enhancement: scan dei `secondary` e merge di duplicati semantici.

## Cancellazione manuale di un fatto

Non c'è interfaccia ufficiale (out of scope v1). Vie possibili:

- Modifica diretta del `.db` con `sqlite3` CLI o DB Browser.
- In conversazione, far emettere un fact con `supersedes_id` che annulla quello vecchio (richiede l'AI cooperante).
