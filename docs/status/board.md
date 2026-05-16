---
created: 2026-05-16
updated: 2026-05-16T22:00:00+02:00
tags: [project/viet-chatter, kanban]
kanban-plugin: board
---

## Not Started

- [ ] **#SA** Spec A: handle non-text media (image vision via OpenCode + escalation for audio/video/sticker/document/location). See [specs/2026-05-16-spec-a-media.md](../dev/specs/2026-05-16-spec-a-media.md). [[viet-chatter]]
- [ ] **#SB** Spec B: e2e test framework B+C hybrid (mock scenario registry + separate `e2e/` driver with own wweb session). See [specs/2026-05-16-spec-b-test-framework.md](../dev/specs/2026-05-16-spec-b-test-framework.md). [[viet-chatter]]
- [ ] **#SC** Spec C: dashboard read-only (KB explorer + schedule view + stats). See [specs/2026-05-16-spec-c-dashboard.md](../dev/specs/2026-05-16-spec-c-dashboard.md). [[viet-chatter]]
- [ ] **#SD1** Spec D1: AI summary read-only ("tell me what Maria did this week"). Coperto da spec C. [[viet-chatter]]
- [ ] **#SD2** Spec D2: AI command channel write-capable (chat con agent che propone azioni structured + confirm-then-execute). Security: localhost-only binding + warning banner + kill switch. See [specs/2026-05-16-spec-d2-ai-commands.md](../dev/specs/2026-05-16-spec-d2-ai-commands.md). [[viet-chatter]]

## In Progress

- [ ] **#62** smoke test E2E manuale: trigger escalation (messaggio "sei libero sabato?" da numero whitelisted), verifica notifica Telegram arriva, verifica holding reply su WhatsApp, verifica out_manual chiude escalation. Wave 11. Telegram channel + multi-recipient + retry implementati; live trigger NOT performed. (= "message that needs human interaction" da tested.md)
- [ ] **#63** smoke test E2E manuale: birthday job (insert manuale fact con anchor_date oggi+1min, verifica fire). Wave 11. Implementato; non live-tested.
- [ ] **#NEW1** smoke test E2E manuale: re_engage / re-initiate conversation after silence threshold. ManualJobsCron path. Non live-tested. (= "re-initiate conversation after not responding for a while" da tested.md)
- [ ] **#NEW2** smoke test E2E manuale: skip output. Stub AI o messaggio reale che l'AI considera non-need-response (es. emoji singolo). Verifica skip:true, niente reply, facts persisted. (= "message that doesn't need response" da tested.md)

## Done

- [x] **#61** smoke test E2E base reply: messaggio test da numero whitelisted, reply arriva con delay corretto, out_manual cancella. Verified manually 2026-05-16 (+39 → +31 paired account). [[viet-chatter]]
- [x] **#64** smoke test E2E reconnect / boot reconciler: stop bot, ricevi 3 messaggi, restart, verifica catch-up con post-reconnect spread. Verified per tested.md ("recover older messages after disconnection"). [[viet-chatter]]
- [x] **#R2** runtime hardening: lid resolution + isBotSent race + delayed reconciler + Chromium pre-launch cleanup + free-port helper + Telegram multi-recipient + dotenv autoload + UI field descriptions + wweb 1.34.7 upgrade + OpenCode default model swap + DEFAULT_PLUGINS fix. [[viet-chatter]]
- [x] **#R1 + #01-#65** waves 1-10 ship: 65 task chiusi (#01-#60 implementazione + #65 README) + refactor a single-project + YAML config. [[viet-chatter]]

**Complete**

## Paused

%% kanban:settings

```
{"kanban-plugin":"board","list-collapse":[false,false,false,false]}
```

%%
