# Local-first wire conformance: the real client against the real backend

The laptop's sync engine (`src/lib/local-first/**`) talks to one backend: the `projexa-sync` Supabase Edge Function in **FChecklist/compliance-tracker**
(`supabase/functions/projexa-sync/handler.ts` and its SQL, `drizzle/0677..0684`). Its unit tests run against an in-memory fake of that service
(`src/lib/local-first/__fixtures__/fake-sync-server.ts`). Until 2026-10-02 the fake was written from `CONTRACT.md` alone, and it hid real defects: every real
sync ended in `user_mismatch`, the BOQ screen dropped every real row, a 200-id pull was a 413 that wedged a project. Two test files now make that class of
defect visible:

| File | What it runs | Without `CT_ROOT` |
|---|---|---|
| `src/lib/local-first/conformance/wire.integration.test.ts` | the REAL client (sync client, replica, outbox, local writes, BOQ readers) against the REAL handler on a real Postgres (PGlite, in-process, no server, no network): 42 tests `[W01]..[W32]`, each titled with its owner | skipped, one line printed |
| `src/lib/local-first/conformance/parity.test.ts` | 8 scenarios (first sync, update elsewhere, tombstone, push applied, conflict, lost answer -> duplicate, 426, 429 + Retry-After) against the fake AND the real handler, same expectations | the fake half runs, the real half is skipped |

The fake's own rules are in its header; `wire.integration.test.ts` W29b checks on every run that its limits (`REAL_LIMITS`) still equal the handler's constants,
and W18b that the golden rows `src/lib/local-first/__fixtures__/real-sync-rows.json` (fed to the non-CT BOQ tests) still have the real key sets.

## Run it locally

```
git clone https://github.com/FChecklist/compliance-tracker ../compliance-tracker     # once
git -C ../compliance-tracker fetch origin && git -C ../compliance-tracker checkout --detach origin/feat/lf-sync-backend
(cd ../compliance-tracker && bun install --frozen-lockfile)     # 403s for private tarballs (veridian-ui-kit, sheetjs) are harmless here

CT_ROOT=$(cd ../compliance-tracker && pwd) bun test --isolate src/lib/local-first/conformance/wire.integration.test.ts
CT_ROOT=$(cd ../compliance-tracker && pwd) bun test --isolate src/lib/local-first/conformance/parity.test.ts
```
About 7 s each after PGlite has built the schema. On Windows use a forward-slash path for `CT_ROOT` (`C:/ct/ct`).

Environment switches:
- `CT_ROOT` - the compliance-tracker checkout (required for the real half).
- `LF_BACKEND_HARDENED=1` - also run the tests marked `BACKEND-PENDING` (fixes in flight on `claude/lf-d1-*`, `d2`, `d3`: CORS preflight and Expose-Headers W27/W27b,
  the pull-by-ids body cap W06b, transient pipeline codes W31, `uncertain` ops W22).
- `LF_CLIENT_FB=1` - also run `CLIENT-PENDING:FB` (package `lf-fb-outbox-safety`: `record_kind` on creates W16/W16b, server-deleted conflict W20, 64 KB op W24,
  NOT_LINKED W32).
- `LF_CLIENT_FC=1` - also run `CLIENT-PENDING:FC` (request budget under the 120/min cap, W26).
- `LF_RUN_PENDING=1` - run every pending test (to see what is still red).
- `LF_WRITE_GOLDEN=1` - re-capture `__fixtures__/real-sync-rows.json` from the real handler (after the backend changes a kind's columns), then commit it.

When a pending package merges, delete its `pending` argument in `wire.integration.test.ts` so the test always runs.

## In CI

`.github/workflows/ci.yml` job **`conformance`** ("Local-first wire conformance (non-required)") checks out `FChecklist/compliance-tracker` at
`feat/lf-sync-backend` into `.conformance/compliance-tracker` (inside the workspace: `actions/checkout` refuses a path outside it; projexa's own `bun test` never sees
it because `bunfig.toml` sets the test root to `src`), installs both, and runs the two files with `CT_ROOT` set.

**This job is NOT a required check, and must not be made one yet.** It runs against an unmerged backend branch that other engineers are still changing, so it carries
`continue-on-error: true`: a red run is information, not a merge block. When `feat/lf-sync-backend` is merged into compliance-tracker's `main`: change the job's
`ref:` to `main`, remove `continue-on-error`, and only then add it to branch protection.

## Reading a failure

- A `[client:FA]` test red: the laptop's wire code (`sync-client.ts`, `replica.ts` identity/feed lines, `boq-local.ts`, `task-errors.ts`) or `CONTRACT.md` drifted from
  the handler. The handler is the implemented truth: fix the laptop, or file a backend bug if the handler's behaviour is wrong.
- A `[backend]` test red without `LF_BACKEND_HARDENED`: the backend changed under the laptop; read the handler's diff.
- `parity [fake]` red while `parity [real handler]` is green: the fake lies; fix the fake, never the expectation.
- `parity [real handler]` red while `parity [fake]` is green: the real service changed or the fake was made to agree with a wrong expectation.
