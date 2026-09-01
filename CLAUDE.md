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

## This is a SEPARATE app from `FChecklist/compliance-tracker` — not a skin of it

**Added 2026-09-01, after a real multi-hour session confused these two apps** and spent a
full debugging cycle looking for PROJEXA's real, current UI inside `compliance-tracker`'s
own pages instead of here. Domain data (schedule/BOQ/RFIs/etc.) is proxied through
`compliance-tracker`'s API (see "What this is" above) — but the **UI, screens, and this
repo's own tenant/auth data are independent**. If someone reports "PROJEXA's UI looks old"
or asks to verify "the real UI/UX we agreed on", the correct codebase to run and check is
**this repo**, not `compliance-tracker`.

- **Local dev runs on port 3100** (`bun run dev`, see `package.json`'s `dev` script) —
  `compliance-tracker`'s local dev server (port 3000) will never show you this app's UI.
- **Real Supabase project: `evpckeuxgvahguwsaeul`** (named "projexa" in the Supabase
  dashboard/API, `ACTIVE_HEALTHY`) — this is where `NEXT_PUBLIC_SUPABASE_URL` should
  point and where this repo's own `auth.users`/tenant tables (`organizations`,
  `memberships`) live. This is a **different** Supabase project from
  `compliance-tracker`'s own `pcrjmlpuqsbocqfwoxod` ("verdian-ai") — do not assume a
  migration or schema check against one project says anything about the other.
- **`vercel env pull` reliably returns empty/placeholder values for this project's
  secrets** (reproduced twice, 2026-09-01) — do not trust it for local env setup. If a
  working `.env.local` exists from a prior local checkout, prefer copying real values
  from that over a fresh `vercel env pull`.
- Shares `@fchecklist/veridian-ui-kit` with `compliance-tracker` for shell components
  (`AppSidebar`/`AppHeader` equivalents) — but this repo's own product screens
  (construction/interior-design PM UI, the "real-screen conversion" waves) are built
  independently on top of that shared kit, not copied from `compliance-tracker`.

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server (**port 3100**)
- `bun run build` — production build
- `bun test --isolate` — run the test suite. **Always pass `--isolate`, matching `.github/workflows/ci.yml`'s `test` job** (added during the R1-R64 recheck, 2026-08-30 -- this repo's 220+ bun:test tests were never run in CI before that). 27+ test files mock `@/lib/supabase/auth-guard` via `mock.module()` without restoring it; without `--isolate`, that leaks a stale/incomplete mock across files in a single `bun test` process, producing spurious role-gate/import failures that look exactly like real bugs (missing exports, RBAC regressions) but are pure test order-dependence. Confirmed via direct reproduction. Bare `bun test` is not a reliable signal on this repo.
- `bunfig.toml` scopes `[test] root = "src"` -- without it, bun's default test glob also picks up `e2e/*.spec.ts` (Playwright specs, meant for `playwright test`, not `bun test`), which crash with `Playwright Test did not expect test.use() to be called here.`
