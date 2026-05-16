import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin tracing root to the web/ package to silence the multi-lockfile warning
  // (the bot's root package-lock.json is unrelated to the Next build).
  outputFileTracingRoot: resolve(__dirname),

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
    return config
  },
}

export default nextConfig
