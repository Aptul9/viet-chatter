// Knowledge-base store: persistence of extracted facts and 3-tier retrieval
// for the per-turn TurnContext. See docs/dev/06-kb-and-rag.md.
//
// All DB access goes through repo.ts; this module only orchestrates the
// fact-insert pipeline (embed secondary, supersede, create date_anchored
// manual_jobs) and assembles the KB bundle for the orchestrator.

import type { Sqlite } from '../db/client.js'
import {
  insertFact,
  insertManualJob,
  loadActiveEphemeral,
  loadFactsByIds,
  loadImportant,
  markSuperseded,
} from '../db/repo.js'
import type { VecStore } from './vec.js'
import { EmbeddingService } from './embedding.js'
import { config } from '../config/index.js'
import { log } from '../log.js'
import type { ChatId, ExtractedFact, FactRow, KBBundle } from '../types.js'
import { DATE_ANCHORED_FIRE_HOUR, DATE_ANCHORED_JITTER_MAX_MIN } from '../config/constants.js'

export interface KbDeps {
  sqlite: Sqlite
  vecStore: VecStore
  embedding: EmbeddingService
}

/**
 * Persist a batch of AI-extracted facts. Pipeline per `docs/dev/06-kb-and-rag.md`:
 *  - insert into `facts` with tier-correct expiry
 *  - embed + upsert into `facts_vec` when tier === 'secondary'
 *  - on supersedes_id: mark old row superseded_by new id
 *  - on anchor_date: create a date_anchored manual_jobs row
 */
export async function persistExtractedFacts(
  deps: KbDeps,
  personId: ChatId,
  facts: ExtractedFact[],
  now: number
): Promise<void> {
  for (const f of facts) {
    const expiresAt =
      f.tier === 'ephemeral' ? now + (f.ttl_days ?? config.ephemeralTtlDays) * 86_400_000 : null
    const id = insertFact(deps.sqlite, {
      personId,
      tier: f.tier,
      content: f.content,
      sourceMsgId: null,
      confidence: f.confidence,
      createdAt: now,
      expiresAt,
    })

    if (f.tier === 'secondary') {
      try {
        const emb = await deps.embedding.embed(f.content)
        deps.vecStore.upsert(id, emb)
      } catch (err) {
        log.error({ err, factId: id }, 'embedding upsert failed')
      }
    }

    if (typeof f.supersedes_id === 'number') {
      markSuperseded(deps.sqlite, f.supersedes_id, id)
    }

    if (f.anchor_date) {
      const fireAt = nextOccurrence(f.anchor_date, f.anchor_recurring ?? null)
      insertManualJob(deps.sqlite, {
        chatId: personId,
        kind: 'date_anchored',
        fireAt,
        payload: JSON.stringify({ action: f.anchor_action ?? null, fact_id: id }),
        status: 'pending',
        createdAt: now,
        attemptCount: null,
      })
    }
  }
}

/** Build the per-turn KB bundle: important + ephemeral + RAG-retrieved secondary. */
export async function loadKB(
  deps: KbDeps,
  personId: ChatId,
  recentIncomingBody: string,
  now: number
): Promise<KBBundle> {
  const important = loadImportant(deps.sqlite, personId)
  const ephemeral = loadActiveEphemeral(deps.sqlite, personId)
  void now

  let secondary: FactRow[] = []
  const trimmed = recentIncomingBody.trim()
  if (trimmed.length > 0) {
    try {
      const qEmb = await deps.embedding.embed(trimmed)
      const ids = deps.vecStore.search(personId, qEmb, config.ragTopK)
      if (ids.length > 0) {
        secondary = loadFactsByIds(deps.sqlite, ids)
      }
    } catch (err) {
      log.error({ err, personId }, 'KB secondary retrieval failed')
    }
  }

  return { important, ephemeral, secondary }
}

/**
 * Compute the next fire time for a date_anchored fact.
 *  - YYYY-MM-DD: one-shot fixed date.
 *  - MM-DD: yearly recurring; bump to next year if already past.
 * Local fire window: 09:00 + random jitter up to 60 minutes (process tz).
 */
export function nextOccurrence(anchorDate: string, recurring: 'yearly' | null): number {
  const now = new Date()
  let target: Date

  if (/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) {
    const [y, m, d] = anchorDate.split('-').map(Number) as [number, number, number]
    target = new Date(y, m - 1, d, DATE_ANCHORED_FIRE_HOUR, 0, 0)
  } else if (/^\d{2}-\d{2}$/.test(anchorDate)) {
    const [m, d] = anchorDate.split('-').map(Number) as [number, number]
    target = new Date(now.getFullYear(), m - 1, d, DATE_ANCHORED_FIRE_HOUR, 0, 0)
    if (target.getTime() <= now.getTime()) {
      target = new Date(now.getFullYear() + 1, m - 1, d, DATE_ANCHORED_FIRE_HOUR, 0, 0)
    }
  } else {
    throw new Error(`invalid anchor_date format: ${anchorDate}`)
  }

  const jitterMin = Math.floor(Math.random() * DATE_ANCHORED_JITTER_MAX_MIN)
  target.setMinutes(target.getMinutes() + jitterMin)

  if (recurring && recurring !== 'yearly') {
    log.warn({ recurring }, 'unknown anchor_recurring value; treating as one-shot')
  }
  return target.getTime()
}
