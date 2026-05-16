# Status

Folder operativa per tracking dello sviluppo del progetto.

## File

- [board.md](board.md): Kanban Obsidian (4 colonne: Not Started, In Progress, Done, Paused). 65 task granulari per implementazione v1, ognuno collegato ai file dev rilevanti e con marker della wave di parallelizzazione.
- [done.md](done.md): log progressivo cronologico. Per ogni task chiuso o evento significativo: cosa fatto, problemi incontrati, decisioni, follow-up. Append-only.
- [parallel.md](parallel.md): dependency DAG dei task + wave plan per spawnare subagent paralleli. Cluster di task per esecuzione efficiente. Stima totale wall-clock.

## Workflow

1. **Leggi** `parallel.md` per identificare la wave corrente.
2. **Sposta** i task della wave da Not Started a In Progress in `board.md` (Obsidian Kanban).
3. **Spawn** N subagent (oppure cluster di task come definito in `parallel.md`).
4. **Quando un task finisce**: sposta la card in Done + aggiungi entry in `done.md`.
5. **Se un task si blocca**: sposta in Paused + documenta motivo in `done.md`.

## Visualizzazione Kanban

Apri `board.md` con Obsidian. Il plugin Kanban deve essere installato per vedere la vista board (altrimenti vedi solo markdown raw).

Plugin Kanban Obsidian: https://github.com/mgmeyers/obsidian-kanban

## Quando aggiornare

- `board.md`: ogni volta che un task cambia stato.
- `done.md`: dopo ogni task chiuso (anche piccolo) e ogni decisione/problema notable.
- `parallel.md`: solo se la struttura delle dependency cambia (es. nuova feature aggiunta, riorganizzazione waves).
