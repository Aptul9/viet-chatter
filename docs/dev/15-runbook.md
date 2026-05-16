# Runbook

## Setup iniziale

```bash
git clone <repo>
cd viet-chatter
npm install
npm run db:migrate     # crea ./viet-chatter.db con schema iniziale
# (opzionale) setup Telegram per le escalations: vedi sezione "Setup Telegram" sotto
npm start              # primo run, mostra QR code
```

Scansiona il QR code da WhatsApp mobile (`Impostazioni > Dispositivi collegati > Collega un dispositivo`).

## Setup Telegram (canale escalation)

Necessario solo se `config.escalation.channels` include `'telegram'`. Se usi solo `'whatsapp_self'`, skip questa sezione.

### Creare un bot Telegram

1. Su Telegram, cerca il contatto `@BotFather`.
2. Avvia chat e invia `/newbot`.
3. Scegli un display name (es. `viet-chatter notifier`).
4. Scegli uno username (deve finire con `bot`, es. `viet_chatter_notify_bot`).
5. BotFather risponde con il token: lo registri in `.env`:

   ```
   TELEGRAM_BOT_TOKEN=123456789:AAA-bbb-ccc-ddd-eee
   ```

   ATTENZIONE: chiunque abbia il token controlla il bot. Se trapela, revoca via `/revoke` su BotFather e genera nuovo.

### Recuperare il proprio chat_id

1. Da Telegram, scrivi un messaggio qualunque al bot appena creato (es. "ciao").
2. Apri nel browser:

   ```
   https://api.telegram.org/bot<IL_TUO_TOKEN>/getUpdates
   ```

3. Cerca nel JSON `"chat":{"id": NNNNNNNN, ...}`. Il numero è il tuo `chat_id`.
4. Lo registri in `.env`:

   ```
   TELEGRAM_USER_CHAT_ID=987654321
   ```

### Verifica setup

Da terminale:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": $TELEGRAM_USER_CHAT_ID, \"text\": \"viet-chatter test ok\"}"
```

Deve arrivare il messaggio "viet-chatter test ok" sul tuo Telegram. Se sì, setup completato.

### Caricamento ENV vars

Le ENV vars devono essere visibili al processo Node che lancia il bot.

Linux/macOS:

```bash
export $(grep -v '^#' .env | xargs)
npm start
```

Windows PowerShell:

```powershell
Get-Content .env | ForEach-Object {
  $name, $value = $_.split('=', 2)
  if ($name -and !$name.StartsWith('#')) {
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}
npm start
```

Windows cmd:

```
for /f "tokens=1,* delims==" %a in (.env) do set %a=%b
npm start
```

In v1 il bot non auto-carica `.env` (per scelta di minimal dependency). Vedi `11-config-e-hot-reload.md` per opzione futura con `dotenv`.

## Setup WhatsApp self-chat

Niente da configurare a livello bot. Tre cose da fare lato utente per assicurarti che le notifiche ti arrivino:

1. Sul telefono, apri WhatsApp -> chat con te stesso (numero "Te stesso" / "You").
2. Aprire le impostazioni della chat e verifica che "Notifiche" siano attive (non muted).
3. Test: dal computer (con bot fermo, oppure manualmente da WhatsApp Web), mandati un messaggio nella self-chat. Deve apparire come notifica push sul telefono come per le altre chat.

Se la notifica NON appare, il telefono / la versione di WhatsApp potrebbe non supportare bene le notifiche di self-chat. In quel caso usare Telegram come canale primario.

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
  chat.phone.startsWith('+84') && !['+84111', '+84222', '+84NUOVO'].includes(chat.phone)
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

## Troubleshoot: escalation non arriva su Telegram

1. Verifica ENV vars caricate:

   ```bash
   echo $TELEGRAM_BOT_TOKEN | head -c 20    # deve mostrare prefisso del token
   echo $TELEGRAM_USER_CHAT_ID              # deve mostrare il numero
   ```

   Se sono vuote, le ENV vars non sono visibili al processo. Ricarica `.env` come da sezione "Caricamento ENV vars".

2. Test diretto API Telegram:

   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
     -H "Content-Type: application/json" \
     -d "{\"chat_id\": $TELEGRAM_USER_CHAT_ID, \"text\": \"manual test\"}"
   ```

   Se la risposta JSON ha `"ok": false`:
   - `"description":"Unauthorized"` -> token sbagliato o revocato.
   - `"description":"chat not found"` -> chat_id sbagliato. Rifai `getUpdates`.
   - `"description":"Forbidden: bot was blocked by the user"` -> hai bloccato il bot, sbloccalo da Telegram.

3. Verifica log del bot:

   ```bash
   cat logs/viet-chatter.log | jq 'select(.msg | test("escalation"))'
   ```

   Cerca `escalation notified` con `channels_failed` includente `telegram`. Vedi il messaggio errore.

4. Rate limit raggiunto: cerca `escalation rate limited` nei log. Aumenta `config.escalation.rateLimitPerHour`.

5. Bot Telegram disabilitato: BotFather può disabilitare bot per inattività prolungata. Verifica con `/mybots` su BotFather.

## Troubleshoot: escalation non arriva su WhatsApp self-chat

1. Verifica che il bot sia connesso a WhatsApp Web (`npm run health`, vedi `chats_total > 0`).

2. Verifica che `client.info.wid` sia disponibile. Il modulo `WhatsAppSelfChannel` dovrebbe loggare al primo invio "self chat resolved to <wid>". Se non logga, problema lato `whatsapp-web.js`.

3. Verifica notifiche WhatsApp self-chat sul telefono: alcune versioni di WhatsApp non emettono notifica push per messaggi inviati a se stesso da WhatsApp Web. Test manuale: mandati un messaggio dalla chat self-chat su WhatsApp Web stesso. Vedi se la notifica appare sul telefono.

4. Se il telefono non riceve push per self-chat, switcha a Telegram (più affidabile per use case "chiamami quando serve").

## Troubleshoot: escalations stuck in pending

Query:

```sql
SELECT id, chat_id, reason, urgency, created_at, notified_channels
FROM escalations
WHERE status = 'pending' AND created_at < strftime('%s','now') * 1000 - 3600000
ORDER BY created_at DESC;
```

Cause possibili:

- `notified_channels='[]'`: nessun canale ha funzionato. Il retry job (ogni 5 min, max 3 attempts) potrebbe averli esauriti. Riavvia il bot per resettare retry counter (in v1 retry counter è in-memory).
- `notified_channels=['whatsapp_self']` ma utente non vede: notifica self-chat non recapitata correttamente, vedi sopra.
- `notified_channels=['telegram']` ma utente non vede: bot Telegram bloccato o muted.

Per risolvere manualmente una escalation senza che l'utente abbia risposto:

```sql
UPDATE escalations SET status='dismissed', resolved_at = strftime('%s','now') * 1000
WHERE id = ?;
```

## Disabilitare temporaneamente escalation

```ts
// config/index.ts
escalation: {
  enabled: false,
  ...
}
```

Salva, hot reload prende effetto immediato. Le escalations già pendenti restano in DB ma non vengono rinotificate. Quando riabiliti, il retry riprende.

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
