# Implementation notes (shipped v1)

Sintesi del comportamento effettivo del progetto dopo l'implementazione. Sostituisce, dove diverge, le specifiche dei file 01-18 (che restano leggibili come riferimento di design originale). Una sola fonte canonica per "cosa fa il bot oggi".

Last update: 2026-05-16.

## Indice

1. Single Node project (no `web/` sub-package).
2. Config: YAML hot-reload + `config/defaults.ts`.
3. Web UI (Next 15 / Tailwind / shadcn).
4. Prettier (`format` / `format:check`) e ignore list.
5. `.env` autoload via `dotenv/config`.
6. Telegram multi-recipient broadcast.
7. Modello OpenCode di default.
8. OpenCode env-var bug: `OPENCODE_DISABLE_DEFAULT_PLUGINS` deve restare `false`.
9. Pre-launch Chromium cleanup.
10. `scripts/free-port.mjs`.
11. Shutdown hardening (signals + uncaughtException).
12. `whatsapp-web.js` 1.34.7 upgrade.
13. `@lid` resolution.
14. `isBotSent` race fix sotto `@lid`.
15. Delayed reconciler passes.
16. wweb diagnostics.
17. `npm run test:e2e`.
18. Dispatcher log level promotion.

---

## 1. Single Node project

Una sola `package.json` in root. Niente `web/package.json`, niente `web/node_modules`. `npm install` una volta dalla root.

Script principali (vedi [package.json](../../package.json)):

- `npm run dev` → `concurrently` lancia in parallelo `tsx src/index.ts` e `next dev ./web -p 3000`. Output prefissato `[bot]` / `[web]`.
- `npm start` → bot only. La UI Next.js e' dev-only.
- `npm run build:web` → build Next per validazione (non si esegue in prod).
- `npm run db:migrate` / `db:generate` / `db:studio` invariati.
- `npm run health` → self-check (vedi `12-logging-observability.md`).
- `npm run test:e2e` → smoke pipeline senza WhatsApp (vedi §17).
- `npm run format` / `format:check` → Prettier (vedi §4).

`web/` resta una sottocartella per il codice Next, ma usa le deps di root. Spiegazione in [web/README.md](../../web/README.md).

## 2. Config: YAML + `defaults.ts`

Source of truth runtime:

- [`config/defaults.ts`](../../config/defaults.ts) — defaults TypeScript tipati, nessun IO, nessuna logica di filtro.
- [`config/user-config.yaml`](../../config/user-config.yaml) (gitignored) — overrides utente.
- `config/user-config.example.yaml` — fallback se l'utente non ha ancora creato il file vivo. Versionato.

[`config/index.ts`](../../config/index.ts) (root) carica `defaults` + YAML, fa deep-merge (arrays REPLACE, objects merge ricorsivo) ed espone:

- `config: Defaults` — merged.
- `shouldReply: (chat: ChatContext) => boolean` — generato 100% dal blocco `filter` del YAML. **Non esiste piu' un escape hatch TS** (il vecchio predicate function-based e' stato rimosso).

Hot reload via chokidar su `user-config.yaml`: re-parse + re-validate (zod) + swap atomico. Vedi [src/config/index.ts](../../src/config/index.ts). Cambi a `defaults.ts` richiedono restart.

Filter block (declarative):

```yaml
filter:
  allowedPrefixes: ['+39', '+84'] # OR logic, empty = no prefix gate
  blockedNumbers: ['+391234567890'] # full E.164, vince sempre
  savedContactsOnly: false # solo contatti salvati sul telefono paired
  unreadOnly: false # solo chat con unreadCount > 0
```

Eliminati: `config/user-config.json`, `config/user-config.example.json`. Il vecchio predicate TS in `config/index.ts` rimpiazzato dal generator declarative.

## 3. Web UI

Posizione: [`web/`](../../web/). Stack: Next 15 (App Router) + React 19 + Tailwind v3.4 + shadcn/ui + react-hook-form + zod.

8 tab: Scheduler, KB, AI, Logging, Escalation, Filter, Manual jobs, Boot. Ogni campo ha tooltip descrittivo e marker `RESTART REQUIRED` dove rilevante.

API route [web/app/api/config/route.ts](../../web/app/api/config/route.ts):

- `GET` → legge `config/user-config.yaml` (o example fallback), valida zod, ritorna come JSON.
- `POST` → riceve JSON dal form, valida, scrive `config/user-config.yaml` come YAML. Chokidar in `src/config/index.ts` rileva il change e fa hot-reload.

`web/lib/config-schema.ts` re-esporta `defaults` da [`config/defaults.ts`](../../config/defaults.ts) (single source of truth). Lo zod schema resta duplicato (web sotto module resolution `bundler`, bot sotto `NodeNext`).

