# Escalation a umano

Quando il bot riceve un messaggio che richiede informazioni o decisioni che l'AI non può conoscere o sostituire (impegni futuri, decisioni delicate, scelte personali, autorizzazioni), invece di inventare una risposta o tirare a indovinare, segnala l'utente su un canale fuori-banda. L'utente risponde a mano da WhatsApp.

Questa funzionalità non contraddice il design "fully autonomous" (vedi `17-out-of-scope.md`): il bot resta autonomo nel 95% dei turn, e ammette esplicitamente quando non sa nel 5% restante. Differente da un approval flow (dove ogni reply è in revisione umana): qui solo i turn dove l'AI dichiara `escalate_to_human` saltano l'invio automatico.

## Quando escalare

L'AI nel `TurnOutput` produce `escalate_to_human` non-null quando il messaggio in arrivo cade in una delle categorie:

| `reason` | Trigger esempio |
|---|---|
| `scheduling` | "ci vediamo alle 16?", "sei libero martedì sera?", "vieni alla cena di sabato?" |
| `commitment` | "puoi farmi questo favore?", "mi presti X?", "posso passare da te?" |
| `sensitive` | argomenti emotivamente delicati dove una risposta sbagliata può ferire (lutti, malattie, conflitti recenti documentati nel KB) |
| `financial` | richieste di soldi, prestiti, contributi a regali, split di conto su cui l'AI non sa la posizione dell'utente |
| `identity` | richiesta di parlare di un'opinione personale forte (politica, fede, scelte di vita) non documentata nel KB |
| `other` | qualunque altra cosa che l'AI ha riconosciuto come "starei tirando a indovinare". Bar dell'AI: "se rispondessi io, l'utente potrebbe disapprovare l'esito" |

Bar generale: l'AI escalla quando una risposta autonoma rischierebbe di impegnare l'utente, ferire la persona, o esporre opinioni che non sono nel KB.

L'AI NON escalla per:

