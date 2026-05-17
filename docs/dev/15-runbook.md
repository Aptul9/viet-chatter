# Runbook

> Status: design; behavior implemented. Canonical quick-start in root `README.md`. `.env` now auto-loaded via `dotenv`; no need for manual export before `npm start`. `TELEGRAM_USER_CHAT_ID` supports comma-separated for broadcast.

## Initial setup

```bash
git clone <repo>
cd viet-chatter
npm install
npm run db:migrate     # creates ./viet-chatter.db with initial schema
# (optional) Telegram setup for escalations: see "Telegram setup" section below
npm start              # first run, shows QR code
```

Scan the QR code from WhatsApp mobile (`Settings > Linked devices > Link a device`).

## Telegram setup (escalation channel)

Needed only if `config.escalation.channels` includes `'telegram'`. If you only use `'whatsapp_self'`, skip this section.

### Create a Telegram bot

1. On Telegram, search for the `@BotFather` contact.
2. Start chat and send `/newbot`.
3. Choose a display name (e.g. `viet-chatter notifier`).
4. Choose a username (must end with `bot`, e.g. `viet_chatter_notify_bot`).
5. BotFather responds with the token: register it in `.env`:

   ```
   TELEGRAM_BOT_TOKEN=123456789:AAA-bbb-ccc-ddd-eee
   ```

   ATTENTION: anyone with the token controls the bot. If it leaks, revoke via `/revoke` on BotFather and generate a new one.

### Retrieve your own chat_id

1. From Telegram, write any message to the bot just created (e.g. "hi").
2. Open in browser:

   ```
   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates
   ```

3. Search in JSON for `"chat":{"id": NNNNNNNN, ...}`. The number is your `chat_id`.
4. Register it in `.env`:

   ```
   TELEGRAM_USER_CHAT_ID=987654321
   ```

### Setup verification

From terminal:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  -H "Content-Type: application/json" \
  -d "{\"chat_id\": $TELEGRAM_USER_CHAT_ID, \"text\": \"viet-chatter test ok\"}"
```

The message "viet-chatter test ok" must arrive on your Telegram. If so, setup completed.

### Loading ENV vars

ENV vars must be visible to the Node process that launches the bot.

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

In v1 the bot does not auto-load `.env` (by choice of minimal dependency). See `11-config-and-hot-reload.md` for future option with `dotenv`.

## WhatsApp self-chat setup

Nothing to configure at bot level. Three things to do on the user side to make sure notifications arrive:

1. On phone, open WhatsApp -> chat with yourself ("Yourself" / "You" number).
2. Open chat settings and verify that "Notifications" are active (not muted).
3. Test: from computer (with bot stopped, or manually from WhatsApp Web), send yourself a message in self-chat. It must appear as a push notification on the phone like for other chats.

If the notification does NOT appear, the phone / WhatsApp version may not support self-chat notifications well. In that case use Telegram as primary channel.

## Normal startup

```bash
npm start
```

The bot:

1. Loads config.
2. Opens SQLite + sqlite-vec.
3. Starts OpenCode server (auto, free port).
4. Connects to WhatsApp Web (session cached in `.wwebjs_auth/`).
5. Runs `BootReconciler`.
6. Starts `TickerLoop`, `ManualJobsCron`, `EphemeralPruner`.
7. Prints "boot done" on stdout.

From this moment the terminal stays open, the bot runs until you stop it (`Ctrl+C`).

## Stop

`Ctrl+C` in the terminal. The `SIGINT` handler cleanly closes WhatsApp client, OpenCode server, DB.

## Health check

```bash
npm run health
```

Prints:

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

## Restart after crash

Same command: `npm start`. The bot:

- Recovers state from DB (state machine rebuilt).
- BootReconciler catches messages arrived during downtime.
- Post-reconnect spread if there are `SCHEDULED` overdue.

No persistent data loss. Any interrupted `SENDING` turns are handled by the recovery in `09-boot-reconciler.md`.

## Live configuration

Edit `config/index.ts` with an editor. Save. The bot reloads automatically (chokidar + zod validation). See `11-config-and-hot-reload.md`.

Fields requiring restart to take effect: `sessionDir`, `dbPath`, `embeddingModel`, `aiModel`, `logFile`. All others are hot-reloadable.

## Update the filter

Modify the `shouldReply` function in `config/index.ts`. Save. Hot reload.

```ts
// example: add a number to the blacklist
export const shouldReply = (chat) =>
  chat.phone.startsWith('+84') && !['+84111', '+84222', '+84NEW'].includes(chat.phone)
