// Entry point. Wires all modules in the order required by docs/dev/13-project-layout.md.

// Load .env at the very top so process.env is populated before any module that
// reads from it (e.g. escalation/channels/telegram.ts reads TELEGRAM_BOT_TOKEN
// and TELEGRAM_USER_CHAT_ID). Silently no-ops if .env is missing.
import 'dotenv/config'

import { initConfig, config, __overrideConfigForTest } from './config/index.js'
import { log, setLogLevel } from './log.js'
import { openDb } from './db/client.js'
import { initWhatsApp } from './whatsapp/client.js'
import { ConnectionStateMachine } from './whatsapp/connection.js'
import { MessageDispatcher } from './dispatcher/index.js'
import { ChatStateMachine } from './scheduler/state.js'
import { InflightRegistry } from './orchestrator/inflight.js'
import { MediaQueue } from './orchestrator/media-queue.js'
import { ReplyOrchestrator } from './orchestrator/index.js'
import { EmbeddingService } from './kb/embedding.js'
import { SqliteVecStore } from './kb/vec.js'
import { startTicker, stopTicker, type TurnRunner } from './scheduler/ticker.js'
import {
  startManualJobsCron,
  stopManualJobsCron,
  type ManualJobRunner,
} from './scheduler/manual-jobs-cron.js'
import { startEphemeralPruner, stopEphemeralPruner } from './kb/pruner.js'
import { runReconciler } from './boot/reconciler.js'
import { ensureOpencodeServer, stopOpencodeServer } from './ai/opencode.js'
import { buildEscalationChannels } from './escalation/channels/index.js'
import { TelegramChannel } from './escalation/channels/telegram.js'
import { EscalationNotifier } from './escalation/notifier.js'
import { startEscalationRetry, stopEscalationRetry } from './escalation/retry.js'
import { getFailureTracker } from './utils/failure-tracker.js'

