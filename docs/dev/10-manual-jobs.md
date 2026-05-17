# Manual jobs

> Status: design; behavior implemented.

Three types of non-reactive jobs the bot starts on its own:

- `date_anchored`: messages on specific/recurring dates (birthdays, anniversaries).
- `revive`: conversation revival after a "dry" ending (heart only, emoji only).
- `re_engage`: re-engagement after prolonged silence (default 14 days).

## `manual_jobs` table

```ts
manualJobs(id, chatId, kind, fireAt, payload(JSON), status, firedAt, createdAt)
```

`status`: `pending` -> `firing` -> `fired` | `superseded` | `cancelled`.

## `ManualJobsCron`

Frequency: every 30 seconds (higher than TickerLoop because jobs have exact `fire_at`, not rolling).

Pseudocode:

```ts
async function tick() {
  if (!client.isConnected()) return
  if (isInNightWindow(Date.now(), config.timezone)) return // no night fires

  const due = await repo.pendingManualJobs(Date.now())
  for (const job of due) {
    const claimed = await repo.transitionManualJob(job.id, 'pending', 'firing')
    if (!claimed) continue // someone else

    if (await preFireCheckSupersedes(job)) {
      await repo.transitionManualJob(job.id, 'firing', 'superseded')
      continue
    }

    invokeJob(job)
      .catch((err) => log.error({ err, jobId: job.id }, 'manual job error'))
      .finally(() => {
        if (job.kind === 'date_anchored' && job.recurring === 'yearly') {
          repo.insertManualJob({ ...job, fireAt: job.fireAt + ONE_YEAR_MS, status: 'pending' })
        }
        repo.transitionManualJob(job.id, 'firing', 'fired')
      })
  }
}
```

## Pre-fire supersede check

```ts
async function preFireCheckSupersedes(job: ManualJob): Promise<boolean> {
  // 1. last 12h: was there an out_bot or out_manual towards this chat?
  const recent = await repo.recentProcessedMessages(job.chatId, /*limit=*/ 30)
  const cutoff = Date.now() - 12 * 3600_000
  const hasRecentOut = recent.some(
    (r) => (r.direction === 'out_bot' || r.direction === 'out_manual') && r.ts > cutoff
  )
  if (hasRecentOut) return true

  // 2. chat_state in active state (non-IDLE)?
  const cs = await repo.getChatState(job.chatId)
  if (cs && cs.state !== 'IDLE') return true

  return false
}
```

## Job invocation

For all three kinds, the invocation goes through `ReplyOrchestrator.generateAndSendForManualJob(chatId, manualJobContext)`. The pipeline is the same as a reactive turn, but the `TurnContext` includes `manualJobContext`:

```ts
manualJobContext = {
  kind: 'date_anchored' | 'revive' | 're_engage',
  hint: string, // text for AI: "today is birthday", "user sent only ❤️ after long chat", etc.
}
```

The AI in the prompt is instructed to take `manualJobContext` into account when present.

## `date_anchored`

### Origin

The AI during a turn extracts a fact with `anchor_date` and/or `anchor_recurring`. Example:

```json
{
  "tier": "important",
  "content": "Birthday: February 22",
  "anchor_date": "02-22",
  "anchor_recurring": "yearly",
  "anchor_action": "wish_birthday"
}
```

The bot automatically creates a `manual_jobs(kind='date_anchored', fire_at=nextOccurrence(02-22, yearly), payload={action, fact_id})`.

### `nextOccurrence`

```ts
function nextOccurrence(anchorDate: string, recurring: 'yearly' | null): number {
  const now = new Date()
  let target: Date
  if (anchorDate.length === 10) {
    // YYYY-MM-DD: fixed date
    target = new Date(anchorDate + 'T09:00:00')
  } else {
    // MM-DD: recurring
    const [m, d] = anchorDate.split('-').map(Number)
    target = new Date(now.getFullYear(), m - 1, d, 9, 0, 0)
    if (target.getTime() <= now.getTime()) {
      target.setFullYear(target.getFullYear() + 1)
    }
  }
  // jitter on the minute
  target.setMinutes(target.getMinutes() + Math.floor(Math.random() * 60))
  return target.getTime()
}
```

Fixed time 09:00 + jitter 0-60 minutes to avoid being too "punctual".

### Fire

At `fire_at`, the AI receives in the prompt:

```
manualJobContext: {
  kind: "date_anchored",
  hint: "Today is the person's birthday (Feb 22). Wish them happy birthday in a natural, warm way that fits your established tone with them."
}
```

