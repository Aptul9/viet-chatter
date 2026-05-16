// CLI self-check: `npm run health`. Read-only DB queries + env presence checks.
// Schema per docs/dev/12-logging-observability.md "self-check".

import 'dotenv/config'
import { existsSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import { initConfig, config } from '../config/index.js'
import { openDb } from '../db/client.js'

interface ChatStateBreakdown {
  IDLE: number
  ACCUMULATING: number
  SCHEDULED: number
  SENDING: number
}

async function main(): Promise<void> {
  await initConfig()
  const dbPath = config.dbPath
  if (!existsSync(dbPath)) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ ok: false, msg: 'db not found', dbPath }))
    process.exit(2)
  }
  const { sqlite } = openDb(dbPath)
  try {
    const chatsTotal = single<number>(sqlite, 'SELECT COUNT(*) AS c FROM chat_state', 'c')
    const breakdownRows = sqlite
      .prepare('SELECT state, COUNT(*) AS c FROM chat_state GROUP BY state')
      .all() as Array<{ state: string; c: number }>
    const breakdown: ChatStateBreakdown = { IDLE: 0, ACCUMULATING: 0, SCHEDULED: 0, SENDING: 0 }
    for (const r of breakdownRows) {
      if (r.state in breakdown) (breakdown as unknown as Record<string, number>)[r.state] = r.c
    }
    const manualPending = single<number>(
      sqlite,
      "SELECT COUNT(*) AS c FROM manual_jobs WHERE status='pending'",
      'c'
    )
    const lastTurn = sqlite
      .prepare('SELECT chat_id, ts, status, language_used FROM turn_log ORDER BY ts DESC LIMIT 1')
      .get() as Record<string, unknown> | undefined
    const factsTotal = single<number>(sqlite, 'SELECT COUNT(*) AS c FROM facts', 'c')

    const cacheDir = resolvePath(process.cwd(), '.cache/transformers')
    const embeddingPresent = existsSync(cacheDir)

    const now = Date.now()
    const since24h = now - 24 * 60 * 60_000
    const escPending = single<number>(
      sqlite,
      "SELECT COUNT(*) AS c FROM escalations WHERE status='pending'",
      'c'
    )
    const escResolved = single<number>(
      sqlite,
      "SELECT COUNT(*) AS c FROM escalations WHERE status IN ('user_replied','superseded') AND resolved_at > ?",
      'c',
      [since24h]
    )
    const escFailed = single<number>(
      sqlite,
      "SELECT COUNT(*) AS c FROM escalations WHERE notified_channels='[]' AND created_at > ?",
      'c',
      [since24h]
    )

    const telegramConfigured =
      !!process.env[config.escalation.telegramBotTokenEnv] &&
      !!process.env[config.escalation.telegramChatIdEnv]

    const out = {
      ok: true,
      db_path: dbPath,
      chats_total: chatsTotal,
      chat_state_breakdown: breakdown,
      manual_jobs_pending: manualPending,
      last_turn: lastTurn ?? null,
      facts_total: factsTotal,
      embedding_model_present: embeddingPresent,
      escalations: {
        pending: escPending,
        resolved_24h: escResolved,
        failed_to_notify_24h: escFailed,
      },
      telegram_configured: telegramConfigured,
    }
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out, null, 2))
  } finally {
    sqlite.close()
  }
}

function single<T>(
  sqlite: ReturnType<typeof openDb>['sqlite'],
  sql: string,
  col: string,
  params: unknown[] = []
): T {
  const row = sqlite.prepare(sql).get(...params) as Record<string, unknown> | undefined
  return (row?.[col] ?? 0) as T
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({ ok: false, err: err instanceof Error ? err.message : String(err) })
    )
    process.exit(1)
  })
