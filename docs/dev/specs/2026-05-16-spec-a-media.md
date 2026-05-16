# Spec A — Non-text media handling

Data: 2026-05-16.
Status: approved (brainstorm 2026-05-16).
Lingua: italiano (prosa) + english (technical terms).

## Scopo

Gestire messaggi WhatsApp non-testuali (immagini, audio, video, sticker, document, location) che oggi vengono ignorati o trattati come testo vuoto dal dispatcher. Modifica scope rispetto a `17-out-of-scope.md` "Detection avanzata sticker/audio/video": ora le immagini passano per pipeline AI multimodale via OpenCode, gli altri tipi forzano un'escalation a umano.

## Policy

Mapping tipo messaggio → azione:

| `msg.type`         | Azione default       | Razionale                                                  |
| ------------------ | -------------------- | ---------------------------------------------------------- |
| `image`            | `vision`             | Modelli vision-capable (gpt-5-mini, gpt-4o, ...) supportano image input. |
| `sticker`          | `skip`               | Tipicamente espressivo, equivalente a emoji.                |
| `audio` / `ptt`    | `escalate`           | STT fuori scope; utente decide se ascoltare e rispondere.   |
| `video`            | `escalate`           | Analisi video fuori scope.                                  |
| `document`         | `escalate`           | PDF/Word/Excel arbitrari; non sicuro auto-rispondere.       |
| `location` / `live_location` | `escalate` | Decisione utente: condividere posizione, dare indicazioni. |
| `vcard`            | `escalate`           | Condivisione contatto, valutazione utente.                  |
| `chat` (text)      | (pipeline esistente) | Invariato.                                                  |

L'utente puo' modificare il mapping via YAML (`media.<type>.strategy: 'vision' | 'escalate' | 'skip'`).

## Architettura

### Dispatcher branch

`src/dispatcher/index.ts` aggiunge classificazione tipo messaggio PRIMA di `applyFilter`:

```
handleIncoming(msg)
  ├── chatId, ctx = build chat context
  ├── if msg.type !== 'chat' OR msg.hasMedia:
  │     ├── policy = resolveMediaPolicy(msg.type)
  │     ├── if policy.strategy == 'skip':
  │     │     └── persist marker in processed_messages, return
  │     ├── if policy.strategy == 'escalate':
  │     │     ├── persist marker + create escalations row directly
  │     │     ├── escalationNotifier.notify(escId)
  │     │     └── return
  │     ├── if policy.strategy == 'vision':
  │     │     ├── if model not in VISION_CAPABLE_MODELS:
  │     │     │     └── fallback to media.visionFallback (default 'escalate')
  │     │     ├── downloadMedia → {mime, base64}
  │     │     ├── attach to chatState as pending media reference (in-memory)
  │     │     └── proceed to state machine accumulate (debounce join with text)
  │     └── (note: if vision, the message proceeds through filter + state machine
  │           identically to text. The orchestrator picks up media at fire time.)
  └── (text path, unchanged) applyFilter → state machine
```

### Nuovo file `src/dispatcher/media-policy.ts`

```typescript
import { config } from '../config/index.js'
import { VISION_CAPABLE_MODELS } from '../config/constants.js'

export type MediaStrategy = 'vision' | 'escalate' | 'skip'
export type MediaType =
  | 'image' | 'sticker' | 'audio' | 'ptt' | 'video'
  | 'document' | 'location' | 'live_location' | 'vcard' | 'chat' | 'unknown'

export function classifyMediaType(rawType: string | undefined): MediaType { ... }

export function resolveMediaPolicy(type: MediaType): { strategy: MediaStrategy; fallback?: MediaStrategy } {
  const cfg = config.media
  const entry = cfg[type] ?? { strategy: 'escalate' }
  if (entry.strategy === 'vision' && !VISION_CAPABLE_MODELS.includes(config.aiModel)) {
    return { strategy: cfg.visionFallback ?? 'escalate' }
  }
  return entry
}
```

### Estensione WhatsApp client

`src/whatsapp/client.ts` espone:

```typescript
downloadMedia(msg: WAMessage): Promise<{ mime: string; base64: string; filename: string | null } | null>
```

Wraps `msg.downloadMedia()` di wweb. Ritorna `null` se download fallisce (media expired, network, etc.). Bytes restano in memoria, mai persistiti su disco né in DB.

### Estensione OpenCode wrapper

`src/ai/opencode.ts` modifica `callOpencodeCli` signature: invece di `prompt: string`, accetta `parts: OpenCodePart[]`:

