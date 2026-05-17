# Filter engine

> Status: design; behavior implemented. The TypeScript predicate `shouldReply` shown below is REPLACED in v1 by a declarative `filter:` block in YAML.

## Model

The filter is a user-defined TypeScript predicate function in `config/index.ts`:

```ts
export const shouldReply = (chat: ChatContext): boolean => {
  return chat.phone.startsWith('+84') && !['+84111111111', '+84222222222'].includes(chat.phone)
}
```

Parameter type:

```ts
export type ChatContext = {
  phone: string // E.164 with +
  name: string | undefined // saved-contact name
  isSavedContact: boolean
  lastMessageTs: number // unix ms
  unreadCount: number
}
```

## Construction of `ChatContext`

`MessageDispatcher` builds it for every `message` event:

```ts
async function buildChatContext(chat: WAChat): Promise<ChatContext> {
  const phone = chat.id._serialized.replace('@c.us', '').replace(/^/, '+')
  const contact = await chat.getContact()
  return {
    phone,
    name: contact.name ?? contact.pushname ?? undefined,
    isSavedContact: contact.isMyContact,
    lastMessageTs: chat.lastMessage?.timestamp ? chat.lastMessage.timestamp * 1000 : 0,
    unreadCount: chat.unreadCount,
  }
}
```

Note: `whatsapp-web.js` exposes timestamps in seconds, we convert them to ms internally.

## Hot reload

`chokidar` watch on `config/index.ts`. On `change` event:

1. Dynamic `import` with cache busting (`import('./config/index.ts?v=' + Date.now())`).
2. Zod validation on exported `config`.
3. Test-run of `shouldReply` with a dummy `ChatContext` to catch syntactic crashes.
4. If ok, atomic swap of references (`currentConfig = newConfig`, `currentShouldReply = newShouldReply`).
5. Log info "config reloaded".
6. If error, log error, keep the previous config. No downtime.

```ts
// src/config/index.ts (loader)
let currentConfig: Config = await loadInitial()
let currentShouldReply: (c: ChatContext) => boolean = (await import('../../config/index.ts'))
  .shouldReply

chokidar.watch('config/index.ts').on('change', async () => {
  try {
    const fresh = await import('../../config/index.ts?v=' + Date.now())
    Schema.parse(fresh.config)
    fresh.shouldReply({
      phone: '+0',
      name: undefined,
      isSavedContact: false,
      lastMessageTs: 0,
      unreadCount: 0,
    })
    currentConfig = fresh.config
    currentShouldReply = fresh.shouldReply
    log.info('config reloaded')
  } catch (e) {
    log.error({ err: e }, 'config reload failed, keeping previous')
  }
})
```

## Constraints and best practices for the predicate function

- **Pure**: no side effects (no I/O, no DB, no network).
- **Fast**: must typically return in <1ms. Called on every incoming message.
- **Deterministic**: same input -> same output always (no `Math.random`, no `Date.now()` in the decision).
- **Type-safe**: TypeScript checks at edit time. Compilation errors block the hot reload (handled by the try/catch).

## Useful patterns

```ts
// Only Vietnamese numbers, excluding blocklist
chat.phone.startsWith('+84') &&
  !['+84a', '+84b']
    .includes(chat.phone)

    [
      // Explicit whitelist
      ('+84111', '+84222', '+84333')
    ].includes(chat.phone)

// Saved contacts with name matching pattern
chat.isSavedContact &&
  /viet/i.test(chat.name ?? '')(
    // Multi-prefix with exclusions
    chat.phone.startsWith('+84') || chat.phone.startsWith('+39')
  ) &&
  !chat.phone.endsWith('00')

// Only if has unread (useful in particular triage scenarios)
chat.unreadCount > 0 && chat.phone.startsWith('+84')
```

## Applied decision

`MessageDispatcher`:

```ts
const ctx = await buildChatContext(chat)
const allowed = currentShouldReply(ctx)
if (!allowed) {
  log.debug({ chat_id, phone: ctx.phone, passed_filter: false }, 'msg filtered out')
  return // no state machine, no accumulation
}
```

## What is NOT included in the v1 filter

- Filter on message content. The filter only sees chat metadata, not the body. If keyword filtering is needed, it's a follow-up change (pass `messageBody` as a field in `ChatContext`).
- Stateful filter (e.g. "temporarily block for 24h"). If needed, handle it with a `temporary_block_until` field in `person_profile` read by the predicate.
- Multi-tenant / multi-rule. One predicate per instance.
