/**
 * WhatsApp client wrapper.
 *
 * Wraps `whatsapp-web.js` (CJS package, consumed from ESM/NodeNext via the
 * `import pkg from '...'; const { Client, LocalAuth } = pkg` pattern).
 *
 * Exposes a `WhatsAppHandle` to the rest of the app so the dispatcher,
 * orchestrator, escalation channels, and boot reconciler never reach into
 * the raw `Client` (apart from the `client` escape hatch on the handle, used
 * when wweb-specific APIs are unavoidable — e.g. `getChats()` in the
 * reconciler, or `client.info.wid._serialized` in the escalation self-chat).
 *
 * Spec references:
 *   - docs/dev/02-architecture.md  (WhatsAppClient module table row)
 *   - docs/dev/03-data-flow.md     (Flow A: incoming; Flow D: out_manual
 *                                   distinction via id-tracker; Flow E/F: boot)
 *   - docs/dev/09-boot-reconciler.md (uses `client.getChats()`,
 *                                     `chat.fetchMessages({ limit })`)
 *   - docs/dev/12-logging-observability.md (QR pairing required; ready)
 *   - docs/dev/18-escalation.md    (WhatsApp self-chat -> `client.info.wid._serialized`)
 *
 * Key responsibilities:
 *   - Init wweb Client with persistent session (`LocalAuth({ dataPath })`)
 *     and headless puppeteer configured for server use (no sandbox).
 *   - QR pairing: print to stdout via `qrcode-terminal`, log warn.
 *   - Resolve `initWhatsApp` only on `ready` so callers can assume the
 *     handle is usable as soon as the promise settles.
 *   - Maintain a bounded in-memory set of bot-sent message ids (TTL-evicted
 *     after 5 min). `sendMessage` adds the id to the set BEFORE returning
 *     (and BEFORE awaiting any subsequent tick), so the synchronous
 *     `message_create` handler (Flow D) can classify the echo as `out_bot`
 *     instead of `out_manual`.
 *   - Provide thin `onIncoming` / `onMessageCreate` wrappers so the
 *     dispatcher doesn't bind directly to the raw client's events.
 */

import pkg from 'whatsapp-web.js'
import qrcode from 'qrcode-terminal'
import type { Client as WAClient, Message as WAMessage, Chat as WAChat } from 'whatsapp-web.js'

import { log } from '../log.js'
import { ensureCleanSession } from './pre-launch.js'

// CJS destructure under NodeNext ESM. `whatsapp-web.js` ships as
// `declare namespace WAWebJS { export class Client ... } export = WAWebJS`,
// which lands the runtime classes on the default import.
const { Client, LocalAuth } = pkg

// ---------------------------------------------------------------------------
// Public surface
// ---------------------------------------------------------------------------

export type IncomingHandler = (msg: WAMessage) => void | Promise<void>
export type MessageCreateHandler = (msg: WAMessage) => void | Promise<void>

/** Downloaded media payload returned by `WhatsAppHandle.downloadMedia`. */
export interface DownloadedMedia {
  mime: string
  base64: string
  filename: string | null
}

