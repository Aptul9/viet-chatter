# Status

Folder operativa di tracking dello sviluppo del progetto. v1 shipped 2026-05-16, poi 2026-05-16 sera scope expansion con 5 specs aggiuntivi (A/B/C/D1/D2).

## File

- [board.md](board.md): Kanban Obsidian. Contiene smoke test E2E live ancora da eseguire (#62 / #63 / #NEW1 / #NEW2) + 5 nuovi card per i specs in scope (#SA / #SB / #SC / #SD1 / #SD2). Il resto e' in Done come compact summary.
- [done.md](done.md): log progressivo cronologico. Append-only. Sezioni per giornata, sotto-sezioni per evento. Vedi 2026-05-16 per:
  1. waves 1-10 ship (impl iniziale),
  2. single-project + YAML refactor,
  3. runtime hardening (wweb lid + race),
  4. scope expansion (5 specs).
- [tested.md](tested.md): SUPERSEDED dal board.md, kept come traccia originale dell'input utente.
- ~~parallel.md~~: rimosso, historical only.

## Workflow

V1 base shippata. 4 smoke test live ancora pendenti + 5 specs nuovi in attesa di implementazione.

Per ogni spec in `Not Started`:

1. Implementare seguendo il design doc in `docs/dev/specs/`.
2. Quando completato, sposta da `Not Started` → `Done` e aggiungi entry in `done.md` con esito + decisioni.
3. Eventuali deviazioni dal design vanno annotate in `docs/dev/19-implementation-notes.md`.

Per smoke test live in `In Progress`:

- Esecuzione richiede WhatsApp reale paired + (per #62) Telegram bot configurato.
- Sposta a `Done` con esito quando eseguito. Se fallisce, lascia `In Progress` con annotazione.

Nuove feature future vanno proposte come future enhancement (vedi `docs/dev/16-future-enhancements.md`) e poi tracciate qui se accettate.

## Visualizzazione Kanban

Apri `board.md` con Obsidian. Il plugin Kanban deve essere installato per vedere la vista board (altrimenti vedi solo markdown raw).

Plugin Kanban Obsidian: https://github.com/mgmeyers/obsidian-kanban
