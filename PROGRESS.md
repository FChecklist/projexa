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

## Remaining
- [ ] Await review/merge of both PRs through their normal dispatch pipelines (structured audit-verdict comment required before merge, per each repo's own governance).
