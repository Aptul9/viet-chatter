# Data flow

> Status: design; behavior implemented. See `19-implementation-notes.md` for shipped deltas.

## Flow A: messaggio entrante (incoming)

1. `whatsapp-web.js` emette `message` (incoming).
2. `MessageDispatcher` riceve. Persiste in `processed_messages` (idempotente su `whatsapp_msg_id`).
3. `FilterEngine.shouldReply(chatContext)`. Se `false`, fine.
4. Cancella eventuale `manual_jobs` pendente per quella chat (collision rule, vedi `10-manual-jobs.md`).
5. `ChatStateMachine.handleIncoming(chat_id, msg_ts)`:
   - Stato `IDLE` -> `ACCUMULATING`. Set `first_msg_at`, `debounce_deadline = now + DEBOUNCE_MS`.
   - Stato `ACCUMULATING` -> aggiorna `debounce_deadline`. Se `now - first_msg_at >= HARD_CAP_MS`, forza chiusura immediata.
   - Stato `SCHEDULED` -> cancella job, `state = ACCUMULATING`, set nuovo `debounce_deadline`.
   - Stato `SENDING` -> niente, lascia finire. Sarà incluso nel prossimo turn.

## Flow B: TickerLoop processa stati maturi

Ogni 10s:

1. `SELECT * FROM chat_state WHERE state IN ('ACCUMULATING','SCHEDULED')`.
2. Per ogni riga `ACCUMULATING`:
   - Se `now >= debounce_deadline` o `now - first_msg_at >= HARD_CAP_MS`:
     - `fireAt = computeFireAt(chat_id)` (vedi `04-scheduler-state-machine.md`).
     - `UPDATE chat_state SET state='SCHEDULED', fire_at=? WHERE chat_id=? AND state='ACCUMULATING'` (atomico).
3. Per ogni riga `SCHEDULED`:
   - Se `now >= fire_at`:
     - Claim atomico: `UPDATE chat_state SET state='SENDING' WHERE chat_id=? AND state='SCHEDULED'`. Se `changes() == 0`, skip (qualcuno ha già preso o cambiato stato).
     - Pre-send check: `SELECT * FROM processed_messages WHERE chat_id=? ORDER BY ts DESC LIMIT 1`. Se `direction='out_manual'` e `ts > fire_at - 30s` -> abort, `state='IDLE'`, fine.
     - Registra `AbortController` in `InflightRegistry`.
     - Invoca `ReplyOrchestrator.generateAndSend(chat_id, abortSignal)` async.

## Flow C: ReplyOrchestrator.generateAndSend

1. Check abort signal #1: se aborted, return early, `state='IDLE'`, unregister.
2. `chat = await client.getChat(chat_id)`.
3. `recentMessages = await chat.fetchMessages({ limit: aiHistoryLimit })`. Niente storage in DB del body.
4. `lastIncomingBody = ultimo incoming nel batch fetched`.
5. `lastIncomingEmbedding = embed(lastIncomingBody)`.
6. `kb = { important, ephemeral, secondary }`:
   - `important = repo.loadImportant(chat_id)`.
   - `ephemeral = repo.loadActiveEphemeral(chat_id)`.
   - `secondary = vecStore.search(chat_id, lastIncomingEmbedding, ragTopK).then(ids => repo.loadFactsByIds(ids))`.
7. `profile = repo.getPersonProfile(chat_id)`.
8. Costruisci `TurnContext`. JSON-serializza.
9. Check abort signal #2.
10. `turnOutput = await aiClient.generateTurn(turnContext, abortSignal)`.
11. Check abort signal #3.
12. Validazione zod su `turnOutput`. Se fail, retry una volta. Se di nuovo fail, log error, `state='IDLE'`, return.
13. **Branch escalation**: se `turnOutput.escalate_to_human != null` AND `config.escalation.enabled`:
    - Check dedup: `existing = repo.pendingEscalation(chat_id)`. Se esiste, aggiorna `summary` e ri-notifica solo se urgency è salita. Salta i passi 14-15. Persisti comunque `extracted_facts` (passo 17). Procedi al passo 19+.
    - Se non esiste:
      - Insert `escalations` row (`status='pending'`, `notified_channels='[]'`).
      - Se `escalate_to_human.suggested_holding_reply != null`: send come `out_bot`, persisti `processed_messages`, marca `holding_reply_sent=true`.
      - `EscalationNotifier.notify(escId)` (async, non bloccante per il completamento del turn).
      - Persisti `extracted_facts` (passo 17), tone/languages update (18-19), `turn_log` con `status='escalated'` (20). `state='IDLE'`.
      - Return.
14. Se `turnOutput.skip == true`: niente send. Persisti comunque `extracted_facts`. Update `tone_summary` / `languages`. `state='IDLE'`.
15. Altrimenti: check abort signal #4 (last guard before send).
16. `sentMsg = await client.sendMessage(chat_id, turnOutput.reply)`.
17. Persisti `processed_messages` con `direction='out_bot'`, `whatsapp_msg_id=sentMsg.id`.
18. Persisti `extracted_facts`:
    - Per ogni fact: insert in `facts`. Se `tier='secondary'`, calcola embedding e insert in `facts_vec`.
    - Se `supersedes_id` presente: `UPDATE facts SET superseded_by=newId WHERE id=supersedes_id`.
    - Se `anchor_date` presente: crea row in `manual_jobs(kind='date_anchored', fire_at=...)`.
