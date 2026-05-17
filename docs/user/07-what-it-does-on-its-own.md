# What it does on its own

Beyond replying to messages it receives, the bot occasionally starts a conversation itself, or fires off a notification to you. Four cases in total.

## 1. Birthday wishes (and important dates)

If during a conversation a person tells you "my birthday is February 22", the AI records this fact as important. On February 22 of the current year (and subsequent ones), the bot automatically sends a wishes message.

Constraints:

- If you have already exchanged messages with that person in the last 12 hours, the bot does NOT send the wishes as a separate message. It lets the AI, during a normal reply, naturally include the wishes (it sees in the memory that it is the birthday).
- The idea is not to spam with a "happy birthday" if the real conversation already covers the topic.

It also works for other dates (anniversaries, departures, exams) if the bot has recorded them as recurring or specific.

## 2. Conversation revive

When a conversation "dies" badly: you chatted for a while, you said something, she replied only with a heart or a short emoji, and then silence.

The bot, seeing that the day was full of exchanges and the ending was abrupt, can decide to send a small follow-up after a while (e.g. 30-60 minutes). A single attempt. If this one too gets no reply, it lets go.

No insistence, no multiple messages. One gentle attempt, then pause.

The AI is instructed to be conservative: if the conversation was already at the "natural sunset" (formal goodbyes, "talk soon"), it does not intervene. Only if there was an abrupt cutoff after real exchanges.

## 3. Re-engage after prolonged silence

If you have not talked to a person for about 2 weeks, the bot tries to pick up the threads. It sends a natural message taking into account what it knows about her from the journal.

Example:

- She had said she was going on holiday to Da Nang.
- 2 weeks have passed.
- The bot sends: "Hey, how was Da Nang?"

Constraints:

- One single attempt per chat at a time.
- If after the re-engage she does not reply within 7 days, the bot marks her as "cold" and stops trying. It waits for her to write to you.
- No re-engage at night.

Default silence threshold: 14 days. The AI can adapt it based on the type of relationship (with people you hear from often, shorter threshold; with sporadic acquaintances, longer).

## What happens if you reply before the scheduled fire

For all three types (wishes, revive, re-engage): if before the scheduled moment the person writes to you (or you write to her), the auto-scheduled job is cancelled. No duplicate message.

## 4. Escalation to human

When the person writes you something the bot does not know how to answer (appointments, delicate decisions, etc.), instead of making things up it sends you a notification on Telegram (or WhatsApp self-chat) to tell you "go handle this".

See the detail in `12-when-it-calls-you.md`.

This is an important feature: without it, the bot would tend to confirm appointments you cannot keep or to reply to delicate questions incorrectly.

## Can I disable one of these behaviors for a specific person?

In v1 there is no convenient switch. You can act on the global configuration to disable them all, or write the message by hand and the job auto-cancels.

In future versions more granular handling is planned, including the option to force "always escalate" or "never escalate" for a specific person.