async function main(): Promise<void> {
  log.info({ pid: process.pid, nodeVersion: process.version }, 'boot start')

  await initConfig()
  // Spec B: e2e harness can redirect logs and DB to per-scenario paths via
  // env vars, so multiple scenarios don't trample each other's state.
  // `BOT_E2E_MODE=1` gates the override helper; the harness sets it too.
  if (process.env['BOT_E2E_MODE'] === '1') {
    const overrides: Partial<typeof config> = {}
    const logPath = process.env['BOT_E2E_LOG_PATH']
    const dbPath = process.env['BOT_E2E_DB_PATH']
    if (logPath) overrides.logFile = logPath
    if (dbPath) overrides.dbPath = dbPath
    if (Object.keys(overrides).length > 0) __overrideConfigForTest(overrides)
  }
  // Honor the YAML/UI-driven log level (overrides the env-default in src/log.ts).
  setLogLevel(config.logLevel)
  const { sqlite } = openDb(config.dbPath)
  log.info({ dbPath: config.dbPath }, 'db opened')

  await ensureOpencodeServer('boot')

  const wa = await initWhatsApp(config.sessionDir)
  log.info('whatsapp ready')

  const connection = new ConnectionStateMachine()
  connection.start()
  connection.setState('CONNECTED', 'initial')

  const inflight = new InflightRegistry()
  const state = new ChatStateMachine(sqlite)
  const mediaQueue = new MediaQueue()
  const embedding = new EmbeddingService(config.embeddingModel)
  const vecStore = new SqliteVecStore(sqlite)

  const escalationChannels = buildEscalationChannels({ wa })
  const escalationNotifier = new EscalationNotifier({ sqlite, channels: escalationChannels, wa })

  // Hook failure-tracker alerts to Telegram. If telegram channel isn't
  // configured (or fails to initialize), alerts still log via the warn path
  // inside the tracker — they just don't make it to your phone.
  const telegramChannel = escalationChannels.find((c) => c.name === 'telegram') as
    | TelegramChannel
    | undefined
  if (telegramChannel) {
    getFailureTracker().setAlertSink(async (payload) => {
      const ok = await telegramChannel.sendSystemAlert(payload.text)
      if (!ok) log.warn({ reason: payload.reason }, 'failure alert: telegram send failed')
    })
  } else {
    log.warn('telegram channel not configured; failure alerts will only hit logs')
  }

  const orchestrator = new ReplyOrchestrator({
    sqlite,
    wa,
    state,
    inflight,
    mediaQueue,
    embedding,
    vecStore,
    escalationNotifier,
  })

  const dispatcher = new MessageDispatcher({
    sqlite,
    wa,
    state,
    inflight,
    mediaQueue,
    escalationNotifier,
  })
  dispatcher.start()

  await runReconciler({ sqlite, wa, dispatcher })

  // wweb's multi-device sync trickles chats in over the first 30-90s after
  // boot. The initial reconciler may have run before any real chat showed up
  // in `client.getChats()`. Re-run after delays to catch late-syncing chats.
  // Each pass is idempotent via `processed_messages.whatsapp_msg_id` PK.
  for (const delayMs of [15_000, 45_000, 120_000]) {
    setTimeout(() => {
      runReconciler({ sqlite, wa, dispatcher }).catch((err) =>
        log.warn(
          { err: err instanceof Error ? err.message : String(err) },
          'delayed reconciler failed'
        )
      )
    }, delayMs).unref()
  }

  const registerInflight = (chatId: string): AbortSignal => inflight.register(chatId).signal
  const isConnected = (): boolean => connection.getState() === 'CONNECTED'

  const turnRunner: TurnRunner = (chatId, signal, retryCtx) =>
    orchestrator.generateAndSend(chatId, signal, retryCtx)
  const manualJobRunner: ManualJobRunner = (chatId, ctx, signal, retryCtx) =>
    orchestrator.generateAndSendForManualJob(chatId, ctx, signal, retryCtx)

  startTicker({ sqlite, state, runTurn: turnRunner, registerInflight, isConnected })
  startManualJobsCron({
    sqlite,
    state,
    runManualJob: manualJobRunner,
    runReactiveTurn: turnRunner,
    registerInflight,
    isConnected,
  })
  startEphemeralPruner(sqlite, vecStore)
  startEscalationRetry({ sqlite, notifier: escalationNotifier })

  log.info('boot done')

  let shuttingDown = false
  const shutdown = async (reason: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    log.info({ reason }, 'shutdown')
    try {
      stopTicker()
    } catch {
      /* noop */
    }
    try {
      stopManualJobsCron()
    } catch {
      /* noop */
    }
    try {
      stopEphemeralPruner()
    } catch {
      /* noop */
    }
    try {
      stopEscalationRetry()
    } catch {
      /* noop */
    }
    try {
      await stopOpencodeServer()
    } catch (err) {
      log.error({ err }, 'stopOpencodeServer error')
    }
    try {
      sqlite.close()
    } catch (err) {
      log.error({ err }, 'sqlite close error')
    }
    try {
      await wa.client.destroy()
    } catch (err) {
      log.error({ err }, 'wa destroy error')
    }
    process.exit(0)
  }
  process.on('SIGINT', (s) => {
    void shutdown(s)
  })
  process.on('SIGTERM', (s) => {
    void shutdown(s)
  })
  process.on('SIGHUP', (s) => {
    void shutdown(s)
  })
  process.on('uncaughtException', (err) => {
    log.error({ err: err.message, stack: err.stack }, 'uncaughtException')
    void shutdown('uncaughtException')
  })
  process.on('unhandledRejection', (reason) => {
    log.error(
      { reason: reason instanceof Error ? reason.message : String(reason) },
      'unhandledRejection'
    )
    void shutdown('unhandledRejection')
  })
}

main().catch((err) => {
  log.error(
    {
      err: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    },
    'fatal boot error'
  )
  process.exit(1)
})
