# PROGRESS -- task-20260727-122935-projexa-e2e--pm-site-engineer-role-model

## Completed
- [x] PROJEXA role model: extended `memberships.role` (drizzle/0012, applied live via Supabase MCP) to `owner | admin | pm | site_engineer | member | client_viewer` -- `client_viewer` made a real PROJEXA-native role (justified in PR description: PROJEXA's VERIDIAN calls use one shared per-org API key, not a per-user VERIDIAN identity, so there is nothing on the VERIDIAN side for a per-user client_viewer gate to attach to).
- [x] Added `requireRole()`/`ROLE_GROUPS` (`PM_OR_ABOVE`, `FIELD`) to `src/lib/supabase/auth-guard.ts`, following the existing `org/provision` inline-check pattern but as a reusable helper.
- [x] Gated real API routes: `project-budgets` POST, `schedule/baselines` POST, `change-orders` POST + `[id]` PATCH, `purchase-orders` POST -> `PM_OR_ABOVE`; `site-diary` POST, `punch-list` POST -> `FIELD` (site_engineer allowed).
- [x] `src/lib/supabase/auth-guard.test.ts`: proves site_engineer rejected from PM_OR_ABOVE / allowed on FIELD, pm allowed on both, client_viewer rejected from both.
- [x] `npx tsc --noEmit` clean; `bun test src/lib/supabase/auth-guard.test.ts` 6/6 pass (full-repo `bun test` has a pre-existing, unrelated e2e/*.spec.ts vs bun-test-glob collision -- confirmed present before this change too, not fixed here per "avoid unrelated changes").
- [x] `get_advisors(security)` on the `projexa` Supabase project: identical finding set before/after the migration -- zero new findings.
- [x] PROJEXA PR opened: https://github.com/FChecklist/projexa/pull/53
- [x] compliance-tracker: extended `designerTimesheetReport()` in `construction-reports-service.ts` with a real Category/Designer/Project/Designer-status Budget-vs-Actual breakdown, via a new pure `aggregateDesignerTimesheetCosts()` aggregator. Reuses `pms-budget-service.ts`'s existing budget-vs-actual computation shape (`pms_budgets`/`pms_budget_line_items` = planned, sum(hours x `resolveBillableRate()`) = actual) rather than the ERP-based `budgetSummary()`/`budgetVsActual()` in the same file, since that pattern was confirmed to have no per-designer/category/project dimension at all. Category-wise budget honestly reported as `null` (no per-category budget dimension exists anywhere in the schema).
- [x] compliance-tracker: `construction-reports-service.test.ts` (new) -- 6/6 pass, tests the pure aggregator against a realistic 3-designer/2-project/3-category fixture incl. an unbudgeted designer and an unassigned material budget line.
- [x] compliance-tracker: `npx tsc --noEmit` clean (needed `NODE_OPTIONS=--max-old-space-size=8192` to avoid an OOM on this repo's large type-check, pre-existing, not introduced here); full `bun test` 2125/2125 pass.
- [x] `get_advisors(security)` on the `verdian-ai` (compliance-tracker) Supabase project: no schema changes in this PR at all, so identical findings before/after by construction.
- [x] compliance-tracker PR opened: https://github.com/FChecklist/compliance-tracker/pull/597

## Audit-fix round (2026-07-27, addressing PR #53 FAIL verdict)
- [x] `src/app/api/punch-list/[id]/route.ts` PATCH was missing `requireRole()`/`ROLE_GROUPS.FIELD` entirely (sibling POST had it) -- any authenticated member, including the new read-only `client_viewer`, could update/resolve punch-list items. Added the same `ROLE_GROUPS.FIELD` gate PATCH's sibling POST already used.
- [x] No mechanism existed to assign the new `pm`/`site_engineer`/`client_viewer` roles to a membership -- `member` is excluded from both `ROLE_GROUPS.PM_OR_ABOVE` and `ROLE_GROUPS.FIELD`, so merging as-is would 403 every existing non-owner/admin user on all 6 gated routes with only a manual Supabase edit as a fix. Built a real recovery path instead of loosening enforcement: `PATCH /api/org-members/[id]` lets an owner/admin reassign any member's role to any of the 6 valid roles, gated by a new `ROLE_GROUPS.ORG_ADMIN = ["owner","admin"]`. Added a role-select dropdown to the existing Team table in `SettingsClient.tsx` (visible only to owner/admin viewers) so this is usable without a raw API call.
- [x] Explicitly did NOT add `member` back into either `ROLE_GROUPS` as a transitional default -- every org's owner/admin is unaffected by the regression (both roles were already allowed in both groups) and can immediately self-serve promote their `member` users via the new route/UI on merge, so no user is silently locked out with zero recovery path; loosening the other 5 already-correctly-gated routes was avoided per the audit's own constraint.
- [x] New tests: `src/app/api/punch-list/[id]/route.test.ts` (3/3 -- client_viewer and plain member 403, site_engineer 200, mirroring sibling POST's enforcement) and `src/app/api/org-members/[id]/route.test.ts` (5/5 -- owner/admin can reassign, member/site_engineer cannot, invalid role value 400).
- [x] `npx tsc --noEmit` clean. `find src -name "*.test.ts" | xargs bun test`: 35/35 pass across 6 files (full unqualified `bun test` still hits the same pre-existing, unrelated e2e/*.spec.ts-vs-bun-test-glob collision noted above -- confirmed present on this branch before this round too). `bun run lint`: 0 errors (1 pre-existing, unrelated react-hooks/incompatible-library warning on `data-table.tsx`).

## Remaining
- [ ] Await review/merge of both PRs through their normal dispatch pipelines (structured audit-verdict comment required before merge, per each repo's own governance).
# PROGRESS -- task-20260727-122445-projexa--fix-veridian-ui-kit-appheader-e

## Finding: the spec's premise was stale

The spec's KNOWN_CONTEXT asserted `AppHeader`/`header` prop do not exist anywhere in
`veridian-ui-kit` (checked node_modules pinned at `v0.2.2`, and tag `v0.3.0`), and that
`npx tsc --noEmit` currently fails on PROJEXA main with TS2322/TS2305.

Verified directly against a fresh `bun install` + `npx tsc --noEmit` on PROJEXA's actual
current `main` (commit `5441c50`): **this does not reproduce. `tsc --noEmit` exits 0.**

Root cause of the stale premise: `veridian-ui-kit`'s AppHeader/`header`/`homeThreadSlot`
work was already added on 2026-07-19 (repo commits `74688aa`, `5465042`, `8dcc5e7`, task
`task-20260719-024156-veridian-ui-kit--extract-shared-appheade`), *before* the `v0.2.2`
tag was cut (`v0.2.2` = `66a6527`, created after `74688aa`) and well before PROJEXA's PR
#42 bumped its pin to `v0.2.2`. So PROJEXA's `AppTopbar.tsx`/`layout.tsx` (which already
call `AppHeader` and pass a `header` prop, per PR #42) have compiled against a working
API the whole time. `v0.3.0` also contains these commits (confirmed via
`git merge-base --is-ancestor`). No new veridian-ui-kit tag or PROJEXA dependency bump
was needed -- both were already correct.

## Real gap that did exist (spec item 2/4)

`src/app/(app)/layout.tsx` passed `sidebar`/`composer`/`panel`/`header` to
`AppShellFrame` but never `homeThreadSlot`. Since `AppShellFrame`'s `isHome` branch
always hides the right panel on `/dashboard` regardless of `homeThreadSlot`, this meant:
opening a query result or a conversation while on the dashboard (`isThreadOpen`) showed
nothing at all -- `VeriChatPanel` (which owns `QueryThread`/`ConvoThread` rendering) is
never mounted on Home, and the composer hides its own UI while a thread is open. This
was a real, confirmed drift matching the spec's description.

## Completed
- [x] Investigated veridian-ui-kit (`/opt/veridian/repos/veridian-ui-kit`) and confirmed
      `AppHeader`, `AppShellFrame`'s `header` prop, and `homeThreadSlot` wiring already
      exist and are already used correctly by PROJEXA's `AppTopbar.tsx`/`layout.tsx` and
      by compliance-tracker's `AppShell.tsx` (`homeThreadSlot={<HomeThreadSlot />}`,
      same pattern used as reference here). No veridian-ui-kit changes needed.
- [x] Confirmed `npx tsc --noEmit` is already clean on PROJEXA main -- no version bump
      needed to fix a nonexistent break.
- [x] Added `src/components/veri-chat/HomeThreadSlot.tsx`: renders PROJEXA's "Discuss"
      AI-assistant conversation (`discussMessages`) inline via the shared package's
      `ThreadView`, mirroring compliance-tracker's own `HomeThreadSlot` (whose
      `aiThreadId`/singleton AI thread is PROJEXA's closest analog: `discussMessages`,
      not the async Query/Conversation threads, which stay panel-only as before).
- [x] Exported `HOME_ROUTE` from `veri-chat-context.tsx` (was a private const in
      `layout.tsx`) so both `layout.tsx` and `VeriComposer.tsx` share one definition.
- [x] Wired `homeThreadSlot={<HomeThreadSlot />}` into `layout.tsx`'s `AppShellFrame`.
- [x] `VeriComposer.tsx`: suppressed its own inline discuss-message preview strip on
      `HOME_ROUTE` (`!isHome` guard) since `HomeThreadSlot` now renders that same
      conversation in the main content area there -- avoids a duplicate-render
      regression that wiring `homeThreadSlot` would otherwise have introduced.
- [x] `npx tsc --noEmit` clean on PROJEXA (exit 0) after the change.
- [x] `npx tsc --noEmit` clean on compliance-tracker main, verified via a fresh
      `--depth 1` clone + `bun install` (needed `NODE_OPTIONS=--max-old-space-size=8192`
      to avoid an OOM in this sandbox -- pre-existing project size issue, unrelated to
      this change) -- confirmed unaffected, as expected since no veridian-ui-kit or
      PROJEXA dependency-pin changes were made.
- [x] Visual proof: built a temporary, unauthenticated preview route
      (`/shell-preview`, outside middleware's `PROTECTED_PREFIXES`) mounting the same
      `AppShellFrame`/`AppTopbar`/`HomeThreadSlot` tree `layout.tsx` uses, seeded two
      fake discuss messages, screenshotted with Playwright (system Chrome, since the
      sandboxed Playwright-bundled browser was missing shared libs with no sudo
      available to install them) -- confirms the topbar (sidebar toggle, logo, search
      w/ ⌘K, notifications, theme toggle, user-account menu) and the merged inline
      chat content both render. Preview route, `.env.local` placeholder Supabase keys,
      and the screenshot script were all deleted afterward -- throwaway verification
      only, not part of the shipped diff.
- [x] Reverted `next-env.d.ts` (auto-regenerated by `next dev`, unrelated to the fix)
      and cleared the stale `.next` type-validator cache that referenced the deleted
      preview route.

## Remaining
- [x] Open PR against PROJEXA `main` with this diff: https://github.com/FChecklist/projexa/pull/52
- [x] No veridian-ui-kit PR needed (nothing to change there).
- [x] No compliance-tracker PR needed (dependency pin unchanged, typecheck unaffected).
