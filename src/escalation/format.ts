// Format the notification message per channel.
// See docs/dev/18-escalation.md "Formato del messaggio di notifica".
//
// Project style: NO emoji anywhere. The `!`/`!!` urgency markers are plain ASCII.

import type { EscalationChannelName, EscalationPayload, EscalationRow } from '../types.js'

function urgencyMarker(urgency: EscalationRow['urgency']): string {
  if (urgency === 'high') return '!! '
  if (urgency === 'normal') return '! '
  return ''
}

function personHeader(esc: EscalationRow, displayPhone: string | null): string {
  // Prefer the resolved E.164 phone (passed by the notifier after a
  // `wa.resolveLidPhone` lookup). Otherwise fall back to the chatId with the
  // wweb suffix (`@c.us` / `@lid`) stripped and a `+` prepended. The `@lid`
  // case still leaks the raw lid digits, but at least no longer the suffix.
  if (displayPhone) return displayPhone
  const stripped = esc.chatId.replace(/@(c\.us|lid)$/, '')
  return '+' + stripped
}

function holdingLine(esc: EscalationRow): string {
  return esc.holdingReplySent ? 'Holding reply: inviata.' : 'Holding reply: nessuna.'
}

function formatPlain(esc: EscalationRow, displayPhone: string | null): string {
  return [
    `[viet-chatter] ${urgencyMarker(esc.urgency)}${esc.reason.toUpperCase()}`,
    `Da: ${personHeader(esc, displayPhone)}`,
    `Riassunto: ${esc.summary}`,
    holdingLine(esc),
    '',
    'Vai a rispondere su WhatsApp.',
  ].join('\n')
}

function escapeMarkdown(s: string): string {
  return s.replace(/([_*`\[\]])/g, '\\$1')
}

function formatMarkdown(esc: EscalationRow, displayPhone: string | null): string {
  return [
    `*[viet-chatter] ${urgencyMarker(esc.urgency)}${esc.reason.toUpperCase()}*`,
    `*Da:* ${escapeMarkdown(personHeader(esc, displayPhone))}`,
    `*Riassunto:* ${escapeMarkdown(esc.summary)}`,
    `*${holdingLine(esc)}*`,
    '',
    'Vai a rispondere su WhatsApp.',
  ].join('\n')
}

export function formatEscalation(
  channel: EscalationChannelName,
  esc: EscalationRow,
  displayPhone: string | null = null
): EscalationPayload {
  const text =
    channel === 'telegram' ? formatMarkdown(esc, displayPhone) : formatPlain(esc, displayPhone)
  return { esc, text }
}
