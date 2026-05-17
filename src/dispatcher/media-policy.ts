// Media-policy resolver.
//
// Decides whether an incoming non-text WhatsApp message should:
//   - 'vision'   → flow into the AI pipeline as multimodal input
//   - 'escalate' → bypass AI, raise an escalation row directly
//   - 'skip'     → persist marker only, no reply, no escalation
//
// The mapping comes from the user-config `media:` block (see
// `config/user-config.example.yaml`). Vision is downgraded to the configured
// `visionFallback` when the active `aiModel` is not in `VISION_CAPABLE_MODELS`.

import { config } from '../config/index.js'
import { VISION_CAPABLE_MODELS } from '../config/constants.js'
import type { MediaPolicy, MediaStrategy, MediaType } from '../types.js'

/**
 * Normalize the `msg.type` string surfaced by whatsapp-web.js into our
 * `MediaType` union. wweb emits values like 'chat', 'image', 'video', 'audio',
 * 'ptt', 'sticker', 'document', 'location', 'live_location', 'vcard',
 * 'multi_vcard', plus rarer types (poll, revoked, ...). We keep the common
 * ones and lump anything else under 'unknown' (treated as escalate by default).
 */
export function classifyMediaType(rawType: string | undefined): MediaType {
  if (!rawType) return 'unknown'
  switch (rawType) {
    case 'chat':
    case 'image':
    case 'sticker':
    case 'audio':
    case 'ptt':
    case 'video':
    case 'document':
    case 'location':
    case 'live_location':
    case 'vcard':
      return rawType
    case 'multi_vcard':
      return 'vcard'
    default:
      return 'unknown'
  }
}

/** Strategy carrier returned by `resolveMediaPolicy`. */
export interface ResolvedMediaPolicy {
  strategy: MediaStrategy
  /** True iff the requested strategy was downgraded because of capability checks. */
  downgraded: boolean
  /** Original (pre-downgrade) strategy, useful for log lines. */
  requested: MediaStrategy
}

const FALLBACK: MediaPolicy = { strategy: 'escalate' }

/**
 * Resolve the active policy for a given `MediaType`, applying the vision-
 * capability allowlist downgrade when relevant.
 *
 * 'chat' returns 'vision' (sentinel — caller should NOT invoke the resolver for
 * text messages; included so the function is total).
 * 'unknown' falls through to the configured escalate default.
 */
export function resolveMediaPolicy(type: MediaType): ResolvedMediaPolicy {
  if (type === 'chat') {
    return { strategy: 'vision', downgraded: false, requested: 'vision' }
  }

  const mediaCfg = config.media
  // The schema enforces presence of every modeled key, so a missing entry
  // means the type was 'unknown' or a future wweb type we have not modeled.
  const entry: MediaPolicy =
    (mediaCfg as unknown as Record<string, MediaPolicy | undefined>)[type] ?? FALLBACK
  const requested: MediaStrategy = entry.strategy

  if (requested === 'vision' && !VISION_CAPABLE_MODELS.includes(config.aiModel)) {
    return {
      strategy: mediaCfg.visionFallback,
      downgraded: true,
      requested,
    }
  }

  return { strategy: requested, downgraded: false, requested }
}
