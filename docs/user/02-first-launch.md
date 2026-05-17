# First launch

## What you need

- A computer (Windows, Linux, or Mac) that is always on when you want the bot to reply.
- Internet connection.
- Your phone with WhatsApp installed and working (for the first sync).
- (Optional but recommended) A personal Telegram bot to receive "escalation to human" notifications. See `12-when-it-calls-you.md` for what it is and why it helps, and `dev/15-runbook.md` for the technical setup (5 minutes).

## Procedure

1. Open the terminal in the project folder.
2. Run the start command (`npm run dev` to start bot + web UI together, or `npm start` for the bot only).
3. A QR code appears in the terminal.
4. Open WhatsApp on your phone, go to `Settings > Linked devices > Link a device`.
5. Scan the QR code.
6. The bot connects to your WhatsApp Web session and starts observing messages.

## Configuration (who to handle, timing, language, etc.)

Two equivalent paths to configure the bot:

- **Web UI** (simpler): if you ran `npm run dev`, open `http://localhost:3000`. You find 8 tabs (Scheduler, KB, AI, Logging, Escalation, Filter, Manual jobs, Boot) with tooltips that explain every field. Save -> the bot reloads automatically.
- **By hand**: edit the file `config/user-config.yaml` with a text editor. Inline comments explain every field. Save -> same automatic hot-reload.

Some fields require a bot restart to take effect (marked `RESTART REQUIRED` in both the UI and the YAML): DB path, AI model, WhatsApp session.

## After the first launch

The session is saved locally. Subsequent times you do not need to scan the QR again (unless you manually unlink the device from WhatsApp, or months of inactivity pass).

If you keep the computer on, the bot keeps running. If you turn it off, the bot stops. When you turn it back on and relaunch, the bot:

- Recovers messages that arrived while it was off.
- Decides whether they were in the chats to be handled.
- Schedules the replies as if it had been online from the start (respects the delays, does not blast everything at once).

## What you see while it runs

The terminal stays open and shows basic logs: who wrote, what the bot is doing, any errors. Nothing dramatic: it just helps you know whether it is alive.

Detailed logs are saved in the `logs/` folder so you can figure out what happened later if needed.

## When the computer shuts down

If the PC shuts down (close, reboot, crash), the bot stops replying. People still write, their messages stay in WhatsApp. When you power it back on and relaunch the bot, it finds them and handles them.

No message loss, only delay until it is back online.

## When WhatsApp asks you to reconnect

WhatsApp may unlink devices (happens if you have not used WhatsApp Web for a long time, or for security reasons). In that case, at bot startup the QR code reappears: scan it again and everything resumes.
