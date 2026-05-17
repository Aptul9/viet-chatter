# FAQ

## Does the bot really replace me?

It does not replace you. It replies "like you" on a subset of chats, but:

- You can always reply first and it stops.
- You see all messages normally on the phone.
- You control who it replies to via the filter rule.

## Do people notice it is a bot?

Hard, but not impossible. Three things make it look human:

- Realistic response times (not 2 seconds).
- No night.
- Memory of the past and adaptive tone.

If replies are too perfect or too generic, someone might suspect. Depends on the AI model chosen and the prompt quality.

## Can I configure a "flirty" or "sarcastic" tone?

Yes, but indirectly. There is no "tone = flirty" selector. The AI keeps a tone note per person that evolves from the conversation. If your first conversations are flirty, it will learn to keep that register.

More controllable: in the filter rule or in the initial prompt you can insert general guidance ("always reply in a casual and friendly way"). But fine personalization is automatic.

## Can I make it use my way of writing (typos, slang)?

Partially. The AI tries to adapt to the register it sees in your previous messages (it reads the whole history). If you write in a very particular way (systematic mistakes, your own abbreviations), over time it imitates.

For perfect imitation, fine-tuning would be needed, out of scope for this version.

## How much does it cost?

Depends on the chosen AI provider.

- Local models (via OpenCode with local backend): zero cost.
- Cloud models (Anthropic, Gemini, Groq paid tier): a few cents a day, depending on chat volume.

For a typical volume (10-30 replies per day total), the cost is less than a coffee per week. If you want zero cost, go local.

## Does it reply even when the PC is on stand-by?

No. If the PC sleeps, the bot sleeps too. WhatsApp accumulates messages, it handles them on wake.

## Can I run it on a Raspberry Pi / VPS / cloud?

Technically yes, but:

- Resources are needed for the Chromium inside whatsapp-web.js (Raspberry Pi 4 8GB makes it, below it is tight).
- On a cloud VPS it becomes an always-on service, monthly cost.
- WhatsApp can flag prolonged use of Web sessions from datacenter IPs as "non-personal use" and block. Real risk.

Typical recommended setup: your personal PC on, or a home mini-PC.

## What if WhatsApp blocks my account?

WhatsApp Web is not an official API for bots. Massive or "non-human" use can lead to account suspension. Mitigations the bot adopts:

- Human response times (not instant).
- No night.
- Only 1:1 chats, no broadcast.
- No automation on groups.

Residual risk is not zero. Use it with judgment.

## Can I see what it replied?

Yes, simply by opening the chats on WhatsApp. The bot's replies appear as normal messages from you. For details on when each reply went out and why, there are the logs in the `logs/` folder.

## Can I temporarily disable the bot for a person?

You edit the filter rule to exclude them, save. From that moment the chat goes back to full manual control.

## If I delete a fact from the journal, does it really forget it?

Yes. You edit/delete the row in the `.db` file (requires a DB tool like DB Browser for SQLite), and the bot will never use it again. It is irreversible unless you have a backup.

## What if the AI gets it wrong and says something embarrassing?

It can happen. The bot does not have human checks on every reply (it is "fully autonomous"). To reduce the risk:

- Start with few people, less critical contacts.
- Check the chats periodically to see how it is going.
- If you see a wrong message, write a "sorry, did not mean that" yourself.

To reduce the probability that it makes up information it does not know, **escalation to human** is enabled by default (see `12-when-it-calls-you.md`): the AI notifies you outside WhatsApp when a request requires information it does not have (future appointments, personal choices, delicate topics). You reply by hand in those cases.

## Does the bot warn me when it cannot reply?

Yes. When the message asks for information or decisions the bot cannot know or substitute (appointments, loans, delicate topics), instead of making things up it sends a notification outside WhatsApp (Telegram or WhatsApp self-chat). See `12-when-it-calls-you.md` for the detail.

## Can I configure via Telegram?

In v1 no. The Telegram setup is only a notification channel for escalations. In the future it could be extended to receive commands from the Telegram bot (e.g. snooze), but in v1 it is only a direction: bot -> you.

## Does it work with WhatsApp Business?

Probably yes as a linkable account, but it has not been tested and WhatsApp Business has different policies. Use it at your own risk.
