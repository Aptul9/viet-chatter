// In-memory registry of AbortControllers keyed by chat id.
// Used by the scheduler to abort the orchestrator pipeline when a manual
// outgoing message arrives mid-turn (see docs/dev/04-scheduler-state-machine.md
// race R3 and docs/dev/03-data-flow.md Flow D).

import type { ChatId } from '../types.js'

export class InflightRegistry {
  private readonly map = new Map<ChatId, AbortController>()

  register(chatId: ChatId): AbortController {
    this.get(chatId)?.abort('superseded by new turn')
    const ctrl = new AbortController()
    this.map.set(chatId, ctrl)
    return ctrl
  }

  get(chatId: ChatId): AbortController | undefined {
    return this.map.get(chatId)
  }

  abort(chatId: ChatId, reason?: string): boolean {
    const ctrl = this.map.get(chatId)
    if (!ctrl) return false
    ctrl.abort(reason ?? 'manual override')
    this.map.delete(chatId)
    return true
  }

  unregister(chatId: ChatId): void {
    this.map.delete(chatId)
  }

  size(): number {
    return this.map.size
  }
}
