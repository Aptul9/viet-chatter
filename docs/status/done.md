---
created: 2026-05-16
updated: 2026-05-16T20:00:00+02:00
tags: [project/viet-chatter, status]
---

# Done log

Append-only log delle cose fatte durante lo sviluppo. Una entry per task chiuso (allineata al numero della card su `board.md`) o per evento significativo. Top = piu' recente.

Convenzioni:

- Header per giornata: `## YYYY-MM-DD`.
- Sotto-sezione per evento: `### **#NN** titolo card` (oppure `### Evento: ...` se non legato a una card).
- Body: cosa fatto, problemi incontrati, decisioni prese, link a commit / PR / file rilevanti.
- Linea finale "outcome": `- outcome: <one-line>` se utile.

## Sezioni standard per task

Quando si chiude un task, scrivi:

- **Cosa fatto**: 1-3 frasi su cosa il task ha prodotto.
- **Problemi incontrati**: bug, surprise, deprecation, edge case (con link a issue / commit di fix).
- **Decisioni**: scelte fatte non ovvie dalla docs (con motivazione breve).
- **Tempo**: stima vs reale (se interessante per learning).
- **Follow-up**: task creati come conseguenza, oppure quirks da documentare in dev docs.

## Convenzioni problematiche

Per problemi NON banali che impattano la docs o il design futuro:

- Apri o aggiorna `## Quirks` nel relativo file `docs/dev/*.md`.
- Se il problema modifica una decisione, aggiorna anche `docs/dev/specs/2026-05-10-viet-chatter-design.md` (sezione 15).
- Se la decisione e' nuova/grossa, crea decision note nel vault Obsidian (`02_Areas/Decisions/`). [SUPERSEDED: il progetto non usa vault esterno, ogni stato vive in `docs/status/` di questo repo.]

---

## 2026-05-17

### Evento: scope expansion impl shipped — 5 specs end-to-end (A / B / C+D1 / D2)

- Cosa fatto: implementati tutti e 5 gli spec progettati nella sessione di brainstorm del 2026-05-16, autonomamente in single overnight session su branch `feat/v1-scope-expansion`. 5 commit semanticamente coerenti (uno per spec), + 1 commit fix finali.
  - **Spec A — media handler** (commit `3a8a1f6`): `src/dispatcher/media-policy.ts` + `src/orchestrator/media-queue.ts` + `src/escalation/from-media.ts` + estensione `opencode.ts/router.ts/turn.ts` con parts API. Dispatcher branch su `msg.type`. Image vision via OpenCode multimodal (VISION_CAPABLE_MODELS allowlist + fallback). Audio/video/document/location/sticker policy YAML-driven.
  - **Spec B — test framework** (commit `824a72c`): refactor di `src/scripts/test-e2e.ts` in scenario registry sotto `src/scripts/e2e-scenarios/`. 6 scenari mockati (basic-reply, image-vision, image-escalation-fallback, audio-escalation, skip-output, escalation-output). Subagent creato `e2e/` top-level con driver wweb separato + validator readonly DB + orchestrator `e2e/run.ts`. Env knobs `BOT_E2E_STUB_AI` / `BOT_E2E_LOG_PATH` / `BOT_E2E_DB_PATH` / `BOT_E2E_MODE`. AI stub in router.ts.
  - **Spec C+D1 — dashboard read-only + AI summary** (commit `558ec3d`): nuovi tab `/dashboard` (home + chats + chats/[id] + schedule + stats + summary). API read-only sotto `/api/dashboard/`. 4 nuovi repo helper read-only (listChatsWithSummary / getChatDetail / getScheduleOverview / getStats). D1 endpoint POST `/api/dashboard/summary` chiama AI con prompts/summary template (no zod, free-form markdown, cap 4000 char).
  - **Spec D2 — AI command channel** (commit `7d99cad`): nuovo modulo `src/agent/` (types + context + turn + store + 6 action handler). Web UI `/dashboard/agent` con chat + confirm-then-execute pattern. AgentOutput discriminated zod union (createManualJob / cancelManualJobs / dismissEscalation / summarizeChat / updateEngagement / listOverview). Nuova tabella `agent_commands` (audit log) via `ensureAdditiveSchema` in client.ts (idempotent). Security: forced localhost bind (`--hostname 127.0.0.1`) + Host-header runtime check (web/lib/agent-gate.ts) + kill switch `AGENT_DISABLED=1` env + audit log.
  - **Fix finali** (commit `17424e2`): `BOT_E2E_MODE=1` settato all'inizio di test-e2e.ts; `web/next.config.mjs` extensionAlias `.js` → `.ts` per webpack che altrimenti non risolve i bot imports.
