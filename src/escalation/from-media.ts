// Direct media-driven escalation (Spec A).
//
// When the media-policy resolver returns `strategy='escalate'` (audio, video,
// document, location, live_location, vcard, unknown), the dispatcher creates
// an escalation row WITHOUT invoking the AI. The triggering message is the
// non-text one itself; the summary is templated locally.
//
// This is intentionally NOT inside the orchestrator: the orchestrator owns the
// AI pipeline and a media-only branch has nothing to do with TurnContext or
// the state machine. Keeping it separate also means the dispatcher can fire
// the escalation synchronously and return — no debounce, no scheduler hop.

import type { Sqlite } from '../db/client.js'
import { insertEscalation } from '../db/repo.js'
import type { EscalationNotifier } from './notifier.js'
import { log } from '../log.js'
import type { ChatId, MediaType, WhatsappMsgId } from '../types.js'

const LABEL_BY_TYPE: Record<MediaType, string> = {
  chat: 'Messaggio testo',
  image: 'Immagine',
  sticker: 'Sticker',
  audio: 'Messaggio audio',
  ptt: 'Messaggio vocale',
  video: 'Video',
  document: 'Documento',
  location: 'Posizione',
  live_location: 'Posizione live',
  vcard: 'Contatto',
  unknown: 'Messaggio non testuale',
}

export interface MediaEscalationArgs {
  sqlite: Sqlite
  notifier: EscalationNotifier
  chatId: ChatId
  triggerMsgId: WhatsappMsgId
  mediaType: MediaType
  /** Optional caption attached to the media (text body). */
  caption: string
  /** Optional display name, used in the summary. */
  displayName: string | null
}

export function escalateMedia(args: MediaEscalationArgs): number {
  const label = LABEL_BY_TYPE[args.mediaType] ?? LABEL_BY_TYPE.unknown
  const sender = args.displayName ?? args.chatId
  const captionPart = args.caption.trim().length > 0 ? ` Didascalia: "${args.caption.trim()}".` : ''
  const summary = `${label} ricevuto da ${sender}.${captionPart} Vai a controllare la chat.`

  const escId = insertEscalation(args.sqlite, {
    chatId: args.chatId,
    triggerMsgId: args.triggerMsgId,
    reason: 'other',
    urgency: 'normal',
    summary,
    holdingReplySent: false,
    status: 'pending',
    createdAt: Date.now(),
    notifiedChannels: [],
  })

  log.info(
    { escId, chatId: args.chatId, mediaType: args.mediaType, captionLen: args.caption.length },
    'media escalation created'
  )

  void args.notifier.notify(escId).catch((err: unknown) => {
    log.error(
      { err: err instanceof Error ? err.message : String(err), escId },
      'media escalation notify failed'
    )
  })

  return escId
}
