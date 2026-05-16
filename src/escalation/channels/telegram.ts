// Telegram channel: HTTPS POST to api.telegram.org/bot<TOKEN>/sendMessage.
// See docs/dev/18-escalation.md "Canale 2: Telegram bot".
// Fail-soft: returns false when ENV vars are missing or the API rejects.

import { config } from '../../config/index.js'
import { log } from '../../log.js'
import type { EscalationChannel } from './index.js'
import type { EscalationChannelName, EscalationPayload } from '../../types.js'

const TELEGRAM_API = 'https://api.telegram.org/bot'

export class TelegramChannel implements EscalationChannel {
  readonly name: EscalationChannelName = 'telegram'

  async send(payload: EscalationPayload): Promise<boolean> {
    const tokenEnv = config.escalation.telegramBotTokenEnv
    const chatIdEnv = config.escalation.telegramChatIdEnv
    const token = process.env[tokenEnv]
    const chatIdsRaw = process.env[chatIdEnv]

    if (!token || !chatIdsRaw) {
      log.warn(
        { tokenEnv, chatIdEnv, tokenPresent: !!token, chatIdPresent: !!chatIdsRaw },
        'telegram credentials missing, skipping send'
      )
      return false
    }

    // Comma-separated chat ids → broadcast. Any success counts as success.
    const chatIds = chatIdsRaw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (chatIds.length === 0) {
      log.warn({ chatIdEnv }, 'telegram chat id env empty after split, skipping send')
      return false
    }

    const results = await Promise.allSettled(
      chatIds.map((chatId) => this.sendOne(token, chatId, payload))
    )
    const okCount = results.filter((r) => r.status === 'fulfilled' && r.value).length
    if (okCount === 0) {
      log.error({ escId: payload.esc.id, recipients: chatIds.length }, 'telegram broadcast: all failed')
      return false
    }
    if (okCount < chatIds.length) {
      log.warn({ escId: payload.esc.id, ok: okCount, total: chatIds.length }, 'telegram broadcast: partial')
    }
    return true
  }

  private async sendOne(
    token: string,
    chatId: string,
    payload: EscalationPayload
  ): Promise<boolean> {
    let res: Response
    try {
      res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: payload.text,
          parse_mode: 'Markdown',
        }),
      })
    } catch (err) {
      log.error({ err, escId: payload.esc.id, chatId }, 'telegram fetch failed')
      return false
    }

    if (!res.ok) {
      let body = ''
      try {
        body = await res.text()
      } catch {
        body = '<unreadable>'
      }
      log.error({ status: res.status, body, escId: payload.esc.id, chatId }, 'telegram send rejected')
      return false
    }
    return true
  }
}
