# Workflows and use cases

Concrete examples of what happens in real scenarios.

## Case 1: first person added to the rule

**Situation**: you have just configured the bot. The rule says "reply to Vietnamese numbers". Hoa (number +84...) writes to you for the first time.

**Timeline**:

- 14:00 Hoa writes "Hi! How are you?".
- 14:00 the bot sees, checks the rule: number +84, passes.
- 14:00 the bot starts the silence timer (2 minutes). Is she writing? Wait.
- 14:02 two minutes of silence, burst closed.
- 14:02 delay calc: with Hoa there is no reply history, default 30 minutes.
- 14:02 with randomness +/-20%: say 27 minutes. Reply scheduled for 14:29.
- 14:29 the bot sends: "Hey Hoa, all good. You?".
- 14:29 the AI notes that Hoa writes in English, saves to the profile `languages: [en]`.

**Journal updated**: nothing important or secondary extracted yet (the conversation is too early-stage).

## Case 2: burst of 4 messages

**Situation**: Lan (on the list) sends you 4 messages in a row.

**Timeline**:

- 09:30 Lan: "Hi".
- 09:30 timer starts (2 min).
- 09:30:15 Lan: "How are you?" -> timer reset.
- 09:30:35 Lan: "I have something to tell you..." -> timer reset.
- 09:31:10 Lan: "Got 5 minutes?" -> timer reset.
- 09:33:10 two minutes of total silence, burst closed.
- 09:33:10 delay calc: last 5 replies to Lan on average 45 minutes, +/-20% -> say 41 min.
- 09:33:10 reply scheduled for 10:14.
- 10:14 the bot sends ONE reply that addresses all 4 messages: "Hi Lan, I'm well, tell me".

## Case 3: you reply before the bot

**Situation**: like Case 2, but at 10:00 (before the scheduled 10:14) you reply by hand.

**Timeline**:

- 10:00 you write: "all good, tell me" from the phone.
- 10:00 the bot sees the `out_manual` event, cancels the job scheduled for 10:14.
- 10:00 chat returns to `IDLE` state.
- 10:14 nothing fires (job had been cancelled).

**Latency**: 30 minutes from Lan's third message. This enters the rolling average for the next calculations.

## Case 4: bot offline, then comes back

**Situation**: you shut down the PC at 18:00. Lan writes at 19:00, at 20:30, at 21:45. You turn the PC back on at 22:30 (but we are in the night window, 22-06).

**Timeline**:

- 22:30 you launch the bot, boot starts.
- 22:30 reconciliation: the bot sees Lan has 3 new messages since the last one it had seen (15:00). Loads them.
- 22:30 normally it would start accumulation and the delay calc. But computing the delay, the fire would fall in the night window -> shift to the morning.
- 22:30 reply scheduled for around 06:05 (06:00 + random jitter).
- 06:05 reply fires.

## Case 5: birthday

**Situation**: during a conversation 3 weeks ago, Hoa said "my birthday is February 22". The AI extracted and saved it as an important fact, with recurring date.

**Timeline**:

- February 22, 09:00 ("good time of morning" + jitter): the wishes job fires.
- 09:00 the bot checks: in the last 12 hours have you exchanged messages? No.
- 09:00 the bot automatically sends: "Hey Hoa, happy birthday!".

**Variant**: you chatted at 23:50 the night before. At 09:00 the bot sees the recent exchanges, does NOT send the wishes as a separate message. It waits for Hoa to reply to the previous message: when she replies, the AI during generation sees "today is the birthday" in the journal and includes the wishes in the normal reply.

## Case 6: dry heart after a long conversation

**Situation**: with Lan you chatted for 2 straight hours (15 messages each). Your last message was a joke. She replies only with a heart.

**Timeline**:

- 17:00 your last message (via bot).
- 17:02 Lan: "heart emoji" -> arrives at the bot as a message.
- 17:04 burst closed (silence 2 min).
- 17:04 the bot computes the reply. The AI evaluates:
  - Very active conversation today: yes.
  - She sent only a heart: ambiguous closure.
  - Suggests `revive_hint = { attempt_in_minutes: 50 }`.
- 17:04 the bot decides: skip immediate reply (the AI said skip for the single heart). But creates a revive job for 17:54.
- 17:54 the revive fires. AI generates a light follow-up: "For the record, it was a joke ;)". Sends.
- 18:30 Lan has not replied. The job is already done, does not repeat.

## Case 7: re-engage after 2 weeks

**Situation**: you have not talked to Mai for 14 days. The filter rule includes her.

**Timeline**:

- day 14, 09:00: daily cron scans the chats.
- 09:00 finds Mai: last exchange 14 days ago, 14-day threshold exceeded, no pending job, not in `cold` state.
- 09:00 creates a re-engage job for 10:30 (sensible time + jitter).
- 10:30 fires. AI reads Mai's journal: "works in Hanoi", "last time she was stressed".
- 10:30 AI generates: "Hey Mai, how is it going? All good with work?". Sends.
- day 21 (7 days later): Mai has not replied. Mai marked as `cold`. No more re-engage until she writes first.

## Case 8: you send cold (proactive)

**Situation**: you open WhatsApp and write to Hoa on your own "Hey, got a restaurant recommendation?".

**Timeline**:

- 12:00 your `out_manual`. The bot sees it, records it in `processed_messages`. State stays `IDLE` (no pending incoming).
- 12:30 Hoa replies: "Sushi place near Old Quarter".
- 12:30 the bot sees the incoming, applies filter, accumulation and delay.
- ~13:15 the bot replies based on your message + hers. Handles it normally.

Nothing special: your proactive messages enter the history, everything else as usual.

## Case 9: tone change over time

**Situation**: with Phuong the initial tone was "casual, joking". For a week she has been going through a bad time (work, family).

**Evolutionary timeline**:

- days 1-7: tone note "casual, ironic, jokes".
- day 8: she says "I'm very stressed". The AI extracts an ephemeral fact, and in the `tone_update` proposes "supportive, attentive, fewer jokes".
- day 8 onwards: the bot generates more caring replies. The journal contains the ephemeral fact "stressed by work" expiring in 7 days.
- day 15: the ephemeral fact expires. The tone note stays until the AI detects a change in her messages (she goes back to cheerful).
- day 20: she says "all sorted, finally I can breathe!". The AI updates `tone_update = "casual, joking"`.

## Case 10: filter rule modified on the fly

**Situation**: the bot has been running for 3 days. You want to exclude Linh's number.

**Timeline**:

- 16:00 you open the web UI (`http://localhost:3000`, Filter tab) and add `+84LinhNumber` to "Blocked numbers", Save. Or equivalently edit `config/user-config.yaml` `filter.blockedNumbers` block and save.
- 16:00 the bot detects the modified file, reloads the rule, validates with zod, atomic swap.
- 16:01 Linh writes to you. The bot reads, checks the NEW rule: number in blacklist -> does not pass. Ignores.

No downtime, no restart.
