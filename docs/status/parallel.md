---
created: 2026-05-16
updated: 2026-05-16T12:29:00+02:00
tags: [project/viet-chatter, parallelization]
---

# Parallel execution plan

Documento operativo per spawnare piu' subagent insieme su task indipendenti, riducendo tempo totale.

## Come usarlo

1. Identifica la wave corrente (la prima dove ci sono task `Not Started` con tutte le dependency soddisfatte).
2. Tutti i task della stessa wave possono partire in parallelo.
3. Spawn N subagent (uno per task, oppure clustering basato sul tipo: vedi "Cluster di task").
4. Mai partire una wave successiva finche' la precedente non e' chiusa: i task della wave N+1 hanno dependency su task della wave N.
5. Eccezione: i prompt files (`prompts/turn/*`) e altri task "isolati" possono fare il salto se le loro dependency sono comunque soddisfatte (vedi DAG).

## Constraints di design alla parallelizzazione

- **Repo**: tutti i subagent scrivono nello stesso repo. Senza branch isolation rischio merge conflict. Mitigazione: ogni subagent lavora su file disjoint (i file sono assegnati 1:1 ai task).
- **DB schema**: `src/db/schema.ts` e' UN file unico. Una sola task lo tocca (#11). Non parallelizzabile su questo file.
- **Repo functions**: `src/db/repo.ts` e' UN file unico ma diviso in 6 task (#15-20) per parti logiche. Si possono parallelizzare se ogni subagent scrive a sezione separata e poi un merge step finale unifica. Realisticamente: meglio sequenziale per evitare conflict, oppure partizionare in 6 file separati e fare un `index.ts` re-export. Vedi sezione "Strategia per repo.ts".
- **Smoke test E2E**: necessitano account WhatsApp reale. Non parallelizzabili: l'utente deve essere disponibile a scansionare QR e mandare messaggi test. Solo 1 alla volta.

## Wave plan

Le wave non sono settimane: sono ordinamenti topologici. Ogni wave puo' essere completata in poche ore se i task sono parallelizzati.

### Wave 1 - Foundation (5 task, parallelizzabili al 100%)

Niente dependency tra loro. Spawn 5 subagent in parallelo.

