# Data privacy

## Where the data lives

Everything on your computer. No cloud, no third-party services, no automatic backup.

Concretely:

- **WhatsApp messages**: they stay where they already are, in WhatsApp. The bot does not copy them into its own database.
- **People journal (important, secondary, ephemeral)**: in a single `viet-chatter.db` file in the project folder.
- **Job and scheduler state**: same `.db` file.
- **Operation logs**: in the `logs/` subfolder.
- **WhatsApp Web session**: in the `.wwebjs_auth/` subfolder.

## What is NOT saved

- The full text of messages is never duplicated in our database. The bot reads it live from WhatsApp when needed, and that is it.
- No audio transcriptions, no image OCR.
- No external statistical analysis.

## What goes to the AI

When the bot needs to generate a reply, it sends to the AI (handled through the OpenCode module):

- The last 30 chat messages (text).
- That person's journal (the 3 levels).
- Person profile (language, tone note).
- The time context (day, hour).

This is sent to the AI provider you configured behind OpenCode (Claude, Gemini, etc.). AI providers see this content.

**Consequence**: personal data of the people you chat with passes through the chosen AI provider. Pick it consciously. If you want maximum privacy, configure a local model behind OpenCode (Llama, self-hosted Qwen, etc.).

## What does NOT go to the AI

- Phone numbers: they are sent as an opaque identifier, not as metadata "this is Maria's number".
- Body of non-text messages (stickers, photos, audio): sent as a generic placeholder ("[sticker]").

## Encryption of local data

The `.db` file is in cleartext. If you want at-rest encryption, turn on BitLocker (Windows) or FileVault (macOS) or LUKS (Linux) on your disk. The bot does not add an application-level encryption layer.

## Backup

The bot does not perform automatic backups. If the `.db` file corrupts or gets deleted, you lose the people journal and the scheduler state. The WhatsApp session keeps working, but the bot starts "from zero" on the contexts.

If you want backups, copy the `.db` file to a safe place periodically yourself. Manually.

## Multi-machine sync

Not supported. The bot runs on a single machine at a time. If you move the folder to another PC, the journal goes with it (just copy).

Do not link the `.db` file to OneDrive, Dropbox, Syncthing, git: risk of corruption (concurrent access on a live DB).

## Total deletion

To delete everything:

1. Stop the bot.
2. Delete the `viet-chatter/` folder entirely, or the individual files `viet-chatter.db`, `logs/`, `.wwebjs_auth/`.
3. On the phone, go to `WhatsApp > Settings > Linked devices` and remove the bot session.

Everything disappears. No residue to clean up elsewhere.
