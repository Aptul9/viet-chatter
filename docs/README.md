# Documentazione viet-chatter

Bot WhatsApp che risponde in modo autonomo a un sottoinsieme filtrato di chat 1:1, con timing umano-simile, memoria per persona, tono adattivo, lingua dinamica.

## Tre rami della documentazione

- `utente/`: documentazione non tecnica. Spiega cosa fa il bot, come usarlo, cosa aspettarsi. Pensata per un lettore non sviluppatore.
- `dev/`: documentazione tecnica. Architettura, schema DB, scheduler, prompt, edge case. Per chi mette mano al codice.
- `status/`: tracking operativo dello sviluppo. Kanban board (Obsidian), done log, plan di parallelizzazione subagent.

Lo spec di design completo (frutto del brainstorming iniziale) si trova in `dev/specs/`.

## Come leggerla

- Se vuoi capire cosa fa: parti da `utente/README.md`.
- Se vuoi mettere mano al progetto: parti da `dev/README.md`.
- Se vuoi vedere lo stato dello sviluppo (cosa fatto, cosa in corso): parti da `status/README.md`.

## Stato

v1, in definizione. Nessun codice scritto ancora. La documentazione precede l'implementazione.

Il tracking implementativo (kanban + done log + parallel plan) vive in `status/`.