- Domande informative coperte dal KB ("dove vivi?" -> KB).
- Convenevoli ("come stai?", "ciao!").
- Continuazioni di thread già stabiliti (l'utente ha già risposto su questo nei messaggi precedenti).
- Messaggi non testuali (sticker, emoji singoli) -> resta `skip` come prima.

## Schema `escalate_to_human`

Aggiunta al `TurnOutput` (vedi `07-ai-integration.md` per lo schema completo):

```ts
escalate_to_human: z.object({
  reason: z.enum(['scheduling','commitment','sensitive','financial','identity','other']),
  urgency: z.enum(['low','normal','high']),
  summary: z.string().min(1).max(500),                  // 1-3 frasi: cosa chiede, perchè non posso rispondere
  suggested_holding_reply: z.string().nullable(),       // null = non rispondere, string = stall ("ti faccio sapere")
}).nullable()
```

Note:

- `urgency: 'high'` -> notifica immediata, senza accumulo.
- `urgency: 'normal'` -> notifica subito, ma accettabile se l'utente la vede dopo qualche minuto.
- `urgency: 'low'` -> notifica solo nel digest giornaliero (vedi `16-future-enhancements.md` #8 quando implementato; in v1 senza digest, equivale a `normal`).
- `suggested_holding_reply` esempio: "Aspetta che controllo, ti faccio sapere". Se non-null, viene inviato a WhatsApp prima di notificare. Se null, niente reply, l'utente risponde da zero.

## Comportamento del bot

Quando `TurnOutput.escalate_to_human` non è null, in `ReplyOrchestrator.generateAndSend` (vedi `03-data-flow.md` Flow C):

1. Se `suggested_holding_reply` non null:
   - Inviare il messaggio come `out_bot` normale.
   - Persistere in `processed_messages`.
2. Inserire una row in `escalations` (vedi sotto) con `status='pending'`.
3. Notificare sul canale configurato (vedi `Canali` sotto).
4. NON eseguire le altre azioni del Flow C che dipendono dal contenuto della reply (extracted_facts, tone_update, language_update procedono comunque, sono indipendenti).
5. `chat_state -> IDLE`.
6. `turn_log` insert con `status='escalated'` (nuovo enum value).

Se `escalate_to_human` è null (caso normale), il flow resta invariato.

## Tabella `escalations`

```ts
export const escalations = sqliteTable('escalations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  chatId: text('chat_id').notNull(),
  triggerMsgId: text('trigger_msg_id').notNull(),       // whatsapp_msg_id che ha fatto scattare l'escalation
  reason: text('reason').notNull(),                     // scheduling | commitment | ...
  urgency: text('urgency', { enum: ['low','normal','high'] }).notNull(),
  summary: text('summary').notNull(),
  holdingReplySent: integer('holding_reply_sent', { mode: 'boolean' }).notNull().default(false),
  status: text('status', { enum: ['pending','user_replied','superseded','dismissed'] }).notNull().default('pending'),
  createdAt: integer('created_at').notNull(),
  resolvedAt: integer('resolved_at'),
  notifiedChannels: text('notified_channels').notNull(),  // JSON array: ['whatsapp_self','telegram']
}, (t) => ({
  chatStatusIdx: index('idx_esc_chat_status').on(t.chatId, t.status),
  createdIdx: index('idx_esc_created').on(t.createdAt),
}))
```

Lifecycle:

- `pending` -> creata. Notifica inviata.
- `user_replied` -> rilevato `out_manual` per quella chat dopo `createdAt`. Marker informativo, l'utente ha risposto.
- `superseded` -> arrivato un altro messaggio dalla persona dopo l'escalation, l'AI ha generato una nuova escalation o una reply autonoma. La vecchia diventa stale.
- `dismissed` -> manuale, non implementato in v1 (cambia row a mano in DB se necessario).

## Canali di notifica

Configurabile tramite `config.escalation`:

```ts
escalation: {
  enabled: true,
  channels: ['whatsapp_self', 'telegram'] as Array<'whatsapp_self' | 'telegram'>,
  whatsappSelfChatId: 'me',                             // 'me' -> usa numero proprio risolto a runtime
  telegramBotTokenEnv: 'TELEGRAM_BOT_TOKEN',            // nome ENV var
  telegramChatIdEnv: 'TELEGRAM_USER_CHAT_ID',           // nome ENV var
  rateLimitPerHour: 12,                                 // safety: max 12 notifiche/ora aggregate
  highUrgencyBypassRateLimit: true,
}
```

### Canale 1: WhatsApp self-chat

Il bot manda un messaggio sulla propria chat con se stesso (numero proprio = numero proprio). `whatsapp-web.js` supporta:

```ts
const myWid = client.info.wid._serialized          // es. '391234567@c.us'
await client.sendMessage(myWid, formattedNotification)
```

Pro: zero infra aggiuntiva, notifica push WhatsApp standard.

Contro: dipende dalla notifica push di WhatsApp arrivare al telefono dell'utente. Le notifiche di self-chat possono essere mute dall'utente per errore o non comparire come notifica visibile su alcune versioni di WhatsApp. Verificare al setup (vedi `15-runbook.md`).

Se WhatsApp Web stessa è disconnessa, l'invio fallisce e l'escalation resta `pending` finchè non torna online. Stesso destino del bot: nessuno dei due funziona.

### Canale 2: Telegram bot

Il bot invia su Telegram tramite Bot API. HTTPS POST diretto a `https://api.telegram.org/bot<TOKEN>/sendMessage` con body JSON `{ chat_id, text, parse_mode: 'Markdown' }`.

Niente libreria necessaria, basta `fetch` (Node 20+).

```ts
async function sendTelegram(text: string) {
  const token = process.env[config.escalation.telegramBotTokenEnv]
  const chatId = process.env[config.escalation.telegramChatIdEnv]
  if (!token || !chatId) {
    log.warn('telegram credentials missing, skipping')
    return false
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
  return res.ok
}
```

Pro: indipendente da WhatsApp Web. Notifiche push Telegram sono affidabili.

Contro: serve setup iniziale del bot (vedi `15-runbook.md` sezione "Setup Telegram"). Token segreto, da tenere in `.env` non committato.

### Multi-canale e fallback

Se entrambi i canali sono attivi, il bot prova entrambi in parallelo. Almeno un successo è considerato success (escalation `notified_channels` registra quali hanno funzionato).

Se entrambi falliscono, l'escalation resta `pending` con `notified_channels=[]`. Un retry job ogni 5 minuti tenta di rinotificare per le pendenti senza notify success. Cap 3 retry, dopo log error e basta (l'utente la vedrà comunque al boot successivo se ancora in `pending`).

### Rate limit

`config.escalation.rateLimitPerHour` (default 12) limita il volume aggregato di notifiche per non spammare l'utente.

Implementazione: query `SELECT COUNT(*) FROM escalations WHERE created_at > now - 3600_000 AND notified_channels != '[]'`. Se > limit, aggregare in un'unica notifica "X escalations pending, vedere log/dashboard".

`highUrgencyBypassRateLimit: true` -> `urgency='high'` non conta nel rate limit, sempre notificata individualmente.

## Formato del messaggio di notifica

```
[viet-chatter] {urgency_emoji}{REASON}
Da: {display_name or phone}
Riassunto: {summary}
{holding_reply_indicator}

Vai a rispondere su WhatsApp.
```

Esempi:

WhatsApp self-chat (no Markdown):
```
[viet-chatter] !! SCHEDULING
Da: Hoa (+8412345)
Riassunto: Hoa chiede se sei libero sabato sera per cena. Non ho informazioni sui tuoi impegni.
Holding reply inviata: "ti faccio sapere"

Vai a rispondere su WhatsApp.
```

Telegram (Markdown):
```
*[viet-chatter] SCHEDULING* ⚠️
*Da:* Hoa (+8412345)
*Riassunto:* Hoa chiede se sei libero sabato sera per cena. Non ho informazioni sui tuoi impegni.
*Holding reply inviata:* "ti faccio sapere"

Vai a rispondere su WhatsApp.
```

`urgency_emoji` -> `low` = nessuna emoji, `normal` = `!`, `high` = `!!`. Niente emoji su WhatsApp self-chat (vincolo style del progetto: nessun emoji), su Telegram opzionali. (Decisione: niente emoji ovunque per coerenza con lo stile del progetto. Le emoji sopra sono solo nell'esempio Telegram come illustrazione, da rimuovere se si decide di mantenere la regola "no emoji" anche per Telegram.)

## Dedup ed evoluzione

### Caso: messaggio in arrivo trigger escalation, esiste gia escalation pending per la stessa chat

Comportamento: NON creare una nuova escalation. Aggiornare la `summary` della pendente esistente con il nuovo messaggio, e ri-notificare solo se l'urgenza sale (es. da `normal` a `high`).

Implementazione:

```ts
const existing = await repo.pendingEscalation(chatId)
if (existing) {
  await repo.updateEscalationSummary(existing.id, newSummary)
  if (newUrgency > existing.urgency) {
    await renotify(existing.id, channels)
  }
  return
}
// else create new
```

### Caso: utente risponde manualmente

`MessageDispatcher` sull'evento `out_manual` per una chat con escalation `pending`:

```ts
await repo.markEscalationsResolved(chatId, 'user_replied')
```

Niente notifica di "risolto" all'utente, solo update DB.

### Caso: bot stesso genera una reply autonoma (turn successivo, AI cambia idea)

Stesso comportamento: la nuova reply implica che l'AI ora sa abbastanza, l'escalation precedente diventa stale. Marker `superseded` con `resolvedAt = now`.

## Configurazione per chat (override)

Some chat sono OK per escalation, altre no. Esempio: una chat di lavoro dove l'utente preferisce rispondere sempre lui -> sempre escalation. Una chat amichevole dove l'utente si fida del bot al 100% -> mai escalation.

In v1, override per chat NON implementato. Il filtro è globale: l'AI decide turn-per-turn.

Override per chat è una future enhancement (vedi `16-future-enhancements.md`): aggiungere `escalation_policy` su `person_profile` con valori `'auto' | 'always' | 'never'`. L'AI legge il valore dal `TurnContext` e applica.

## Edge case e race

### Edge: bot offline al momento del trigger

Stesso destino del bot: il messaggio resta in WhatsApp, viene processato al ritorno online dal `BootReconciler`. Se l'AI lo classifica ancora come da escalare, parte l'escalation con un ritardo equivalente all'offline window. Niente comportamento speciale.

### Edge: utente risponde nei millisecondi tra send `holding_reply` e notifica

Identico alle race window esistenti del Flow D (`out_manual` durante `SENDING`). Mitigato dal pattern `processed_messages.ts > escalation.createdAt`. Documentato come accettabile.

### Edge: AI emette `escalate_to_human` senza `summary`

Schema zod richiede `summary` non vuota. Se manca, validation fail, retry. Se persiste, escalation creata con `summary = "AI ha richiesto escalation senza fornire dettagli. Vai a controllare la chat."` come fallback.

### Edge: AI emette sia `reply` non vuoto che `escalate_to_human` non null

Conflitto: l'AI ha generato una reply ma anche dichiarato escalation. Risoluzione: l'`escalate_to_human` ha precedenza. Il `reply` viene scartato (NON inviato), e si invia solo `suggested_holding_reply` se presente. Logica: se l'AI è incerta abbastanza da escalare, la sua reply non è affidabile.

Documentare questo comportamento nei prompt: "se setti escalate_to_human, lascia reply vuoto o usa suggested_holding_reply".

## Configurazione di esempio

`config/index.ts`:

```ts
escalation: {
  enabled: true,
  channels: ['telegram'] as const,                      // solo Telegram, self-chat skip
  whatsappSelfChatId: 'me',
  telegramBotTokenEnv: 'TELEGRAM_BOT_TOKEN',
  telegramChatIdEnv: 'TELEGRAM_USER_CHAT_ID',
  rateLimitPerHour: 12,
  highUrgencyBypassRateLimit: true,
}
```

`.env` (gitignored):

```
TELEGRAM_BOT_TOKEN=123456789:AAA-bbb-ccc-ddd-eee
TELEGRAM_USER_CHAT_ID=987654321
```

Per disabilitare temporaneamente: `escalation.enabled = false`. Hot reload prende effetto al prossimo turn.

## Modulo `EscalationNotifier`

`src/escalation/notifier.ts`:

```ts
export interface EscalationChannel {
  send(payload: EscalationPayload): Promise<boolean>
  name: string
}

export class WhatsAppSelfChannel implements EscalationChannel { /* ... */ }
export class TelegramChannel implements EscalationChannel { /* ... */ }

export class EscalationNotifier {
  constructor(private channels: EscalationChannel[], private repo: Repo) {}

  async notify(escId: number): Promise<void> {
    const esc = await this.repo.getEscalation(escId)
    if (!esc) return
    if (await this.checkRateLimit(esc.urgency)) {
      log.warn({ escId }, 'rate limited, deferring')
      return
    }
    const text = this.format(esc)
    const results = await Promise.allSettled(
      this.channels.map(c => c.send({ esc, text }))
    )
    const ok = results
      .map((r, i) => r.status === 'fulfilled' && r.value ? this.channels[i].name : null)
      .filter(Boolean) as string[]
    await this.repo.updateEscalationNotified(escId, ok)
    if (ok.length === 0) log.error({ escId }, 'all channels failed')
  }
}
```

## Logging

Eventi nuovi (vedi `12-logging-observability.md` per il catalogo aggiornato):

| Evento | Level | Campi |
|---|---|---|
| escalation created | `info` | `esc_id`, `chat_id`, `reason`, `urgency` |
| escalation notified | `info` | `esc_id`, `channels_ok`, `channels_failed` |
| escalation rate limited | `warn` | `esc_id`, `aggregated` |
| escalation resolved (user_replied) | `info` | `esc_id`, `chat_id` |
| escalation superseded | `info` | `esc_id`, `chat_id`, `reason` |
| holding reply sent | `info` | `esc_id`, `chat_id` |

## Health check estensione

`npm run health` aggiunge:

```
escalations: {
  pending: 2,
  resolved_24h: 5,
  failed_to_notify_24h: 0,
}
```

Permette di rilevare al volo se ci sono escalations bloccate (notifica fallita, utente non vede).

## Sicurezza

- Token Telegram in `.env`, mai in `config/index.ts` o committato.
- `.env` deve essere in `.gitignore` (vedi `13-progetto-layout.md`).
- Verificare al setup che `.env` non sia tracciato (`git ls-files .env` deve essere vuoto).
- Bot Telegram dedicato per ogni installazione, non condividerne il token.
- `chat_id` Telegram dell'utente: trattare come PII, ma non come segreto critico (è un identificativo opaco).
- Rotazione token: revocare il vecchio via @BotFather, generare nuovo, aggiornare `.env`, restart bot.

## Differenza esplicita: escalation vs approval flow

| Aspetto | Escalation (questo) | Approval flow (out-of-scope) |
|---|---|---|
| Controllo umano | Solo turn dove l'AI dichiara incertezza | Su ogni reply, sempre |
| Default behavior | Bot risponde autonomamente | Bot mai risponde senza OK |
| Latency utente | Bot manda holding reply (es. "aspetta") immediato + notifica | Lunga: aspetta che utente approvi ogni turn |
| Relazione con `fully autonomous` | Compatibile: la scelta di escalare è essa stessa autonoma | Incompatibile: per definizione richiede revisione |
| User experience | Persona vede risposta o stall, l'utente risponde quando può | Persona non vede nulla finchè l'utente non approva |

## Riepilogo flusso completo

```
1. Hoa: "Sei libero sabato per cena?"
2. Bot legge messaggio, applica filtro -> passa.
3. Debounce 120s, raffica chiusa.
4. Calcola fire_at, scheduled.
5. fire_at hit, SENDING.
6. Build TurnContext (history + KB + profile).
7. AI call.
8. AI output:
   {
     reply: "",
     skip: false,
     escalate_to_human: {
       reason: "scheduling",
       urgency: "normal",
       summary: "Hoa chiede se sabato sera sei libero per cena.",
       suggested_holding_reply: "Aspetta che controllo, ti faccio sapere"
     },
     ...
   }
9. Bot:
   a. Send "Aspetta che controllo, ti faccio sapere" come out_bot.
   b. Insert escalation in DB.
   c. EscalationNotifier.notify(escId).
   d. Manda Telegram: "[viet-chatter] SCHEDULING - Da: Hoa - Riassunto: ..."
10. Utente vede notifica Telegram, va su WhatsApp, legge la chat con Hoa.
11. Utente risponde a mano: "Si, alle 20".
12. Dispatcher rileva out_manual.
13. Dispatcher chiama repo.markEscalationsResolved(chatId, 'user_replied').
14. Escalation status -> user_replied. resolvedAt = now.
15. Niente messaggio extra all'utente.
```

## Future enhancement collegate

- `escalation_policy` per chat (`auto` / `always` / `never`).
- Snooze: ricevuta notifica, "ti ricordo tra X minuti se non ho ancora risposto".
- Daily digest che lista tutte le escalations non risolte con tempo trascorso.
- Aggregazione intelligente quando arrivano N escalations in 30 minuti (un'unica notifica con elenco).
- Smart escalation: l'AI stima un calendar lookup possibile (Google/Apple Calendar via OS) per non escalare su scheduling se ha accesso.