The AI generates a consistent opener. The bot sends it. If `recurring=yearly`, a new job for the following year is created.

## `revive`

### Origin

The AI in the `TurnOutput` produces `revive_hint`:

```json
{
  ...,
  "revive_hint": {
    "attempt_in_minutes": 50,
    "context": "She sent only ❤️ after a 2-hour conversation. The closing felt accidental rather than intentional sign-off."
  }
}
```

The bot, processing the TurnOutput, checks:

- Is there already a `pending` revive for this chat? If yes, skip (max 1 revive per chat).
- If no, create `manual_jobs(kind='revive', fire_at=now + attempt_in_minutes * 60_000, payload={context})`.

### Constraints

- Maximum 1 `pending` revive per chat at a time.
- Maximum 1 `fired` revive per conversation day (check: `SELECT COUNT(*) FROM manual_jobs WHERE chat_id=? AND kind='revive' AND fired_at >= start_of_today`).
- No night revives (cron skips night window).

### Fire

```
manualJobContext: {
  kind: "revive",
  hint: "She sent only ❤️ after a 2-hour conversation. The closing felt accidental. Send a light, brief follow-up to revive the conversation. Do NOT be needy. One attempt only."
}
```

If the person does not reply within the next 24h, the revive stays as `fired` but no second attempt.

## `re_engage`

### Origin

Daily cron (in the morning), separate from `ManualJobsCron`:

```ts
async function reEngageScan() {
  const cutoffByChat = await repo.cutoffPerChat()              // reads re_engage_threshold_days from person_profile
  const candidates = await repo.chatsWithSilenceLongerThan(cutoffByChat)
  for (const chatId of candidates) {
    const profile = await repo.getPersonProfile(chatId)
    if (profile.engagementState === 'cold') continue
    if (await repo.hasPendingManualJob(chatId, 're_engage')) continue
    if (await repo.countOutgoing(chatId) < 3) continue           // need history with this person
    const fireAt = nextMorningSlotWithJitter()                   // 09:00-11:00 today or tomorrow
    await repo.insertManualJob({
      chatId, kind: 're_engage', fireAt,
      payload: JSON.stringify({ days_silent: ..., last_seen_iso: ... }),
      status: 'pending', createdAt: Date.now(),
    })
  }
}
```

The cron runs once a day (e.g. at boot, then every 24h).

### Constraints

- Default threshold: 14 days.
- Per-person override: `person_profile.re_engage_threshold_days` (modifiable by the AI through TurnOutput, future enhancement).
- Maximum 1 `pending` `re_engage` per chat.
- Only for chats with at least 3 outgoing in history (excludes sporadic acquaintances with whom there is no real relationship).
- After `fired`, if the person doesn't reply in 7 days, mark `engagement_state='cold'`.

Post-fired cleanup:

```ts
// periodic cron
async function markColdAfterReEngageNoReply() {
  const stale = await repo.recentReEngagesWithoutReply(/*olderThanDays=*/ 7)
  for (const job of stale) {
    await repo.setEngagementState(job.chatId, 'cold')
  }
}
```

### Fire

```
manualJobContext: {
  kind: "re_engage",
  hint: "Last interaction was 14 days ago. Re-engage naturally. Use KB to anchor the opener (e.g. 'how was Da Nang?' if she mentioned travel). Do NOT mention the silence explicitly."
}
```

## Collision rules with reactive flow

When an `incoming` arrives for a chat with `manual_jobs.pending`:

```ts
async function onIncoming(chatId: string) {
  // ...
  await repo.cancelPendingManualJobsForChat(chatId) // any kind
  // proceed with state machine
}
```

`cancelPendingManualJobsForChat`:

```sql
UPDATE manual_jobs SET status = 'cancelled' WHERE chat_id = ? AND status = 'pending'
```

Same for `out_manual`.

## Edge: person writes in the hour before the fire

Covered. The `preFireCheckSupersedes` detects the recent `out_bot`/`out_manual` and marks `superseded`. No double message.

## Edge: bot offline at fire_at of a manual_job

`ManualJobsCron` checks `client.isConnected()`. If offline, skip. When back online, the job is still `pending` and will be processed. If `fire_at` is now very old (e.g. >12h), `preFireCheckSupersedes` will probably mark it `superseded` because something happened in the meantime, or the bot will execute it with an accepted delay (a late re-engage is still valid; a birthday the day after is not, but in that case the chat has probably already exchanged messages that day -> superseded).

## Future enhancement

- ML-driven parameters for thresholds.
- More granular engagement state (`dormant`, `breakup`, `do_not_re_engage`).
