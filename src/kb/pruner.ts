// Daily cron: delete expired ephemeral facts from both `facts` and `facts_vec`.
// See docs/dev/06-kb-e-rag.md "Pruner ephemeral".

import type { Sqlite } from '../db/client.js'
import { deleteFact, expiredEphemeralIds } from '../db/repo.js'
import type { VecStore } from './vec.js'
import { log } from '../log.js'
import { ONE_DAY_MS } from '../config/constants.js'

type Timer = ReturnType<typeof setTimeout>

let intervalHandle: Timer | null = null

export function pruneEphemeralOnce(sqlite: Sqlite, vecStore: VecStore, now: number): number {
  const startedAt = Date.now()
  const ids = expiredEphemeralIds(sqlite, now)
  for (const id of ids) {
    vecStore.delete(id)
    deleteFact(sqlite, id)
  }
  log.info({ deletedCount: ids.length, durationMs: Date.now() - startedAt }, 'ephemeral pruner')
  return ids.length
}

export function startEphemeralPruner(sqlite: Sqlite, vecStore: VecStore): void {
  stopEphemeralPruner()
  const tick = (): void => {
    try {
      pruneEphemeralOnce(sqlite, vecStore, Date.now())
    } catch (err) {
      log.error({ err }, 'ephemeral pruner tick failed')
    }
  }
  // Run once shortly after boot, then every 24h.
  setTimeout(tick, 10_000).unref()
  intervalHandle = setInterval(tick, ONE_DAY_MS)
  intervalHandle.unref()
}

export function stopEphemeralPruner(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle)
    intervalHandle = null
  }
}
