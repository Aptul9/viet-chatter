# Scheduler / state machine

> Status: design; behavior implemented.

## States

```
IDLE → ACCUMULATING → SCHEDULED → SENDING → IDLE
```

One row in `chat_state` per chat. Current state always persisted.

| State          | Meaning                                           | Persisted fields                                      |
| -------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `IDLE`         | No pending incoming, no job.                      | `state='IDLE'`, others NULL.                          |
| `ACCUMULATING` | At least one unanswered incoming. Debounce active. | `first_msg_at`, `debounce_deadline`, `last_event_at`. |
| `SCHEDULED`    | Debounce closed, fire scheduled.                  | `fire_at`, `last_event_at`.                           |
| `SENDING`      | Orchestrator running.                             | `last_event_at` (short duration).                     |

## Parameters (from `config/index.ts`)

- `debounceMs = 120_000` (120s).
- `hardCapMs = 600_000` (10 min).
- `minDelayMs = 5 * 60_000`.
- `maxDelayMs = 2 * 60 * 60_000`.
- `jitterPct = 0.20`.
- `nightWindow = { startHour: 22, endHour: 6 }` in `config.timezone`.
- `rollingLatencyWindow = 5`.
- `fallbackDelayMs = 30 * 60_000`.
- `postReconnectSpreadMs = { min: 30_000, max: 180_000 }`.

## Transitions

| Event                        | From           | To                      | Notes                                                                                                                                                                                                                                                                       |
| ----------------------------- | -------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incoming                      | `IDLE`         | `ACCUMULATING`          | Set `first_msg_at`, `debounce_deadline = now + debounceMs`.                                                                                                                                                                                                                |
| Incoming                      | `ACCUMULATING` | `ACCUMULATING`          | Update `debounce_deadline`. If `now - first_msg_at >= hardCapMs` -> close immediately (delegated to TickerLoop, see below).                                                                                                                                                |
| Incoming                      | `SCHEDULED`    | `ACCUMULATING`          | Cancel job. Set new `debounce_deadline`. Keep original `first_msg_at` or reset? **Reset**: `first_msg_at = now`. Logic: arrival during SCHEDULED represents a new "wave" added to the old one, and the delay must be recomputed from the last quiet period.               |
| Incoming                      | `SENDING`      | `SENDING`               | Nothing, just persist the message. New turn starts after SENDING -> IDLE -> new incoming triggers ACCUMULATING.                                                                                                                                                            |
| Out_manual                    | `ACCUMULATING` | `IDLE`                  | All fields reset.                                                                                                                                                                                                                                                          |
| Out_manual                    | `SCHEDULED`    | `IDLE`                  | Cancel job.                                                                                                                                                                                                                                                                |
| Out_manual                    | `SENDING`      | (state stays `SENDING`) | Abort via `InflightRegistry.get(chat_id)?.abort()`. Orchestrator will see signal and bring to IDLE.                                                                                                                                                                        |
| Out_manual                    | `IDLE`         | `IDLE`                  | Persistence only.                                                                                                                                                                                                                                                          |
| Debounce close (TickerLoop)   | `ACCUMULATING` | `SCHEDULED`             | Compute `fireAt`, set.                                                                                                                                                                                                                                                     |
| Hard cap reached (TickerLoop) | `ACCUMULATING` | `SCHEDULED`             | Same.                                                                                                                                                                                                                                                                      |
| Fire (TickerLoop)             | `SCHEDULED`    | `SENDING`               | Atomic claim + pre-send check.                                                                                                                                                                                                                                             |
| Send done                     | `SENDING`      | `IDLE`                  | Reset fields.                                                                                                                                                                                                                                                              |
| Send abort                    | `SENDING`      | `IDLE`                  | Reset fields, no message sent.                                                                                                                                                                                                                                             |
| Send error (post retry)       | `SENDING`      | `IDLE`                  | Log error, no send (no spam).                                                                                                                                                                                                                                              |

## Atomicity of transitions

All transitions start with a conditional UPDATE:

```sql
UPDATE chat_state
SET state = 'NEW_STATE', ...
WHERE chat_id = ? AND state = 'EXPECTED_STATE'
```

If `changes() == 0`, someone else got there first. The action is abandoned. Never assume the state without checking `changes()`.

## `fire_at` computation

```ts
function computeFireAt(chatId: string, debounceCloseTs: number): number {
  const avgLatency = rollingAvgLatency(chatId, /*window=*/ 5, /*excludeNight=*/ true)
  const baseDelay =
    avgLatency != null
      ? clamp(avgLatency, config.minDelayMs, config.maxDelayMs)
      : config.fallbackDelayMs
  const jitterFactor = 1 + (Math.random() * 2 - 1) * config.jitterPct
  const jittered = baseDelay * jitterFactor
  let fireAt = debounceCloseTs + jittered
  if (isInNightWindow(fireAt, config.timezone)) {
    fireAt = nextMorningStart(fireAt, config.timezone) + Math.random() * config.minDelayMs
  }
  return fireAt
}
```

