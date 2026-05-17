# Data flow

> Status: design; behavior implemented.

## Flow A: incoming message

1. `whatsapp-web.js` emits `message` (incoming).
2. `MessageDispatcher` receives. Persists in `processed_messages` (idempotent on `whatsapp_msg_id`).
3. `FilterEngine.shouldReply(chatContext)`. If `false`, end.
4. Cancel any pending `manual_jobs` for that chat (collision rule, see `10-manual-jobs.md`).
5. `ChatStateMachine.handleIncoming(chat_id, msg_ts)`:
   - State `IDLE` -> `ACCUMULATING`. Set `first_msg_at`, `debounce_deadline = now + DEBOUNCE_MS`.
   - State `ACCUMULATING` -> update `debounce_deadline`. If `now - first_msg_at >= HARD_CAP_MS`, force immediate closure.
   - State `SCHEDULED` -> cancel job, `state = ACCUMULATING`, set new `debounce_deadline`.
   - State `SENDING` -> nothing, let it finish. It will be included in the next turn.

## Flow B: TickerLoop processes mature states

Every 10s:

1. `SELECT * FROM chat_state WHERE state IN ('ACCUMULATING','SCHEDULED')`.
2. For each `ACCUMULATING` row:
   - If `now >= debounce_deadline` or `now - first_msg_at >= HARD_CAP_MS`:
     - `fireAt = computeFireAt(chat_id)` (see `04-scheduler-state-machine.md`).
     - `UPDATE chat_state SET state='SCHEDULED', fire_at=? WHERE chat_id=? AND state='ACCUMULATING'` (atomic).
3. For each `SCHEDULED` row:
   - If `now >= fire_at`:
     - Atomic claim: `UPDATE chat_state SET state='SENDING' WHERE chat_id=? AND state='SCHEDULED'`. If `changes() == 0`, skip (someone already took or changed state).
     - Pre-send check: `SELECT * FROM processed_messages WHERE chat_id=? ORDER BY ts DESC LIMIT 1`. If `direction='out_manual'` and `ts > fire_at - 30s` -> abort, `state='IDLE'`, end.
     - Register `AbortController` in `InflightRegistry`.
     - Invoke `ReplyOrchestrator.generateAndSend(chat_id, abortSignal)` async.

## Flow C: ReplyOrchestrator.generateAndSend

1. Abort signal check #1: if aborted, return early, `state='IDLE'`, unregister.
2. `chat = await client.getChat(chat_id)`.
3. `recentMessages = await chat.fetchMessages({ limit: aiHistoryLimit })`. No storage in DB of the body.
4. `lastIncomingBody = last incoming in the fetched batch`.
5. `lastIncomingEmbedding = embed(lastIncomingBody)`.
6. `kb = { important, ephemeral, secondary }`:
   - `important = repo.loadImportant(chat_id)`.
   - `ephemeral = repo.loadActiveEphemeral(chat_id)`.
   - `secondary = vecStore.search(chat_id, lastIncomingEmbedding, ragTopK).then(ids => repo.loadFactsByIds(ids))`.
7. `profile = repo.getPersonProfile(chat_id)`.
8. Build `TurnContext`. JSON-serialize.
9. Abort signal check #2.
10. `turnOutput = await aiClient.generateTurn(turnContext, abortSignal)`.
11. Abort signal check #3.
12. Zod validation on `turnOutput`. If fail, retry once. If fail again, log error, `state='IDLE'`, return.
13. **Escalation branch**: if `turnOutput.escalate_to_human != null` AND `config.escalation.enabled`:
    - Dedup check: `existing = repo.pendingEscalation(chat_id)`. If exists, update `summary` and re-notify only if urgency went up. Skip steps 14-15. Persist `extracted_facts` anyway (step 17). Proceed to step 19+.
    - If it doesn't exist:
      - Insert `escalations` row (`status='pending'`, `notified_channels='[]'`).
      - If `escalate_to_human.suggested_holding_reply != null`: send as `out_bot`, persist `processed_messages`, mark `holding_reply_sent=true`.
      - `EscalationNotifier.notify(escId)` (async, non-blocking for turn completion).
      - Persist `extracted_facts` (step 17), tone/languages update (18-19), `turn_log` with `status='escalated'` (20). `state='IDLE'`.
      - Return.
14. If `turnOutput.skip == true`: no send. Persist `extracted_facts` anyway. Update `tone_summary` / `languages`. `state='IDLE'`.
15. Otherwise: abort signal check #4 (last guard before send).
16. `sentMsg = await client.sendMessage(chat_id, turnOutput.reply)`.
17. Persist `processed_messages` with `direction='out_bot'`, `whatsapp_msg_id=sentMsg.id`.
18. Persist `extracted_facts`:
    - For each fact: insert into `facts`. If `tier='secondary'`, compute embedding and insert into `facts_vec`.
    - If `supersedes_id` present: `UPDATE facts SET superseded_by=newId WHERE id=supersedes_id`.
    - If `anchor_date` present: create row in `manual_jobs(kind='date_anchored', fire_at=...)`.
