# PROJEXA — Agent Context

## What this is (R66 code-quality fix, 2026-09-01: summarized from AGENTS.md,
## which has the fuller version -- read that for the complete picture)

Construction/architecture/interior-design PM product: Next.js 16 (App
Router) + TypeScript strict + Tailwind 4 + Drizzle ORM (`postgres.js`)
against Supabase Postgres, `bun` as package manager. Carries **no
construction domain data of its own** — schedule, BOQ, RFIs, punch lists,
mood boards, FF&E, floor plans, etc. are all read/written through
`src/lib/veridian-client.ts`, a single proxy client calling VERIDIAN AI
OS's (`FChecklist/compliance-tracker`) `/api/v1/projexa/*` API surface
with a Bearer API key. This repo's own Drizzle schema
(`src/lib/db/schema.ts`) holds only tenant/auth plumbing
(`organizations`, `memberships`) and PROJEXA's own
chat/todo/assistant-history tables.

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server
- `bun run build` — production build
- `bun test --isolate` — run the test suite. **Always pass `--isolate`, matching `.github/workflows/ci.yml`'s `test` job** (added during the R1-R64 recheck, 2026-08-30 -- this repo's 220+ bun:test tests were never run in CI before that). 27+ test files mock `@/lib/supabase/auth-guard` via `mock.module()` without restoring it; without `--isolate`, that leaks a stale/incomplete mock across files in a single `bun test` process, producing spurious role-gate/import failures that look exactly like real bugs (missing exports, RBAC regressions) but are pure test order-dependence. Confirmed via direct reproduction. Bare `bun test` is not a reliable signal on this repo.
- `bunfig.toml` scopes `[test] root = "src"` -- without it, bun's default test glob also picks up `e2e/*.spec.ts` (Playwright specs, meant for `playwright test`, not `bun test`), which crash with `Playwright Test did not expect test.use() to be called here.`
