# Documentazione viet-chatter

Bot WhatsApp che risponde in modo autonomo a un sottoinsieme filtrato di chat 1:1, con timing umano-simile, memoria per persona, tono adattivo, lingua dinamica.

## Tre rami della documentazione

- `utente/`: documentazione non tecnica. Spiega cosa fa il bot, come usarlo, cosa aspettarsi. Per un lettore non sviluppatore.
- `dev/`: documentazione tecnica. Architettura, schema DB, scheduler, prompt, edge case. Per chi mette mano al codice. I file `01-18` descrivono il design pre-implementazione; il file `19-implementation-notes.md` descrive il comportamento effettivo dopo lo ship di v1.
- `status/`: tracking storico dello sviluppo (board, done log, parallel plan). Implementazione completata, materiale mantenuto per riferimento.

Lo spec di design completo (brainstorm iniziale, ora storico) e' in `dev/specs/2026-05-10-viet-chatter-design.md`.

## Come leggerla

- Per capire cosa fa: parti da `utente/README.md`.
- Per mettere mano al progetto: parti da `dev/README.md`, poi `dev/19-implementation-notes.md` per lo stato corrente.
- Per la storia di come e' stato costruito: `status/README.md`.

## Stato

v1 shipped (2026-05-16). Single Node project con YAML config + web UI. Vedi `dev/19-implementation-notes.md` per il dettaglio di cosa diverge dalla spec originale.
