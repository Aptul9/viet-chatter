# What the bot does

It replies to WhatsApp chats on your behalf. Only certain chats, chosen by you. It runs on your computer and uses your number (exactly like when you are in front of the phone yourself).

## Concrete example

You have 30 open chats, but you want the bot to reply only to people with a Vietnamese prefix, excluding 2-3 specific ones. All other chats (relatives, work, groups) stay untouched. You see them and reply by hand as usual.

When a person "on the list" writes to you:

1. The bot reads the message.
2. Waits a bit (so it does not look like a bot replying instantly).
3. Builds a sensible reply, based on what it knows about her.
4. Sends the reply as if it were you.

## What makes it different from an auto-responder

- **Looks human**: waits minutes or hours, not seconds. Mimics your average response time to that person.
- **Does not reply at night**: from 22:00 to 06:00 it stays silent. Replies arrive in the morning.
- **Adapts**: tone, language, and content change based on the person.
- **Remembers**: the next time that person writes to you, the bot remembers what you said last week.
- **Knows when it does not know**: when the person asks something the bot cannot know or decide on your behalf (a future appointment, an important favor, a delicate topic), instead of making things up it notifies you outside WhatsApp and you go reply by hand. See `12-when-it-calls-you.md`.

## What it cannot do

- Does not read stickers, images, audio, video. It only sees that they arrived and decides whether to ignore them or reply briefly.
- Does not make calls or video calls.
- Does not send files or photos.
- Does not handle groups.

## When the bot notices you stepping in

If, while the bot was about to reply, you reply from phone or PC, the bot notices and cancels its reply. It does not send a duplicate.

In rare cases (millisecond overlap), both could go out. Nothing serious, but theoretically possible.