- Verifica:
  - `npx tsc --noEmit` (bot side): clean.
  - `cd web && npx tsc --noEmit`: clean.
  - `cd e2e/driver && npx tsc --noEmit`: clean.
  - `cd e2e/validator && npx tsc --noEmit`: clean.
  - `npm run test:e2e -- all`: **6/6 PASS** (basic-reply 5.2s, image-vision 5.2s, image-escalation-fallback 37ms, audio-escalation 30ms, skip-output 4.7s, escalation-output 4.7s).
  - `npm run health`: ok, 7 chats, 2 facts, 3 escalations pending (residue di test).
  - `npm run build:web`: PASS, tutti i 14 route generati (7 page + 7 api).
  - `npm run dev` (boot completo + UI): NON eseguito per evitare di disturbare la sessione WhatsApp paired dell'utente.
- Decisioni implementative:
  - **Media bytes mai persistiti**: vivono solo nella `MediaQueue` in-memory, drenata al turn fire o all'out_manual. Privacy by design (richiesta da spec A).
  - **Vision allowlist hardcoded** in `src/config/constants.ts` invece di runtime probe per evitare API call al boot. Update manuale quando si aggiunge un nuovo model vision-capable.
  - **`__overrideConfigForTest` gated** dietro `BOT_E2E_MODE=1` o `NODE_ENV=test` per evitare accidental production use.
  - **`agent_commands` table NON gestita via drizzle migration**: usata `ensureAdditiveSchema(sqlite)` in `client.ts` con `CREATE TABLE IF NOT EXISTS`. Pragmatico per single-user project. Una futura `drizzle-kit generate` la fold in una vera migration.
  - **Separate db-ro vs db-rw connections** in web/lib/: dashboard read-only routes usano sempre db-ro, solo agent routes (D2) hanno accesso a db-rw. Defense-in-depth contro write accidentali.
  - **Webpack extensionAlias** per il .js → .ts: necessario perchè bot code (NodeNext) usa `.js` extensions su relative imports, mentre web (bundler resolution) non li riconosce.
  - **Vision scenario nel mock test** usa monkey-patch del fake WA handle's `downloadMedia` invece di setup config aggiuntivo. Più localizzato.
- Note di sicurezza per D2 (write-capable):
  - Forced bind a `127.0.0.1` in `package.json` scripts (dev + dev:web).
  - Runtime check su Host header in `web/lib/agent-gate.ts` come backstop.
  - Kill switch `AGENT_DISABLED=1`: route ritorna 503.
  - Audit log: ogni propose/execute scrive JSON line su stdout + persiste in `agent_commands` table.
  - Action whitelist enforced via zod discriminated union: payload corrotto / type sconosciuto → fail al propose AND al execute (double validation).
  - Banner UI giallo prominente in `/dashboard/agent` warning utente.
