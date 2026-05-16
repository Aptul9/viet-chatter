# Status

Folder operativa di tracking dello sviluppo del progetto. v1 shipped 2026-05-16: la maggior parte del contenuto qui dentro e' ormai storico, mantenuto come riferimento di come e' stato costruito il progetto.

## File

- [board.md](board.md): Kanban Obsidian. Contiene 4 smoke test E2E ancora in `In Progress` (#61 verificato manualmente, #62 / #63 / #64 da eseguire live). Tutto il resto e' in `Done` come compact summary.
- [done.md](done.md): log progressivo cronologico. Append-only. Sezioni per giornata, sotto-sezioni per evento. Vedi 2026-05-16 per le tre wave principali (waves 1-10 ship, single-project + YAML refactor, runtime hardening).
- [parallel.md](parallel.md): dependency DAG storico + wave plan. Historical, kept for reference.

## Workflow

Implementazione completata, kanban quasi tutta in `Done`. Resta solo da eseguire manualmente i 3 smoke test live ancora pendenti (#62 / #63 / #64). Per il futuro:

- Quando si esegue uno smoke test, sposta la card da In Progress a Done e aggiungi entry in `done.md` con esito.
- Nuove feature richieste in futuro vanno proposte come future enhancement (vedi `docs/dev/16-future-enhancements.md`) e poi tracciate qui se accettate.

## Visualizzazione Kanban

Apri `board.md` con Obsidian. Il plugin Kanban deve essere installato per vedere la vista board (altrimenti vedi solo markdown raw).

Plugin Kanban Obsidian: https://github.com/mgmeyers/obsidian-kanban
