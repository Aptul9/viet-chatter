import { defaults, type ConfigShape } from './config-schema'

export function mergeOverDefaults(parsed: unknown): ConfigShape {
  const p = (parsed ?? {}) as Record<string, unknown>
  const nightWindow = { ...defaults.nightWindow, ...((p.nightWindow as object) ?? {}) }
  const postReconnectSpreadMs = {
    ...defaults.postReconnectSpreadMs,
    ...((p.postReconnectSpreadMs as object) ?? {}),
  }
  const escalation = { ...defaults.escalation, ...((p.escalation as object) ?? {}) }
  const filter = { ...defaults.filter, ...((p.filter as object) ?? {}) }
  const media = { ...defaults.media, ...((p.media as object) ?? {}) }
  return {
    ...defaults,
    ...p,
    nightWindow,
    postReconnectSpreadMs,
    escalation,
    filter,
    media,
  } as ConfigShape
}