PostCSS / Tailwind: shim a livello root (`postcss.config.mjs`, `tailwind.config.ts`) re-esporta da `web/` perche' `next build ./web` lanciato da root risolve la config dal cwd.

## 4. Prettier

- [`.prettierrc.json`](../../.prettierrc.json): `singleQuote`, `semi: false`, `printWidth: 100`, `trailingComma: es5`.
- [`.prettierignore`](../../.prettierignore): esclude `node_modules/`, `dist/`, `logs/`, `.wwebjs_auth/`, `.cache/`, `drizzle/0000_init.sql`, `drizzle/meta/`, `viet-chatter.db*`, `package-lock.json`, `prompts/turn/`, `config/user-config*.yaml`, `web/`.
- Script: `npm run format` (write), `npm run format:check` (CI-safe).

`prompts/turn/` sono fuori dal formatter per preservare il phrasing del LLM. `web/` ha il suo (Next ha regole sue). `config/user-config*.yaml` fuori per preservare i commenti inline.

## 5. `.env` autoload via `dotenv`

`import 'dotenv/config'` come PRIMA riga di:

- [`src/index.ts`](../../src/index.ts) — bot entry point.
- [`src/scripts/health.ts`](../../src/scripts/health.ts) — health check.
- [`src/scripts/test-e2e.ts`](../../src/scripts/test-e2e.ts) — smoke test.

`.env` resta gitignored. [`.env.example`](../../.env.example) versionato. Variabili attese:

| Var                           | Uso                                                                     |
| ----------------------------- | ----------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`          | Bot Telegram per escalation.                                            |
| `TELEGRAM_USER_CHAT_ID`       | Comma-separated chat id(s) per broadcast. Vedi §6.                      |
| `LOG_LEVEL`                   | Override del default (`info`); il YAML/UI puo' sovrascrivere a runtime. |
| `OPENCODE_DISABLE_AUTOUPDATE` | `1` raccomandato in prod.                                               |
| `OPENCODE_DISABLE_LSP`        | `1` raccomandato in prod.                                               |

`OPENCODE_DISABLE_DEFAULT_PLUGINS` NON va settata a `1`: vedi §8.

## 6. Telegram multi-recipient broadcast

`TELEGRAM_USER_CHAT_ID` accetta valori comma-separated:

```
TELEGRAM_USER_CHAT_ID=123456789,987654321,555000111
```

[`src/escalation/channels/telegram.ts`](../../src/escalation/channels/telegram.ts) splitta sulla virgola, invia in parallelo via `Promise.allSettled`. Successo se almeno UN recipient riceve. Fallimenti parziali loggati (`telegram broadcast: partial`). Tutti i recipient falliti → l'escalation resta `pending` ed entra nel retry job (cron 5min).

Caso d'uso: user wants Telegram notify su 2 dispositivi (telefono + tablet) oppure 2 bot Telegram diversi.

## 7. OpenCode model di default

Default in [`config/defaults.ts`](../../config/defaults.ts):

```ts
aiModel: 'opencode:github-copilot/gpt-5-mini'
```

(Prima: `opencode:anthropic/claude-sonnet-4-6`.) Cambio motivato da costi + disponibilita' del provider. Override via YAML / web UI.

`aiModel` e' restart-required (caricato in `src/ai/router.ts` al boot).

## 8. OpenCode env-var bug (DEFAULT_PLUGINS)

Setting `OPENCODE_DISABLE_DEFAULT_PLUGINS=1` disabilita non solo eventuali plugin "auxiliary", ma ANCHE i provider plugin bundled (`github-copilot`, `openai`, `anthropic`). Risultato: qualunque modello `opencode:provider/...` ritorna HTTP 500 `ProviderModelNotFoundError`.

[`src/config/constants.ts`](../../src/config/constants.ts):

```ts
export const OPENCODE_DISABLE_DEFAULT_PLUGINS = false // DON'T flip to true
export const OPENCODE_DISABLE_CLAUDE_CODE = true // safe, blocks CLAUDE.md/AGENTS.md auto-inject
```

L'isolamento tool del LLM (no bash, no filesystem, no webfetch, ecc.) e' garantito da:

- Il blocco `permission` (tutto `deny`) sull'agent `direct-reply` in [`opencode.json`](../../opencode.json).
- `OPENCODE_DISABLE_CLAUDE_CODE=1` che blocca l'auto-injection di `CLAUDE.md`/`AGENTS.md` nel prompt.

`OPENCODE_DISABLE_DEFAULT_PLUGINS` non e' un livello di sicurezza aggiuntivo: e' un foot-gun. Stesso bug e' presente in `linkedin-autoapply` (config.yaml: `opencode_disable_default_plugins: false`).

## 9. Pre-launch Chromium cleanup

[`src/whatsapp/pre-launch.ts`](../../src/whatsapp/pre-launch.ts) viene chiamato in `initWhatsApp` PRIMA di `client.initialize()`. Risolve l'errore "Failed to launch the browser process! The browser is already running for /path/to/.wwebjs_auth/..." causato da shutdown unclean (kill -9, terminal chiuso, crash) che lascia:

- Processi Chromium orfani che tengono lock su `.wwebjs_auth/`.
- File lock (`SingletonLock`, `SingletonCookie`, `SingletonSocket`, `lockfile`) nel sessionDir e nei profile subdir.

Strategia:

1. **Kill mirato** dei processi Chromium la cui command line contiene il path assoluto del NOSTRO `sessionDir`. Mai kill di Chromium generici (chiuderebbe il browser dell'utente).
   - Windows: `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*<sessionDir>*' } | Stop-Process -Force`.
   - POSIX: `pgrep -af 'chrom.*<sessionDir>'` + `process.kill(pid, 'SIGKILL')`.