- Subagent usage: spawn 1 subagent per Spec B's `e2e/` folder (23 file completamente isolati da src/). Lavoro parallelo, coordinazione zero perchè file disjoint. Subagent completato in 6m31s con clean tsc. Decisione corretta in retrospect.
- Tempo: ~3.5h wall-clock per i 5 spec impl + commit + verify. Subagent ridotto il context bloat sul main agent.
- Follow-up live testing (`In Progress` lane su board.md):
  - **#62** escalation Telegram live trigger.
  - **#63** birthday job live fire.
  - **#NEW1** re_engage live.
  - **#NEW2** skip-output live.
  - **#SA-live** invio media reali (image / audio / video / location) da numero whitelistato. Vision model: `gpt-5-mini` (default) già in allowlist.
  - **#SB-live** pair second WhatsApp account in `e2e/driver/`, run `npx tsx e2e/run.ts basic-reply --ai stub`.
  - **#SD-live** UI dashboard `/dashboard/agent` con prompt reale, verifica Confirm + manual_jobs row creata. Inoltre testare kill switch + curl Host header.
- Branch: `feat/v1-scope-expansion`. Da mergeare a `main` dopo review.

### Evento: scope expansion — 5 specs aggiunti (A media / B test framework / C dashboard / D1 AI summary / D2 AI commands)

