---
created: 2026-05-16
updated: 2026-05-17T00:30:00+02:00
tags: [project/viet-chatter, kanban]
kanban-plugin: board
---

## Not Started

## In Progress

- [ ] **#62** smoke test E2E manuale: trigger escalation (messaggio "sei libero sabato?" da numero whitelisted), verifica notifica Telegram arriva, verifica holding reply su WhatsApp, verifica out_manual chiude escalation. Wave 11. Telegram channel + multi-recipient + retry implementati; live trigger NOT performed. (= "message that needs human interaction" da tested.md)
- [ ] **#63** smoke test E2E manuale: birthday job (insert manuale fact con anchor_date oggi+1min, verifica fire). Wave 11. Implementato; non live-tested.
- [ ] **#NEW1** smoke test E2E manuale: re_engage / re-initiate conversation after silence threshold. ManualJobsCron path. Non live-tested. (= "re-initiate conversation after not responding for a while" da tested.md)
- [ ] **#NEW2** smoke test E2E manuale: skip output. Stub AI o messaggio reale che l'AI considera non-need-response (es. emoji singolo). Verifica skip:true, niente reply, facts persisted. (= "message that doesn't need response" da tested.md)
- [ ] **#SA-live** Spec A live test: invia immagine + audio + video + posizione da numero whitelisted con WhatsApp reale, verifica behaviour (image=reply via vision, audio/video/location=escalation). Vision model deve essere in VISION_CAPABLE_MODELS (default `gpt-5-mini` ok).
- [ ] **#SB-live** Spec B live test: pair second WhatsApp account in `e2e/driver/`, run `npx tsx e2e/run.ts basic-reply --ai stub`, verifica bot riceve + risponde + validator pass.
- [ ] **#SD-live** Spec D2 live test: aprire `/dashboard/agent`, scrivere "manda 'tanti auguri Maria' il 15 maggio alle 9", verificare proposal + Confirm + manual_jobs row creata. Inoltre testare kill switch (`AGENT_DISABLED=1`) + bind localhost (curl con Host: malicious).

## Done

- [x] **#SA** Spec A: handle non-text media (image vision via OpenCode + escalation for audio/video/sticker/document/location). Implementato + tsc clean + test:e2e image-vision/image-escalation-fallback/audio-escalation PASS. See [specs/2026-05-16-spec-a-media.md](../dev/specs/2026-05-16-spec-a-media.md) + commit `3a8a1f6`. [[viet-chatter]]
- [x] **#SB** Spec B: e2e test framework B+C hybrid. 6 mock scenarios PASS (`npm run test:e2e -- all`). e2e/ folder con driver wweb separato + validator + orchestrator. Live test pending. See [specs/2026-05-16-spec-b-test-framework.md](../dev/specs/2026-05-16-spec-b-test-framework.md) + commits `824a72c` + `17424e2`. [[viet-chatter]]
- [x] **#SC** Spec C: dashboard read-only. /dashboard tabs (home + chats + schedule + stats + summary). API routes all read-only. Web build PASS. See [specs/2026-05-16-spec-c-dashboard.md](../dev/specs/2026-05-16-spec-c-dashboard.md) + commit `558ec3d`. [[viet-chatter]]
- [x] **#SD1** Spec D1: AI summary read-only. `/dashboard/summary` form + `/api/dashboard/summary` POST. Prompt folder `prompts/summary/`. Coperto da spec C, commit `558ec3d`. [[viet-chatter]]
- [x] **#SD2** Spec D2: AI command channel write-capable. `/dashboard/agent` con chat UI + confirm-then-execute. 6 action types whitelisted (createManualJob, cancelManualJobs, dismissEscalation, summarizeChat, updateEngagement, listOverview). Security: forced localhost bind + AGENT_DISABLED kill switch + audit log via agent_commands table. See [specs/2026-05-16-spec-d2-ai-commands.md](../dev/specs/2026-05-16-spec-d2-ai-commands.md) + commits `7d99cad` + `17424e2`. [[viet-chatter]]
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
