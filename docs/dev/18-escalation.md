# Escalation to human

> Status: design; behavior implemented. `TELEGRAM_USER_CHAT_ID` supports comma-separated for multi-recipient broadcast.

When the bot receives a message requiring information or decisions that the AI cannot know or substitute (future commitments, sensitive decisions, personal choices, authorizations), instead of making up an answer or guessing, it signals the user on an out-of-band channel. The user replies manually from WhatsApp.

This functionality does not contradict the "fully autonomous" design: the bot remains autonomous in 95% of turns, and explicitly admits when it doesn't know in the remaining 5%. Different from an approval flow (where every reply is in human review): here only turns where the AI declares `escalate_to_human` skip the automatic send.

## When to escalate

The AI in the `TurnOutput` produces a non-null `escalate_to_human` when the incoming message falls into one of the categories:

| `reason`     | Trigger example                                                                                                                                            |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scheduling` | "shall we meet at 4pm?", "are you free Tuesday evening?", "are you coming to Saturday's dinner?"                                                            |
| `commitment` | "can you do me this favor?", "can you lend me X?", "can I stop by your place?"                                                                              |
| `sensitive`  | emotionally sensitive topics where a wrong answer can hurt (bereavements, illnesses, recent conflicts documented in KB)                                     |
| `financial`  | money requests, loans, gift contributions, bill splits where the AI doesn't know the user's position                                                        |
| `identity`   | request to discuss a strong personal opinion (politics, faith, life choices) not documented in KB                                                           |
| `other`      | anything else the AI has recognized as "I'd be guessing". AI bar: "if I were to reply, the user might disapprove of the outcome"                            |

General bar: the AI escalates when an autonomous reply would risk committing the user, hurting the person, or exposing opinions that are not in KB.

The AI does NOT escalate for:

- Informational questions covered by KB ("where do you live?" -> KB).
- Pleasantries ("how are you?", "hi!").
- Continuations of already-established threads (the user has already replied on this in previous messages).
- Non-textual messages (stickers, single emojis) -> stays `skip` as before.

## `escalate_to_human` schema

Added to `TurnOutput` (see `07-ai-integration.md` for the complete schema):

```ts
escalate_to_human: z.object({
  reason: z.enum(['scheduling', 'commitment', 'sensitive', 'financial', 'identity', 'other']),
  urgency: z.enum(['low', 'normal', 'high']),
  summary: z.string().min(1).max(500), // 1-3 sentences: what they're asking, why I can't reply
  suggested_holding_reply: z.string().nullable(), // null = don't reply, string = stall ("I'll let you know")
}).nullable()
```

Notes:

- `urgency: 'high'` -> immediate notification, no accumulation.
- `urgency: 'normal'` -> notify immediately, but acceptable if the user sees it after a few minutes.
- `urgency: 'low'` -> notify only in daily digest (in v1 without digest, equivalent to `normal`).
- `suggested_holding_reply` example: "Wait, let me check, I'll let you know". If non-null, sent to WhatsApp before notifying. If null, no reply, the user replies from scratch.

## Bot behavior

When `TurnOutput.escalate_to_human` is non-null, in `ReplyOrchestrator.generateAndSend` (see `03-data-flow.md` Flow C):

1. If `suggested_holding_reply` non-null:
   - Send the message as normal `out_bot`.
   - Persist in `processed_messages`.
2. Insert a row in `escalations` (see below) with `status='pending'`.
3. Notify on configured channel (see `Channels` below).
4. DO NOT execute other Flow C actions that depend on reply content (extracted_facts, tone_update, language_update proceed anyway, they are independent).
5. `chat_state -> IDLE`.
6. `turn_log` insert with `status='escalated'` (new enum value).

If `escalate_to_human` is null (normal case), the flow stays unchanged.

## `escalations` table

```ts
export const escalations = sqliteTable(
  'escalations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: text('chat_id').notNull(),
    triggerMsgId: text('trigger_msg_id').notNull(), // whatsapp_msg_id that triggered escalation
    reason: text('reason').notNull(), // scheduling | commitment | ...
    urgency: text('urgency', { enum: ['low', 'normal', 'high'] }).notNull(),
    summary: text('summary').notNull(),
    holdingReplySent: integer('holding_reply_sent', { mode: 'boolean' }).notNull().default(false),
    status: text('status', { enum: ['pending', 'user_replied', 'superseded', 'dismissed'] })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
    notifiedChannels: text('notified_channels').notNull(), // JSON array: ['whatsapp_self','telegram']
  },
  (t) => ({
    chatStatusIdx: index('idx_esc_chat_status').on(t.chatId, t.status),
    createdIdx: index('idx_esc_created').on(t.createdAt),
  })
)
```

Lifecycle:

- `pending` -> created. Notification sent.
- `user_replied` -> detected `out_manual` for that chat after `createdAt`. Informational marker, user replied.
- `superseded` -> another message arrived from the person after escalation, AI generated a new escalation or autonomous reply. The old one becomes stale.
- `dismissed` -> manual, not implemented in v1 (change row by hand in DB if necessary).

## Notification channels

Configurable through `config.escalation`:

```ts
escalation: {
  enabled: true,
  channels: ['whatsapp_self', 'telegram'] as Array<'whatsapp_self' | 'telegram'>,
  whatsappSelfChatId: 'me',                             // 'me' -> uses own number resolved at runtime
  telegramBotTokenEnv: 'TELEGRAM_BOT_TOKEN',            // ENV var name
  telegramChatIdEnv: 'TELEGRAM_USER_CHAT_ID',           // ENV var name
  rateLimitPerHour: 12,                                 // safety: max 12 aggregated notifications/hour
  highUrgencyBypassRateLimit: true,
}
```

### Channel 1: WhatsApp self-chat

The bot sends a message on its own chat with itself (own number = own number). `whatsapp-web.js` supports:

```ts
const myWid = client.info.wid._serialized // e.g. '391234567@c.us'
await client.sendMessage(myWid, formattedNotification)
```

Pro: zero additional infra, standard WhatsApp push notification.

Con: depends on WhatsApp push notification arriving at the user's phone. Self-chat notifications can be muted by the user by mistake or not appear as visible notification on some WhatsApp versions. Verify at setup (see `15-runbook.md`).

If WhatsApp Web itself is disconnected, the send fails and the escalation stays `pending` until it comes back online. Same fate as the bot: neither works.

### Channel 2: Telegram bot

The bot sends to Telegram via Bot API. Direct HTTPS POST to `https://api.telegram.org/bot<TOKEN>/sendMessage` with JSON body `{ chat_id, text, parse_mode: 'Markdown' }`.

