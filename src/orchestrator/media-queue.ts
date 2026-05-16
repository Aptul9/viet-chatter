// MediaQueue (Spec A).
//
// In-memory queue of media payloads waiting to be folded into the next AI turn
// for a chat. The dispatcher pushes after a successful `downloadMedia`; the
// orchestrator drains at fire time and passes the bytes to `generateTurn`.
//
// Bytes are NEVER persisted to DB or disk. The queue is a Map<chatId, list>
// with bounded size per chat (drop oldest beyond cap). On process exit
// everything is lost — acceptable because media older than the debounce window
// will already have been processed.

import type { ChatId, PendingMedia } from '../types.js'

const MAX_PENDING_PER_CHAT = 5

export class MediaQueue {
  private readonly q = new Map<ChatId, PendingMedia[]>()

  push(chatId: ChatId, media: PendingMedia): void {
    const existing = this.q.get(chatId) ?? []
    existing.push(media)
    while (existing.length > MAX_PENDING_PER_CHAT) existing.shift()
    this.q.set(chatId, existing)
  }

  /** Return current pending media (a defensive copy) without consuming it. */
  peek(chatId: ChatId): PendingMedia[] {
    return [...(this.q.get(chatId) ?? [])]
  }

  /** Atomically take and clear all pending media for a chat. */
  drain(chatId: ChatId): PendingMedia[] {
    const list = this.q.get(chatId)
    if (!list || list.length === 0) return []
    this.q.delete(chatId)
    return list
  }

  /** Drop pending media for a chat without consuming (e.g. on out_manual). */
  clear(chatId: ChatId): number {
    const list = this.q.get(chatId)
    if (!list) return 0
    const n = list.length
    this.q.delete(chatId)
    return n
  }

  size(chatId: ChatId): number {
    return this.q.get(chatId)?.length ?? 0
  }

  totalChats(): number {
    return this.q.size
  }
}
