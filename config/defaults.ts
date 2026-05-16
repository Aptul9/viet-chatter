// Plain TS defaults. No imports, no filter logic, no IO.
// The merged runtime config lives in `config/index.ts`, which deep-merges
// `config/user-config.yaml` over these values.

export const defaults = {
  // WhatsApp
  sessionDir: './.wwebjs_auth',
  timezone: 'Europe/Rome',

  // Scheduler
  debounceMs: 120_000,
  hardCapMs: 600_000,
  minDelayMs: 5 * 60_000,
  maxDelayMs: 2 * 60 * 60_000,
  jitterPct: 0.2,
  nightWindow: { startHour: 22, endHour: 6 },
  rollingLatencyWindow: 5,
  fallbackDelayMs: 30 * 60_000,
  postReconnectSpreadMs: { min: 30_000, max: 180_000 },

  // Boot
  bootMaxChatsToFetch: 50,
  fetchConcurrency: 5,

  // Tick
  tickIntervalMs: 10_000,
  manualJobsTickIntervalMs: 30_000,

  // KB
  ephemeralTtlDays: 7,
  ragTopK: 8,
  embeddingModel: 'Xenova/bge-small-en-v1.5',

  // AI
  aiModel: 'opencode:github-copilot/gpt-5-mini',
  aiHistoryLimit: 30,
  aiMaxRetryParseFail: 1,

  // Logging
  logLevel: 'info' as 'trace' | 'debug' | 'info' | 'warn' | 'error',
  logFile: './logs/viet-chatter.log',
  logRotation: 'daily',
  logMaxSize: '50m',

  // Manual jobs
  reEngageDefaultThresholdDays: 14,
  reEngageColdAfterDays: 7,
  reEngageMinOutgoingHistory: 3,

  // Escalation
  escalation: {
    enabled: true,
    channels: ['telegram'] as Array<'whatsapp_self' | 'telegram'>,
    whatsappSelfChatId: 'me',
    telegramBotTokenEnv: 'TELEGRAM_BOT_TOKEN',
    telegramChatIdEnv: 'TELEGRAM_USER_CHAT_ID',
    rateLimitPerHour: 12,
    highUrgencyBypassRateLimit: true,
    retryIntervalMs: 5 * 60_000,
    retryMaxAttempts: 3,
  },

  // DB
  dbPath: './viet-chatter.db',

  // Filter (declarative reply gating)
  filter: {
    allowedPrefixes: ['+84'] as string[],
    blockedNumbers: [] as string[],
    savedContactsOnly: false,
    unreadOnly: false,
  },

  // Media handling (Spec A). Per-type policy; bot uses `visionFallback`
  // when `image.strategy = 'vision'` but the configured `aiModel` is not in
  // `VISION_CAPABLE_MODELS`.
  media: {
    image: { strategy: 'vision' as 'vision' | 'escalate' | 'skip' },
    sticker: { strategy: 'skip' as 'vision' | 'escalate' | 'skip' },
    audio: { strategy: 'escalate' as 'vision' | 'escalate' | 'skip' },
    ptt: { strategy: 'escalate' as 'vision' | 'escalate' | 'skip' },
    video: { strategy: 'escalate' as 'vision' | 'escalate' | 'skip' },
    document: { strategy: 'escalate' as 'vision' | 'escalate' | 'skip' },
    location: { strategy: 'escalate' as 'vision' | 'escalate' | 'skip' },
    live_location: { strategy: 'escalate' as 'vision' | 'escalate' | 'skip' },
    vcard: { strategy: 'escalate' as 'vision' | 'escalate' | 'skip' },
    visionFallback: 'escalate' as 'escalate' | 'skip',
  },
}

export type Defaults = typeof defaults
