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

function personHeader(esc: EscalationRow): string {
  // chatId is the WhatsApp `_serialized` id (e.g. "84xxxx@c.us").
  // We strip the suffix for readability. The summary will give name context.
  const phone = esc.chatId.replace(/@c\.us$/, '').replace(/^/, '+')
  return phone
}

function holdingLine(esc: EscalationRow): string {
  return esc.holdingReplySent ? 'Holding reply: inviata.' : 'Holding reply: nessuna.'
}

function formatPlain(esc: EscalationRow): string {
  return [
    `[viet-chatter] ${urgencyMarker(esc.urgency)}${esc.reason.toUpperCase()}`,
    `Da: ${personHeader(esc)}`,
    `Riassunto: ${esc.summary}`,
    holdingLine(esc),
    '',
    'Vai a rispondere su WhatsApp.',
  ].join('\n')
}

function escapeMarkdown(s: string): string {
  return s.replace(/([_*`\[\]])/g, '\\$1')
}

function formatMarkdown(esc: EscalationRow): string {
  return [
    `*[viet-chatter] ${urgencyMarker(esc.urgency)}${esc.reason.toUpperCase()}*`,
    `*Da:* ${escapeMarkdown(personHeader(esc))}`,
    `*Riassunto:* ${escapeMarkdown(esc.summary)}`,
    `*${holdingLine(esc)}*`,
    '',
    'Vai a rispondere su WhatsApp.',
  ].join('\n')
}

export function formatEscalation(
  channel: EscalationChannelName,
  esc: EscalationRow
): EscalationPayload {
  const text = channel === 'telegram' ? formatMarkdown(esc) : formatPlain(esc)
  return { esc, text }
}