```typescript
export type OpenCodeTextPart = { type: 'text'; text: string }
export type OpenCodeFilePart = { type: 'file'; mime: string; url: string } // url = "data:image/jpeg;base64,..."
export type OpenCodePart = OpenCodeTextPart | OpenCodeFilePart

export async function callOpencodeCli(
  parts: OpenCodePart[],
  logPrefix: string,
  model: OpencodeAiModel,
  signal?: AbortSignal
): Promise<string | undefined>
```

Backward compat helper `callOpencodeCliText(prompt, ...)` wraps `[{type:'text', text: prompt}]`.

Router `src/ai/router.ts` aggiunge overload `callAiApi(parts: OpenCodePart[], ...)` oltre a string variant.

### Estensione `turn.ts`

`generateTurn(ctx, signal, mediaParts?: OpenCodeFilePart[])`: se `mediaParts` non vuoto, appende a fine `parts` dopo il text prompt. AI vede prompt JSON + image attachment.

### TurnContext extension

`src/types.ts` `TurnContext` aggiunge campo opzionale:

```typescript
interface TurnContext {
  // ...esistenti
  pendingMedia?: Array<{
    mime: string
    type: MediaType
    caption: string                  // body del messaggio (puo' essere vuoto)
    timestampMs: number
  }>
}
```

Il body base64 NON va in TurnContext (troppo grande per JSON serialize). Vive come parametro separato `mediaParts` passato a `generateTurn`.

### Orchestrator

`src/orchestrator/index.ts` e `context.ts`:

- `buildTurnContext` carica il media payload da una nuova in-memory `MediaQueue` (Map<chatId, PendingMedia[]>) popolata dal dispatcher al momento del download.
- Al fire, orchestrator estrae media dalla queue, passa a `generateTurn` come `mediaParts`, e include caption + tipo nel TurnContext per il prompt.
- Dopo il turn (success o failure), la queue viene drenata per quel chatId.

### Vision capability allowlist

`src/config/constants.ts`:

```typescript
export const VISION_CAPABLE_MODELS: readonly string[] = [
  'opencode:github-copilot/gpt-5-mini',
  'opencode:github-copilot/gpt-5',
  'opencode:openai/gpt-4o',
  'opencode:openai/gpt-4o-mini',
  'opencode:anthropic/claude-sonnet-4-6',
  'opencode:anthropic/claude-opus-4-7',
  'opencode:google/gemini-2.5-pro',
  'opencode:google/gemini-2.5-flash',
] as const
```

Boot-time check: se `config.media.image.strategy === 'vision'` e `aiModel` non in allowlist, log `warn` "vision requested but model not capable, falling back to <visionFallback>". Run continua senza crash.

### Escalation diretta (no AI call)

`src/dispatcher/index.ts` per audio/video/etc. usa nuova funzione helper:

```typescript
// src/escalation/from-media.ts
export function escalateMedia(deps, msg, mediaType) {
  const summary = `${labelForType(mediaType)} ricevuto da ${displayName}. Vai a controllare la chat.`
  const escId = insertEscalation({
    chatId, triggerMsgId, reason: 'other', urgency: 'normal',
    summary, holdingReplySent: false, createdAt: now, notifiedChannels: []
  })
  void escalationNotifier.notify(escId)
}
```

Niente holding reply per default su media non-text (l'utente non sa cosa l'AI direbbe). Configurable via `media.<type>.holdingReply: string | null`.

## Config YAML

`config/defaults.ts` aggiunge:

```typescript
media: {
  image: { strategy: 'vision' as MediaStrategy },
  sticker: { strategy: 'skip' as MediaStrategy },
  audio: { strategy: 'escalate' as MediaStrategy },
  ptt: { strategy: 'escalate' as MediaStrategy },
  video: { strategy: 'escalate' as MediaStrategy },
  document: { strategy: 'escalate' as MediaStrategy },
  location: { strategy: 'escalate' as MediaStrategy },
  live_location: { strategy: 'escalate' as MediaStrategy },
  vcard: { strategy: 'escalate' as MediaStrategy },
  visionFallback: 'escalate' as MediaStrategy,
}
```

`src/config/schema.ts` zod block:

```typescript
const MediaStrategySchema = z.enum(['vision', 'escalate', 'skip'])
const MediaPolicySchema = z.object({ strategy: MediaStrategySchema })
media: z.object({
  image: MediaPolicySchema,
  sticker: MediaPolicySchema,
  audio: MediaPolicySchema,
  ptt: MediaPolicySchema,
  video: MediaPolicySchema,
  document: MediaPolicySchema,
  location: MediaPolicySchema,
  live_location: MediaPolicySchema,
  vcard: MediaPolicySchema,
  visionFallback: MediaStrategySchema,
}),
```