## Rolling avg latency

Computed in TS, not in pure SQL. Algorithm:

```ts
async function rollingAvgLatency(chatId: string, windowSize: number, excludeNight: boolean) {
  const rows = await repo.recentProcessedMessages(chatId, /*limit=*/ 100) // ts ASC
  const latencies: number[] = []
  let lastInTs: number | null = null
  for (const r of rows) {
    if (r.direction === 'in') {
      lastInTs = r.ts
    } else if (lastInTs != null) {
      // out_manual or out_bot: this is a "reply" that closes the previous burst
      const lat = r.ts - lastInTs
      if (!excludeNight || !crossesNight(lastInTs, r.ts, config.timezone)) {
        latencies.push(lat)
      }
      lastInTs = null // reset, next in starts a new burst
    }
  }
  const last5 = latencies.slice(-windowSize)
  if (last5.length < windowSize) return null // fallback applied by caller
  return last5.reduce((a, b) => a + b, 0) / last5.length
}
```

Notes:

- `lastInTs` represents the last `in` of the current burst. When an `out_*` arrives, we compute `out.ts - lastInTs` which is the latency of the last `in` (the one actually "closed" by the reply). Consistent with the requirement: "latency is for their message burst, not ours".
- If there are multiple consecutive `in`, `lastInTs` is updated to the last one. When the `out_*` arrives, we compute from the actual silence window.

## Night window

```ts
function isInNightWindow(tsMs: number, tz: string): boolean {
  const local = new Date(tsMs).toLocaleString('en-US', { timeZone: tz })
  const hour = new Date(local).getHours()
  return hour >= config.nightWindow.startHour || hour < config.nightWindow.endHour
}

function nextMorningStart(tsMs: number, tz: string): number {
  // returns ts ms of the next 06:00 (config.nightWindow.endHour) in local tz
  // implementation with date-fns-tz or luxon
}

function crossesNight(inTs: number, outTs: number, tz: string): boolean {
  // true if the interval [inTs, outTs] intersects [22-06] local tz
  // implementation: iterate by hours or compute exact boundaries
}
```

## Post-reconnect spread

Trigger: `ConnectionStateMachine` transitions to `CONNECTED` after being `DISCONNECTED`.

```ts
async function applyPostReconnectSpread() {
  const rows = await repo.scheduledOverdue() // SELECT * FROM chat_state WHERE state='SCHEDULED' AND fire_at < now ORDER BY fire_at ASC
  if (rows.length <= 1) return
  let acc = Date.now()
  for (const r of rows) {
    const spread =
      config.postReconnectSpreadMs.min +
      Math.random() * (config.postReconnectSpreadMs.max - config.postReconnectSpreadMs.min)
    acc += spread
    await repo.updateChatStateFireAt(r.chatId, acc)
  }
}
```

## Documented race conditions

### R1, TickerLoop between two ticks while out_manual arrives

Safe. `out_manual` is processed synchronously by MessageDispatcher (atomic UPDATE transition). TickerLoop on the next tick reads the updated state.

### R2, TickerLoop and out_manual nearly simultaneous

Conditional UPDATE resolves it. Only one of the two wins (either transition `ACCUMULATING->SCHEDULED` or `ACCUMULATING->IDLE`). The other finds `changes()=0`.

### R3, out_manual during SENDING (AI call in progress)

Mitigated with `InflightRegistry.abort()` + 4 abort-check points in the orchestrator. Residual race window = ms between check #4 and arrival of the `sendMessage` at WhatsApp servers. Accepted: at worst, double message (user + bot). Non-destructive.

### R4, Fire scheduled for `now`, exactly when incoming arrives

Incoming triggers transition `SCHEDULED->ACCUMULATING` (with job cancellation). If simultaneous with TickerLoop trying `SCHEDULED->SENDING`, only one UPDATE wins. If incoming wins, fire cancelled. If TickerLoop wins, SENDING starts and then the pre-send check detects `out_manual`? No, it's an incoming, not an out. So SENDING starts normally, the fresh incoming is in `processed_messages` but not included in TurnContext (fetched at that moment should include it: depends on timing of fetch vs persist). In practice: if the incoming is in the DB, `chat.fetchMessages` includes it (it's already in the WW session). So it's fine.

## Manual jobs and state machine

The `manual_jobs` (date_anchored / revive / re_engage) are managed by `ManualJobsCron`, separate from `TickerLoop`. See `10-manual-jobs.md`. Intersection point: before firing a manual_job, `chat_state.state` is checked. If not `IDLE`, the manual_job is marked `superseded` to avoid overlapping double turns.
