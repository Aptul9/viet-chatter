# viet-chatter

Bot WhatsApp che risponde in modo autonomo a un sottoinsieme filtrato di chat 1:1, con timing umano-simile, memoria per persona, tono adattivo, lingua dinamica.

## Stato

v1 shipped (2026-05-16). Single Node project, YAML config + web UI, OpenCode AI backend, escalation Telegram multi-recipient. `npm run health` ok, `npm run test:e2e` ok, smoke test #61 (reply base) verificato manualmente. Smoke test live #62 / #63 / #64 ancora da eseguire (vedi `docs/status/board.md`).

Per dettagli su tutto cio' che e' shippato (incluso cosa diverge dal design iniziale), vedi [`docs/dev/19-implementation-notes.md`](docs/dev/19-implementation-notes.md).

## Quick start

```bash
npm install                # una volta, dalla root
npm run db:migrate         # crea viet-chatter.db con schema iniziale
npm run dev                # avvia bot + web UI in parallelo
```

Al primo run il bot stampa un QR code: scansionalo da `WhatsApp > Impostazioni > Dispositivi collegati`. UI di configurazione su `http://localhost:3000`.

Altri comandi utili:

- `npm start` — bot only (la UI e' dev-only).
- `npm run health` — self-check JSON: counter DB, escalations pending, modello embedding presente.
- `npm run test:e2e` — smoke pipeline end-to-end con WhatsApp mockato.
- `npm run format` / `format:check` — Prettier.

## Configurazione

Single source of truth runtime: `config/user-config.yaml` (gitignored). Hot-reload via chokidar al salvataggio (tranne campi `RESTART REQUIRED` come `dbPath`, `aiModel`, `sessionDir`, `embeddingModel`, `logFile`, `logRotation`).

Si edita a mano oppure via web UI (`npm run dev` → `http://localhost:3000`, 8 tab con tooltip per campo). Defaults in `config/defaults.ts`.

Filter declarative (no piu' predicate TS): blocco `filter` in YAML con `allowedPrefixes`, `blockedNumbers`, `savedContactsOnly`, `unreadOnly`.

## ENV vars

Caricate automaticamente da `.env` (gitignored) via `dotenv/config`:

- `TELEGRAM_BOT_TOKEN` — token bot Telegram per escalation. Vedi `docs/dev/15-runbook.md`.
- `TELEGRAM_USER_CHAT_ID` — chat id Telegram destinatario. Supporta comma-separated (`123,456,789`) per broadcast.
- `LOG_LEVEL` — override boot del livello log (poi il YAML/UI puo' sovrascrivere a runtime).

`.env.example` versionato come template.

## Tracking sviluppo

Lo stato operativo (kanban, done log, parallel plan) vive in `docs/status/`. Nessuna persistenza esterna.

## Documentazione

- [Documentazione utente](docs/utente/README.md) — non tecnica, cosa fa e come si usa.
- [Documentazione tecnica](docs/dev/README.md) — architettura, schema DB, scheduler, prompt, edge case.
- [Implementation notes (shipped v1)](docs/dev/19-implementation-notes.md) — comportamento attuale, deltas rispetto al design.

## Stack

TypeScript, `whatsapp-web.js@1.34.7`, SQLite + `sqlite-vec`, Drizzle ORM, `@xenova/transformers` (embedding locale), OpenCode CLI (modello default `opencode:github-copilot/gpt-5-mini`), pino + pino-roll per logging, Next.js 15 + Tailwind + shadcn/ui per la web UI.

## Licenza

Non specificata.
