# Technical documentation

> **Implementation status**: v1 shipped (single-project, YAML config, web UI). Files `01-18` reflect the original design (pre-implementation); current behavior may differ.

## Index

1. [Stack](01-stack.md)
2. [Architecture](02-architecture.md)
3. [Data flow](03-data-flow.md)
4. [Scheduler / state machine](04-scheduler-state-machine.md)
5. [Filter engine](05-filter-engine.md)
6. [KB and RAG](06-kb-and-rag.md)
7. [AI integration](07-ai-integration.md)
8. [Persistence (Drizzle, sqlite-vec)](08-persistence.md)
9. [Boot reconciler](09-boot-reconciler.md)
10. [Manual jobs (date_anchored / revive / re_engage)](10-manual-jobs.md)
11. [Config and hot reload](11-config-and-hot-reload.md)
12. [Logging and observability](12-logging-observability.md)
13. [Project layout](13-project-layout.md)
14. [Postgres portability](14-postgres-portability.md)
15. [Runbook](15-runbook.md)
16. [Escalation to human](18-escalation.md)

## Suggested reading order

- For onboarding: 01 -> 02 -> 03 -> 13.
- For implementation of a specific feature: dedicated file (e.g. scheduler -> 04, KB -> 06).
- For operational debug: 15 (runbook) + 12 (logs).

## Internal conventions

- All paths are relative to the project root (`viet-chatter/`).
- All times in formulas are in UTC ms internally, converted to user timezone only for `nightWindow` and log display.
- All business code flows through the `repo.ts` module (no inline SQL scattered around).
- All vector queries go through `VecStore` (abstract interface), concrete implementation `SqliteVecStore`. Ready for swap to a future `PgvectorStore`.