export interface WhatsAppHandle {
  /** Raw whatsapp-web.js Client. Use only for APIs not surfaced here. */
  readonly client: WAClient
  /**
   * Send a text message. The resulting message id is tracked synchronously
   * (before this function returns) so `message_create` can distinguish
   * bot-originated echoes from manual sends. See Flow D.
   */
  sendMessage(chatId: string, text: string): Promise<WAMessage>
  /** Wrapper over `Chat.fetchMessages({ limit })`. */
  fetchMessages(chatId: string, limit: number): Promise<WAMessage[]>
  /** Wrapper over `client.getChatById(chatId)`. */
  getChat(chatId: string): Promise<WAChat>
  /**
   * Return the bot's own serialized WID (e.g. `391234567@c.us`). Lazily
   * cached after the first successful resolution. Used by the WhatsApp
   * self-chat escalation channel (see docs/dev/18-escalation.md).
   */
  getSelfWid(): string
  /**
   * True iff this message is the echo of a `sendMessage` we issued.
   * Strict path: exact id match. Fuzzy path (when chatId+body supplied): match
   * against recent sends to the same chat to handle wweb's @lid id-rewrite race.
   */
  isBotSent(msgId: string, chatId?: string, body?: string): boolean
  /**
   * Resolve a WhatsApp `@lid` (Linked Identifier) to the real E.164 phone, when
   * possible. Returns `+393xxx` if the lid corresponds to a SAVED contact on
   * the paired device; `null` otherwise (unsaved → WhatsApp privacy hides it).
   * Uses wweb 1.34.x `client.getContactLidAndPhone([id])`.
   */
  resolveLidPhone(serializedId: string): Promise<string | null>
  /**
   * Download the media attached to an incoming message (image / audio / video
   * / document / sticker). Returns `null` if the media is missing, expired,
   * or the download fails. Bytes are returned in memory; the caller is
   * responsible for routing them to the AI pipeline or discarding them. The
   * bytes MUST NOT be persisted to DB or disk (Spec A privacy stance).
   */
  downloadMedia(msg: WAMessage): Promise<DownloadedMedia | null>
  /** Subscribe to `message` (incoming only). */
  onIncoming(handler: IncomingHandler): () => void
  /** Subscribe to `message_create` (every created message, incl. fromMe). */
  onMessageCreate(handler: MessageCreateHandler): () => void
}

// ---------------------------------------------------------------------------
// Internal: bot-sent id tracker with TTL eviction.
// ---------------------------------------------------------------------------

const BOT_SENT_TTL_MS = 5 * 60_000
const BOT_SENT_FUZZY_WINDOW_MS = 15_000

class BotSentTracker {
  // Strict path: exact msg id match (works when wweb's `sendMessage` returns
  // the same id WhatsApp later echoes in `message_create`).
  private readonly ids: Set<string> = new Set()
  // Fuzzy path: (chatId -> [{ body, ts }]). Covers the @lid case where wweb
  // may rewrite the id between send and echo (or the echo arrives before the
  // sendMessage promise resolves, leaving the id-tracker empty).
  private readonly recentSends = new Map<string, Array<{ body: string; ts: number }>>()

  add(id: string): void {
    this.ids.add(id)
    setTimeout(() => {
      this.ids.delete(id)
    }, BOT_SENT_TTL_MS).unref?.()
  }

  addRecent(chatId: string, body: string): void {
    const list = this.recentSends.get(chatId) ?? []
    list.push({ body, ts: Date.now() })
    // Drop entries older than the fuzzy window inline so the map stays small.
    const cutoff = Date.now() - BOT_SENT_FUZZY_WINDOW_MS
    while (list.length > 0 && list[0]!.ts < cutoff) list.shift()
    this.recentSends.set(chatId, list)
  }

  has(id: string): boolean {
    return this.ids.has(id)
  }

  matches(msgId: string, chatId: string | undefined, body: string | undefined): boolean {
    if (this.ids.has(msgId)) return true
    if (!chatId) return false
    const list = this.recentSends.get(chatId)
    if (!list || list.length === 0) return false
    const now = Date.now()
    const cutoff = now - BOT_SENT_FUZZY_WINDOW_MS
    // Match either: any send within window (covers empty/sticker echoes where
    // body comparison fails), or a body-exact send within window.
    for (let i = list.length - 1; i >= 0; i--) {
      const entry = list[i]!
      if (entry.ts < cutoff) break
      if (body !== undefined && entry.body === body) return true
      // Bare-window match: if the echo arrives within ~3s of a send to the
      // same chat, it's almost certainly ours. Tighter than the full window.
      if (now - entry.ts < 3_000) return true
    }
    return false
  }
}

