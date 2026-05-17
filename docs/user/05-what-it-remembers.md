# What it remembers

The bot keeps a small "journal" for every person it talks to. It does not save messages, it saves the facts that help it reply better next time.

## The three memory levels

### Important

Big things, that stay. Events that change how you relate to that person:

- "Her father is sick with cancer."
- "She separated from Marco in March."
- "Her dog died."
- "She got an important promotion."
- "Birthday: February 22."

These facts always stay. They do not expire. They are used every time to give context to the reply.

### Secondary

Interesting but not critical details:

- "Works as a graphic designer in Hanoi."
- "Has a dog named Pluto."
- "Likes sushi."
- "Inter fan."

They grow over time, can be many. The bot picks those relevant to the moment, does not use all of them together.

### Ephemeral

Temporary, passing things. They expire after 7 days.

- "Thursday she is getting her nails done."
- "Tonight dinner with her sister."
- "This week she is stressed by work."
- "Tomorrow she leaves for Da Nang."

After a week they disappear automatically. Logic: after 7 days that plan has already passed, no point remembering it anymore.

## How the journal fills up

Automatically. After every reply the bot sends, the AI reads the conversation and decides whether there are new facts to remember. It places them in the right level on its own.

No need to write anything by hand.

## Can I see the journal?

The data lives in a single file on the computer (a database). There is no UI to consult it comfortably yet. A small read-only web page to view it is planned for the future.

## Can I correct or delete a fact?

There is no dedicated tool. The intended path is to write it in the conversation itself (e.g. "actually my father is fine, I told you something else") and the AI should correct the old fact by replacing it with the new one.

In edge cases (serious error, delicate fact the bot must not use), intervene by hand on the database. Not the normal path.

## Are they used every time?

- Important and ephemeral: always, every reply.
- Secondary: only those relevant to the incoming message. Example: if she writes about food, the bot pulls out "likes sushi" and ignores "Inter fan".

## Privacy

Everything stays on your computer. No cloud, no automatic backup, no external service knows these facts. See `09-data-privacy.md`.
