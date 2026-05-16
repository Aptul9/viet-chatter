---
created: 2026-05-16
updated: 2026-05-16T20:00:00+02:00
tags: [project/viet-chatter, kanban]
kanban-plugin: board
---

## Not Started

## In Progress

- [ ] **#61** smoke test E2E manuale: avvio bot, scan QR, messaggio test da numero whitelisted, verifica reply arriva con delay corretto, verifica out_manual cancella. ✓ verified manually 2026-05-16 (+39 → +31 paired account).
- [ ] **#62** smoke test E2E manuale: trigger escalation (messaggio "sei libero sabato?" da numero whitelisted), verifica notifica Telegram arriva, verifica holding reply su WhatsApp, verifica out_manual chiude escalation. Wave 11. Telegram channel + multi-recipient + retry implementati; live trigger NOT performed.
- [ ] **#63** smoke test E2E manuale: birthday job (insert manuale fact con anchor_date oggi+1min, verifica fire). Wave 11. Implementato; non live-tested.
- [ ] **#64** smoke test E2E manuale: reconnect / boot reconciler (stop bot, ricevi 3 messaggi, restart, verifica catch-up con post-reconnect spread). Wave 11. Delayed-reconciler shipped; live disconnect/reconnect NOT performed.

## Done

- [x] **#R2** runtime hardening: lid resolution + isBotSent race + delayed reconciler + Chromium pre-launch cleanup + free-port helper + Telegram multi-recipient + dotenv autoload + UI field descriptions + wweb 1.34.7 upgrade + OpenCode default model swap + DEFAULT_PLUGINS fix. [[viet-chatter]]
- [x] **#R1 + #01-#65** waves 1-10 ship: 65 task chiusi (#01-#60 implementazione + #65 README) + refactor a single-project + YAML config. [[viet-chatter]]

**Complete**

## Paused

%% kanban:settings

```
{"kanban-plugin":"board","list-collapse":[false,false,false,false]}
```

%%
