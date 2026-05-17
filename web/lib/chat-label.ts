// Derives a human-friendly label for a chat row in the dashboard tables.
//
// Real contacts come from WhatsApp with either:
//   - `393999000111@c.us` (phone-rooted JID — strip the suffix, prefix +)
//   - `179950556549242@lid` (anonymized LID, no phone bound yet)
// `display_name` is whatever the WA contact name was at first sight; for the
// owner's own circle it is often just the phone number string, in which case
// we still want to show it (it is more useful than the raw JID).

export interface ChatLabelInput {
  chatId: string
  displayName: string | null
}

/** Best-effort label. Prefers explicit display_name, else derives from JID. */
export function chatLabel({ chatId, displayName }: ChatLabelInput): string {
  if (displayName && displayName.trim().length > 0) return displayName
  const at = chatId.indexOf('@')
  if (at === -1) return chatId
  const local = chatId.slice(0, at)
  const suffix = chatId.slice(at + 1)
  if (suffix === 'c.us') return `+${local}`
  return `${local} (${suffix})`
}