// ---------------------------------------------------------------------------
// initWhatsApp
// ---------------------------------------------------------------------------

/**
 * Initialize the WhatsApp client and resolve once `ready` fires.
 *
 * @param sessionDir - directory passed to `LocalAuth({ dataPath })`. The
 *   wweb session (Chromium profile + auth payload) persists here across
 *   restarts. Should match `config.sessionDir`.
 *
 * The returned promise rejects only if `initialize()` itself throws before
 * `ready`. Disconnect/auth-failure after `ready` are handled by the
 * `ConnectionStateMachine` consumer (this module only logs them).
 */
export async function initWhatsApp(sessionDir: string): Promise<WhatsAppHandle> {
  // Kill any stale Chromium puppeteered against THIS session dir from a previous
  // run that didn't shut down cleanly. Idempotent + safe on first run.
  ensureCleanSession(sessionDir)

  const tracker = new BotSentTracker()

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: sessionDir }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
  })

  // QR pairing: render to stdout (NOT to the rotating log file, per privacy
  // notes in docs/dev/12-logging-observability.md) and emit a warn log line.
  client.on('qr', (qr: string) => {
    qrcode.generate(qr, { small: true })
    log.warn('QR pairing required')
  })

  client.on('authenticated', () => {
    log.info('whatsapp authenticated')
  })

  client.on('auth_failure', (msg: string) => {
    log.error({ reason: msg }, 'whatsapp auth_failure')
  })

  client.on('disconnected', (reason: string) => {
    log.warn({ reason }, 'whatsapp disconnected')
  })

  // Loading-screen progress is useful to see during the long initial sync.
  client.on('loading_screen', (percent: number, message: string) => {
    log.info({ percent, message }, 'whatsapp loading')
  })

  // State changes (CONFLICT, OPENING, PAIRING, UNPAIRED, etc).
  client.on('change_state', (state: string) => {
    log.info({ state }, 'whatsapp change_state')
  })

  // Wait for `ready` before resolving so the caller never sees a half-init
  // client (e.g. one where `client.info` is undefined).
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const onReady = (): void => {
      if (settled) return
      settled = true
      log.info('whatsapp ready')
      resolve()
    }
    const onAuthFailure = (msg: string): void => {
      if (settled) return
      settled = true
      reject(new Error(`whatsapp auth_failure: ${msg}`))
    }
    client.once('ready', onReady)
    client.once('auth_failure', onAuthFailure)

    client.initialize().catch((err: unknown) => {
      if (settled) return
      settled = true
      reject(err instanceof Error ? err : new Error(String(err)))
    })
  })

  // Dump the paired account so the user can verify which WhatsApp number wweb
  // is bound to. Common gotcha: user thinks they paired +X but actually scanned
  // the QR with the +Y phone.
  try {
    const info = (
      client as unknown as {
        info?: {
          wid?: { _serialized?: string; user?: string }
          pushname?: string
          platform?: string
        }
      }
    ).info
    log.info(
      {
        wid: info?.wid?._serialized,
        user: info?.wid?.user,
        pushname: info?.pushname,
        platform: info?.platform,
      },
      'whatsapp paired account'
    )
  } catch (err) {
    log.warn({ err: (err as Error).message }, 'could not read client.info after ready')
  }

  // Heartbeat: every 30s log connection state + chat count. Surfaces silent
  // wweb desyncs (paired but no events flowing).
  const heartbeat = setInterval(() => {
    void (async () => {
      try {
        const state = await (client as unknown as { getState: () => Promise<string> }).getState()
        const chats = await (client as unknown as { getChats: () => Promise<unknown[]> }).getChats()
        log.info({ state, chatsCount: chats.length }, 'whatsapp heartbeat')
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'whatsapp heartbeat failed')
      }
    })()
  }, 30_000)
  heartbeat.unref()

  // Lazy-cached self WID. `client.info` is guaranteed populated post-ready.
  let cachedSelfWid: string | null = null

  const handle: WhatsAppHandle = {
    client,

    async sendMessage(chatId, text) {
      // Two-tier dedup so the `message_create` echo never gets mis-classified
      // as `out_manual`:
      //   1) recentSends entry BEFORE the network call — covers the race where
      //      wweb fires `message_create` before our `await` resolves.
      //   2) exact id AFTER the call resolves — covers the strict-id path.
      tracker.addRecent(chatId, text)
      const sent = await client.sendMessage(chatId, text)
      tracker.add(sent.id._serialized)
      return sent
    },

    async fetchMessages(chatId, limit) {
      const chat = await client.getChatById(chatId)
      return chat.fetchMessages({ limit })
    },

    async getChat(chatId) {
      return client.getChatById(chatId)
    },

    getSelfWid() {
      if (cachedSelfWid !== null) return cachedSelfWid
      const wid = client.info?.wid?._serialized
      if (!wid) {
        throw new Error('getSelfWid: client.info.wid not available (not ready?)')
      }
      cachedSelfWid = wid
      return wid
    },

    isBotSent(msgId, chatId, body) {
      return tracker.matches(msgId, chatId, body)
    },

    async resolveLidPhone(serializedId) {
      try {
        const c = client as unknown as {
          getContactLidAndPhone: (
            ids: string[]
          ) => Promise<Array<{ lid?: string | null; pn?: string | null }>>
        }
        if (typeof c.getContactLidAndPhone !== 'function') return null
        const results = await c.getContactLidAndPhone([serializedId])
        const r = results?.[0]
        const pn = r?.pn ?? null
        if (!pn) return null
        const m = String(pn).match(/^(\d+)@/)
        return m && m[1] ? '+' + m[1] : null
      } catch (err) {
        log.warn({ err: (err as Error).message, id: serializedId }, 'resolveLidPhone failed')
        return null
      }
    },

    async downloadMedia(msg) {
      try {
        const m = msg as unknown as {
          downloadMedia?: () => Promise<
            { mimetype?: string; data?: string; filename?: string | null } | undefined | null
          >
          hasMedia?: boolean
          type?: string
          id?: { _serialized?: string }
        }
        if (typeof m.downloadMedia !== 'function') return null
        const media = await m.downloadMedia()
        if (!media || !media.data || !media.mimetype) {
          log.warn(
            { msgId: m.id?._serialized, type: m.type },
            'downloadMedia returned empty payload'
          )
          return null
        }
        return {
          mime: media.mimetype,
          base64: media.data,
          filename: media.filename ?? null,
        }
      } catch (err) {
        log.warn(
          { err: (err as Error).message, msgId: msg.id?._serialized },
          'downloadMedia failed'
        )
        return null
      }
    },

    onIncoming(handler) {
      const wrapped = (msg: WAMessage): void => {
        log.info(
          {
            event: 'message',
            from: msg.from,
            to: msg.to,
            fromMe: msg.fromMe,
            type: msg.type,
            msgId: msg.id?._serialized,
          },
          'wweb event'
        )
        void Promise.resolve(handler(msg)).catch((err: unknown) => {
          log.error({ err }, 'onIncoming handler threw')
        })
      }
      client.on('message', wrapped)
      return () => {
        client.off('message', wrapped)
      }
    },

    onMessageCreate(handler) {
      const wrapped = (msg: WAMessage): void => {
        log.info(
          {
            event: 'message_create',
            from: msg.from,
            to: msg.to,
            fromMe: msg.fromMe,
            type: msg.type,
            msgId: msg.id?._serialized,
          },
          'wweb event'
        )
        void Promise.resolve(handler(msg)).catch((err: unknown) => {
          log.error({ err }, 'onMessageCreate handler threw')
        })
      }
      client.on('message_create', wrapped)
      return () => {
        client.off('message_create', wrapped)
      }
    },
  }

  return handle
}