2. **Rimozione** dei file lock dal sessionDir root e dai subdir.

Best-effort: errori loggati come warn, non bloccano l'avvio.

## 10. `scripts/free-port.mjs`

[scripts/free-port.mjs](../../scripts/free-port.mjs) (Node ESM module). Usato come `predev:web` step:

```jsonc
"dev:web": "node scripts/free-port.mjs 3000 && next dev ./web -p 3000"
```

Killa qualunque processo holdi il port 3000. Cross-platform:

- Windows: `Get-NetTCPConnection -LocalPort <p>` + `Stop-Process -Id <owner> -Force`.
- POSIX: `lsof -ti :<p>` + `process.kill(pid, SIGKILL)`.

Check anche IPv4 e IPv6 separatamente (Next bind `::`, su Windows separato da `0.0.0.0`).

Risolve `EADDRINUSE` quando un run precedente del bot / Next ha lasciato un Node ancora bound (succede dopo Ctrl+C rapidi consecutivi).

## 11. Shutdown hardening

[`src/index.ts`](../../src/index.ts) intercetta:

- `SIGINT` (Ctrl+C).
- `SIGTERM` (kill standard).
- `SIGHUP`.
- `uncaughtException`.
- `unhandledRejection`.

Tutte e cinque le path passano per la stessa funzione `shutdown(reason)` (idempotent via `shuttingDown` flag), che fa in ordine:

1. `stopTicker()` / `stopManualJobsCron()` / `stopEphemeralPruner()` / `stopEscalationRetry()`.
2. `await stopOpencodeServer()`.
3. `sqlite.close()`.
4. `await wa.client.destroy()` (chiude Chromium pulito → niente lock left over).
5. `process.exit(0)`.

Crash → cleanup. Niente piu' `.wwebjs_auth/` corrotto dopo crash silenziosi.

## 12. `whatsapp-web.js` 1.34.7

Bump da `^1.26.0` (spec originale) → `^1.34.7` (latest a 2026-05-16). Cambi observable:

- Sessione `LocalAuth` blob da 1.26 NON compatibile con 1.34 → re-paire QR richiesto al primo run su 1.34. `.wwebjs_auth/` wipato durante testing.
- Esposto `client.getContactLidAndPhone([id])` per `@lid` resolution (vedi §13).
- Diversi event id rewrite under privacy mode (vedi §14).

## 13. `@lid` resolution

WhatsApp 2024+ ha introdotto i "Linked Identifiers" (`@lid`) per privacy: gli unsaved contact non espongono piu' il numero E.164 al peer, ma un identifier opaco tipo `179xxxxxx@lid`. Conseguenza per il bot: il filtro su `allowedPrefixes` ('+39', '+84') non match perche' il phone visto e' `+179xxx`.

wweb 1.34.x espone `client.getContactLidAndPhone([id])` che restituisce la mappa `lid → phone` SOLO per contatti SALVATI sul dispositivo paired.

Implementazione:

- [`src/whatsapp/client.ts`](../../src/whatsapp/client.ts) espone `resolveLidPhone(serializedId): Promise<string | null>` (ritorna `+39xxx` o `null`).
- [`src/dispatcher/index.ts`](../../src/dispatcher/index.ts) in `handleIncoming` chiama `resolveLidPhone` se `chatId.endsWith('@lid')` PRIMA di `applyFilter`.
- [`src/boot/reconciler.ts`](../../src/boot/reconciler.ts) fa la stessa cosa quando processa chat al boot.

Caveat: contatti **non salvati** restano opachi (WhatsApp privacy by design). Workaround user-side: salvare i contatti che si vogliono whitelistare sul telefono paired. Future enhancement opzionale: `filter.allowUnknownLid: true` (5 righe di codice, non shipped).