`config/user-config.example.yaml` aggiunge blocco commentato.

## Prompt extension

Nuovo file `prompts/turn/07b_media_rules.txt` (caricato in ordine alfabetico tra 07 e 08 da `loadAndCombinePrompts`):

```
=== MEDIA HANDLING ===

You may receive an image attached to a message. When this happens:
- Reply in a natural way about what you see, matching the tone of the conversation.
- The caption (if present) is in `pendingMedia[0].caption`. Use it as additional context.
- Do NOT describe the image clinically ("I see a beach with..."). React naturally as a person would.
- If unsure what to say, set escalate_to_human with reason='other' and a short summary.
- Never reveal you are an AI looking at the image.

If `pendingMedia` is empty or absent, behave as normal text-only turn.
```

## Modifiche ai file

| File                                | Tipo     | Cambiamento                                                  |
| ----------------------------------- | -------- | ------------------------------------------------------------ |
| `src/dispatcher/index.ts`           | modifica | branch media-aware in `handleIncoming`                       |
| `src/dispatcher/media-policy.ts`    | nuovo    | mapping + policy resolver                                    |
| `src/whatsapp/client.ts`            | modifica | espone `downloadMedia`                                       |
| `src/ai/opencode.ts`                | modifica | parts array + multimodal                                     |
| `src/ai/router.ts`                  | modifica | overload con `parts`                                         |
| `src/ai/turn.ts`                    | modifica | accetta `mediaParts` optional                                |
| `src/orchestrator/context.ts`       | modifica | include `pendingMedia` in TurnContext                        |
| `src/orchestrator/index.ts`         | modifica | drena MediaQueue al fire, passa a generateTurn               |
| `src/orchestrator/media-queue.ts`   | nuovo    | Map<chatId, PendingMedia[]> + push/drain                     |
| `src/escalation/from-media.ts`      | nuovo    | helper diretto per escalation media-driven                   |
| `src/types.ts`                      | modifica | aggiunge `MediaType`, `PendingMedia`, estende `TurnContext`  |
| `src/config/constants.ts`           | modifica | aggiunge `VISION_CAPABLE_MODELS`                             |
| `src/config/schema.ts`              | modifica | aggiunge `media` block                                       |
| `config/defaults.ts`                | modifica | aggiunge `media` block                                       |
| `config/user-config.example.yaml`   | modifica | aggiunge sezione commentata                                  |
| `prompts/turn/07b_media_rules.txt`  | nuovo    | regole media per AI                                          |
| `src/scripts/test-e2e.ts`           | modifica | nuovi scenari image-vision / image-escalation / audio-escalate (vedi Spec B) |

## Vincoli e fuori-scope

- **No OCR** sui document. Direttamente escalate.
- **No STT** su audio. Direttamente escalate.
- **No vision su video**. Frame extraction fuori scope.
- **No persistenza media** in DB. Bytes vivono in MediaQueue in-memory finche il turn viene processato, poi dropped.
- **No download retry**: se `downloadMedia` fallisce (es. media expired), log warn + fallback a escalate del messaggio originale.
- **Privacy**: bytes immagine transitano al provider AI. Documentare nel runbook + warning prima del primo run con vision attiva.
- **Group chats**: skip totale invariato. Media in gruppi non considerato.

## Validation criteria

- `tsc --noEmit` clean.
- `npm run test:e2e -- image-vision`: scenario passa con vision stub.
- `npm run test:e2e -- image-escalation-fallback`: con modello non-vision, fallback path attivo.
- `npm run test:e2e -- audio-escalation`: escalation row inserita senza AI call.
- Test live (manuale): inviare immagine + audio da numero whitelistato, verificare reply su image e Telegram notification su audio.

## Migration

Nessuna migration DB richiesta (zero schema change). Solo config additivo + codice.

Utenti esistenti: il default `media.image.strategy = 'vision'` attiva la pipeline al primo restart. Se modello corrente non in allowlist, log warn e fallback a escalate (zero behavior change rispetto a oggi per gli altri tipi). Override esplicito disponibile via YAML.

## Riferimenti

- `docs/dev/03-data-flow.md` Flow A (dispatcher branch)
- `docs/dev/07-ai-integration.md` (OpenCode wrapper estensione)
- `docs/dev/18-escalation.md` (riuso EscalationNotifier)
- `docs/dev/17-out-of-scope.md` (rilassamento "Detection avanzata sticker/audio/video")
