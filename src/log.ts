// Shared pino logger.
//
// Intentionally does NOT import `./config` to avoid a circular dependency
// (config loader self-logs without importing the pino logger; see notes in
// `./config/index.ts`).
//
// Knobs are read from env vars at construction time:
//   LOG_LEVEL      trace|debug|info|warn|error      default 'info'
//   LOG_FILE       path                              default './logs/viet-chatter.log'
//   LOG_FREQUENCY  daily|hourly|<ms>                 default 'daily'
//   LOG_MAX_SIZE   e.g. '50m'                        default '50m'
//
// Defaults mirror the values in `config/index.ts`. Changing them requires a
// restart, which matches the spec's "restart-required" list (logFile, logRotation).

import pino from 'pino'

const LEVEL = (process.env['LOG_LEVEL'] ?? 'info') as 'trace' | 'debug' | 'info' | 'warn' | 'error'
const FILE = process.env['LOG_FILE'] ?? './logs/viet-chatter.log'
const FREQUENCY = process.env['LOG_FREQUENCY'] ?? 'daily'
const MAX_SIZE = process.env['LOG_MAX_SIZE'] ?? '50m'

export const log = pino({
  level: LEVEL,
  transport: {
    targets: [
      {
        target: 'pino-roll',
        level: LEVEL,
        options: {
          file: FILE,
          frequency: FREQUENCY,
          size: MAX_SIZE,
          mkdir: true,
        },
      },
      {
        target: 'pino-pretty',
        level: LEVEL,
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss',
          destination: 1,
        },
      },
    ],
  },
})

// Allow late-stage level overrides (e.g. config hot-reload could call this).
export function setLogLevel(level: 'trace' | 'debug' | 'info' | 'warn' | 'error'): void {
  log.level = level
}
