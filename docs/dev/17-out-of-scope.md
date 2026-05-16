# Out of scope

> Status: speculative / forward-looking. Not implemented in v1.

Lista esplicita di cosa NON viene fatto. Il bot v1 non gestisce niente di seguito, e niente entra in roadmap salvo riapertura esplicita con discussione.

## Esclusioni hard (mai, salvo cambio di scope drastico)

### Chat di gruppo

Gruppi sempre ignorati, anche al boot. Il `MessageDispatcher` filtra `chat.isGroup === true` prima di qualunque altra logica. Niente KB, niente scheduler, niente manual_jobs su chat di gruppo.

Motivo: contesto sociale multi-persona è un problema di scope completamente diverso (KB per partecipante, sentiment incrociato, decisione "rispondere a chi"). Non vale la complessità per casi d'uso atipici.

### Account multipli WhatsApp (nel runtime del bot)

Una sola sessione `whatsapp-web.js` IN PRODUZIONE, un solo numero. Niente astrazione `accountId`, niente isolation per account, niente switching.

Motivo: complessità trasversale (ogni tabella avrebbe `account_id`, ogni query filter, ogni flow lookup). Beneficio marginale (chi ha bisogno di multi-account può girare due istanze separate del bot in directory diverse).

**Carve-out 2026-05-16 (Spec B)**: il framework di test e2e in `e2e/driver/` USA un secondo client `whatsapp-web.js` come "driver" per inviare messaggi al bot da un account di test. Vive completamente isolato dal runtime del bot (separate `package.json`, separate `sessionDir`, separate process), e NON espone alcuna astrazione multi-account in `src/`. Vedi `specs/2026-05-16-spec-b-test-framework.md`.

### Approval flow / draft / preview

Il bot manda direttamente. Non c'è step di review umano sulle reply.

Motivo: contraddice il design "fully autonomous". Se vuoi controllo, riscrivi tu il messaggio (il bot rileva l'`out_manual` e annulla il suo schedule).

**Nota su escalation a umano**: la feature "escalation a umano" (vedi `18-escalation.md`) NON è un approval flow. Differenza chiave:

| Aspetto        | Escalation (in scope)                                     | Approval flow (out of scope)         |
| -------------- | --------------------------------------------------------- | ------------------------------------ |
| Frequenza      | Solo turn dove l'AI dichiara incertezza esplicita         | Ogni reply, sempre                   |
| Default        | Bot risponde da solo                                      | Bot mai risponde senza OK            |
| Decisione      | L'AI stessa decide quando escalare (parte del suo output) | L'utente decide ogni volta           |
| Latenza utente | 0 (l'AI manda holding reply automatica)                   | Lunga (deve approvare ogni risposta) |

Escalation è compatibile con `fully autonomous`: la scelta di escalare è autonoma dell'AI, e capita solo nei casi dove non sa. Approval flow puro resta out-of-scope.

### CLI per KB / job management

Niente comandi `npm run kb:*`, `npm run jobs:*`, ecc.

Motivo: fora il principio "tutto via conversazione naturale". Se serve manipolare il KB, lo si fa via DB diretto (intervento raro) o lasciando che l'AI emetta `supersedes_id`.

**Carve-out 2026-05-16 (Spec C + D2)**: la web UI dashboard (Spec C) fornisce lettura read-only su KB + schedule + stats. La spec D2 estende con un AI command channel che propone azioni structured (createManualJob, dismissEscalation, ecc.) eseguite dopo conferma utente. NON e' una CLI con prefissi: e' una chat naturale in UI che ritorna proposed actions whitelisted via zod. Sicurezza: localhost-only binding + kill switch. Vedi `specs/2026-05-16-spec-c-dashboard.md` e `specs/2026-05-16-spec-d2-ai-commands.md`.

### Self-chat command channel strutturato

Niente parsing di prefissi tipo `/!` o comandi naturali in self-chat.

Motivo: complessità per beneficio marginale. Casi rari di gestione manuale si risolvono con edit DB diretto.

### Web UI / dashboard di gestione (in v1)

Niente HTTP server, niente front-end attivo.

Motivo: aggiunge superficie di attacco e complessità non motivata in v1. Future enhancement #7 prevede una dashboard read-only Next.js.

### Multi-backend AI (in v1)

Solo OpenCode con config `opencode.json` 1:1 da `linkedin-autoapply`. Niente Groq/Gemini/Claude-CLI/Codex-CLI/Playwright UI in v1.

Motivo: limitare la superficie di test e validazione. Ogni backend ha quirks diversi sull'output JSON. Future enhancement #4 reintroduce multi-backend.

### Backup automatico DB

Niente cron di copia, niente snapshot ricorrenti, niente export.

Motivo: fuori scope. L'utente può copiare il file `.db` manualmente quando vuole.

### Sync multi-machine del DB

Single-machine. Il file `.db` non va in OneDrive, Dropbox, Syncthing, git, durante l'esecuzione.

Motivo: SQLite con WAL mode su filesystem sync produce conflitti e potenziale corruzione. Se serve portabilità, copiare `.db` a bot fermo.

### Cifratura at-rest applicativa

Il file `.db` è in chiaro. Niente SQLCipher, niente encryption layer.

Motivo: si delega al filesystem (BitLocker/FileVault/LUKS). La cifratura applicativa aggiunge complessità chiave-management senza benefici significativi nel modello di minaccia tipico (PC personale dell'utente).

### Detection avanzata sticker/audio/video

**Carve-out 2026-05-16 (Spec A)**: la spec A rilassa parzialmente questa esclusione:
- **Image**: ora processate via vision API di OpenCode (modello multimodale, allowlist di modelli vision-capable). Reply generata normalmente. Caption usata come testo accompagnatorio.
- **Audio / video / document / location / live_location / vcard**: forzano un'escalation a umano (riusa infra esistente di `18-escalation.md`). Niente OCR, niente speech-to-text, niente analisi video.
- **Sticker**: skip (equivalente a emoji singolo).

Vedi `specs/2026-05-16-spec-a-media.md` per il design completo.

Resta OUT: OCR di document, STT di audio, frame extraction di video, analisi semantica del contenuto multimediale non-image. Scope creep enorme.

### Persistenza sentiment classification (in v1)

Il sentiment è inline nel prompt. Niente colonna dedicata, niente storia per messaggio.

Motivo: aggiungere colonne a `processed_messages` solo per tracking implica chiamate sentiment in più. Future enhancement #1 lo aggiunge se serve analytics longitudinale.

## Esclusioni di v1 ma riconsiderabili

(Tutti questi sono coperti da future enhancements. Vedi `16-future-enhancements.md`.)

- Sentiment con modello locale persistito.
- Dynamic delay livelli 3 e 4.
- Postgres + pgvector.
- Engagement state lifecycle granulare.
- Dashboard Next.js read-only.
- Daily digest in self-chat.
- Multi-backend AI rotation (incluso UI Playwright).
- Escalation `escalation_policy` per chat (`auto` / `always` / `never`).
- Escalation snooze ("ti ricordo tra X minuti").

## Comportamento davanti a richieste fuori scope

Se durante l'uso emerge una necessita non coperta:

1. Verificare se è in future-enhancements.
2. Se sì, decidere se accelerare l'implementazione di quel punto.
3. Se no, valutare se aggiungerlo a future-enhancements o se è davvero out-of-scope.
4. Documentare la decisione (questo file o `16-future-enhancements.md`).

Niente patch ad hoc fuori da questo processo. Il design v1 è coerente: aggiungere logica non documentata rompe la coerenza.
