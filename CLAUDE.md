# PROJEXA — Agent Context

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server
- `bun run build` — production build
- `bun test --isolate` — run the test suite. **Always pass `--isolate`, matching `.github/workflows/ci.yml`'s `test` job** (added during the R1-R64 recheck, 2026-08-30 -- this repo's 220+ bun:test tests were never run in CI before that). 27+ test files mock `@/lib/supabase/auth-guard` via `mock.module()` without restoring it; without `--isolate`, that leaks a stale/incomplete mock across files in a single `bun test` process, producing spurious role-gate/import failures that look exactly like real bugs (missing exports, RBAC regressions) but are pure test order-dependence. Confirmed via direct reproduction. Bare `bun test` is not a reliable signal on this repo.
- `bunfig.toml` scopes `[test] root = "src"` -- without it, bun's default test glob also picks up `e2e/*.spec.ts` (Playwright specs, meant for `playwright test`, not `bun test`), which crash with `Playwright Test did not expect test.use() to be called here.`
