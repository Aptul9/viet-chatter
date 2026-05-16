import { z } from 'zod'

export const ConfigSchema = z.object({
  sessionDir: z.string().min(1),
  timezone: z.string().min(1),

  debounceMs: z.number().int().positive(),
  hardCapMs: z.number().int().positive(),
  minDelayMs: z.number().int().positive(),
  maxDelayMs: z.number().int().positive(),
  jitterPct: z.number().min(0).max(1),
  nightWindow: z.object({
    startHour: z.number().int().min(0).max(23),
    endHour: z.number().int().min(0).max(23),
  }),
  rollingLatencyWindow: z.number().int().positive(),
  fallbackDelayMs: z.number().int().positive(),
  postReconnectSpreadMs: z.object({
    min: z.number().int().nonnegative(),
    max: z.number().int().positive(),
  }),

  bootMaxChatsToFetch: z.number().int().positive(),
  fetchConcurrency: z.number().int().positive(),

  tickIntervalMs: z.number().int().positive(),
  manualJobsTickIntervalMs: z.number().int().positive(),

  ephemeralTtlDays: z.number().int().positive(),
  ragTopK: z.number().int().positive(),
  embeddingModel: z.string().min(1),

  aiModel: z.string().min(1),
  aiHistoryLimit: z.number().int().positive(),
  aiMaxRetryParseFail: z.number().int().nonnegative(),

  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
  logFile: z.string().min(1),
  logRotation: z.string().min(1),
  logMaxSize: z.string().min(1),

  reEngageDefaultThresholdDays: z.number().int().positive(),
  reEngageColdAfterDays: z.number().int().positive(),
  reEngageMinOutgoingHistory: z.number().int().nonnegative(),

  escalation: z.object({
    enabled: z.boolean(),
    channels: z.array(z.enum(['whatsapp_self', 'telegram'])),
    whatsappSelfChatId: z.string().min(1),
    telegramBotTokenEnv: z.string().min(1),
    telegramChatIdEnv: z.string().min(1),
    rateLimitPerHour: z.number().int().nonnegative(),
    highUrgencyBypassRateLimit: z.boolean(),
    retryIntervalMs: z.number().int().positive(),
    retryMaxAttempts: z.number().int().nonnegative(),
  }),

  dbPath: z.string().min(1),

  filter: z.object({
    allowedPrefixes: z.array(z.string()),
    blockedNumbers: z.array(z.string()),
    savedContactsOnly: z.boolean(),
    unreadOnly: z.boolean(),
  }),
})

export type ConfigShape = z.infer<typeof ConfigSchema>
