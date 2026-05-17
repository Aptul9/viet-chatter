# Stack

| Layer           | Choice                                                                                             | Rationale                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Runtime         | Node 20+                                                                                           | Current LTS, native support for fetch, AbortController, top-level await.                                                           |
| Language        | TypeScript                                                                                         | Type safety, ergonomics for refactoring.                                                                                           |
| Dev execution   | `tsx`                                                                                              | TS execution without build step, hot-reload friendly.                                                                              |
| WhatsApp client | `whatsapp-web.js`                                                                                  | Puppeteer wrapper on WhatsApp Web. Push events, on-demand fetch, no official APIs (unreachable for personal use).                  |
| Storage         | SQLite (driver `better-sqlite3`) + extension `sqlite-vec`                                          | Single file, zero infra, structured queries + native vector search. Local privacy.                                                 |
| ORM             | Drizzle (`drizzle-orm/better-sqlite3`)                                                             | Schema-in-TS, type inference, typed raw SQL escape hatch for virtual tables. Migrations via `drizzle-kit`.                         |
| Embedding       | `@xenova/transformers` with `Xenova/bge-small-en-v1.5` (384 dim)                                   | Local, CPU, zero API cost, zero network for embedding. Privacy.                                                                    |
| AI router       | OpenCode CLI (reused 1:1 from `linkedin-autoapply`, agent `direct-reply` with all permissions `deny`) | Tested backend, single-shot answer engine, no tool use, no MCP, no file/CLAUDE.md reading, no default plugins.                  |
| Validation      | `zod`                                                                                              | Runtime schema for config + AI JSON output.                                                                                        |
| Logging         | `pino` + `pino-roll`                                                                               | Modern Node logger, structured JSON, daily file rotation + size cap.                                                               |
| File watcher    | `chokidar`                                                                                         | Hot-reload config (`config/index.ts`).                                                                                             |
| Internal cron   | Implemented via custom setInterval/setTimeout + state table in DB                                  | No external dependencies like `node-cron`. Everything persistent in DB, idempotent.                                                |

## Minimal `package.json` dependencies

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

## TypeScript versions / target

Recommended `tsconfig.json`:

- `target: ES2022`
- `module: NodeNext`
- `moduleResolution: NodeNext`
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `esModuleInterop: true`

## v1 stack exclusions

- No Express/Fastify (no HTTP server).
- No Playwright (UI backend AI excluded in v1).
- No Docker (manual foreground).
- No PM2/systemd in v1 (see `15-runbook.md`).

## OpenCode constraints (security)

OpenCode requires an `opencode.json` at the project root configured as a 1:1 copy from `linkedin-autoapply`. The configuration is a tested security dependency: see `07-ai-integration.md` for the rationale and modification constraints.