19. Update `person_profile.tone_summary = turnOutput.tone_update` (if not null).
20. Update `person_profile.languages = turnOutput.languages_update` (if not null).
21. Insert `turn_log` with outcome.
22. `state='IDLE'`, unregister `InflightRegistry`.

Conflict rule: if `escalate_to_human != null` and `reply` is non-empty at the same time, escalation takes precedence, the reply is discarded. Only `suggested_holding_reply` is sent (if not null). See `18-escalation.md`.

## Flow D: outgoing manual message

1. `whatsapp-web.js` emits `message_create` with `fromMe=true` not originated by `client.sendMessage`.
   - Distinction: we track the `id` of messages sent by the bot in an in-memory set + in the DB. If `fromMe` and `id` is not in that set -> manual.
2. Persist `processed_messages` with `direction='out_manual'`.
3. Cancel any pending `manual_jobs` for that chat.
4. **Resolve pending escalations**: `repo.markEscalationsResolved(chat_id, 'user_replied')`. Mark all `escalations` with `status='pending'` and `chat_id=?` as `resolved`. No notification to the user.
5. `ChatStateMachine.handleOutgoingManual(chat_id)`:
   - `ACCUMULATING` -> `IDLE`.
   - `SCHEDULED` -> `IDLE`. (Job cancelled.)
   - `SENDING` -> abort via `InflightRegistry.get(chat_id)?.abort()`. The orchestrator sees the abort on checks 1-4 and handles it.
   - `IDLE` -> nothing.

## Flow E: boot

1. `BootReconciler.run()`. See `09-boot-reconciler.md` for details.
2. Iteration on `client.getChats()` (cap at 50, ordered by recency).
3. For each candidate chat, fetch new messages relative to `MAX(ts)` in DB.
4. Every fetched message is routed to `MessageDispatcher` as if it arrived live.
5. State machine absorbs and produces `ACCUMULATING` / `SCHEDULED`.
6. `TickerLoop.start()`.
7. `ManualJobsCron.start()`.

## Flow F: post-reconnect

1. `ConnectionStateMachine` detects `DISCONNECTED -> CONNECTED` transition.
2. Pause TickerLoop.
3. Run `BootReconciler.run()` (idempotent).
4. Post-reconnect spread: for chats with `fire_at < now` accumulated during offline, redistribute the `fire_at` with progressive jitter `[30s, 180s]`.
5. Resume TickerLoop.

## Flow G: manual job fire (date_anchored / revive / re_engage)

1. `ManualJobsCron` (more frequent than TickerLoop, e.g. every 30s, or dedicated) scans `manual_jobs WHERE status='pending' AND fire_at <= now`.
2. For each, atomic claim: `UPDATE manual_jobs SET status='firing' WHERE id=? AND status='pending'`.
3. Pre-fire check:
   - Do `out_bot` or `out_manual` exist in the last 12h for that chat? If yes, `status='superseded'`, end.
   - Is the `chat_state` in `SENDING`/`SCHEDULED`? If yes, `status='superseded'`, end.
4. Build `TurnContext` enriched with `manual_job_context` (e.g. "today is Birthday for this person", "you decided to re-engage after 14 days silence").
5. Invoke `ReplyOrchestrator.generateAndSendForManualJob(chat_id, jobContext, abortSignal)`. Same pipeline as Flow C but with additional context.
6. If `recurring=yearly`: after success, create new `manual_jobs` with `fire_at += 1 year`.
7. `status='fired'`.

## Flow H: escalation notification

Triggered by Flow C step 13 when `turnOutput.escalate_to_human != null`.

1. `EscalationNotifier.notify(escId)` is invoked.
2. Escalation lookup: `esc = await repo.getEscalation(escId)`.
3. Rate limit check: count escalations notified in the last hour. If > `config.escalation.rateLimitPerHour` AND `esc.urgency != 'high'`:
   - Mark `notified_channels=['rate_limited']`.
   - Log warn. Skip notify.
4. Message format: `format(esc)` produces string with reason, person, summary, holding indicator.
5. For each channel in `config.escalation.channels`:
   - `WhatsAppSelfChannel`: `client.sendMessage(myWid, formattedText)`.
   - `TelegramChannel`: HTTPS POST to `api.telegram.org/bot<TOKEN>/sendMessage`.
6. `Promise.allSettled` for parallelism.
7. Aggregate results. Update `escalations.notified_channels` with the names of channels that returned success.
8. If no channel OK: log error. The row stays `pending`. A retry job every 5 min attempts to re-notify (see `18-escalation.md`).
9. If at least one OK: log info, escalation is "delivered".

Notes:

- Notify is idempotent on the channel side by design (Telegram dedup doesn't exist, but if sent twice due to timing race it's acceptable, the user sees 2 substantially identical notifications).
- Notify doesn't change the `status` of the escalation, which stays `pending` until the user replies manually or a new turn overrides the escalation.
