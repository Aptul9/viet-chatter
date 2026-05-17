import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin tracing root to the web/ package to silence the multi-lockfile warning
  // (the bot's root package-lock.json is unrelated to the Next build).
  outputFileTracingRoot: resolve(__dirname),

  // Keep these out of the webpack bundle, load them via Node `require` at
  // runtime. Reasons per package:
  //   pino / pino-pretty / pino-roll / thread-stream: pino spawns worker
  //     threads (one per transport target) by loading `thread-stream/lib/
  //     worker.js`. When bundled, the worker entry path is rewritten into
  //     `.next/server/vendor-chunks/lib/worker.js` which does not exist →
  //     MODULE_NOT_FOUND at request time. Externalizing fixes the summary +
  //     agent routes that transitively import `src/log.ts`.
  //   better-sqlite3 / sqlite-vec: native modules (.node bindings) which
  //     webpack cannot bundle anyway.
  //   chokidar: dynamic fs.watch require, also irrelevant in the web context
  //     (only initConfig() in the bot starts the watcher).
  //   whatsapp-web.js: pulls in puppeteer + Chromium; never used by web.
  serverExternalPackages: [
    'pino',
    'pino-pretty',
    'pino-roll',
    'thread-stream',
    'better-sqlite3',
    'sqlite-vec',
    'chokidar',
    'whatsapp-web.js',
  ],

  // The bot lives under ../src and uses NodeNext-style `.js` extensions on
  // relative imports (e.g. `import { x } from './foo.js'` even though the
  // source file is `foo.ts`). Without this alias, webpack tries to resolve
  // the literal `.js` file and fails when the dashboard / agent routes
  // lazy-import bot modules.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias ?? {}),
      '.js': ['.js', '.ts'],
      '.mjs': ['.mjs', '.mts'],
    }
    // src/config/index.ts has `await import(url)` for hot-reload of the root
    // config module. That code path is only ever hit by the bot's
    // initConfig(); the web bundle imports config purely for the typed
    // `config` proxy. Silence the unavoidable "Critical dependency: the
    // request of a dependency is an expression" webpack warning that this
    // dynamic import would otherwise raise on every web compile.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /src[\\/]config[\\/]index\.ts$/, message: /Critical dependency/ },
    ]
    return config
  },
}

export default nextConfig
