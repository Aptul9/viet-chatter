import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pin tracing root to the web/ package to silence the multi-lockfile warning
  // (the bot's root package-lock.json is unrelated to the Next build).
  outputFileTracingRoot: resolve(__dirname),
}

export default nextConfig
