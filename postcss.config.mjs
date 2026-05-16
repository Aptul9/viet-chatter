// Shim so `next build ./web` and `next dev ./web` work when launched from
// the repo root. PostCSS resolves its config from process.cwd(), which is the
// repo root in our `npm run` scripts, but Tailwind/PostCSS plugin configuration
// for the UI lives under `web/`. Delegating to the same plugins works because
// Tailwind v3 auto-discovers `tailwind.config.ts` from cwd (see root file).
export { default } from './web/postcss.config.mjs'
