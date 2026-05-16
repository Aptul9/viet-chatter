# Scheduler / state machine

> Status: design; behavior implemented. See `19-implementation-notes.md` for shipped deltas.

## Stati

```
IDLE → ACCUMULATING → SCHEDULED → SENDING → IDLE
```

Una sola riga in `chat_state` per chat. Stato corrente sempre persistito.

| Stato          | Significato                                       | Persisted fields                                      |
| -------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `IDLE`         | Nessun incoming pendente, nessun job.             | `state='IDLE'`, altri NULL.                           |
| `ACCUMULATING` | Almeno un incoming non risposto. Debounce attivo. | `first_msg_at`, `debounce_deadline`, `last_event_at`. |
| `SCHEDULED`    | Debounce chiuso, fire programmato.                | `fire_at`, `last_event_at`.                           |
| `SENDING`      | Orchestrator in esecuzione.                       | `last_event_at` (durata breve).                       |

## Parametri (da `config/index.ts`)

- `debounceMs = 120_000` (120s).
- `hardCapMs = 600_000` (10 min).
- `minDelayMs = 5 * 60_000`.
- `maxDelayMs = 2 * 60 * 60_000`.
- `jitterPct = 0.20`.
- `nightWindow = { startHour: 22, endHour: 6 }` in `config.timezone`.
- `rollingLatencyWindow = 5`.
- `fallbackDelayMs = 30 * 60_000`.
- `postReconnectSpreadMs = { min: 30_000, max: 180_000 }`.

## Transizioni

| Evento                        | Da             | A                       | Note                                                                                                                                                                                                                                                                       |
| ----------------------------- | -------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incoming                      | `IDLE`         | `ACCUMULATING`          | Set `first_msg_at`, `debounce_deadline = now + debounceMs`.                                                                                                                                                                                                                |
| Incoming                      | `ACCUMULATING` | `ACCUMULATING`          | Aggiorna `debounce_deadline`. Se `now - first_msg_at >= hardCapMs` -> chiudi subito (delegato a TickerLoop, vedi sotto).                                                                                                                                                   |
| Incoming                      | `SCHEDULED`    | `ACCUMULATING`          | Cancella job. Set nuovo `debounce_deadline`. Mantieni `first_msg_at` originale o resetta? **Reset**: `first_msg_at = now`. Logica: arrivo durante SCHEDULED rappresenta una nuova "ondata" che si aggiunge a quella vecchia, e il delay va ricalcolato dall'ultima quiete. |
| Incoming                      | `SENDING`      | `SENDING`               | Niente, solo persisti il messaggio. Nuovo turn nasce dopo SENDING -> IDLE -> nuovo incoming triggera ACCUMULATING.                                                                                                                                                         |
| Out_manual                    | `ACCUMULATING` | `IDLE`                  | Tutti i campi reset.                                                                                                                                                                                                                                                       |
| Out_manual                    | `SCHEDULED`    | `IDLE`                  | Cancella job.                                                                                                                                                                                                                                                              |
| Out_manual                    | `SENDING`      | (state resta `SENDING`) | Abort via `InflightRegistry.get(chat_id)?.abort()`. Orchestrator vedrà signal e portera a IDLE.                                                                                                                                                                            |
| Out_manual                    | `IDLE`         | `IDLE`                  | Solo persistenza.                                                                                                                                                                                                                                                          |
| Debounce close (TickerLoop)   | `ACCUMULATING` | `SCHEDULED`             | Calcola `fireAt`, set.                                                                                                                                                                                                                                                     |
| Hard cap reached (TickerLoop) | `ACCUMULATING` | `SCHEDULED`             | Idem.                                                                                                                                                                                                                                                                      |
| Fire (TickerLoop)             | `SCHEDULED`    | `SENDING`               | Claim atomico + pre-send check.                                                                                                                                                                                                                                            |
| Send done                     | `SENDING`      | `IDLE`                  | Reset campi.                                                                                                                                                                                                                                                               |
| Send abort                    | `SENDING`      | `IDLE`                  | Reset campi, niente messaggio inviato.                                                                                                                                                                                                                                     |
| Send error (post retry)       | `SENDING`      | `IDLE`                  | Log error, niente invio (no spam).                                                                                                                                                                                                                                         |

## Atomicità delle transizioni

Tutte le transizioni iniziano con un UPDATE condizionato:

```sql
UPDATE chat_state
SET state = 'NEW_STATE', ...
WHERE chat_id = ? AND state = 'EXPECTED_STATE'
```

