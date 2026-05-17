# When it does NOT reply

List of situations in which the bot, on purpose, sends nothing.

## Normal cases

### You replied first

If you reply manually to a message (from phone or from another PC's WhatsApp Web) before the bot has sent its reply, the bot cancels. The human action always wins.

### Person not on the list

If the number does not pass the filter rule you configured, the bot ignores the chat completely. You see the message on the phone as usual, and you handle it.

### Group chats

Always ignored, regardless of the rule.

### Night (22:00 - 06:00)

In this interval the bot sends nothing. Received messages are accumulated and handled from the morning.

### Non-text message

If the person sends only a sticker, a photo, an audio, a video, a file: the bot sees a placeholder arrive ("[sticker]" or similar). The AI can still decide to reply briefly (e.g. to a heart with a heart), or to stay silent. The decision is the AI's based on the context.

### The AI decides "skip"

In every turn, the AI can decide that there is no reason to reply. Examples:

- She sent only a conversation-closing emoji.
- The message does not require a reply (e.g. "ok thanks").
- The content is ambiguous and a forced reply would look strange.

In these cases nothing fires. The bot stays waiting for the next message.

### The AI decides "escalation to human"

The bot understands that the message requires information or decisions it cannot know/substitute (future appointments, favors, delicate topics). In this case it does not send an automatic reply and notifies you on Telegram (or WhatsApp self-chat).

Typical examples: "see you Saturday?", "can you lend me X?", emotionally delicate topics.

The bot can send a brief "I'll get back to you" to the person to avoid leaving them in silence, but then it is up to you to reply by hand.

See `12-when-it-calls-you.md` for the detail.

### Technical error

If the AI fails to generate a valid reply (network error, unparseable output, retries exhausted), the bot sends nothing rather than sending something wrong. The error goes in the logs for analysis.

### Bot offline

If the computer is off, the bot is not running and does not reply. When it comes back online, it recovers messages and handles them with the normal delays.

## Edge cases

### Race "you reply in the exact millisecond"

If you send a message at the exact instant the bot was about to send its own, both can go out. Very low probability but not zero. If it happens, you see two messages (yours and the bot's).

### Messages accumulated during sending

If during the 3-10 seconds in which the bot is generating the reply, the person sends other messages: the current reply goes out anyway (based on the messages present at the moment of starting). The newly arrived messages will be handled in the next turn (a new accumulation starts).

### Re-engage / revive / wishes pending

If the bot had scheduled an automatic message (wishes, revive, re-engage) and in the meantime a message arrives from the person or you reply: the pending job is cancelled. No duplicate message.

## What to do if you see the bot replying when you did NOT want it to

Add that person to the blacklist in the filter rules: either via the web UI (`npm run dev` -> `http://localhost:3000`, Filter tab, "Blocked numbers" field), or by hand editing `config/user-config.yaml` (`filter.blockedNumbers` block). From that moment the bot ignores them (automatic hot-reload).
