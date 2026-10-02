# Package lf-fc: who is doing what on `claude/lf-fc-cost-flag-signout`

Two cloud sessions were found pushing to this branch at the same time (2026-10-02). This note is the cooperative claim list so the
same item is not built twice. Fetch and rebase before every push; never force-push.

| Item | Session | State |
|---|---|---|
| COST-02 WorkspacePrepare + replica-shared flag gate, TEST-11, RfiObjectClient flag-off | c225c6 (session_01EQqetLVq3u8w6X1EuDWNCB) | pushed (074eb0c4) |
| COST-02 boot re-download gate | session_01XXRTazhduerr9fMhtthSSF | pushed (a68e210c) |
| TEST-12 replica-versions | session_01XXRTazhduerr9fMhtthSSF | pushed (bb9ea0b4) |
| COST-05 / data:F11 / TEST-14 / TEST-10 sign-out policy (keep by default + explicit delete) | c225c6 | pushed |
| COST-04 circuit breaker + F07 request pacer (sync-client.ts pacer, replica.ts breaker/cooldown), W26 un-skip, cost harness cap lifted | c225c6 | IN PROGRESS |
| COST-03 `/heads` one-call poll in peer/server-step.ts (+ fake server `/heads`) | c225c6 | NEXT |
| CONTRACT.md / COST_MODEL.md updates for the above | c225c6 | NEXT |
