# viet-chatter end-to-end test harness

Two-account real-WhatsApp test setup. The bot under test runs from `src/`, a
second WhatsApp account (the "driver") lives in `e2e/driver/`, and a separate
read-only validator in `e2e/validator/` checks the bot's DB and log after
each scenario.

This harness covers wweb quirks (real media downloads, lid resolution,
reconnect) that the in-process mock harness (`src/scripts/test-e2e.ts`,
B-side, owned by the parent session) can't exercise.

## Requirements

- Two physical phones, each with WhatsApp installed and registered to a
  distinct number. The "bot phone" pairs the main `src/` client; the
  "driver phone" pairs `e2e/driver/`.
- Node >=20, npm, Chromium dependencies (puppeteer downloads its own).
- Project root deps installed (`npm install`).
- Sub-package deps installed: `cd e2e/driver && npm install` and
  `cd e2e/validator && npm install`.

## One-time setup

1. **Bot phone (main client)**: run `npm start` from project root. Scan the
   QR code printed in the terminal with the bot phone. Wait for
   `whatsapp ready`. Note the bot's E.164 number (used as `BOT_TARGET_NUMBER`
   below). Stop with Ctrl-C once paired; the session persists in
   `./.wwebjs_auth/`.

2. **Driver phone (second account)**: from `e2e/driver/`, run
   `npm run pair`. Scan the QR with the driver phone. The session persists
   in `e2e/driver/.wwebjs_auth/`. This folder is git-ignored.

3. **Save the bot phone in the driver phone's contacts.** Some scenarios
   work without it, but `filter.savedContactsOnly` future tests will need it.

4. **Set environment**: export `BOT_TARGET_NUMBER` to the bot's E.164 number,
   digits only (e.g. `393334445566`, no `+`).

## Running a scenario

From the project root:

```bash
BOT_TARGET_NUMBER=393334445566 npx tsx e2e/run.ts <scenario> [--ai stub|real] [--keep]
```

`run.ts` will:

1. Back up `config/user-config.yaml` to `config/user-config.yaml.backup`
   (if it exists) and swap in `e2e/config/e2e-config.yaml` (short timers,
   permissive filter).
2. Spawn the bot with env `BOT_E2E_MODE=1`, `BOT_E2E_LOG_PATH=./e2e/logs/<scenario>.log`,
   `BOT_E2E_DB_PATH=./e2e/db/<scenario>.db`, and `BOT_E2E_STUB_AI=1` if
   `--ai stub`.
3. Tail the bot log until both `whatsapp ready` and `boot done` appear
   (90s timeout).
4. Run the driver scenario from `e2e/driver/`, which sends one or more
   real WhatsApp messages to `BOT_TARGET_NUMBER`.
5. Poll the validator (`e2e/validator/`) every ~3s until it passes or 60s
   elapses.
6. Print PASS/FAIL and, on FAIL, tail the last 50 log lines.
7. Send SIGTERM to the bot (SIGKILL after 10s if needed) and restore the
   original `user-config.yaml`. With `--keep`, leaves config + DB + log in
   place for debugging.

## Available scenarios

| Scenario                    | Driver action                                | Validator expects                                             |
| --------------------------- | -------------------------------------------- | ------------------------------------------------------------- |
| `send-text`                 | single text message                          | `basic-reply`: >=1 `out_bot`, last `turn_log.status=sent`     |
| `send-image`                | image with caption                           | `image-vision`: bot replied, log has `AI call (multimodal)`   |
| `send-image` (no-vision AI) | image with caption, model not vision-capable | `image-escalation-fallback`: 1 pending escalation, no reply   |
| `send-audio`                | voice clip (ptt)                             | `audio-escalation`: 0 replies, escalation summary has "audio" |
| `send-document`             | PDF                                          | manual: escalation row created                                |
| `send-location`             | static GPS pin                               | manual: escalation row created                                |
| `burst-text`                | 5 text messages, 500ms apart                 | `basic-reply` (only 1 turn fires, debounce coalesces)         |
| `reconnect`                 | manual: see check source                     | `reconnect`: placeholder                                      |

Note: scenario name and validator check name are independent. The
orchestrator reuses the scenario name for both files; if you want a
different mapping, run the driver and validator commands directly:

```bash
cd e2e/driver && npm run scenario -- send-image --to 393334445566
cd e2e/validator && npm run check -- image-escalation-fallback --db ./e2e/db/send-image.db --logs ./e2e/logs/send-image.log
```

## Limits

- Max 1 scenario every 30s, max ~50 messages/hour against any single
  recipient: WhatsApp will ban the driver account otherwise.
- Two Chromium processes (~500MB each) run in parallel. Headless but not
  free.
- Real-AI mode (`--ai real`) consumes opencode / API quota. Default is
  `stub` for that reason.
- No CI: WhatsApp ToS blocks unattended cloud runners. Local-only.

## Fixtures

Place test media in `e2e/fixtures/`. Default scenario file paths:

- `e2e/fixtures/cat.jpg` (`send-image`)
- `e2e/fixtures/voice.ogg` (`send-audio`)
- `e2e/fixtures/doc.pdf` (`send-document`)

Use `--file <abs-path>` from the driver CLI to override.

## Troubleshooting

- **`bot not ready after 90000ms`**: check `e2e/logs/<scenario>.log` for QR
  pairing requests or `auth_failure`. The bot's `./.wwebjs_auth/` may be
  stale. Re-pair the bot phone.
- **`driver failed`**: usually `e2e/driver/.wwebjs_auth/` is missing or
  corrupt. Re-run `npm run pair`.
- **`validator failed: no such file`**: scenario name typo or bot crashed
  before opening the DB. Inspect the log tail printed on failure.
