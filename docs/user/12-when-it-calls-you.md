# When the bot calls you

In some situations, the bot realizes on its own that it cannot reply on your behalf. In these cases it does not make things up, and warns you outside WhatsApp that there is something to handle by hand.

## When it happens

The AI calls you (i.e. sends a notification) when the incoming message requires information or decisions it cannot know. Typical examples:

- **Appointments**: "See you Saturday at 19?". The bot does not know whether you are free on Saturday. It does not want to say yes incorrectly, nor say no when you are actually free. It warns you.
- **Commitments**: "Can you lend me 50 euros?", "Can I drop by tonight?". A decision that concerns you, not the bot.
- **Delicate topics**: the person writes you about a recent loss, a breakup, heavy news. The bot does not want to risk replying badly. It warns you so you reply in person.
- **Money and serious matters**: financial requests, binding agreements.
- **Strong personal opinions**: politics, faith, life choices on which the bot has not tracked your positions.

## What concretely happens

1. The person writes you something "delicate" (example: "Are you free Sunday?").
2. The bot tries to generate the reply. The AI understands it does not know.
3. The bot does two things:
   - **Sends a "bridge" message** to the person, like "Wait, let me check, I'll get back to you". To avoid leaving them in silence.
   - **Notifies you** on the channel you configured (Telegram or WhatsApp with yourself).
4. You see the notification. Open WhatsApp, read the chat, reply by hand as you would normally.
5. The bot sees you replied and marks the thing as resolved.

## Concrete example

**On WhatsApp (Hoa writes to you)**:

```
Hoa: Are you free Saturday evening for dinner?
[bot after a while, sends on its own]
You: Wait, let me check, I'll get back to you
```

**On Telegram (notification on the fly)**:

```
[viet-chatter] SCHEDULING
From: Hoa (+8412345)
Summary: Hoa asks you if you are free Saturday evening for dinner. I have no info on your commitments.
Holding reply sent: "Wait, let me check, I'll get back to you"

Go reply on WhatsApp.
```

You open Telegram, see the message, get it, go to WhatsApp and reply by hand "Yes 20 is fine".

## Available channels

You can choose one or both:

### Telegram

One-time setup: create a personal Telegram bot (free, via @BotFather), copy the token, put it in the bot's `.env` file. Write to your Telegram bot to retrieve your `chat_id` and put it in the same `.env`.

Multi-recipient supported: `TELEGRAM_USER_CHAT_ID` accepts multiple chat ids separated by commas (e.g. `123456,789012`). The bot sends to all of them in parallel. Useful if you want notifications on multiple devices or on different Telegram bots.

Pro: reliable notifications, separated from WhatsApp. If WhatsApp Web stops working, Telegram keeps going.

Con: 5 minutes of initial setup.

### WhatsApp self-chat (chat with yourself)

The bot writes to your personal chat ("Yourself"/"You" in WhatsApp). Zero setup.

Pro: nothing to configure.

Con: WhatsApp notifications on the chat with yourself may not be visible as a push notification on all phones and WhatsApp versions. Before first use, send yourself a message from the computer and verify the phone shows the notification like it does for other chats. If you do not see it, better use Telegram.

### Both

If you want safety, configure both. The bot sends on both channels in parallel. A notification arrives.

## How urgent

The AI picks the urgency level (`low`, `normal`, `high`) and indicates it to you in the notification:

- **Normal** (default): notification on the fly, you handle it within the next minutes/hours.
- **High**: things like "I'm coming over in 10 min, can you open the door?". The bot warns you immediately with no delay.
- **Low**: less urgent things. In v1 it works as Normal. In the future they will flow into a daily summary.

## You do not go reply

If you ignore the notification and never reply to Hoa, the bot will not insist. Hoa has seen the "I'll get back to you" and will probably write to you again. At that point the bot will see the new message and if it still does not know, it re-notifies you (but avoids duplicating if the request is the same).

## You can disable it

Yes. Three equivalent paths:

- Web UI: `npm run dev` -> `http://localhost:3000`, Escalation tab, toggle "Enabled" off, Save.
- By hand in `config/user-config.yaml`:
  ```yaml
  escalation:
    enabled: false
  ```

Automatic hot-reload, from the next turn the bot resumes generating autonomous replies even on delicate cases. Not recommended: the bot will invent appointments you do not have. Better to keep it on.

## Can I configure per specific chat

In v1 no. The filter is global: the AI decides turn by turn whether to escalate.

In the future the option to force "always escalate" or "never escalate" per specific person is planned.

## What the bot does NOT do

- Does not actually call you on the phone. "Call" here is a figure of speech: it notifies you.
- Does not send email.
- Does not write to your calendar.
- Does not post on Slack or Teams or anything else.

Only Telegram and/or WhatsApp self-chat. Nothing more sophisticated in v1.

## Privacy

The notification message includes:

- Name or number of the person who wrote you.
- A one-line summary of why they are asking (generated by the AI).
- The "bridge" message sent (if sent).

It does not include the full body of the original message. But the summary is itself sensitive: if Hoa wrote you about a loss, the summary says so.

Telegram and WhatsApp self-chat are both on external providers (Telegram = Telegram servers; WhatsApp self-chat = WhatsApp servers). Keep this in mind. If you want maximum privacy on the notification channel, a self-host option exists with `ntfy.sh` or `Gotify`, but it is not in v1.

## When it does NOT call you

The AI is instructed to be conservative when calling you, to avoid spam:

- Pleasantries ("how are you?", "hi!"): replies on its own.
- Informational questions covered by the journal ("where do you live?", "what do you do for work?"): replies on its own.
- Thread continuations where you already clarified your position in previous messages: replies on its own.
- Stickers, single emojis, audio, images: same behavior as before (silence or short reply, see `08-when-it-does-not-reply.md`).

## Volume limit

To avoid spamming you, there is a cap of 12 notifications per hour by default (configurable). Beyond the cap, additional escalations are aggregated into a single notification "X things to handle, check". `high` urgency skips the cap.

## Behavior summary

- Bot received "delicate" message -> sends holding reply -> notifies you.
- You see notification -> open WhatsApp -> reply -> bot marks as resolved.
- You do not see notification -> person will rewrite later -> bot re-notifies if still delicate.
- Bot offline at the moment of the message -> on coming back online, processes normally, escalation fires then.
