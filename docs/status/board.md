---
created: 2026-05-16
updated: 2026-05-17T08:00:00+02:00
tags: [project/viet-chatter, kanban]
kanban-plugin: board
---

## Not Started

## In Progress

- [ ] **#63** smoke test E2E manual: birthday job (insert manual fact with anchor_date today+1min, verify fire). Implemented; not live-tested.
- [ ] **#SB-live** Spec B live test: pair second WhatsApp account in `e2e/driver/`, run `npx tsx e2e/run.ts basic-reply --ai stub`, verify bot receives + replies + validator pass.
- [ ] **#SD-live** Spec D2 live test: open `/dashboard/agent`, write "send 'happy birthday Maria' on 15 May at 9", verify proposal + Confirm + manual_jobs row created. Also test kill switch (`AGENT_DISABLED=1`) + localhost bind (curl with Host: malicious).
- [ ] **#RETRY-restart** restart bot process so the new retry/backoff/tracker code path is loaded. Schema migration already applied; tsc clean. Without restart, current failures still drop silently.
- [ ] **#RETRY-live** live test exponential backoff queue: force an AI failure (e.g. break opencode env var briefly), verify `manual_jobs` row with `kind='retry'` + `attempt_count=2` is inserted at `now + 5min + jitter`, verify cron picks it up. Then fix env, verify success clears the chain. Expected schedule: 5/10/20/30 min with ±30s jitter.
- [ ] **#RETRY-alert** live test FailureTracker → Telegram alert. Trigger 3 distinct failed ops within 60 min OR one op that survives to attempt 5 (~80 min). Verify single Telegram alert arrives + dedupe holds for 30 min.
- [ ] **#UI-label** verify dashboard escalation labels: confirm `pending` + notified → "Awaiting reply", `pending` + no channels → "Notification pending". Replied/Dismissed/Superseded already verified by code, no live test needed unless behavior changes.

## Done

- [x] **#01-#65 + #SA-#SD2** project shipped (v1 base + 5 specs: media, e2e framework, dashboard, AI summary, AI command channel). 65 implementation tasks + 5 design specs. Live smoke tests passed for: base reply, reconnect/boot reconciler, image vision + audio/video/location escalation, skip output, human-interaction escalation (surfaced LID-suffix-leak and scheduling-holding-reply bugs, both fixed), re_engage after silence (live-verified via direct manual_jobs insert).
- [x] **#R-hardening** runtime hardening: LID resolution + persistence to display_name, isBotSent race, delayed reconciler, Chromium pre-launch cleanup, free-port helper (Windows-aware bind check), Telegram multi-recipient + system-alert path, dotenv autoload, UI field descriptions, wweb 1.34.7 upgrade, OpenCode default model swap, DEFAULT_PLUGINS fix, dashboard hydration fix (suppressHydrationWarning vs browser extensions), serverExternalPackages for pino workers, lazy config init for web context, retry/backoff queue + FailureTracker + concurrency cap (cron MAX=2).

**Complete**

## Paused

%% kanban:settings

```
{"kanban-plugin":"board","list-collapse":[false,false,false,false]}
```

%%
