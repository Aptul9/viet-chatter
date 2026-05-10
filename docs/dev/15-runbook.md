# Runbook

## Setup iniziale

```bash
git clone <repo>
cd viet-chatter
npm install
npm run db:migrate     # crea ./viet-chatter.db con schema iniziale
npm start              # primo run, mostra QR code
```

Scansiona il QR code da WhatsApp mobile (`Impostazioni > Dispositivi collegati > Collega un dispositivo`).

## Avvio normale

```bash
npm start
```

Il bot:

1. Carica config.
2. Apre SQLite + sqlite-vec.
3. Avvia OpenCode server (auto, port libera).
4. Si connette a WhatsApp Web (sessione cached in `.wwebjs_auth/`).
5. Esegue `BootReconciler`.
6. Avvia `TickerLoop`, `ManualJobsCron`, `EphemeralPruner`.
7. Stampa "boot done" su stdout.

Da questo momento il terminale resta aperto, il bot gira finché non lo fermi (`Ctrl+C`).

## Stop

`Ctrl+C` nel terminale. Lo handler `SIGINT` chiude WhatsApp client, OpenCode server, DB pulitamente.

## Health check

```bash
npm run health
```

Stampa:

```
{
  db_path: "./viet-chatter.db",
  chats_total: 47,
  chat_state_breakdown: { IDLE: 45, ACCUMULATING: 1, SCHEDULED: 1, SENDING: 0 },
  manual_jobs_pending: 3,
  last_turn: { chat_id: "...", ts: ..., status: "sent", language_used: "vi" },
  facts_total: 312,
  embedding_model_present: true
}
```

## Restart dopo crash

Stesso comando: `npm start`. Il bot:

- Recupera lo stato dal DB (state machine ricostruita).
- BootReconciler cattura messaggi arrivati durante il downtime.
- Post-reconnect spread se ci sono `SCHEDULED` overdue.

Niente perdita di dati persistenti. Eventuali turn `SENDING` interrotti vengono gestiti dalla recovery in `09-boot-reconciler.md`.

## Configurazione live

Modifica `config/index.ts` con un editor. Salva. Il bot ricarica in automatico (chokidar + zod validation). Vedi `11-config-e-hot-reload.md`.

Campi che richiedono restart per avere effetto: `sessionDir`, `dbPath`, `embeddingModel`, `aiModel`, `logFile`. Tutti gli altri sono hot-reloadable.

## Aggiornare il filtro

Modifica la funzione `shouldReply` in `config/index.ts`. Salva. Hot reload.

```ts
// esempio: aggiungere un numero alla blacklist
export const shouldReply = (chat) =>
  chat.phone.startsWith('+84')
  && !['+84111', '+84222', '+84NUOVO'].includes(chat.phone)
```

## Rinnovare la sessione WhatsApp

Se WhatsApp Web ha scollegato il dispositivo (succede dopo lunghi periodi di inattività):

1. Stop bot.
2. Cancella `.wwebjs_auth/`.
3. `npm start`.
4. Riscansiona il QR code.

## Backup manuale

```bash
# bot fermo
cp viet-chatter.db viet-chatter-backup-$(date +%F).db
```

Backup su DB live (bot acceso): possibile grazie a WAL mode, ma sconsigliato senza fermare. Per snapshot consistenti:

```bash
sqlite3 viet-chatter.db ".backup viet-chatter-backup.db"
```

Niente cron automatico in v1.

## Troubleshoot: il bot non risponde a chi dovrebbe

Possibili cause:

1. **Filtro non passa**: verifica `shouldReply` con un test rapido. Aggiungi un log temporaneo:
   ```ts
   export const shouldReply = (chat) => {
     const ok = chat.phone.startsWith('+84') && !blacklist.includes(chat.phone)
     console.log('FILTER', chat.phone, ok)
     return ok
   }
   ```
2. **Bot in night window**: controlla l'ora locale.
3. **`chat_state` bloccato**: query DB.
   ```bash
   npm run db:studio    # apre Drizzle Studio
   # oppure
   sqlite3 viet-chatter.db "SELECT * FROM chat_state WHERE chat_id LIKE '%...%';"
   ```
4. **OpenCode non funziona**: verifica `npm run health`. Se `embedding_model_present` o pipeline AI non OK, controlla i log.
5. **Connessione WhatsApp persa**: log "DISCONNECTED". Sessione persa, riscansiona QR.

## Troubleshoot: il bot manda messaggi sbagliati

1. Stop bot.
2. Modifica config: `logLevel: 'debug'`.
3. Riavvia.
4. Aspetta che si verifichi il problema.
5. Cerca nel log:
   ```bash
   cat logs/viet-chatter.log | jq 'select(.chat_id == "84xxx")' > debug.txt
   ```
6. Cerca il `turn started` -> `turn completed` rilevante. Vedi `kb_facts_total`, `language_used`, `duration_ms`.
7. Se necessario, leggi anche `turn_log` table.

## Troubleshoot: AI sempre fallisce parse JSON

1. Modifica config: `logLevel: 'trace'`.
2. Restart.
3. Log raw output dell'AI (campi `prompt_chars`, `response_chars`).
4. Probabili cause:
   - Modello LLM scelto non rispetta lo schema (cambiare `aiModel`).
   - Prompt template corrotto (rivedi `prompts/turn/06_output_schema.txt`).
   - Token limit raggiunto e output troncato (ridurre `aiHistoryLimit` o `ragTopK`).

## Troubleshoot: state machine bloccata in SENDING

Indica un crash mid-sending non recuperato. Recovery manuale:

```sql
-- riporta a IDLE le righe in SENDING piu vecchie di 5 min
UPDATE chat_state
SET state = 'IDLE',
    first_msg_at = NULL,
    debounce_deadline = NULL,
    fire_at = NULL,
    last_event_at = strftime('%s','now') * 1000
WHERE state = 'SENDING'
  AND last_event_at < strftime('%s','now') * 1000 - 300000;
```

In v1 non c'è un job automatico di unstuck. Future enhancement possibile.

## Troubleshoot: embedding model non si scarica

`@xenova/transformers` scarica il modello al primo `embed()` in `.cache/transformers/`. Se il download fallisce:

- Verifica connessione internet.
- Verifica spazio disco (~80MB richiesti).
- Cancella `.cache/transformers/` e riprova.

## Troubleshoot: OpenCode server non parte

```bash
# verifica installazione
which opencode
opencode --version
```

Se non installato globalmente, installalo via il loro guide. La config `opencode.json` richiede plugin specifici (vedi `07-ai-integration.md`); installa anche quelli.

Verifica porte libere:

```bash
netstat -an | grep 3456
```

## Cancellazione totale del bot

```bash
rm -rf node_modules logs viet-chatter.db* .wwebjs_auth .cache
# da WhatsApp mobile: scollega il dispositivo
```

## Aggiornamento dipendenze

```bash
npm outdated
npm update
# rebuild se necessario
```

Attenzione a `whatsapp-web.js`: aggiornamenti frequenti. Testare che la sessione non si rompa dopo upgrade.
