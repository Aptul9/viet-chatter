// Shim re-export. See `web/tailwind.config.ts` for the actual config.
// Needed because Tailwind v3 resolves its config relative to PostCSS's cwd
// (the repo root when running `next build ./web` / `next dev ./web`).
export { default } from './web/tailwind.config'
