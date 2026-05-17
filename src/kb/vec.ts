// VecStore: abstract interface + sqlite-vec implementation.
// Confines all knowledge of `facts_vec` virtual table to this module so a
// future swap to PgvectorStore is a single point of change.
// See docs/dev/06-kb-and-rag.md "VecStore" + docs/dev/14-postgres-portability.md.

import type { Sqlite } from '../db/client.js'

export interface VecStore {
  upsert(factId: number, embedding: Float32Array): void
  search(personId: string, qEmb: Float32Array, k: number): number[]
  delete(factId: number): void
}

export class SqliteVecStore implements VecStore {
  constructor(private readonly sqlite: Sqlite) {}

  upsert(factId: number, embedding: Float32Array): void {
    this.sqlite
      .prepare(`INSERT OR REPLACE INTO facts_vec(fact_id, embedding) VALUES (?, ?)`)
      .run(factId, Buffer.from(embedding.buffer))
  }

  search(personId: string, qEmb: Float32Array, k: number): number[] {
    const rows = this.sqlite
      .prepare(
        `SELECT v.fact_id AS fact_id
         FROM facts_vec v
         JOIN facts f ON f.id = v.fact_id
         WHERE f.person_id = ?
           AND f.tier = 'secondary'
           AND f.superseded_by IS NULL
         ORDER BY vec_distance_cosine(v.embedding, ?)
         LIMIT ?`
      )
      .all(personId, Buffer.from(qEmb.buffer), k) as Array<{ fact_id: number }>
    return rows.map((r) => r.fact_id)
  }

  delete(factId: number): void {
    this.sqlite.prepare(`DELETE FROM facts_vec WHERE fact_id = ?`).run(factId)
  }
}