```

## Renew the WhatsApp session

If WhatsApp Web has disconnected the device (happens after long inactivity periods):

1. Stop bot.
2. Delete `.wwebjs_auth/`.
3. `npm start`.
4. Re-scan the QR code.

## Manual backup

```bash
# bot stopped
cp viet-chatter.db viet-chatter-backup-$(date +%F).db
```

Backup on live DB (bot running): possible thanks to WAL mode, but discouraged without stopping. For consistent snapshots:

```bash
sqlite3 viet-chatter.db ".backup viet-chatter-backup.db"
```

No automatic cron in v1.

## Troubleshoot: bot doesn't reply to who it should

Possible causes:

1. **Filter doesn't pass**: verify `shouldReply` with a quick test. Add a temporary log:
   ```ts
   export const shouldReply = (chat) => {
     const ok = chat.phone.startsWith('+84') && !blacklist.includes(chat.phone)
     console.log('FILTER', chat.phone, ok)
     return ok
   }
   ```
2. **Bot in night window**: check local time.
3. **`chat_state` stuck**: query DB.
   ```bash
   npm run db:studio    # opens Drizzle Studio
   # or
   sqlite3 viet-chatter.db "SELECT * FROM chat_state WHERE chat_id LIKE '%...%';"
   ```
4. **OpenCode doesn't work**: verify `npm run health`. If `embedding_model_present` or AI pipeline not OK, check logs.
5. **WhatsApp connection lost**: "DISCONNECTED" log. Session lost, re-scan QR.

## Troubleshoot: bot sends wrong messages

1. Stop bot.
2. Modify config: `logLevel: 'debug'`.
3. Restart.
4. Wait for the problem to occur.
5. Search in log:
   ```bash
   cat logs/viet-chatter.log | jq 'select(.chat_id == "84xxx")' > debug.txt
   ```
6. Search for the relevant `turn started` -> `turn completed`. See `kb_facts_total`, `language_used`, `duration_ms`.
7. If necessary, also read `turn_log` table.

## Troubleshoot: AI always fails JSON parse

1. Modify config: `logLevel: 'trace'`.
2. Restart.
3. Log raw AI output (fields `prompt_chars`, `response_chars`).
4. Probable causes:
   - Chosen LLM model doesn't respect the schema (change `aiModel`).
   - Corrupt prompt template (review `prompts/turn/06_output_schema.txt`).
   - Token limit reached and output truncated (reduce `aiHistoryLimit` or `ragTopK`).

## Troubleshoot: state machine stuck in SENDING

Indicates a non-recovered mid-sending crash. Manual recovery:

```sql
-- bring back to IDLE the rows in SENDING older than 5 min
UPDATE chat_state
SET state = 'IDLE',
    first_msg_at = NULL,
    debounce_deadline = NULL,
    fire_at = NULL,
    last_event_at = strftime('%s','now') * 1000
WHERE state = 'SENDING'
  AND last_event_at < strftime('%s','now') * 1000 - 300000;
