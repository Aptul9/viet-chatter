# Manual jobs

Tre tipi di job non-reattivi che il bot fa partire da solo:

- `date_anchored`: messaggi su date specifiche/ricorrenti (compleanni, anniversari).
- `revive`: ravvivamento conversazione dopo finale "secco" (cuore solo, emoji solo).
- `re_engage`: re-engage dopo silenzio prolungato (default 14 giorni).

## Tabella `manual_jobs`

```ts
manualJobs(
  id, chatId, kind, fireAt, payload (JSON), status, firedAt, createdAt
)
```

`status`: `pending` -> `firing` -> `fired` | `superseded` | `cancelled`.

## Cron `ManualJobsCron`

Frequenza: ogni 30 secondi (più alta del TickerLoop perché i job hanno `fire_at` esatti, non rolling).

Pseudocode:

```ts
async function tick() {
  if (!client.isConnected()) return
  if (isInNightWindow(Date.now(), config.timezone)) return       // niente fire notturni

  const due = await repo.pendingManualJobs(Date.now())
  for (const job of due) {
    const claimed = await repo.transitionManualJob(job.id, 'pending', 'firing')
    if (!claimed) continue                                        // qualcun altro

    if (await preFireCheckSupersedes(job)) {
      await repo.transitionManualJob(job.id, 'firing', 'superseded')
      continue
    }

    invokeJob(job)
      .catch(err => log.error({ err, jobId: job.id }, 'manual job error'))
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
  // 1. ultimi 12h: c'è stato out_bot o out_manual verso questa chat?
  const recent = await repo.recentProcessedMessages(job.chatId, /*limit=*/30)
  const cutoff = Date.now() - 12 * 3600_000
  const hasRecentOut = recent.some(r =>
    (r.direction === 'out_bot' || r.direction === 'out_manual') && r.ts > cutoff
  )
  if (hasRecentOut) return true

  // 2. chat_state in stato attivo (non-IDLE)?
  const cs = await repo.getChatState(job.chatId)
  if (cs && cs.state !== 'IDLE') return true

  return false
}
```

## Invocazione job

Per tutti e tre i kind, l'invocazione passa attraverso `ReplyOrchestrator.generateAndSendForManualJob(chatId, manualJobContext)`. La pipeline è la stessa di un turn reattivo, ma il `TurnContext` include `manualJobContext`:

```ts
manualJobContext = {
  kind: 'date_anchored' | 'revive' | 're_engage',
  hint: string                                  // testo per AI: "today is birthday", "user sent only ❤️ after long chat", etc.
}
```

L'AI nel prompt è istruita a tener conto del `manualJobContext` quando presente.

## `date_anchored`

### Origine

L'AI durante un turn estrae un fact con `anchor_date` e/o `anchor_recurring`. Esempio:

```json
{
  "tier": "important",
  "content": "Birthday: February 22",
  "anchor_date": "02-22",
  "anchor_recurring": "yearly",
  "anchor_action": "wish_birthday"
}
```

Il bot crea automaticamente un `manual_jobs(kind='date_anchored', fire_at=nextOccurrence(02-22, yearly), payload={action, fact_id})`.

### `nextOccurrence`

```ts
function nextOccurrence(anchorDate: string, recurring: 'yearly' | null): number {
  const now = new Date()
  let target: Date
  if (anchorDate.length === 10) {
    // YYYY-MM-DD: data fissa
    target = new Date(anchorDate + 'T09:00:00')
  } else {
    // MM-DD: ricorrente
    const [m, d] = anchorDate.split('-').map(Number)
    target = new Date(now.getFullYear(), m - 1, d, 9, 0, 0)
    if (target.getTime() <= now.getTime()) {
      target.setFullYear(target.getFullYear() + 1)
    }
  }
  // jitter sul minuto
  target.setMinutes(target.getMinutes() + Math.floor(Math.random() * 60))
  return target.getTime()
}
```

Orario fisso 09:00 + jitter 0-60 minuti per non essere troppo "a punto fisso".

### Fire

Al `fire_at`, l'AI riceve nel prompt:

```
manualJobContext: {
  kind: "date_anchored",
  hint: "Today is the person's birthday (Feb 22). Wish them happy birthday in a natural, warm way that fits your established tone with them."
}
```

L'AI genera un opener coerente. Il bot manda. Se `recurring=yearly`, viene creato un nuovo job per l'anno successivo.

## `revive`

### Origine