No library required, just `fetch` (Node 20+).

```ts
async function sendTelegram(text: string) {
  const token = process.env[config.escalation.telegramBotTokenEnv]
  const chatId = process.env[config.escalation.telegramChatIdEnv]
  if (!token || !chatId) {
    log.warn('telegram credentials missing, skipping')
    return false
  }
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
  return res.ok
}
```

Pro: independent from WhatsApp Web. Telegram push notifications are reliable.

Con: requires initial bot setup (see `15-runbook.md` section "Telegram setup"). Secret token, to keep in `.env` not committed.

### Multi-channel and fallback

If both channels are active, the bot tries both in parallel. At least one success is considered success (escalation `notified_channels` records which ones worked).

If both fail, the escalation stays `pending` with `notified_channels=[]`. A retry job every 5 minutes attempts to re-notify for pending without notify success. Cap 3 retry, after log error and that's it (the user will see it anyway at next boot if still `pending`).

### Rate limit

`config.escalation.rateLimitPerHour` (default 12) limits the aggregate volume of notifications to avoid spamming the user.

Implementation: query `SELECT COUNT(*) FROM escalations WHERE created_at > now - 3600_000 AND notified_channels != '[]'`. If > limit, aggregate in a single notification "X escalations pending, see log/dashboard".

`highUrgencyBypassRateLimit: true` -> `urgency='high'` does not count in rate limit, always notified individually.

## Notification message format

```
[viet-chatter] {urgency_emoji}{REASON}
From: {display_name or phone}
Summary: {summary}
{holding_reply_indicator}

Go reply on WhatsApp.
```

Examples:

WhatsApp self-chat (no Markdown):

```
[viet-chatter] !! SCHEDULING
From: Hoa (+8412345)
Summary: Hoa is asking if you're free Saturday evening for dinner. I don't have information about your commitments.
Holding reply sent: "I'll let you know"

Go reply on WhatsApp.
```

Telegram (Markdown):

```
*[viet-chatter] SCHEDULING* ⚠️
*From:* Hoa (+8412345)
*Summary:* Hoa is asking if you're free Saturday evening for dinner. I don't have information about your commitments.
*Holding reply sent:* "I'll let you know"

Go reply on WhatsApp.
```