```

In v1 there is no automatic unstuck job. Future enhancement possible.

## Troubleshoot: embedding model doesn't download

`@xenova/transformers` downloads the model at first `embed()` to `.cache/transformers/`. If download fails:

- Verify internet connection.
- Verify disk space (~80MB required).
- Delete `.cache/transformers/` and retry.

## Troubleshoot: OpenCode server doesn't start

```bash
# verify installation
which opencode
opencode --version
```

If not installed globally, install it via their guide. The `opencode.json` config requires specific plugins (see `07-ai-integration.md`); install those too.

Verify free ports:

```bash
netstat -an | grep 3456
```

## Troubleshoot: escalation doesn't arrive on Telegram

1. Verify loaded ENV vars:

   ```bash
   echo $TELEGRAM_BOT_TOKEN | head -c 20    # must show token prefix
   echo $TELEGRAM_USER_CHAT_ID              # must show the number
   ```

   If empty, ENV vars are not visible to the process. Reload `.env` as per "Loading ENV vars" section.

2. Direct Telegram API test:

   ```bash
   curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
     -H "Content-Type: application/json" \
     -d "{\"chat_id\": $TELEGRAM_USER_CHAT_ID, \"text\": \"manual test\"}"
   ```

   If the JSON response has `"ok": false`:
   - `"description":"Unauthorized"` -> wrong or revoked token.
   - `"description":"chat not found"` -> wrong chat_id. Redo `getUpdates`.
   - `"description":"Forbidden: bot was blocked by the user"` -> you blocked the bot, unblock from Telegram.

3. Verify bot logs:

   ```bash
   cat logs/viet-chatter.log | jq 'select(.msg | test("escalation"))'
   ```

   Look for `escalation notified` with `channels_failed` including `telegram`. See the error message.

4. Rate limit reached: search for `escalation rate limited` in logs. Increase `config.escalation.rateLimitPerHour`.

5. Telegram bot disabled: BotFather may disable bots for prolonged inactivity. Verify with `/mybots` on BotFather.

## Troubleshoot: escalation doesn't arrive on WhatsApp self-chat

1. Verify that the bot is connected to WhatsApp Web (`npm run health`, see `chats_total > 0`).

2. Verify that `client.info.wid` is available. The `WhatsAppSelfChannel` module should log "self chat resolved to <wid>" at first send. If it doesn't log, problem on `whatsapp-web.js` side.

3. Verify WhatsApp self-chat notifications on phone: some WhatsApp versions don't emit push notification for messages sent to oneself from WhatsApp Web. Manual test: send yourself a message from self-chat on WhatsApp Web itself. See if the notification appears on the phone.

4. If the phone doesn't receive push for self-chat, switch to Telegram (more reliable for "call me when needed" use case).

## Troubleshoot: escalations stuck in pending

Query:

```sql
SELECT id, chat_id, reason, urgency, created_at, notified_channels
FROM escalations
WHERE status = 'pending' AND created_at < strftime('%s','now') * 1000 - 3600000
ORDER BY created_at DESC;
```

Possible causes:

- `notified_channels='[]'`: no channel worked. The retry job (every 5 min, max 3 attempts) may have exhausted them. Restart the bot to reset retry counter (in v1 retry counter is in-memory).
- `notified_channels=['whatsapp_self']` but user doesn't see: self-chat notification not delivered correctly, see above.
- `notified_channels=['telegram']` but user doesn't see: Telegram bot blocked or muted.

To manually resolve an escalation without the user having responded:

```sql
UPDATE escalations SET status='dismissed', resolved_at = strftime('%s','now') * 1000
WHERE id = ?;
```

## Temporarily disable escalation

```ts
// config/index.ts
escalation: {
  enabled: false,
  ...
}
```

Save, hot reload takes immediate effect. Already pending escalations stay in DB but are no longer re-notified. When you re-enable, retry resumes.

## Total bot deletion

```bash
rm -rf node_modules logs viet-chatter.db* .wwebjs_auth .cache
# from WhatsApp mobile: unlink the device
```

## Dependency updates

```bash
npm outdated
npm update
# rebuild if necessary
```

Watch out for `whatsapp-web.js`: frequent updates. Test that the session doesn't break after upgrade.
