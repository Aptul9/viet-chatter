# viet-chatter

Bot WhatsApp che risponde in modo autonomo a un sottoinsieme filtrato di chat 1:1, con timing umano-simile, memoria per persona, tono adattivo, lingua dinamica.

## Stato

v1 in definizione. Documentazione completa, codice non ancora scritto.

## Documentazione

- [Documentazione utente](docs/utente/README.md) per chi vuole capire cosa fa e come si usa.
- [Documentazione tecnica](docs/dev/README.md) per chi mette mano al codice.
- [Spec di design](docs/dev/specs/2026-05-10-viet-chatter-design.md).

## Stack previsto

TypeScript, `whatsapp-web.js`, SQLite + `sqlite-vec`, Drizzle ORM, `@xenova/transformers` (embedding locale), OpenCode come AI backend, pino per logging.

## Licenza

Non specificata.