`urgency_emoji` -> `low` = no emoji, `normal` = `!`, `high` = `!!`. No emoji on WhatsApp self-chat (project style constraint: no emojis), on Telegram optional. (Decision: no emoji anywhere for consistency with project style. The emojis above are only in the Telegram example as illustration, to be removed if the "no emoji" rule is kept for Telegram too.)

## Dedup and evolution

### Case: incoming message triggers escalation, pending escalation already exists for the same chat

Behavior: do NOT create a new escalation. Update the `summary` of the existing pending one with the new message, and re-notify only if urgency rises (e.g. from `normal` to `high`).

Implementation:

```ts
const existing = await repo.pendingEscalation(chatId)
if (existing) {
  await repo.updateEscalationSummary(existing.id, newSummary)
  if (newUrgency > existing.urgency) {
    await renotify(existing.id, channels)
  }
  return
}
// else create new
```

### Case: user replies manually

`MessageDispatcher` on the `out_manual` event for a chat with `pending` escalation:

```ts
await repo.markEscalationsResolved(chatId, 'user_replied')
```

No "resolved" notification to the user, just DB update.

### Case: bot itself generates an autonomous reply (next turn, AI changes its mind)

Same behavior: the new reply implies the AI now knows enough, the previous escalation becomes stale. Marker `superseded` with `resolvedAt = now`.

## Per-chat configuration (override)

Some chats are OK for escalation, others not. Example: a work chat where the user prefers to always reply themselves -> always escalation. A friendly chat where the user trusts the bot 100% -> never escalation.

In v1, per-chat override NOT implemented. The filter is global: the AI decides turn-by-turn.

Per-chat override is a future enhancement: add `escalation_policy` to `person_profile` with values `'auto' | 'always' | 'never'`. The AI reads the value from `TurnContext` and applies.

## Edge cases and races

### Edge: bot offline at trigger moment

Same fate as the bot: the message stays in WhatsApp, gets processed when back online by `BootReconciler`. If the AI still classifies it as to escalate, the escalation starts with a delay equivalent to the offline window. No special behavior.

### Edge: user replies in the milliseconds between `holding_reply` send and notification

Identical to existing race windows of Flow D (`out_manual` during `SENDING`). Mitigated by the `processed_messages.ts > escalation.createdAt` pattern. Documented as acceptable.

### Edge: AI emits `escalate_to_human` without `summary`

Zod schema requires non-empty `summary`. If missing, validation fail, retry. If it persists, escalation created with `summary = "AI requested escalation without providing details. Go check the chat."` as fallback.

### Edge: AI emits both non-empty `reply` and non-null `escalate_to_human`

Conflict: the AI has generated a reply but also declared escalation. Resolution: `escalate_to_human` takes precedence. The `reply` is discarded (NOT sent), and only `suggested_holding_reply` is sent if present. Logic: if the AI is uncertain enough to escalate, its reply is not reliable.

Document this behavior in the prompts: "if you set escalate_to_human, leave reply empty or use suggested_holding_reply".

## Example configuration

`config/index.ts`:

```ts
escalation: {
  enabled: true,
  channels: ['telegram'] as const,                      // Telegram only, self-chat skip
  whatsappSelfChatId: 'me',
  telegramBotTokenEnv: 'TELEGRAM_BOT_TOKEN',
  telegramChatIdEnv: 'TELEGRAM_USER_CHAT_ID',
  rateLimitPerHour: 12,
  highUrgencyBypassRateLimit: true,
}
```

`.env` (gitignored):

```
TELEGRAM_BOT_TOKEN=123456789:AAA-bbb-ccc-ddd-eee
TELEGRAM_USER_CHAT_ID=987654321
```

To disable temporarily: `escalation.enabled = false`. Hot reload takes effect at the next turn.

## `EscalationNotifier` module

`src/escalation/notifier.ts`:

```ts
export interface EscalationChannel {
  send(payload: EscalationPayload): Promise<boolean>
  name: string
}

export class WhatsAppSelfChannel implements EscalationChannel {
  /* ... */
}
export class TelegramChannel implements EscalationChannel {
  /* ... */
}

export class EscalationNotifier {
  constructor(
    private channels: EscalationChannel[],
    private repo: Repo
  ) {}

  async notify(escId: number): Promise<void> {
    const esc = await this.repo.getEscalation(escId)
    if (!esc) return
    if (await this.checkRateLimit(esc.urgency)) {
      log.warn({ escId }, 'rate limited, deferring')
      return
    }
    const text = this.format(esc)
    const results = await Promise.allSettled(this.channels.map((c) => c.send({ esc, text })))
    const ok = results
      .map((r, i) => (r.status === 'fulfilled' && r.value ? this.channels[i].name : null))
      .filter(Boolean) as string[]
    await this.repo.updateEscalationNotified(escId, ok)
    if (ok.length === 0) log.error({ escId }, 'all channels failed')
  }
}
```

## Logging

New events (see `12-logging-observability.md` for the updated catalog):

| Event                              | Level  | Fields                                     |
| ---------------------------------- | ------ | ------------------------------------------ |
| escalation created                 | `info` | `esc_id`, `chat_id`, `reason`, `urgency`   |
| escalation notified                | `info` | `esc_id`, `channels_ok`, `channels_failed` |
| escalation rate limited            | `warn` | `esc_id`, `aggregated`                     |
| escalation resolved (user_replied) | `info` | `esc_id`, `chat_id`                        |
| escalation superseded              | `info` | `esc_id`, `chat_id`, `reason`              |
| holding reply sent                 | `info` | `esc_id`, `chat_id`                        |

## Health check extension

`npm run health` adds:

```
escalations: {
  pending: 2,
  resolved_24h: 5,
  failed_to_notify_24h: 0,
}
```

Allows to detect on the fly if there are stuck escalations (failed notification, user doesn't see).

## Security

- Telegram token in `.env`, never in `config/index.ts` or committed.
- `.env` must be in `.gitignore` (see `13-project-layout.md`).
- Verify at setup that `.env` is not tracked (`git ls-files .env` must be empty).
- Dedicated Telegram bot for each installation, do not share its token.
- User's Telegram `chat_id`: treat as PII, but not as critical secret (it's an opaque identifier).
- Token rotation: revoke the old one via @BotFather, generate a new one, update `.env`, restart bot.

## Explicit difference: escalation vs approval flow

| Aspect                           | Escalation (this)                                            | Approval flow (out-of-scope)                       |
| -------------------------------- | ------------------------------------------------------------ | -------------------------------------------------- |
| Human control                    | Only turns where the AI declares uncertainty                 | On every reply, always                             |
| Default behavior                 | Bot replies autonomously                                     | Bot never replies without OK                       |
| User latency                     | Bot sends holding reply (e.g. "wait") immediate + notification | Long: waits for user to approve each turn          |
| Relationship with `fully autonomous` | Compatible: the choice to escalate is itself autonomous   | Incompatible: by definition requires review        |
| User experience                  | Person sees reply or stall, user replies when they can       | Person sees nothing until user approves            |

## Complete flow summary

```
1. Hoa: "Are you free Saturday for dinner?"
2. Bot reads message, applies filter -> passes.
3. Debounce 120s, burst closed.
4. Compute fire_at, scheduled.
5. fire_at hit, SENDING.
6. Build TurnContext (history + KB + profile).
7. AI call.
8. AI output:
   {
     reply: "",
     skip: false,
     escalate_to_human: {
       reason: "scheduling",
       urgency: "normal",
       summary: "Hoa is asking if you're free Saturday evening for dinner.",
       suggested_holding_reply: "Wait, let me check, I'll let you know"
     },
     ...
   }
9. Bot:
   a. Send "Wait, let me check, I'll let you know" as out_bot.
   b. Insert escalation in DB.
   c. EscalationNotifier.notify(escId).
   d. Sends Telegram: "[viet-chatter] SCHEDULING - From: Hoa - Summary: ..."
10. User sees Telegram notification, goes to WhatsApp, reads chat with Hoa.
11. User replies manually: "Yes, at 8".
12. Dispatcher detects out_manual.
13. Dispatcher calls repo.markEscalationsResolved(chatId, 'user_replied').
14. Escalation status -> user_replied. resolvedAt = now.
15. No extra message to the user.
```

## Related future enhancements

- `escalation_policy` per chat (`auto` / `always` / `never`).
- Snooze: notification received, "I'll remind you in X minutes if you haven't replied yet".
- Daily digest listing all unresolved escalations with elapsed time.
- Smart aggregation when N escalations arrive in 30 minutes (single notification with list).
- Smart escalation: AI estimates a possible calendar lookup (Google/Apple Calendar via OS) to avoid escalating on scheduling if it has access.
