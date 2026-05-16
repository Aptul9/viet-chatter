# Boot reconciler

> Status: design; behavior implemented. The reconciler runs at boot AND on a delayed schedule (15s / 45s / 120s) to catch wweb's late-loading chats. `@lid` resolution applied before filter. See `19-implementation-notes.md` §13 + §15.

## Scopo

Catch-up dei messaggi WhatsApp che sono arrivati mentre il bot era offline o non connesso. Idempotente, deterministico, scalabile su account con molte chat.

## Quando viene eseguito

- Una volta all'avvio (`BOOTING -> CONNECTING -> CONNECTED`).
- Ogni volta che la connessione passa da `DISCONNECTED` a `CONNECTED` durante l'esecuzione.

## Algoritmo

```ts
async function reconcile() {
  const allChats = await client.getChats() // lettura locale, gratis
  const candidates = allChats
    .filter((c) => !c.isGroup) // 1. drop gruppi
    .filter((c) => c.lastMessage) // 2. drop chat senza alcun messaggio
    .map((c) => ({
      chat: c,
      lastWhatsAppTs: c.lastMessage!.timestamp * 1000,
      lastSeenInDb: null as number | null, // riempito sotto
    }))

  // 3. resolve last_seen per ogni candidate (single batched query)
  const chatIds = candidates.map((c) => c.chat.id._serialized)
  const lastSeenMap = await repo.getLastSeenForChats(chatIds)
  for (const c of candidates) {
    c.lastSeenInDb = lastSeenMap.get(c.chat.id._serialized) ?? null
  }

  // 4. filter chat che hanno qualcosa di nuovo
  const toFetch = candidates.filter((c) => {
    if (c.lastSeenInDb === null) {
      return c.chat.unreadCount > 0 // chat sconosciuta: solo se unread
    }
    return c.lastWhatsAppTs > c.lastSeenInDb // chat nota: nuovo materiale
  })

  // 5. ordina per recency e cap
  toFetch.sort((a, b) => b.lastWhatsAppTs - a.lastWhatsAppTs)
  const capped = toFetch.slice(0, config.bootMaxChatsToFetch)
  if (toFetch.length > config.bootMaxChatsToFetch) {
    log.warn({ skipped: toFetch.length - capped.length }, 'boot cap reached, older chats skipped')
  }

  // 6. apply filter (shouldReply) prima di fetch
  const filtered: typeof capped = []
  for (const c of capped) {
    const ctx = await buildChatContext(c.chat)
    if (currentShouldReply(ctx)) {
      filtered.push(c)
    }
  }

  // 7. fetch + dispatch con concurrency limit
  await pAll(
    filtered.map((c) => async () => {
      const limit = clamp((c.chat.unreadCount || 0) + 5, 10, 50)
      const messages = await c.chat.fetchMessages({ limit })
      const newMessages = messages.filter((m) => {
        const tsMs = m.timestamp * 1000
        return c.lastSeenInDb === null ? c.chat.unreadCount > 0 : tsMs > c.lastSeenInDb!
      })
      for (const m of newMessages) {
        await dispatcher.handleMessage(m, { fromBoot: true })
      }
    }),
    { concurrency: config.fetchConcurrency }
  )

  log.info({ candidates: candidates.length, fetched: filtered.length }, 'reconcile done')
}
```

## Caps di sicurezza

| Cap                                | Default | Motivo                                                                                                                                                                         |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `bootMaxChatsToFetch`              | 50      | Evita boot patologici se l'utente è stato offline a lungo con molte chat attive. Le chat oltre il cap saranno gestite quando arriverà un evento `message` live su quella chat. |
| `fetchConcurrency`                 | 5       | Niente saturazione della sessione WhatsApp Web (Chromium puppeteered).                                                                                                         |
| `unreadCount + 5` clamp `[10, 50]` | -       | Margine di sicurezza per timing edge case. Mai oltre 50 messaggi per chat al boot.                                                                                             |

## Idempotenza

Garantita dal `processed_messages.whatsapp_msg_id` come PRIMARY KEY. INSERT con `INSERT OR IGNORE` (o equivalente Drizzle). Lo stesso messaggio processato due volte (es. boot subito dopo evento live) viene scartato dal DB e non triggera state machine.

## Comportamento per chat ancora MAI processata

- `lastSeenInDb === null` -> dipende da `unreadCount`.
- Se `unreadCount > 0`: fetch ultimi `unreadCount + 5` messaggi (cap 10-50). Dispatch.
- Se `unreadCount === 0`: skip. Quando arriverà il primo evento live, la chat sarà processata normalmente.

## Comportamento per chat con state machine non-IDLE al boot

`BootReconciler` precede l'avvio del `TickerLoop`. Quindi le righe in `chat_state` con state non-IDLE possono essere "stale" (es. `SCHEDULED` con `fire_at` ormai passato).

Strategia post-reconcile:

1. Reconcile messaggi (sezione sopra).
2. Pre-tick recovery:
   - `ACCUMULATING` con `debounce_deadline < now` o `now - first_msg_at >= hardCapMs` -> verra processato dal primo tick (gestione naturale).
   - `SCHEDULED` con `fire_at < now` -> applica post-reconnect spread (vedi `04-scheduler-state-machine.md`).
   - `SENDING` -> ambiguo (crash mid-sending). Recovery conservativa:
     - Leggi ultimo messaggio della chat in `processed_messages`.
     - Se `direction = 'out_bot'` con ts negli ultimi 60 secondi -> assumi inviato, `state = 'IDLE'`.
     - Altrimenti `state = 'ACCUMULATING'` con `debounce_deadline = now + debounceMs`. Il prossimo tick gestirà.
3. Avvia `TickerLoop`.

## Boot scenario di esempio

Account con 800 chat. Bot offline 2 ore.

1. `getChats()` -> 800 oggetti (lettura locale Chromium, ~ms).
2. Filter gruppi -> 350 chat 1:1.
3. Filter `lastMessage.timestamp > lastSeenInDb` (per chat note) o `unreadCount > 0` (per nuove) -> 12 chat con qualcosa di nuovo.
4. Sort per recency, cap 50 -> 12 (sotto cap).
5. Apply shouldReply -> 8 passano.
6. Fetch parallelo (concurrency 5) -> ~10 secondi totali.
7. Dispatch -> 8 chat in `ACCUMULATING`.
8. TickerLoop parte.

## Flow dei messaggi durante boot

`MessageDispatcher.handleMessage(msg, { fromBoot: true })` ha logica leggermente diversa da `{ fromBoot: false }`:

- `fromBoot=true`: niente differenza in v1 nelle azioni. Resta come hook per future ottimizzazioni (es. log differente, batch persist).

## Logging

```
[INFO] reconcile start (since 2026-05-10T08:30:12Z)
[INFO] candidates: 12, fetched: 8, skipped (cap): 0, skipped (filter): 4
[INFO] reconcile done in 9482ms
[INFO] post-reconcile recovery: 2 SCHEDULED expired -> spread, 1 SENDING ambiguous -> ACCUMULATING
[INFO] ticker started
```
