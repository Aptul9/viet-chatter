# Tone and language

The bot adapts how it speaks to whoever it is facing.

## Tone

For every person, the bot keeps a "tone note" that describes how it positions itself with her.

Examples:

- "Casual, ironic, frequent jokes."
- "Affectionate and attentive, she is going through a hard time because of her father."
- "Direct, work conversation, no fluff."
- "Light flirt, evening chats."

This note is updated automatically by the AI as the conversation moves forward. If something important changes (bereavements, hard times, phases of enthusiasm), the tone adapts.

It does not have to be written by hand. There is no menu of "preset personalities": the tone arises from the conversation itself.

## Language

For every person, the bot keeps a list of allowed languages. Examples:

- `[en]`: English only.
- `[vi]`: Vietnamese only.
- `[en, vi]`: uses whichever seems right based on the person's most recent messages.

The AI picks the "right" language for each specific turn. If the person writes to you in Vietnamese, it replies in Vietnamese. If she switches to English, it switches to English. All natural.

### "Translation illusion" case

For people with little English you configure `[vi]`. The bot always replies in Vietnamese. She thinks you speak Vietnamese or are using a translator. The conversation flows smoothly.

### Language change suggested by the AI

If the AI notices that a person consistently starts using a language different from the configured one (e.g. configured `[en]` but she writes only in Vietnamese for 5 messages), it updates the language list itself by including the other one. You do not have to do anything.

## Sentiment (mood of the incoming message)

The bot takes the message mood into account when choosing the tone of the reply. Without making a science of it: it reads the conversation, figures out whether the person is angry, sad, happy, joking, and replies accordingly.

There are no explicit labels stored for every message (this is planned as a future feature). Sentiment is "felt" on the fly by the AI at every reply.

## Tone memory over time

When you start talking to a new person, the tone starts neutral. After a few exchanges, the bot already has an initial tone note. After weeks, the note is precise and personalized.

If the conversation drastically changes direction (argument, reconciliation, dramatic moment), the tone note adapts.
