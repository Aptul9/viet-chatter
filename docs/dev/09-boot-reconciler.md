# Boot reconciler

> Status: design; behavior implemented. The reconciler runs at boot AND on a delayed schedule (15s / 45s / 120s) to catch wweb's late-loading chats. `@lid` resolution applied before filter.

## Purpose

Catch-up of WhatsApp messages that arrived while the bot was offline or not connected. Idempotent, deterministic, scalable on accounts with many chats.

## When it runs

- Once at startup (`BOOTING -> CONNECTING -> CONNECTED`).
- Every time the connection transitions from `DISCONNECTED` to `CONNECTED` during execution.

## Algorithm

```ts
async function reconcile() {
  const allChats = await client.getChats() // local read, free
  const candidates = allChats
    .filter((c) => !c.isGroup) // 1. drop groups
    .filter((c) => c.lastMessage) // 2. drop chats with no message
    .map((c) => ({
      chat: c,
      lastWhatsAppTs: c.lastMessage!.timestamp * 1000,
      lastSeenInDb: null as number | null, // filled below
    }))

  // 3. resolve last_seen for each candidate (single batched query)
  const chatIds = candidates.map((c) => c.chat.id._serialized)
  const lastSeenMap = await repo.getLastSeenForChats(chatIds)
  for (const c of candidates) {
    c.lastSeenInDb = lastSeenMap.get(c.chat.id._serialized) ?? null
  }

  // 4. filter chats that have something new
  const toFetch = candidates.filter((c) => {
    if (c.lastSeenInDb === null) {
      return c.chat.unreadCount > 0 // unknown chat: only if unread
    }
    return c.lastWhatsAppTs > c.lastSeenInDb // known chat: new material
  })

  // 5. sort by recency and cap
  toFetch.sort((a, b) => b.lastWhatsAppTs - a.lastWhatsAppTs)
  const capped = toFetch.slice(0, config.bootMaxChatsToFetch)
  if (toFetch.length > config.bootMaxChatsToFetch) {
    log.warn({ skipped: toFetch.length - capped.length }, 'boot cap reached, older chats skipped')
  }

  // 6. apply filter (shouldReply) before fetch
  const filtered: typeof capped = []
  for (const c of capped) {
    const ctx = await buildChatContext(c.chat)
    if (currentShouldReply(ctx)) {
      filtered.push(c)
    }
  }

  // 7. fetch + dispatch with concurrency limit
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

## Safety caps

| Cap                                | Default | Reason                                                                                                                                                                                |
| ---------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bootMaxChatsToFetch`              | 50      | Avoids pathological boots if the user has been offline for a long time with many active chats. Chats beyond the cap will be handled when a live `message` event arrives on that chat. |
| `fetchConcurrency`                 | 5       | No saturation of the WhatsApp Web session (Chromium puppeteered).                                                                                                                     |
| `unreadCount + 5` clamp `[10, 50]` | -       | Safety margin for timing edge cases. Never more than 50 messages per chat at boot.                                                                                                    |

## Idempotency

Guaranteed by `processed_messages.whatsapp_msg_id` as PRIMARY KEY. INSERT with `INSERT OR IGNORE` (or equivalent Drizzle). The same message processed twice (e.g. boot immediately after live event) is discarded by the DB and does not trigger the state machine.

## Behavior for chat never processed

- `lastSeenInDb === null` -> depends on `unreadCount`.
- If `unreadCount > 0`: fetch last `unreadCount + 5` messages (cap 10-50). Dispatch.
- If `unreadCount === 0`: skip. When the first live event arrives, the chat will be processed normally.

## Behavior for chat with non-IDLE state machine at boot

`BootReconciler` precedes the `TickerLoop` startup. So `chat_state` rows with non-IDLE state may be "stale" (e.g. `SCHEDULED` with `fire_at` long past).

Post-reconcile strategy:

1. Reconcile messages (section above).
2. Pre-tick recovery:
   - `ACCUMULATING` with `debounce_deadline < now` or `now - first_msg_at >= hardCapMs` -> will be processed by the first tick (natural handling).
   - `SCHEDULED` with `fire_at < now` -> apply post-reconnect spread (see `04-scheduler-state-machine.md`).
   - `SENDING` -> ambiguous (mid-sending crash). Conservative recovery:
     - Read last message of the chat in `processed_messages`.
     - If `direction = 'out_bot'` with ts in last 60 seconds -> assume sent, `state = 'IDLE'`.
     - Otherwise `state = 'ACCUMULATING'` with `debounce_deadline = now + debounceMs`. The next tick will handle it.
3. Start `TickerLoop`.

## Example boot scenario

Account with 800 chats. Bot offline 2 hours.

1. `getChats()` -> 800 objects (local Chromium read, ~ms).
2. Filter groups -> 350 1:1 chats.
3. Filter `lastMessage.timestamp > lastSeenInDb` (for known chats) or `unreadCount > 0` (for new) -> 12 chats with something new.
4. Sort by recency, cap 50 -> 12 (below cap).
5. Apply shouldReply -> 8 pass.
6. Parallel fetch (concurrency 5) -> ~10 seconds total.
7. Dispatch -> 8 chats in `ACCUMULATING`.
8. TickerLoop starts.

## Message flow during boot

`MessageDispatcher.handleMessage(msg, { fromBoot: true })` has slightly different logic from `{ fromBoot: false }`:

- `fromBoot=true`: no difference in v1 in actions. Kept as a hook for future optimizations (e.g. different log, batch persist).

## Logging

```
[INFO] reconcile start (since 2026-05-10T08:30:12Z)
[INFO] candidates: 12, fetched: 8, skipped (cap): 0, skipped (filter): 4
[INFO] reconcile done in 9482ms
[INFO] post-reconcile recovery: 2 SCHEDULED expired -> spread, 1 SENDING ambiguous -> ACCUMULATING
[INFO] ticker started
```
