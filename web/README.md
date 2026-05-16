# viet-chatter web UI

Browser-based editor for the bot's runtime configuration. Replaces the need to hand-edit YAML, though both paths are supported.

## Install / run

See the root [README.md](../README.md). One `npm install` at the repo root, then `npm run dev` from the root starts both the bot and the UI together. There is no separate `web/package.json`: all deps live at the repo root.

To run only the UI in dev: `npm run dev:web` (alias for `next dev ./web -p 3000`).

## Stack

- Next.js 15 (App Router) + React 19
- TypeScript
- Tailwind CSS v3.4
- shadcn/ui (button, input, label, switch, select, card, separator, tabs, badge, toast)
- react-hook-form + zod

## Where it writes

Saving the form writes YAML to the **repo root** at:

```
<repo-root>/config/user-config.yaml
```

(NOT `web/config/`.) The bot watches this file via chokidar and hot-reloads on save for everything except the restart-required keys (`sessionDir`, `dbPath`, `embeddingModel`, `aiModel`, `logFile`, `logRotation`).

On first load the form prefills from `user-config.yaml` if present, else from `user-config.example.yaml`, else from the compiled defaults in `config/defaults.ts`.

## Filter UI

The bot's reply filter is exposed declaratively (no TypeScript editing required, no TS predicate fallback exists in v2 of the config layer):

- Allowed prefixes: E.164 prefix list (e.g. `+84`). Empty = no prefix gate.
- Blocked numbers: full E.164 numbers, always wins over the allow list.
- Saved contacts only: toggle.
- Unread only: toggle.

These map 1:1 to the `filter` block in `user-config.yaml`.

## Production

The web UI is dev-only. `npm start` at the repo root runs the bot only. Do not deploy `next start` from this folder.
