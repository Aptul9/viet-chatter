# Stack

| Layer           | Scelta                                                                                             | Motivazione                                                                                                                       |
| --------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | Node 20+                                                                                           | LTS corrente, supporto nativo a fetch, AbortController, top-level await.                                                          |
| Linguaggio      | TypeScript                                                                                         | Type safety, ergonomia per refactor.                                                                                              |
| Esecuzione dev  | `tsx`                                                                                              | Esecuzione TS senza build step, hot-reload friendly.                                                                              |
| WhatsApp client | `whatsapp-web.js`                                                                                  | Wrapper Puppeteer su WhatsApp Web. Eventi push, fetch on-demand, niente API ufficiali (irraggiungibili per uso personale).        |
| Storage         | SQLite (driver `better-sqlite3`) + estensione `sqlite-vec`                                         | Single file, zero infra, query strutturate + vector search nativi. Privacy locale.                                                |
| ORM             | Drizzle (`drizzle-orm/better-sqlite3`)                                                             | Schema-in-TS, type inference, raw SQL escape hatch tipato per virtual tables. Migrations via `drizzle-kit`.                       |
| Embedding       | `@xenova/transformers` con `Xenova/bge-small-en-v1.5` (384 dim)                                    | Locale, CPU, zero API cost, zero rete per embedding. Privacy.                                                                     |
| AI router       | OpenCode CLI (riusato 1:1 da `linkedin-autoapply`, agent `direct-reply` con tutti permessi `deny`) | Backend testato, single-shot answer engine, niente tool use, niente MCP, niente lettura file/CLAUDE.md, niente plugin di default. |
| Validazione     | `zod`                                                                                              | Schema runtime per config + output AI JSON.                                                                                       |
| Logging         | `pino` + `pino-roll`                                                                               | Logger Node moderno, JSON strutturato, file rotation giornaliera + cap dimensione.                                                |
| File watcher    | `chokidar`                                                                                         | Hot-reload config (`config/index.ts`).                                                                                            |
| Cron interno    | Implementato via setInterval/setTimeout custom + tabella stato in DB                               | Niente dependency esterne tipo `node-cron`. Tutto persistente in DB, idempotente.                                                 |

## Dependency `package.json` minimali

```json
{
  "dependencies": {
    "whatsapp-web.js": "^1.x",
    "qrcode-terminal": "^0.12.x",
    "better-sqlite3": "^11.x",
    "sqlite-vec": "^0.1.x",
    "drizzle-orm": "^0.36.x",
    "@xenova/transformers": "^2.x",
    "zod": "^3.x",
    "pino": "^9.x",
    "pino-roll": "^2.x",
    "pino-pretty": "^11.x",
    "chokidar": "^4.x"
  },
  "devDependencies": {
    "typescript": "^5.x",
    "tsx": "^4.x",
    "drizzle-kit": "^0.27.x",
    "@types/node": "^22.x"
  }
}
```

## Versioni TypeScript / target

`tsconfig.json` consigliato:

- `target: ES2022`
- `module: NodeNext`
- `moduleResolution: NodeNext`
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `esModuleInterop: true`

## Esclusioni dello stack v1

- Niente Express/Fastify (no HTTP server).
- Niente Playwright (UI backend AI esclusi in v1).
- Niente Docker (foreground manuale).
- Niente PM2/systemd in v1 (vedi `15-runbook.md`).

## Vincoli OpenCode (sicurezza)

OpenCode richiede in root del progetto un `opencode.json` configurato come copia 1:1 da `linkedin-autoapply`. La configurazione è dipendenza di sicurezza testata: vedi `07-ai-integration.md` per la motivazione e i vincoli di modifica.