- Cosa fatto: brainstorm sessione con utente per estendere lo scope post-v1. Decomposizione in 4 spec separati (D1 integrato in C) + 1 spec future-but-now-in-scope (D2). Cinque design doc scritti in `docs/dev/specs/`:
  - [`2026-05-16-spec-a-media.md`](../dev/specs/2026-05-16-spec-a-media.md): handling non-text media. Image → vision via OpenCode multimodal parts. Audio / video / document / location / vcard / live_location → escalation a umano. Sticker → skip. Vision capability check via allowlist `VISION_CAPABLE_MODELS`. Fallback policy se modello non vision-capable. Config YAML per-tipo. Nuovo prompt `prompts/turn/07b_media_rules.txt`. Zero schema change DB.
  - [`2026-05-16-spec-b-test-framework.md`](../dev/specs/2026-05-16-spec-b-test-framework.md): test e2e B+C hybrid. C side = scenario registry in `src/scripts/test-e2e.ts` (basic-reply, image-vision, audio-escalation, skip-output, escalation-output, manual-job-revive, out-manual-during-sending). B side = nuovo top-level `e2e/` con driver wweb separato (proprio sessionDir, proprio QR account di test) + validator readonly su bot DB + orchestrator `e2e/run.ts`. Test mode env vars (`BOT_E2E_STUB_AI`, `BOT_E2E_LOG_PATH`, `BOT_E2E_DB_PATH`). Bot resta single-account, multi-account confinato all'e2e tooling.
  - [`2026-05-16-spec-c-dashboard.md`](../dev/specs/2026-05-16-spec-c-dashboard.md): dashboard read-only nella web UI. 4 nuovi tab (Home / Chats list+detail / Schedule / Stats / Summary). Riusa DB esistente in readonly via WAL (gia' attivo). 4 nuovi helper read-only in `src/db/repo.ts`. API route sotto `web/app/api/dashboard/`. Include D1 (AI summary): nuovo prompt folder `prompts/summary/`, POST endpoint che carica history + facts + profile e chiama AI per riassunto free-form (no zod, no parse).
  - [`2026-05-16-spec-d2-ai-commands.md`](../dev/specs/2026-05-16-spec-d2-ai-commands.md): AI command channel write-capable. Chat-with-agent in `/dashboard/agent`. AI emette `AgentOutput` con `proposedActions` (createManualJob / cancelManualJobs / dismissEscalation / summarizeChat / updateEngagement / listOverview). Action whitelist enforced via zod discriminated union. Confirm-then-execute pattern per write actions, auto-execute per read-only. Nuova tabella `agent_commands` (migration `0001`). Sicurezza: forced localhost bind (`--hostname 127.0.0.1`) + runtime check su Host header + kill switch `AGENT_DISABLED=1` env var + audit log + banner UI prominente.
- Decisioni:
  - **Multi-account WhatsApp resta out-of-scope in `src/`**. Lo zero-shot multi-account refactor (touch ogni tabella, ogni query, ogni flow) e' debito troppo grosso per beneficio marginale. Spec B sposta il "second WhatsApp" in `e2e/driver/` come tool esterno, completamente isolato dal runtime del bot (separate `package.json`, separate `sessionDir`, separate process).
  - **D2 NON deferred**. L'utente ha esplicitamente autorizzato l'implementazione contestuale a C, accettando il tradeoff sicurezza (no auth, solo localhost). Mitigazioni: forced bind + runtime check + audit log + banner + kill switch + read-only branch handlers + write actions confirm-required.
  - **Vision via OpenCode parts API**. Wrapper esistente passa solo `parts: [{type:'text', text: prompt}]`. Estensione additiva: accetta array di parts misto text + file. Allowlist hardcoded di modelli vision-capable (gpt-5-mini, gpt-4o, claude-sonnet-4-6, gemini-2.5-pro/flash). Fallback config-driven se modello corrente non in allowlist.
  - **Media bytes mai persistiti** in DB o filesystem. Vivono in MediaQueue in-memory per il tempo del turn poi dropped. Privacy-by-design.
  - **Summary AI free-form, no zod**. Output e' prosa markdown destinata all'utente, non struttura. Cap a 4000 chars per evitare uso come LLM proxy gratuito.
- Decisione board:
  - `tested.md` conservato con superseded-note al top, NON cancellato (richiesta esplicita utente). Mapping degli item documentato nella note stessa + board.md.
  - `board.md` ristrutturato: #61 e #64 spostati in Done. Aggiunti #NEW1 (re_engage live test) + #NEW2 (skip-output live test) in In Progress, mappati agli item del tested.md. 5 nuovi card #SA/#SB/#SC/#SD1/#SD2 in Not Started.
  - `done.md`: questo entry.
- Documenti aggiornati:
  - `docs/dev/16-future-enhancements.md`: rimosso #7 (Dashboard locale Next.js) come future enhancement (ora in scope come Spec C).
  - `docs/dev/17-out-of-scope.md`: rilassati 3 carve-out: (a) "Detection avanzata sticker/audio/video" ora image=vision e altri=escalate, OCR/STT/analisi-video restano OUT; (b) "CLI per KB / job management" equivalente disponibile via web UI dashboard (Spec C+D2); (c) "Account multipli WhatsApp" carve-out per testing only in `e2e/`.
- Tempo: brainstorm + scrittura specs ~1h wall-clock.
- Follow-up:
  - Implementare i 5 spec in ordine A, B, C+D1, D2. Branch corrente `feat/v1-scope-expansion`.
  - Wave 11 #62 / #63 / #NEW1 / #NEW2 restano live tests manuali, da eseguire dopo l'implementazione di Spec B.

### Evento: runtime hardening — wweb lid + race fixes

- Cosa fatto: wave di hardening post-implementazione per stabilizzare l'esperienza utente. Coperti: wweb upgrade, lid resolution, isBotSent race, delayed reconciler, pre-launch cleanup, free-port helper, Telegram multi-recipient, dotenv autoload, OpenCode model swap, OPENCODE_DISABLE_DEFAULT_PLUGINS bug, shutdown hardening, dispatcher log level promotion, npm run test:e2e, wweb diagnostics. Dettaglio in [docs/dev/19-implementation-notes.md](../dev/19-implementation-notes.md).
- Decisioni:
  - **`OPENCODE_DISABLE_DEFAULT_PLUGINS=false` di default**. Settarlo a `1` unloada anche i provider plugin bundled (github-copilot, openai, anthropic) → qualunque `opencode:*` model ritorna HTTP 500 `ProviderModelNotFoundError`. Tool isolation gia' garantita dal blocco `permission` deny-all sull'agent `direct-reply` in `opencode.json` + da `OPENCODE_DISABLE_CLAUDE_CODE=1` (che blocca `CLAUDE.md` / `AGENTS.md` auto-injection). Stesso bug presente in `linkedin-autoapply` config.yaml.
  - **OpenCode model default → `opencode:github-copilot/gpt-5-mini`** (da `opencode:anthropic/claude-sonnet-4-6`). Override via YAML / web UI.
  - **whatsapp-web.js 1.34.7** (da `^1.26.0`). Sessione `LocalAuth` blob da 1.26 NON compatibile → re-paire QR richiesto. `.wwebjs_auth/` wipato durante testing.
  - **`@lid` resolution**: wweb 1.34.x espone `client.getContactLidAndPhone([id])`. Risolve solo contatti SALVATI sul telefono paired (privacy by design). Workaround user-side: salvare i numeri da whitelistare.
  - **`isBotSent` race fix**: sotto @lid wweb rewrita msgId dell'echo `message_create` o fira l'evento PRIMA che `sendMessage` risolva. Tracker ora ha 2 path: strict id match + fuzzy (chatId + body + ts window ≤3s/15s). Previene il classify dell'echo come `out_manual` con conseguente abort della pipeline mid-send.
  - **Delayed reconciler passes 15s / 45s / 120s** dopo `ready`. wweb 1.34 multi-device sync trickle-in delle chat nei primi 30-90s. Ogni pass e' idempotente via `processed_messages.whatsapp_msg_id` PK.
  - **Pre-launch Chromium cleanup** in `initWhatsApp` PRIMA di `client.initialize()`. Kill mirato dei processi Chromium la cui command line referenzia il NOSTRO `.wwebjs_auth/` (mai chrome.exe generici → chiuderebbe il browser dell'utente). Rimozione file lock (`SingletonLock`, `SingletonCookie`, `SingletonSocket`, `lockfile`). Cross-platform (PS Win / pgrep POSIX).
  - **`TELEGRAM_USER_CHAT_ID` comma-separated → broadcast**. Promise.allSettled, any success counts. Partial failures loggati.
  - **`dotenv/config` autoload** in cima a `src/index.ts`, `src/scripts/health.ts`, `src/scripts/test-e2e.ts`. Niente piu' export manuale.
  - **`scripts/free-port.mjs`** wrappato come `predev:web` step. Cross-platform kill di chi holdi port 3000. Risolve EADDRINUSE dopo Ctrl+C consecutivi.
  - **Shutdown hardening**: `SIGINT` / `SIGTERM` / `SIGHUP` / `uncaughtException` / `unhandledRejection` tutti convergono in `shutdown(reason)` idempotente che chiude ticker / cron / opencode / sqlite / wa pulito.
  - **Dispatcher log promotion**: `msg received` / `msg passed filter` / `msg filtered out` / `msg skipped (group)` / state transitions promossi a `info`. Testing manuale non richiede piu' `LOG_LEVEL=debug`.
  - **`npm run test:e2e`**: smoke pipeline completa senza wweb (fake `WhatsAppHandle` con `sendMessage` che logga). Permette validazione AI + state machine + orchestrator senza scan QR.
- Problemi incontrati:
  - **`@lid` privacy**: WhatsApp 2024+ mostra `179xxx@lid` per contatti unsaved al peer. Il bot lato sender vede questa identifier opaca al posto del +39/+84 atteso → filter rejecta tutti. Mitigato con `getContactLidAndPhone` per contatti saved. Contatti unsaved restano opachi by design (privacy).
  - **`isBotSent` race**: sotto @lid wweb 1.34 rewrita il msgId dell'echo OR fira `message_create` PRIMA che `sendMessage` risolva. Senza fuzzy match il dispatcher classificava l'echo come `out_manual` → abortiva la propria pipeline mid-send → no reply visibile.
  - **`OPENCODE_DISABLE_DEFAULT_PLUGINS=1`**: scoperto che disabilita anche i provider bundled (non solo plugin "auxiliary"). Sintomo: tutti i model `opencode:*` ritornano 500 ProviderModelNotFoundError. Workaround: `false` di default. Documentato in `19-implementation-notes.md` §8.
  - **Chromium lock left over**: Ctrl+C / kill -9 / crash silenzioso lasciano processi Chromium orfani + `SingletonLock` file. Nuovo run → "The browser is already running for /path/to/.wwebjs_auth/". Mitigato con pre-launch cleanup.
- Verifica:
  - `npm run test:e2e` PASS (exit code 0, reply mock generata in 26s).
  - `npm run health` PASS.
  - `npm run dev` PASS (entrambi `[bot]` e `[web]` partono).
  - Smoke test #61 (base reply) verificato manualmente con +39 → +31 paired account.
- Follow-up:
  - **Wave 11 #62 (escalation Telegram)** ancora non live-testato. Implementation completa (multi-recipient + retry).
  - **Wave 11 #63 (birthday job)** ancora non live-testato. Implementation completa.
  - **Wave 11 #64 (reconnect / boot reconciler)** ancora non live-testato. Delayed reconciler shipped.
  - Future enhancement opzionale: `filter.allowUnknownLid: true` (~5 righe in `filter.ts`) per accettare unsaved `@lid` con pushname non vuoto. Apre superficie privacy (unsaved random con tuo nome potrebbe triggerare).
  - Plan B se wweb diventa instabile: migrazione a `@whiskeysockets/Baileys`. Non in roadmap attiva.

### Evento: collapse a single-project + YAML config

- Cosa fatto: collassato i due progetti Node (root bot + `web/` UI) in un unico progetto. Tutte le dependencies di `web/package.json` (Next 15, React 19, Tailwind, shadcn radix-ui, react-hook-form, hookform/resolvers) mergeate in root `package.json`. Cancellati `web/package.json`, `web/package-lock.json`, `web/node_modules`. Aggiunto `concurrently@^9` come dev. Nuovi script: `npm run dev` (= concurrently bot + web), `dev:bot`, `dev:web` (= `next dev ./web -p 3000`), `build:web` (= `next build ./web`). `npm start` resta bot-only.
- Cosa fatto (config refactor): runtime config switchata da TS/JSON a YAML. Nuovo `config/defaults.ts` (sola TS, niente IO ne' filter logic). Nuovo `config/user-config.example.yaml` con commenti inline per ogni campo (unita', descrizione, marker `# RESTART REQUIRED`). Riscritto `config/index.ts` per leggere YAML via `yaml@^2`, deep-merge over defaults, ed esporre `shouldReply` derivato 100% dal blocco `filter`. Cancellati `config/user-config.json` + `config/user-config.example.json`. Aggiornato `src/config/index.ts` (chokidar watcha `user-config.yaml`, re-parse + re-merge + re-validate + swap atomico) e `src/config/schema.ts` (aggiunto block zod per `filter`). Refactored API route `web/app/api/config/route.ts` per leggere/scrivere YAML usando lo stesso zod schema del bot. Form Next.js usa i nomi nuovi del filter (`allowedPrefixes`, `blockedNumbers`).
- Decisioni utente (baked-in nel refactor):
  - **Prod = bot-only.** `npm start` lancia solo il bot. La UI e' dev-only. Nessun `next start` in produzione.
  - **YAML-only filter.** Killato l'escape hatch TS per `shouldReply`. La predicate e' generata 100% dal blocco YAML `filter` (con default a `allowedPrefixes=['+84']` da `defaults.ts`).
  - **YAML commentato.** `user-config.example.yaml` ha commento inline per ogni campo: unita' (`ms`, `days`), marker restart-required, descrizione one-liner.
- Decisioni tecniche aggiuntive:
  - Filter field rename: `prefixWhitelist` -> `allowedPrefixes`, `blocklist` -> `blockedNumbers`. Aggiornati schema, form, defaults.
  - Aggiunti shim `postcss.config.mjs` + `tailwind.config.ts` a root (re-export dei file in `web/`). Necessari perche' PostCSS / Tailwind risolvono il config da `process.cwd()`, che con `next build ./web` lanciato da root e' la root. Il `web/tailwind.config.ts` usa `path.dirname(fileURLToPath(import.meta.url))` per gli `content` paths, cosi' funziona da entrambi i lati.
  - `web/lib/config-schema.ts` re-esporta `defaults` da `config/defaults.ts` (single source of truth). Lo zod schema rimane duplicato (web sotto module resolution `bundler`, bot sotto `NodeNext`).
  - `config/user-config.yaml` gitignored (e' il file utente locale); committato solo `user-config.example.yaml`. Anche aggiunto a `.prettierignore` per non scompaginare i commenti inline.
- Verifica:
  - `npm install` clean (707 packages, no `web/node_modules` recreato).
  - `npx tsc --noEmit`: clean.
  - `npm run build:web`: PASS (Next build OK con shim PostCSS).
  - `npx tsx -e "import('./config/index.ts')...`": `shouldReply +8499 -> true`, `+39 -> false`.
  - `npm run dev`: entrambi `[bot]` e `[web]` in output, `[web] Ready in 4.9s`.
  - YAML round-trip (modifica `aiHistoryLimit=42` via `yaml.stringify`, re-read, re-import config): valore aggiornato, zod ok.
  - `npm run format` + `format:check`: clean.
- Follow-up:
  - I dev docs 01-18 (eccetto 11) non sono stati toccati: descrivono comportamenti runtime invarianti rispetto a questo refactor.
  - Form filter UI gia' shippata con i nomi nuovi; nessun migration path per utenti esistenti (la spec era v1 dev, no produzione attiva).

### Evento: waves 1-10 implementate end-to-end

- Cosa fatto: implementati tutti i task #01-#60 + #65 (65 totali, escluso wave 11 smoke E2E che richiede interazione utente). Project type-checks clean con `npx tsc --noEmit` su tutto `src/` + `config/index.ts` + `drizzle.config.ts`. `npm run db:migrate` applica `drizzle/0000_init.sql` correttamente (7 tabelle base + `facts_vec` virtual). `npm run health` esegue e produce JSON valido con tutti i counter a 0.
- Decisioni:
  - **Vault esterno disabilitato per questo progetto.** Tutto lo stato operativo vive in `docs/status/` (board, done, parallel) dentro al repo stesso. Nota aggiunta in `README.md`.
  - **Strategy A per repo.ts** (mono-file): un solo `src/db/repo.ts` con 35 funzioni semantiche divise in 6 parti logiche. Scartata Strategy B (split in `src/db/repo/*.ts`) perche' con cap di 1-2 subagent paralleli non guadagnava wall-clock, e mono-file e' piu' navigabile per Find Symbol.
  - **`src/log.ts` non importa `config`**: per evitare ciclo `config -> log -> config`. Knobs presi da env vars (`LOG_LEVEL`, `LOG_FILE`, `LOG_FREQUENCY`, `LOG_MAX_SIZE`) con default allineati ai valori di `config/index.ts`. Cambio runtime supportato via `setLogLevel(level)`. Deviazione dalla pseudocodice in `dev/12-logging-observability.md` documentata in commento in cima al file.
  - **`config/index.ts` (root) ridotto in import**: invece di `require.resolve` (CJS-only) usa `pathToFileURL(resolvePath(cwd, 'config/index.ts'))` con cache-busting query string. Compatibile con NodeNext ESM.
  - **`src/ai/opencode.ts` + `opencode.json`**: copia 1:1 da `C:\Users\Antonio\Downloads\linkedin-autoapply`. Adattato solo gli import (path relativi diversi nel nostro layout) e aggiunte costanti corrispondenti in `src/config/constants.ts` (OPENCODE*SERVER_HOST/PORT/TIMEOUT_MS/DISABLE*\*). Aggiunto `src/utils/utils.ts` con la sola funzione `delay` necessaria.
  - **Subagent #04 (types.ts) ha definito `ChatContext` con shape diversa da spec** (campo `chatId`/`whatsappMsgId`/`direction` invece di `phone/name/isSavedContact/lastMessageTs/unreadCount`). Corretto a mano per allinearlo a `dev/05-filter-engine.md`.
  - **`ai/turn.ts` carica i prompt una sola volta** all'avvio (cached). Per ricarica live richiederebbe restart o invalidazione cache.
  - **`scheduler/latency.ts` usa Intl.DateTimeFormat** per timezone math invece di luxon/date-fns-tz (riduce dependency count).
  - **`scheduler/ticker.ts` e `scheduler/manual-jobs-cron.ts` riceveranno `runTurn`/`runManualJob` come callback** dal `src/index.ts`. Evita import circolare scheduler -> orchestrator -> scheduler.
- Problemi incontrati:
  - `tsx`/`npm run health` non terminava in foreground perche' `initConfig` apre chokidar watcher che tiene vivo il processo. Risolto chiamando `process.exit(0)` esplicito in `health.ts` dopo il `main()`.
  - Drizzle-kit genera filename random tipo `0000_warm_taskmaster.sql`. Rinominato a mano in `0000_init.sql` (come da spec) e aggiornato `drizzle/meta/_journal.json` di conseguenza, poi appeso `CREATE VIRTUAL TABLE facts_vec USING vec0(...)` per la virtual table sqlite-vec.
- Tempo: ~2 ore wall-clock end-to-end con 2 subagent paralleli (types, wweb, prompts) e tutto il resto inline.
- Follow-up:
  - **Wave 11 (smoke E2E #61-#64)**: richiedono account WhatsApp reale + (per #62) bot Telegram + interazione con utente. Restano in `In Progress` su `board.md` finche' non vengono eseguiti manualmente.
  - **Setup Telegram** (per testare escalation): seguire `docs/dev/15-runbook.md` sezione "Setup Telegram". Token va in `.env` (gitignored).
  - **OpenCode CLI** deve essere installato globalmente (`opencode --version` per verificare). Senza, l'avvio del bot fallisce su `ensureOpencodeServer`.

### Evento: feature escalation a umano aggiunta al design v1

- Cosa fatto: aggiunta feature "Escalation a umano" alla docs pre-implementazione. Nuovi `docs/dev/18-escalation.md` + `docs/utente/12-quando-ti-chiama.md`. Esteso TurnOutput zod schema con `escalate_to_human`, nuova tabella `escalations`, modulo `EscalationNotifier` con canali WhatsApp self-chat + Telegram, config `escalation.*`, `.env` con TELEGRAM_BOT_TOKEN + TELEGRAM_USER_CHAT_ID, prompt `06_escalation_rules.txt`, runbook setup Telegram + troubleshoot, future enhancements #9-11 (policy per chat, snooze, aggregation).
- Decisioni:
  - Escalation = feature v1, non future. Rischio: senza, l'AI inventa appuntamenti che l'utente non puo' mantenere.
  - Compatibile con design fully-autonomous: l'AI sceglie autonomamente quando escalare. Approval flow puro resta out-of-scope.
  - Canali v1: WhatsApp self-chat e/o Telegram bot, configurabili insieme. Telegram via HTTPS POST diretto (no libreria), Node 20 fetch. Token in `.env` gitignored.
- Commit: `3e8dc1b` su `main`.

### Evento: docs/status/ creato

- Cosa fatto: creata folder `docs/status/` con `board.md` (kanban Obsidian, 4 colonne, 65 task), `done.md` (questo file), `parallel.md` (dependency DAG + wave plan per spawn subagent paralleli), `README.md` (indice).
- Decisioni:
  - Granularita' granulare (65 task) preferita a macro (15 task) per migliore parallelizzazione subagent.
  - Italiano per tutta la prosa, technical terms in inglese (allineato repo).
  - 4 colonne: Not Started / In Progress / Done / Paused. Niente "Blocked" separato: se un task e' bloccato, va in Paused con motivo nel done.md.
  - Done log = file separato dalla colonna Done del board: la colonna Kanban tiene one-liner, il file done.md tiene il post-mortem.
- Outcome: project tracking pronto per lo sviluppo.
