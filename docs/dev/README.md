# Documentazione tecnica

> **Implementation status**: v1 shipped (single-project, YAML config, web UI). I file `01-18` riflettono il design originale (pre-implementazione); il comportamento corrente puo' differire. Vedi `19-implementation-notes.md` per i delta shippati e per quello che e' canonico oggi.

## Indice

1. [Stack](01-stack.md)
2. [Architettura](02-architettura.md)
3. [Data flow](03-data-flow.md)
4. [Scheduler / state machine](04-scheduler-state-machine.md)
5. [Filter engine](05-filter-engine.md)
6. [KB e RAG](06-kb-e-rag.md)
7. [AI integration](07-ai-integration.md)
8. [Persistenza (Drizzle, sqlite-vec)](08-persistenza.md)
9. [Boot reconciler](09-boot-reconciler.md)
10. [Manual jobs (date_anchored / revive / re_engage)](10-manual-jobs.md)
11. [Config e hot reload](11-config-e-hot-reload.md)
12. [Logging e observability](12-logging-observability.md)
13. [Progetto layout](13-progetto-layout.md)
14. [Portabilità a Postgres](14-portabilita-postgres.md)
15. [Runbook](15-runbook.md)
16. [Future enhancements](16-future-enhancements.md)
17. [Out of scope](17-out-of-scope.md)
18. [Escalation a umano](18-escalation.md)
19. [Implementation notes (shipped v1)](19-implementation-notes.md)

Spec di design originale: [specs/2026-05-10-viet-chatter-design.md](specs/2026-05-10-viet-chatter-design.md).

## Ordine di lettura suggerito

- Per onboarding: 01 → 02 → 03 → 13 → 19.
- Per implementazione di una feature specifica: file dedicato (es. scheduler → 04, KB → 06), poi verifica delta in 19.
- Per debug operativo: 15 (runbook) + 12 (log) + 19.

## Convenzioni interne

- Tutti i path sono relativi alla root del progetto (`viet-chatter/`).
- Tutti gli orari delle formule sono in UTC ms internamente, convertiti in timezone utente solo per `nightWindow` e display log.
- Tutto il codice business attraversa il modulo `repo.ts` (nessun SQL inline sparso).
- Tutte le query vettoriali passano da `VecStore` (interfaccia astratta), implementazione concreta `SqliteVecStore`. Pronte allo swap a `PgvectorStore` futuro.
