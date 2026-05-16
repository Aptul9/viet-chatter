---
created: 2026-05-16
updated: 2026-05-16T12:29:00+02:00
tags: [project/viet-chatter, status]
---

# Done log

Append-only log delle cose fatte durante lo sviluppo. Una entry per task chiuso (allineata al numero della card su `board.md`) o per evento significativo. Top = piu' recente.

Convenzioni:

- Header per giornata: `## YYYY-MM-DD`.
- Sotto-sezione per evento: `### **#NN** titolo card` (oppure `### Evento: ...` se non legato a una card).
- Body: cosa fatto, problemi incontrati, decisioni prese, link a commit / PR / file rilevanti.
- Linea finale "outcome": `- outcome: <one-line>` se utile.

## Sezioni standard per task

Quando si chiude un task, scrivi:

- **Cosa fatto**: 1-3 frasi su cosa il task ha prodotto.
- **Problemi incontrati**: bug, surprise, deprecation, edge case (con link a issue / commit di fix).
- **Decisioni**: scelte fatte non ovvie dalla docs (con motivazione breve).
- **Tempo**: stima vs reale (se interessante per learning).
- **Follow-up**: task creati come conseguenza, oppure quirks da documentare in dev docs.

## Convenzioni problematiche

Per problemi NON banali che impattano la docs o il design futuro:

- Apri o aggiorna `## Quirks` nel relativo file `docs/dev/*.md`.
- Se il problema modifica una decisione, aggiorna anche `docs/dev/specs/2026-05-10-viet-chatter-design.md` (sezione 15).
- Se la decisione e' nuova/grossa, crea decision note nel vault Obsidian (`02_Areas/Decisions/`).

---

## 2026-05-16

### Evento: feature escalation a umano aggiunta al design v1

- Cosa fatto: aggiunta feature "Escalation a umano" alla docs pre-implementazione. Nuovi `docs/dev/18-escalation.md` + `docs/utente/12-quando-ti-chiama.md`. Esteso TurnOutput zod schema con `escalate_to_human`, nuova tabella `escalations`, modulo `EscalationNotifier` con canali WhatsApp self-chat + Telegram, config `escalation.*`, `.env` con TELEGRAM_BOT_TOKEN + TELEGRAM_USER_CHAT_ID, prompt `06_escalation_rules.txt`, runbook setup Telegram + troubleshoot, future enhancements #9-11 (policy per chat, snooze, aggregation).
- Decisioni:
  - Escalation = feature v1, non future. Rischio: senza, l'AI inventa appuntamenti che l'utente non puo' mantenere.
  - Compatibile con design fully-autonomous: l'AI sceglie autonomamente quando escalare. Approval flow puro resta out-of-scope.
  - Canali v1: WhatsApp self-chat e/o Telegram bot, configurabili insieme. Telegram via HTTPS POST diretto (no libreria), Node 20 fetch. Token in `.env` gitignored.
- Commit: `3e8dc1b` su `main`.

### Evento: docs/status/ creato

- Cosa fatto: creata folder `docs/status/` con `board.md` (kanban Obsidian, 4 colonne, 65 task), `done.md` (questo file), `parallel.md` (dependency DAG + wave plan per spawn subagent paralleli), `README.md` (indice).
- Decisioni:
  - Granularita' granulare (65 task) preferita a macro (15 task) per migliore parallelizzazione subagent.
  - Italiano per tutta la prosa, technical terms in inglese (allineato repo).
  - 4 colonne: Not Started / In Progress / Done / Paused. Niente "Blocked" separato: se un task e' bloccato, va in Paused con motivo nel done.md.
  - Done log = file separato dalla colonna Done del board: la colonna Kanban tiene one-liner, il file done.md tiene il post-mortem.
- Outcome: project tracking pronto per lo sviluppo.