Se `changes() == 0`, qualcun altro è arrivato prima. Si abbandona l'azione. Mai assumere lo stato senza checkare `changes()`.

## Calcolo `fire_at`

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

Calcolata in TS, non in SQL puro. Algoritmo:

```ts
async function rollingAvgLatency(chatId: string, windowSize: number, excludeNight: boolean) {
  const rows = await repo.recentProcessedMessages(chatId, /*limit=*/ 100) // ts ASC
  const latencies: number[] = []
  let lastInTs: number | null = null
  for (const r of rows) {
    if (r.direction === 'in') {
      lastInTs = r.ts
    } else if (lastInTs != null) {
      // out_manual o out_bot: questa è una "reply" che chiude la raffica precedente
      const lat = r.ts - lastInTs
      if (!excludeNight || !crossesNight(lastInTs, r.ts, config.timezone)) {
        latencies.push(lat)
      }
      lastInTs = null // reset, prossimo in inizia raffica nuova
    }
  }
  const last5 = latencies.slice(-windowSize)
  if (last5.length < windowSize) return null // fallback applicato dal caller
  return last5.reduce((a, b) => a + b, 0) / last5.length
}
```

Note:

- `lastInTs` rappresenta l'ultimo `in` della raffica corrente. Quando arriva un `out_*`, calcoliamo `out.ts - lastInTs` che è la latency dell'ultimo `in` (cioè quello effettivamente "chiuso" dalla risposta). Coerente con la richiesta: "latenza è per la raffica di messaggi suoi, non nostri".
- Se ci sono multipli `in` consecutivi, `lastInTs` viene aggiornato all'ultimo. Quando arriva l'`out_*`, calcoliamo dalla finestra di silenzio reale.

## Night window

```ts
function isInNightWindow(tsMs: number, tz: string): boolean {
  const local = new Date(tsMs).toLocaleString('en-US', { timeZone: tz })
  const hour = new Date(local).getHours()
  return hour >= config.nightWindow.startHour || hour < config.nightWindow.endHour
}

function nextMorningStart(tsMs: number, tz: string): number {
  // restituisce ts ms della prossima 06:00 (config.nightWindow.endHour) in tz locale
  // implementazione con date-fns-tz o luxon
}

function crossesNight(inTs: number, outTs: number, tz: string): boolean {
  // true se l'intervallo [inTs, outTs] interseca [22-06] tz locale
  // implementazione: itera per ore o calcola boundaries esatte
}
```

## Post-reconnect spread

Trigger: `ConnectionStateMachine` passa a `CONNECTED` dopo essere stato `DISCONNECTED`.

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

## Race conditions documentate

### R1 — TickerLoop tra due tick mentre arriva out_manual

Sicuro. `out_manual` viene processato sincronamente da MessageDispatcher (transizione UPDATE atomica). TickerLoop al prossimo tick legge lo stato aggiornato.

### R2 — TickerLoop e out_manual quasi simultanei

UPDATE condizionato risolve. Solo uno dei due wins (o transition `ACCUMULATING->SCHEDULED` oppure `ACCUMULATING->IDLE`). L'altro si trova `changes()=0`.

### R3 — out_manual durante SENDING (AI call in corso)

Mitigato con `InflightRegistry.abort()` + 4 abort-check points nell'orchestrator. Race window residua = ms tra check #4 e arrivo del `sendMessage` ai server WhatsApp. Accettata: nel peggiore dei casi, doppio messaggio (utente + bot). Non distruttivo.

### R4 — Fire programmato per `now`, esattamente quando arriva incoming

Incoming triggera transizione `SCHEDULED->ACCUMULATING` (con cancellazione job). Se simultaneo a TickerLoop che tenta `SCHEDULED->SENDING`, una sola UPDATE wins. Se vince incoming, fire cancellato. Se vince TickerLoop, SENDING parte e poi pre-send check rileva `out_manual`? No, è un incoming, non un out. Quindi SENDING parte normalmente, l'incoming fresco è in `processed_messages` ma non incluso nel TurnContext (fetched a quel momento dovrebbe includerlo: dipende da timing fetch vs persist). In pratica: se l'incoming è nel DB, `chat.fetchMessages` lo include (è già nella sessione WW). Quindi va bene.

## Manual jobs e state machine

I `manual_jobs` (date_anchored / revive / re_engage) sono gestiti da `ManualJobsCron`, separato da `TickerLoop`. Vedi `10-manual-jobs.md`. Punto di intersezione: prima di firare un manual_job, si controlla `chat_state.state`. Se non `IDLE`, il manual_job è marcato `superseded` per evitare doppi turn sovrapposti.
