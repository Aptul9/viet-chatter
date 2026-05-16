# Filter engine

## Modello

Il filtro è una predicate function TypeScript user-defined in `config/index.ts`:

```ts
export const shouldReply = (chat: ChatContext): boolean => {
  return chat.phone.startsWith('+84') && !['+84111111111', '+84222222222'].includes(chat.phone)
}
```

Tipo del parametro:

```ts
export type ChatContext = {
  phone: string // E.164 con +
  name: string | undefined // nome saved-contact
  isSavedContact: boolean
  lastMessageTs: number // unix ms
  unreadCount: number
}
```

## Costruzione del `ChatContext`

`MessageDispatcher` la costruisce per ogni evento `message`:

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

Nota: `whatsapp-web.js` espone i timestamp in secondi, internamente li convertiamo in ms.

## Hot reload

`chokidar` watch su `config/index.ts`. Su event `change`:

1. `import` dinamico con cache busting (`import('./config/index.ts?v=' + Date.now())`).
2. Validazione zod su `config` esportato.
3. Test-run di `shouldReply` con un `ChatContext` dummy per beccare crash sintattici.
4. Se ok, swap atomico delle reference (`currentConfig = newConfig`, `currentShouldReply = newShouldReply`).
5. Log info "config reloaded".
6. Se errore, log error, mantieni la config precedente. Niente downtime.

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

## Vincoli e best practice della predicate function

- **Pura**: no side effects (no I/O, no DB, no network).
- **Veloce**: deve restituire in <1ms tipicamente. È chiamata su ogni messaggio in arrivo.
- **Deterministica**: stessa input -> stesso output sempre (no `Math.random`, no `Date.now()` nella decisione).
- **Type-safe**: TypeScript controlla a edit time. Errori di compilazione bloccano l'hot reload (gestito dal try/catch).

## Pattern utili

```ts
// Solo numeri vietnamiti, escluso blocklist
chat.phone.startsWith('+84') &&
  !['+84a', '+84b']
    .includes(chat.phone)

    [
      // Whitelist esplicita
      ('+84111', '+84222', '+84333')
    ].includes(chat.phone)

// Contatti saved con nome che matcha pattern
chat.isSavedContact &&
  /viet/i.test(chat.name ?? '')(
    // Multi-prefisso con esclusioni
    chat.phone.startsWith('+84') || chat.phone.startsWith('+39')
  ) &&
  !chat.phone.endsWith('00')

// Solo se ha unread (utile in scenari particolari di triage)
chat.unreadCount > 0 && chat.phone.startsWith('+84')
```

## Decisione applicata

`MessageDispatcher`:

```ts
const ctx = await buildChatContext(chat)
const allowed = currentShouldReply(ctx)
if (!allowed) {
  log.debug({ chat_id, phone: ctx.phone, passed_filter: false }, 'msg filtered out')
  return // niente state machine, niente accumulo
}
```

## Cosa NON è incluso nel filtro v1

- Filtro su contenuto messaggio. Il filtro vede solo metadati della chat, non il body. Se serve filtraggio per parole chiave, è una modifica successiva (passare `messageBody` come campo in `ChatContext`).
- Filtro stateful (es. "blocca temporaneamente per 24h"). Se serve, si gestisce con un campo `temporary_block_until` in `person_profile` letto dal predicate.
- Multi-tenant / multi-rule. Una sola predicate per istanza.