| # | Task | File | Indep |
|---|---|---|---|
| 01 | init | `package.json`, `tsconfig.json`, `.gitignore`, `.env.example` | si |
| 02 | install deps | (lock file change) | si (deve venire dopo o insieme a #01 se package.json gia' c'e') |
| 03 | scaffold filesystem | tutta la struttura `src/` vuota | si |
| 04 | types | `src/types.ts` | si |
| 05 | log | `src/log.ts` (dipende solo da pino installato) | dipende da #02 |

Ordine: spawn #01, #03, #04 immediato. Poi #02 (after #01 esiste). Poi #05 (after #02).

In pratica: tre task batch:
- batch A: #01, #03, #04 (parallelo)
- batch B: #02 (dopo A)
- batch C: #05 (dopo B)

### Wave 2 - Config (3 task)

Dependency: #04 (types) + #02 (deps `zod`, `chokidar`).

| # | Task | File | Parallelizzabile con |
|---|---|---|---|
| 06 | config/index.ts (root) | predicate function + valori | #07, #08, #09 (file diversi) |
| 07 | schema.ts | zod schema | #06, #08, #09 |
| 08 | config loader | hot reload | #06, #07, #09 |
| 09 | constants.ts | const fissi | #06, #07, #08 |

Spawn 4 subagent in parallelo.

### Wave 3 - DB foundation (5 task)

Dependency: #02 (`better-sqlite3`, `sqlite-vec`, `drizzle-orm`, `drizzle-kit`).

| # | Task | File | Parallelizzabile con |
|---|---|---|---|
| 10 | db/client.ts | open + pragmas + sqliteVec.load | #11, #12 |
| 11 | db/schema.ts | tutte tabelle Drizzle | #10, #12 |
| 12 | drizzle.config.ts | drizzle config | #10, #11 |
| 13 | drizzle/0000_init.sql | edit dopo generate | dopo #11 + #12 |
| 14 | db/migrate.ts | migrate runner | dopo #10 + #11 |

Spawn #10, #11, #12 paralleli. Poi #13 (dopo #11 + #12). Poi #14 (dopo #10 + #11).

### Wave 4 - Repo (6 task)

Dependency: #11 (schema), #10 (client). Vedi "Strategia per repo.ts" sotto.

Strategia A (sequenziale conservativa): #15 → #16 → #17 → #18 → #19 → #20. 1 subagent.

Strategia B (parallelo aggressivo, raccomandata): suddividi `repo.ts` in:
- `src/db/repo/messages.ts` (#15)
- `src/db/repo/chat-state.ts` (#16)
- `src/db/repo/profile.ts` (#17)
- `src/db/repo/facts.ts` (#18)
- `src/db/repo/manual-jobs.ts` (#19)
- `src/db/repo/turn-log-and-escalations.ts` (#20)
- `src/db/repo/index.ts` (re-export aggregator)

Tutti file disjoint. Spawn 6 subagent paralleli + 1 finale per index.ts.

### Wave 5 - Layer indipendenti (8 task, alta parallelizzazione)

Tutti su file disjoint. Spawn 8 subagent paralleli.

| # | Task | File |
|---|---|---|
| 21 | embedding.ts | `src/kb/embedding.ts` |
| 22 | vec.ts | `src/kb/vec.ts` (dipende da #11 per facts_vec, ma solo runtime) |
| 25 | profile.ts | `src/persona/profile.ts` (richiama repo) |
| 26 | wa client.ts | `src/whatsapp/client.ts` |
| 27 | wa connection.ts | `src/whatsapp/connection.ts` |
| 34 | inflight.ts | `src/orchestrator/inflight.ts` (puro standalone) |
| 36 | ai/opencode.ts | copia 1:1 da linkedin-autoapply |
| 37 | opencode.json | copia 1:1 da linkedin-autoapply (root) |

### Wave 6 - Layer dipendenti + prompts (parallelizzazione massima!)

I 10 prompt files sono completamente indipendenti tra loro: spawn 10 subagent paralleli su quelli + 6 task code in parallelo. Totale 16 subagent simultanei.

| # | Task | File | Note |
|---|---|---|---|
| 23 | kb/store.ts | `src/kb/store.ts` | dopo #15-20 + #22 + #21 |
| 24 | kb/pruner.ts | `src/kb/pruner.ts` | dopo #18 + #22 |
| 28 | dispatcher/filter.ts | `src/dispatcher/filter.ts` | dopo #08 |
| 30 | scheduler/latency.ts | `src/scheduler/latency.ts` | dopo #15 |
| 38 | ai/router.ts | `src/ai/router.ts` | dopo #36 |
| 40 | prompt 00_role | `prompts/turn/00_role.txt` | indep |
| 41 | prompt 01_persona_kb | `prompts/turn/01_persona_kb.txt` | indep |
| 42 | prompt 02_tone_guidance | `prompts/turn/02_tone_guidance.txt` | indep |
| 43 | prompt 03_language_rules | `prompts/turn/03_language_rules.txt` | indep |
| 44 | prompt 04_extraction_rules | `prompts/turn/04_extraction_rules.txt` | indep |
| 45 | prompt 05_revive_and_skip | `prompts/turn/05_revive_and_skip.txt` | indep |
| 46 | prompt 06_escalation_rules | `prompts/turn/06_escalation_rules.txt` | indep |
| 47 | prompt 07_output_schema | `prompts/turn/07_output_schema.txt` | indep |
| 48 | prompt 08_examples | `prompts/turn/08_examples.txt` | indep |
| 49 | prompt 99_context_template | `prompts/turn/99_context_template.txt` | indep |
| 50 | escalation/format.ts | `src/escalation/format.ts` | indep |
| 51 | escalation/channels/index.ts | interfaccia + factory | indep |
| 53 | escalation/channels/telegram.ts | HTTPS POST | indep |

### Wave 7 - Pipeline core (5 task)

Dependency: wave 5 + 6 chiusa.

| # | Task | File | Parallelizzabile con |
|---|---|---|---|
| 29 | dispatcher/index.ts | `src/dispatcher/index.ts` | #31, #35, #39, #52 (file diversi) |
| 31 | scheduler/state.ts | `src/scheduler/state.ts` | #29, #35, #39, #52 |
| 35 | orchestrator/context.ts | `src/orchestrator/context.ts` | #29, #31, #39, #52 |
| 39 | ai/turn.ts | `src/ai/turn.ts` (richiama prompts wave 6) | #29, #31, #35, #52 |
| 52 | escalation/channels/whatsapp-self.ts | richiama wa client | #29, #31, #35, #39 |

Spawn 5 subagent paralleli.

### Wave 8 - Cron + notifier (4 task)

Dependency: wave 7 chiusa.

| # | Task | File |
|---|---|---|
| 32 | scheduler/ticker.ts | `src/scheduler/ticker.ts` |
| 33 | scheduler/manual-jobs-cron.ts | `src/scheduler/manual-jobs-cron.ts` |
| 54 | escalation/notifier.ts | `src/escalation/notifier.ts` |
| 55 | escalation/retry.ts | `src/escalation/retry.ts` |
| 59 | scripts/health.ts | `src/scripts/health.ts` |

Spawn 5 subagent paralleli.

### Wave 9 - Orchestrator + boot (3 task)

Dependency: wave 8 chiusa.

| # | Task | File |
|---|---|---|
| 56 | orchestrator/index.ts (parte 1) | `generateAndSend` |
| 57 | orchestrator/index.ts (parte 2) | `generateAndSendForManualJob` |
| 58 | boot/reconciler.ts | `src/boot/reconciler.ts` |

#56 e #57 sono sullo stesso file: sequenziali (#56 prima, #57 aggiunge la seconda funzione). #58 e' parallelo a entrambi.

Strategia: spawn #56 + #58 in parallelo. Poi #57 dopo che #56 e' completato.

### Wave 10 - Entry point (1 task)

| # | Task | File |
|---|---|---|
| 60 | index.ts | `src/index.ts` |

Singolo task, integra tutto. Solo 1 subagent.

### Wave 11 - Smoke test E2E + finalizing (5 task, sequenziali per definizione)

Smoke test richiedono interazione utente con WhatsApp reale. Non parallelizzabili.

| # | Task | Note |
|---|---|---|
| 61 | smoke reply base | Test debounce + delay + cancel su out_manual |
| 62 | smoke escalation | Test trigger + Telegram delivery + holding reply |
| 63 | smoke birthday job | Test date_anchored fire + send |
| 64 | smoke boot reconciler | Test reconnect + post-reconnect spread |
| 65 | README finalize | Sezione "Stato" |

Tutti sequenziali. #65 ultimo (lo facciamo solo dopo che gli smoke 61-64 passano).

## DAG riassunto

```
Wave 1: foundation
  01 ┐
  03 ┼─> 02 ─> 05
  04 ┘

Wave 2: config (depends on Wave 1)
  06, 07, 08, 09 (paralleli)

Wave 3: DB foundation (depends on Wave 1 + 2)
  10, 11, 12 (paralleli) ─> 13, 14

Wave 4: Repo (depends on Wave 3)
  15, 16, 17, 18, 19, 20 (paralleli se split su file separati)

Wave 5: Indipendenti (depends on Wave 4 + parts of 1-3)
  21, 22, 25, 26, 27, 34, 36, 37 (paralleli)

Wave 6: Layer dipendenti + prompts (depends on Wave 5)
  23, 24, 28, 30, 38, 40-49, 50, 51, 53 (16 paralleli)

Wave 7: Pipeline core (depends on Wave 6)
  29, 31, 35, 39, 52 (paralleli)

Wave 8: Cron + notifier (depends on Wave 7)
  32, 33, 54, 55, 59 (paralleli)

Wave 9: Orchestrator + boot (depends on Wave 8)
  56 ─> 57 (sequenziali)
  58 (parallelo a 56-57)

Wave 10: Entry point (depends on Wave 9)
  60

Wave 11: Smoke E2E (sequenziali)
  61 ─> 62 ─> 63 ─> 64 ─> 65
```

## Cluster di task per spawn efficiente

Quando spawni subagent, raggruppa i task per "tipo" cosi' un singolo subagent puo' fare un cluster coerente in una sessione:

### Cluster A: Prompts (10 task, una sessione)

I 10 file `prompts/turn/*` sono testo, no codice. Un subagent prompt-engineer scrive tutti e 10 in una sessione, leggendo `dev/07-ai-integration.md` e `dev/18-escalation.md`.

Tempo stimato: 30-60 min.

### Cluster B: Repo (6 task, una sessione)

Se scegli strategia B (split in file separati), un subagent specializzato in DB scrive tutti i file `src/db/repo/*.ts` in una sessione, leggendo `dev/08-persistenza.md` e `dev/03-data-flow.md`.

Tempo stimato: 1-2 ore.

### Cluster C: Foundation (Wave 1 + Wave 2, 9 task)

Un subagent setup configura il progetto end-to-end: `package.json`, `tsconfig.json`, `.gitignore`, scaffold cartelle, types, log, config completo, schema zod, loader hot-reload.

Tempo stimato: 1-2 ore.

### Cluster D: Escalation feature (5-7 task)

Un subagent specializzato si occupa di tutta la feature escalation: `src/escalation/format.ts`, `channels/index.ts`, `channels/whatsapp-self.ts`, `channels/telegram.ts`, `notifier.ts`, `retry.ts`, prompt `06_escalation_rules.txt`. Si tira dietro come dependency `repo.ts` parte 6 (#20).

Tempo stimato: 2-3 ore.

### Cluster E: Smoke E2E (4 test, sessione interattiva con utente)

Un subagent QA fa setup + drive dei 4 smoke test con l'utente.

Tempo stimato: 1-2 ore.

## Strategia per repo.ts

Decisione da prendere prima di partire:

- **A. Mono-file `repo.ts`**: 1 subagent, sequenziale, basso rischio merge conflict, ~2 ore.
- **B. Multi-file `repo/*.ts`**: 6 subagent paralleli, ~1 ora wall clock, ma richiede aggregator `index.ts` che re-exporta + leggera modifica del modulo che li importa.

Raccomandata B se:
- Si vuole massima parallelizzazione.
- Si tollera struttura piu' frammentata.

Raccomandata A se:
- Si preferisce 1 file unico (piu' facile per Find Symbol).
- Non c'e' urgenza wall-clock.

L'utente decide al momento del kickoff.

## Stima totale

Stima ottimistica con parallelizzazione massima:

| Wave | Task # | Tempo wall-clock con parallelo |
|---|---|---|
| 1 | 5 | 30 min (3 batch sequenziali) |
| 2 | 4 | 30 min |
| 3 | 5 | 30 min |
| 4 | 6 | 1 ora (strategia B) |
| 5 | 8 | 1 ora |
| 6 | 16 | 1.5 ore (con 16 subagent simultanei) |
| 7 | 5 | 1 ora |
| 8 | 5 | 1 ora |
| 9 | 3 | 1 ora |
| 10 | 1 | 30 min |
| 11 | 5 | 1.5 ore (sequenziale + interattivo) |

**Totale**: ~10-12 ore wall-clock se tutto liscio. Realistico: 15-20 ore con bug e iterazione.

## Anti-pattern (NON fare)

- Spawnare subagent in piu' wave contemporaneamente: rompe le dependency.
- Far scrivere lo stesso file da 2 subagent: garantito merge conflict.
- Spawnare subagent senza dargli i file dev/ rilevanti come context: produrra' codice non allineato al design.
- Saltare wave 11 (smoke test) perche' "sembra funzionare": il bot risponde via WhatsApp reale, qualunque bug si manifesta solo li'.

## Workflow operativo per kickoff

1. Apri `board.md` su Obsidian, vista Kanban.
2. Sposta i task della wave corrente da `Not Started` a `In Progress`.
3. Spawn subagent (uno per task, oppure cluster).
4. Quando un subagent finisce, sposta la card in `Done`.
5. Apri `done.md` e aggiungi entry per ogni task chiuso.
6. Quando tutta la wave e' in `Done`, parti con la wave successiva.

Se un task si blocca:
- Sposta in `Paused`.
- Documenta in `done.md` il motivo (sezione "Blockers" oppure entry dedicata).
- Continua con altri task della stessa wave non bloccati.

Vedi anche `done.md` per il log progressivo e `board.md` per lo stato corrente.