L'AI nel `TurnOutput` produce `revive_hint`:

```json
{
  ...,
  "revive_hint": {
    "attempt_in_minutes": 50,
    "context": "She sent only ❤️ after a 2-hour conversation. The closing felt accidental rather than intentional sign-off."
  }
}
```

Il bot, processando il TurnOutput, controlla:

- C'è già un revive `pending` per questa chat? Se sì, skip (max 1 revive per chat).
- Se no, crea `manual_jobs(kind='revive', fire_at=now + attempt_in_minutes * 60_000, payload={context})`.

### Constraint

- Massimo 1 revive `pending` per chat alla volta.
- Massimo 1 revive `fired` per giornata di conversazione (controllo: `SELECT COUNT(*) FROM manual_jobs WHERE chat_id=? AND kind='revive' AND fired_at >= start_of_today`).
- Niente revive notturni (cron skippa night window).

### Fire

```
manualJobContext: {
  kind: "revive",
  hint: "She sent only ❤️ after a 2-hour conversation. The closing felt accidental. Send a light, brief follow-up to revive the conversation. Do NOT be needy. One attempt only."
}
```

Se la persona non risponde entro le successive 24h, il revive resta come `fired` ma niente secondo tentativo.

## `re_engage`

### Origine

Cron giornaliero (al mattino), separato da `ManualJobsCron`:

```ts
async function reEngageScan() {
  const cutoffByChat = await repo.cutoffPerChat()              // legge re_engage_threshold_days da person_profile
  const candidates = await repo.chatsWithSilenceLongerThan(cutoffByChat)
  for (const chatId of candidates) {
    const profile = await repo.getPersonProfile(chatId)
    if (profile.engagementState === 'cold') continue
    if (await repo.hasPendingManualJob(chatId, 're_engage')) continue
    if (await repo.countOutgoing(chatId) < 3) continue           // serve storia con questa persona
    const fireAt = nextMorningSlotWithJitter()                   // 09:00-11:00 oggi o domani
    await repo.insertManualJob({
      chatId, kind: 're_engage', fireAt,
      payload: JSON.stringify({ days_silent: ..., last_seen_iso: ... }),
      status: 'pending', createdAt: Date.now(),
    })
  }
}
```

Il cron gira una volta al giorno (es. al boot, poi ogni 24h).

### Constraint

- Default soglia: 14 giorni.
- Override per persona: `person_profile.re_engage_threshold_days` (modificabile dall'AI tramite TurnOutput, futura enhancement).
- Massimo 1 `re_engage` `pending` per chat.
- Solo per chat con almeno 3 outgoing nello storico (esclude conoscenze sporadiche con cui non c'è una vera relazione).
- Dopo `fired`, se la persona non risponde in 7 giorni, marcare `engagement_state='cold'`.

Cleanup post-fired:

```ts
// cron periodico
async function markColdAfterReEngageNoReply() {
  const stale = await repo.recentReEngagesWithoutReply(/*olderThanDays=*/7)
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

## Collision rules con flow reattivo

Quando arriva un `incoming` per una chat con `manual_jobs.pending`:

```ts
async function onIncoming(chatId: string) {
  // ...
  await repo.cancelPendingManualJobsForChat(chatId)         // qualunque kind
  // proceed with state machine
}
```

`cancelPendingManualJobsForChat`:

```sql
UPDATE manual_jobs SET status = 'cancelled' WHERE chat_id = ? AND status = 'pending'
```

Stesso per `out_manual`.

## Edge: persona scrive nell'ora prima del fire

Coperto. Il `preFireCheckSupersedes` rileva l'`out_bot`/`out_manual` recente e marca `superseded`. Niente messaggio doppio.

## Edge: bot offline al fire_at di un manual_job

`ManualJobsCron` controlla `client.isConnected()`. Se offline, skip. Quando torna online, il job è ancora `pending` e verrà processato. Se `fire_at` è ormai molto vecchio (es. >12h), il `preFireCheckSupersedes` probabilmente lo marcherà `superseded` perché nel frattempo è successo qualcosa, oppure il bot lo eseguirà con un delay accettato (un re-engage in ritardo è ancora valido; un compleanno il giorno dopo no, ma in quel caso la chat ha probabilmente già scambiato messaggi quel giorno -> superseded).

## Future enhancement

- Parametri ML-driven per thresholds (vedi `16-future-enhancements.md`).
- Engagement state più granulare (`dormant`, `breakup`, `do_not_re_engage`).