## 14. `isBotSent` race fix sotto `@lid`

Sotto privacy mode wweb a volte:

- Rewrita il msgId dell'echo `message_create` rispetto a quello restituito da `client.sendMessage`.
- Fira l'evento `message_create` PRIMA che `client.sendMessage` risolva la sua promise.

Senza mitigation, il dispatcher classifica l'echo del bot come `out_manual` (perche' il msgId non e' ancora nel set in-memory) e abortisce la sua stessa pipeline mid-send → no reply.

Mitigation in [`src/whatsapp/client.ts`](../../src/whatsapp/client.ts) (`isBotSent`):

- **Strict path**: exact match del msgId nel tracker set.
- **Fuzzy path**: match per `chatId + body + timestamp window` (≤3s da `sendMessage`, finestra max 15s nel tracker). Se trovato → e' nostro.

Tracker entries TTL-evicted dopo 5min. Set bounded ⇒ no leak.

## 15. Delayed reconciler passes

wweb 1.34 multi-device sync carica le chat in maniera lazy: `client.getChats()` subito dopo `ready` puo' ritornare un set parziale, e nuove chat trickle-in nei primi 30-90s.

Soluzione in [`src/index.ts`](../../src/index.ts) dopo il reconcile iniziale on `ready`:

```ts
for (const delayMs of [15_000, 45_000, 120_000]) {
  setTimeout(() => {
    runReconciler({ sqlite, wa, dispatcher }).catch(/* logged */)
  }, delayMs).unref()
}
```

Ogni pass e' idempotente grazie a `processed_messages.whatsapp_msg_id` come PK. Catch-up garantito anche per chat late-syncing.

## 16. wweb diagnostics

Eventi log aggiuntivi rispetto al catalogo originale (vedi `12-logging-observability.md`):

- `wweb event` (level `info`) — ogni `message` e `message_create`: `from`, `to`, `fromMe`, `type`, `msgId`. Utile per diagnosticare classificazione direction.
- `whatsapp paired account` (level `info`) — al `ready`: log del wid paired (`391234567@c.us`).
- `whatsapp heartbeat` (level `info`, ogni 30s) — wweb state corrente + `chatsCount`. Permette di vedere a colpo d'occhio se la connessione e' viva.
- `loading_screen` + `change_state` (level `info`) — surface durante init / disconnect.

## 17. `npm run test:e2e`

[`src/scripts/test-e2e.ts`](../../src/scripts/test-e2e.ts). Smoke test della pipeline COMPLETA (config + DB + OpenCode + embedding + state machine + orchestrator) senza richiedere una sessione WhatsApp reale.

Come funziona:

1. Wipa lo state per `393999000111@c.us` (chat id sintetico, +39 → passa il default filter).
2. Costruisce un `WhatsAppHandle` fake (`sendMessage` logga su stdout invece di chiamare wweb).
3. Inietta un messaggio sintetico nel dispatcher come fosse arrivato live.
4. Watcha lo state machine fino a `IDLE` o timeout (60s).

Exit codes:

- `0` → reply generata + "inviata" (logged) entro timeout.
- `1` → errore fatale.
- `2` → timeout.

Usage:

```bash
npm run test:e2e                       # default body
npm run test:e2e -- "ciao come stai?"  # custom
```

Utile per validare la pipeline AI senza dover scansionare un QR.

## 18. Dispatcher log level promotion

Tutti questi eventi sono passati da `debug` → `info` durante la stabilizzazione:

- `msg received` ([src/dispatcher/index.ts](../../src/dispatcher/index.ts)) — ogni messaggio classificato.
- `msg passed filter, enqueuing` — incoming accettato.
- `msg filtered out` — incoming rifiutato + reason fields.
- `msg skipped (group)` — chat di gruppo droppata.
- State transitions ([src/scheduler/state.ts](../../src/scheduler/state.ts)).

Ragione: il testing manuale di Wave 11 senza dover settare `LOG_LEVEL=debug` ogni volta. Volume previsto basso (~10-30 messaggi/giorno).

---

## Cosa NON e' shipped

- `filter.allowUnknownLid: true` opt-in flag — accetterebbe qualunque `@lid` sender con pushname non vuoto. ~5 righe di codice in `filter.ts`. Skip in v1 perche' apre una superficie privacy (un unsaved random che ha tu nome puo' triggerare).
- Migrazione a `@whiskeysockets/Baileys` come Plan B se wweb diventa instabile. Restano nei radar future.
- Smoke test live #62 (escalation Telegram + holding reply), #63 (birthday job), #64 (reconnect / boot reconciler). #61 (base reply) verificato manualmente 2026-05-16. Vedi `docs/status/board.md`.
