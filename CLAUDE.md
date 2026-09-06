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

## R76 state (2026-09-06) — Vercel deploy lockdown

**Vercel credits are exhausted. The owner's requirement: Vercel stays a customer-facing
production surface ONLY — never used to dev/test/deploy-to-check — and no future session
(this one or any other, human-triggered or automated) may spend credits again without the
owner's own explicit act.** Full binding policy: `platform.crr_ruling` id `R76-RULING-01`
in compliance-tracker's Supabase project (`pcrjmlpuqsbocqfwoxod`) — this repo has no
`crr_ruling` table of its own, that policy governs both repos. Full record:
compliance-tracker's `platform.claude_log` id 288 (progress) and its Phase 7 close row.

**Do not deploy to Vercel from this repo under any circumstance, including to test that
the lockdown itself works — test it locally** (`bun test src/lib/vercel-lockdown.test.ts`,
plus local error-injection of the ignore command, exactly as this block did). Do not
create a deployment via CLI/dashboard/API, do not change any Vercel project/dashboard
setting, and do not set the `OWNER_DEPLOY_APPROVAL` env var yourself under any
circumstance — only the owner may set it, directly in the Vercel dashboard, and only to
that exact day's UTC date.

Unlike compliance-tracker, this repo's `vercel.json` had NEITHER layer before R76 — both
were added fresh:
- **Layer 1** — `vercel.json` gained `"git": {"deploymentEnabled": {"*": false}}`.
  Previously absent entirely, which defaults every unspecified branch to enabled.
- **Layer 2** — `vercel.json`'s `ignoreCommand` requires `OWNER_DEPLOY_APPROVAL` to equal
  that exact day's UTC date (`sh -c '[ -n "$OWNER_DEPLOY_APPROVAL" ] && [ "$OWNER_DEPLOY_APPROVAL" = "$(date -u +%Y-%m-%d)" ] && exit 1; exit 0'`)
  — fails closed on unset/empty/wrong-date/malformed-date, proceeds only on an exact
  match. Replaced the old chore/docs-skip command, which did the opposite (proceeded on
  any real code change) and was incompatible with a fail-closed gate.
- **Layer 3** — `src/lib/vercel-lockdown.test.ts` is a checked-in drift guard (same
  pattern as compliance-tracker's `authz-gap-inventory.test.ts`): fails CI the moment
  Layer 1 or Layer 2 weaken, proven via 4 planted-weakening tests each individually
  caught then restored. `.github/workflows/ci.yml`'s Test job has an independent
  `test -f src/lib/vercel-lockdown.test.ts` step guarding against the test file itself
  being deleted — that step doesn't depend on the file's own content to fire.
- **Layer 4** (this section, plus `VERCEL_DEPLOY_OWNER_GUIDE.md` at repo root) — the
  durable record so a future session/agent knows the policy without re-deriving it.

**Layer 0 (removing the Vercel token from the machine, disconnecting the Vercel MCP
connection) is an OWNER action, not done by this block** — filed as an urgent item in the
owner register (see `VERCEL_DEPLOY_OWNER_GUIDE.md`). Until done, Layers 1-3 stop the
ordinary git-push and CI-config paths; they do not revoke the credential itself.

**A real, unrelated regression was found while running this block's own local gate,
not fixed (needs product judgment, out of R76's scope):** `src/components/
dashboard-hierarchy-no-ffe-redirect.test.ts` (guarding fault F_023) asserts
`VISIBLE_NAV_SECTIONS` still has a `labelKey: "items.companyDashboard"` entry pointed at
`/dashboard/hierarchy`. It does not — confirmed by reading `AppSidebar.tsx`'s full
46-entry `NAV_SECTIONS` list directly, no `companyDashboard` key exists anywhere in it.
The underlying page (`src/app/(app)/dashboard/hierarchy/page.tsx`) still exists; only the
sidebar link to it is gone. Whether this was a deliberate nav restructuring (test should
be retired) or an accidental drop (nav item should be restored) needs a product decision
this note deliberately does not make.

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server (**port 3100**)
- `bun run build` — production build
- `bun test --isolate` — run the test suite. **Always pass `--isolate`, matching `.github/workflows/ci.yml`'s `test` job** (added during the R1-R64 recheck, 2026-08-30 -- this repo's 220+ bun:test tests were never run in CI before that). 27+ test files mock `@/lib/supabase/auth-guard` via `mock.module()` without restoring it; without `--isolate`, that leaks a stale/incomplete mock across files in a single `bun test` process, producing spurious role-gate/import failures that look exactly like real bugs (missing exports, RBAC regressions) but are pure test order-dependence. Confirmed via direct reproduction. Bare `bun test` is not a reliable signal on this repo.
- `bunfig.toml` scopes `[test] root = "src"` -- without it, bun's default test glob also picks up `e2e/*.spec.ts` (Playwright specs, meant for `playwright test`, not `bun test`), which crash with `Playwright Test did not expect test.use() to be called here.`
