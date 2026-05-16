# viet-chatter

Bot WhatsApp che risponde in modo autonomo a un sottoinsieme filtrato di chat 1:1, con timing umano-simile, memoria per persona, tono adattivo, lingua dinamica.

## Stato

v1 in sviluppo. Codice waves 1-10 implementato e type-checked (`npx tsc --noEmit` clean). Smoke E2E (wave 11) richiede sessione WhatsApp reale.

## Tracking sviluppo

Tutto lo stato operativo del progetto (decisioni, log, kanban) vive in `docs/status/` dentro questo repo. Nessuna persistenza esterna (no Obsidian vault, no second brain). Vedi [docs/status/README.md](docs/status/README.md).

## Documentazione

- [Documentazione utente](docs/utente/README.md) per chi vuole capire cosa fa e come si usa.
- [Documentazione tecnica](docs/dev/README.md) per chi mette mano al codice.
- [Spec di design](docs/dev/specs/2026-05-10-viet-chatter-design.md).

## Setup

```bash
npm install        # una sola volta, dalla root
npm run dev        # avvia bot + web UI in parallelo (concurrently)
```

`npm run dev` lancia in foreground sia il bot (`tsx src/index.ts`) sia la UI Next.js (`next dev ./web -p 3000`), prefissando ogni linea con `[bot]` o `[web]`. Per production, `npm start` lancia solo il bot (la UI e' dev-only).

## Configuration UI

La UI Next.js vive sotto `web/` (stesso `package.json` della root, nessun secondo `npm install`). Avvio: `npm run dev` quindi apri `http://localhost:3000`. La UI legge e scrive `config/user-config.yaml` (radice del repo): il bot fa hot-reload via chokidar, tranne per i campi marcati `RESTART REQUIRED` nel YAML stesso (es. `sessionDir`, `dbPath`, `embeddingModel`, `aiModel`, `logFile`, `logRotation`).

`config/user-config.example.yaml` contiene tutti i campi con commenti inline (unita', descrizione, marker restart-required). Si puo' editare a mano o via UI: il formato e' lo stesso. La copia "viva" `user-config.yaml` e' gitignored.

Dettagli design in [`docs/dev/11-config-e-hot-reload.md`](docs/dev/11-config-e-hot-reload.md) e [`web/README.md`](web/README.md).

## Stack previsto

TypeScript, `whatsapp-web.js`, SQLite + `sqlite-vec`, Drizzle ORM, `@xenova/transformers` (embedding locale), OpenCode come AI backend, pino per logging. Config a runtime in YAML (`yaml@^2`). UI in Next.js 15 + Tailwind + shadcn/ui, integrata nello stesso progetto Node.

## Licenza

Non specificata.
