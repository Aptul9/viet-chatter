> Status: 2026-05-16 — SUPERSEDED by [board.md](board.md). Kept here as the original informal capture from the user. Content mapping:
> - Tested items → moved to Done lane in board.md (#61, #64).
> - "Needs test" items → In Progress lane (#62 = human interaction; #NEW1 = re-initiate; #NEW2 = no-response).
> - "Next implementation" items → Not Started lane (#SA = non-text media; #SB = test framework). Specs in `docs/dev/specs/2026-05-16-spec-a-media.md` and `docs/dev/specs/2026-05-16-spec-b-test-framework.md`.
> Plus 3 new specs added during the 2026-05-16 brainstorm (C, D1, D2): dashboard + AI summary + AI command channel.

# This is a list of features that have been tested as of now
- message received, scheduled and sent
- recover older messages after diconnection

# Things that needs to be tested
- re-initiate conversation after not responding for a while
- message that doesn't need response
- message that needs human interaction

# Next implementation
- handle non text messages (pictures, photos, videos, locations, etc)
- test framework with another whatsapp (is it possible to have two in this repo? or do we need manual interaction?)