19. Update `person_profile.tone_summary = turnOutput.tone_update` (se non null).
20. Update `person_profile.languages = turnOutput.languages_update` (se non null).
21. Insert `turn_log` con esito.
22. `state='IDLE'`, unregister `InflightRegistry`.

Conflict rule: se `escalate_to_human != null` e contemporaneamente `reply` è non-vuoto, l'escalation ha precedenza, la reply viene scartata. Solo `suggested_holding_reply` viene inviato (se non null). Vedi `18-escalation.md`.

## Flow D: messaggio uscente manuale

1. `whatsapp-web.js` emette `message_create` con `fromMe=true` non originato da `client.sendMessage`.
   - Distinzione: tracciamo gli `id` dei messaggi inviati dal bot in una set in-memory + nel DB. Se `fromMe` e `id` non in quel set -> manuale.
2. Persisti `processed_messages` con `direction='out_manual'`.
3. Cancella eventuali `manual_jobs` pendenti per quella chat.
4. **Risolvi escalations pendenti**: `repo.markEscalationsResolved(chat_id, 'user_replied')`. Marca tutte le `escalations` con `status='pending'` e `chat_id=?` come `resolved`. Niente notifica all'utente.
5. `ChatStateMachine.handleOutgoingManual(chat_id)`:
   - `ACCUMULATING` -> `IDLE`.
   - `SCHEDULED` -> `IDLE`. (Job cancellato.)
   - `SENDING` -> abort tramite `InflightRegistry.get(chat_id)?.abort()`. Lo orchestrator vede l'abort sui check 1-4 e gestisce.
   - `IDLE` -> niente.

## Flow E: boot

1. `BootReconciler.run()`. Vedi `09-boot-reconciler.md` per dettagli.
2. Iterazione su `client.getChats()` (cap a 50, ordinato per recency).
3. Per ogni chat candidata, fetch nuovi messaggi rispetto a `MAX(ts)` in DB.
4. Ogni messaggio fetched viene instradato a `MessageDispatcher` come fosse arrivato live.
5. State machine assorbe e produce `ACCUMULATING` / `SCHEDULED`.
6. `TickerLoop.start()`.
7. `ManualJobsCron.start()`.

## Flow F: post-reconnect

1. `ConnectionStateMachine` rileva transizione `DISCONNECTED -> CONNECTED`.
2. Pause TickerLoop.
3. Esegue `BootReconciler.run()` (idempotente).
4. Post-reconnect spread: per le chat con `fire_at < now` accumulati durante l'offline, ridistribuisce i `fire_at` con jitter `[30s, 180s]` progressivo.
5. Resume TickerLoop.

## Flow G: manual job fire (date_anchored / revive / re_engage)

1. `ManualJobsCron` (più frequente del TickerLoop, es. ogni 30s, oppure dedicato) scansiona `manual_jobs WHERE status='pending' AND fire_at <= now`.
2. Per ognuno, claim atomico: `UPDATE manual_jobs SET status='firing' WHERE id=? AND status='pending'`.
3. Pre-fire check:
   - Esistono `out_bot` o `out_manual` nelle ultime 12h per quel chat? Se sì, `status='superseded'`, fine.
   - Lo `chat_state` è in `SENDING`/`SCHEDULED`? Se sì, `status='superseded'`, fine.
4. Costruisci `TurnContext` arricchito con `manual_job_context` (es. "today is Birthday for this person", "you decided to re-engage after 14 days silence").
5. Invoca `ReplyOrchestrator.generateAndSendForManualJob(chat_id, jobContext, abortSignal)`. Stessa pipeline di Flow C ma con context aggiuntivo.
6. Se `recurring=yearly`: dopo successo, crea nuovo `manual_jobs` con `fire_at += 1 year`.
7. `status='fired'`.

## Flow H: escalation notification

Triggered da Flow C step 13 quando `turnOutput.escalate_to_human != null`.

1. `EscalationNotifier.notify(escId)` viene invocato.
2. Lookup escalation: `esc = await repo.getEscalation(escId)`.
3. Rate limit check: count escalations notified nell'ultima ora. Se > `config.escalation.rateLimitPerHour` AND `esc.urgency != 'high'`:
   - Marca `notified_channels=['rate_limited']`.
   - Log warn. Skip notify.
4. Format del messaggio: `format(esc)` produce stringa con reason, person, summary, holding indicator.
5. Per ogni canale in `config.escalation.channels`:
   - `WhatsAppSelfChannel`: `client.sendMessage(myWid, formattedText)`.
   - `TelegramChannel`: HTTPS POST a `api.telegram.org/bot<TOKEN>/sendMessage`.
6. `Promise.allSettled` per parallelismo.
7. Aggrega risultati. Update `escalations.notified_channels` con i nomi dei canali che hanno restituito success.
8. Se nessun canale OK: log error. La row resta `pending`. Un retry job ogni 5 min tenta di rinotificare (vedi `18-escalation.md`).
9. Se almeno uno OK: log info, escalation è "delivered".

Note:

- Notify è idempotente sul lato canale per design (Telegram dedup non c'è, ma se inviato 2 volte per timing race è accettabile - utente vede 2 notifiche sostanzialmente identiche).
- Notify non cambia lo `status` dell'escalation, che resta `pending` finchè utente risponde manualmente o un nuovo turn supera l'escalation.
