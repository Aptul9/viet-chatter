# KB and RAG

> Status: design; behavior implemented.

## 3-tier model

| Tier        | Description                                                                                                                   | Embedding | Prompt loading     | TTL                     |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------ | ----------------------- |
| `important` | Events that redefine the person (bereavements, illnesses, separations, milestones). Few per person (5-20 stable).             | NO        | Always all          | Never                   |
| `secondary` | Interesting details (work, hobbies, tastes, recurring details). Grow over time (potentially hundreds per person).             | YES       | Top-K via RAG       | Never (unless superseded) |
| `ephemeral` | Time-limited facts (plans, appointments, temporary states).                                                                   | NO        | Always all          | 7 days default          |

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

Virtual table sqlite-vec (manual in migration `0000_init.sql`):

```sql
CREATE VIRTUAL TABLE facts_vec USING vec0(
  fact_id   INTEGER PRIMARY KEY,
  embedding FLOAT[384]
);
```

## Extraction (AI output)

The AI in the `TurnOutput` produces `extracted_facts: ExtractedFact[]`:

```ts
type ExtractedFact = {
  tier: 'important' | 'secondary' | 'ephemeral'
  content: string // 1-2 sentences English
  confidence: number // 0..1
  ttl_days?: number // only for ephemeral, default 7
  supersedes_id?: number // replaces existing fact
  anchor_date?: string // YYYY-MM-DD for fixed date, MM-DD for yearly recurring
  anchor_recurring?: 'yearly' | null
  anchor_action?: 'wish_birthday' | 'follow_up' | string
}
```

## Insert pipeline

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

## Per-turn retrieval

```ts
async function loadKB(personId: string, recentIncomingBody: string) {
  const important = await repo.loadImportant(personId) // all
  const ephemeral = await repo.loadActiveEphemeral(personId) // all non-expired
  const qEmb = await embedding.embed(recentIncomingBody)
  const secondaryIds = await vecStore.search(personId, qEmb, config.ragTopK)
  const secondary = await repo.loadFactsByIds(secondaryIds)
  return { important, ephemeral, secondary }
}
```

## VecStore (interface)

```ts
export interface VecStore {
  upsert(factId: number, embedding: Float32Array): Promise<void>
  search(personId: string, qEmb: Float32Array, k: number): Promise<number[]>
  delete(factId: number): Promise<void>
}
```

Concrete implementation `SqliteVecStore`:

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

Lazy-load: the model (~80MB) is downloaded to `.cache/transformers/` on the first `embed()`. Later runs reuse the cache.

Recommended model: `Xenova/bge-small-en-v1.5` (384 dim, EN-focused, high quality for semantic similarity of short texts like KB facts).

## Supersede and soft delete

`supersedes_id` indicates that an old fact has been updated. New fact inserted, old marked:

```sql
UPDATE facts SET superseded_by = ? WHERE id = ?
```

Read queries exclude `superseded_by IS NOT NULL`.

Soft delete: no physical deletion for `important` and `secondary`. For `ephemeral`, physical deletion at daily pruning.

## Ephemeral pruner

Daily cron (e.g. every 24h since boot, or every morning at 04:00):

```ts
async function pruneEphemeral() {
  const expiredIds = await repo.expiredEphemeralIds() // SELECT id FROM facts WHERE expires_at < NOW
  for (const id of expiredIds) {
    await vecStore.delete(id) // facts_vec is null for ephemeral, but idempotent call
    await repo.deleteFact(id)
  }
  log.info({ deleted: expiredIds.length }, 'ephemeral pruner done')
}
```

## Anti-bloat

Strategies to avoid uncontrolled growth of `secondary`:

1. **Prompt instruction**: the AI is instructed not to emit already-present facts, and to prefer `supersedes_id` when updating.
2. **Confidence threshold**: facts with `confidence < 0.5` could be auto-discarded. Not implemented in v1, future enhancement.
3. **Periodic compaction**: not in v1. Possible future enhancement: scan of `secondary` and merge of semantic duplicates.

## Manual fact deletion

There is no official interface (out of scope v1). Possible paths:

- Direct edit of the `.db` with `sqlite3` CLI or DB Browser.
- In conversation, have the AI emit a fact with `supersedes_id` that cancels the old one (requires the AI to cooperate).
