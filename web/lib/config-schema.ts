// Web-side mirror of the bot zod schema. Kept in sync with
// `src/config/schema.ts` and `config/defaults.ts`.
//
// Why a copy: the bot schema lives under `src/` which the Next compiler does
// not include in its tsconfig roots (different module resolution). Re-exporting
// a small mirror here keeps the web bundle self-contained while the runtime
// API route still validates via THIS schema before writing YAML.
import { z } from 'zod'

import { defaults as botDefaults } from '../../config/defaults'

export const LogLevels = ['trace', 'debug', 'info', 'warn', 'error'] as const
export const LogRotations = ['daily', 'hourly', 'never'] as const
export const EscalationChannels = ['whatsapp_self', 'telegram'] as const

export const FilterSchema = z.object({
  allowedPrefixes: z.array(z.string().min(1)).default([]),
  blockedNumbers: z.array(z.string().min(1)).default([]),
  savedContactsOnly: z.boolean().default(false),
  unreadOnly: z.boolean().default(false),
})

export const ConfigSchema = z.object({
  // WhatsApp
  sessionDir: z.string().min(1),
  timezone: z.string().min(1),

  // Scheduler
  debounceMs: z.coerce.number().int().positive(),
  hardCapMs: z.coerce.number().int().positive(),
  minDelayMs: z.coerce.number().int().positive(),
  maxDelayMs: z.coerce.number().int().positive(),
  jitterPct: z.coerce.number().min(0).max(1),
  nightWindow: z.object({
    startHour: z.coerce.number().int().min(0).max(23),
    endHour: z.coerce.number().int().min(0).max(23),
  }),
  rollingLatencyWindow: z.coerce.number().int().positive(),
  fallbackDelayMs: z.coerce.number().int().positive(),
  postReconnectSpreadMs: z.object({
    min: z.coerce.number().int().nonnegative(),
    max: z.coerce.number().int().positive(),
  }),

  // Boot
  bootMaxChatsToFetch: z.coerce.number().int().positive(),
  fetchConcurrency: z.coerce.number().int().positive(),

  // Tick
  tickIntervalMs: z.coerce.number().int().positive(),
  manualJobsTickIntervalMs: z.coerce.number().int().positive(),

  // KB
  ephemeralTtlDays: z.coerce.number().int().positive(),
  ragTopK: z.coerce.number().int().positive(),
  embeddingModel: z.string().min(1),

  // AI
  aiModel: z.string().min(1),
  aiHistoryLimit: z.coerce.number().int().positive(),
  aiMaxRetryParseFail: z.coerce.number().int().nonnegative(),

  // Logging
  logLevel: z.enum(LogLevels),
  logFile: z.string().min(1),
  logRotation: z.string().min(1),
  logMaxSize: z.string().min(1),

  // Manual jobs
  reEngageDefaultThresholdDays: z.coerce.number().int().positive(),
  reEngageColdAfterDays: z.coerce.number().int().positive(),
  reEngageMinOutgoingHistory: z.coerce.number().int().nonnegative(),

  // Escalation
  escalation: z.object({
    enabled: z.boolean(),
    channels: z.array(z.enum(EscalationChannels)),
    whatsappSelfChatId: z.string().min(1),
    telegramBotTokenEnv: z.string().min(1),
    telegramChatIdEnv: z.string().min(1),
    rateLimitPerHour: z.coerce.number().int().nonnegative(),
    highUrgencyBypassRateLimit: z.boolean(),
    retryIntervalMs: z.coerce.number().int().positive(),
    retryMaxAttempts: z.coerce.number().int().nonnegative(),
  }),

  // DB
  dbPath: z.string().min(1),

  // Filter (declarative)
  filter: FilterSchema,
})

export type ConfigShape = z.infer<typeof ConfigSchema>

// Re-export the canonical defaults from the single source of truth.
export const defaults: ConfigShape = botDefaults
