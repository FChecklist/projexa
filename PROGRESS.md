# PROGRESS -- task-20260727-122935-projexa-e2e--pm-site-engineer-role-model

## Completed
- [x] PROJEXA role model: extended `memberships.role` (drizzle/0012, applied live via Supabase MCP) to `owner | admin | pm | site_engineer | member | client_viewer` -- `client_viewer` made a real PROJEXA-native role (justified in PR description: PROJEXA's VERIDIAN calls use one shared per-org API key, not a per-user VERIDIAN identity, so there is nothing on the VERIDIAN side for a per-user client_viewer gate to attach to).
- [x] Added `requireRole()`/`ROLE_GROUPS` (`PM_OR_ABOVE`, `FIELD`) to `src/lib/supabase/auth-guard.ts`, following the existing `org/provision` inline-check pattern but as a reusable helper.
- [x] Gated real API routes: `project-budgets` POST, `schedule/baselines` POST, `change-orders` POST + `[id]` PATCH, `purchase-orders` POST -> `PM_OR_ABOVE`; `site-diary` POST, `punch-list` POST -> `FIELD` (site_engineer allowed).
- [x] `src/lib/supabase/auth-guard.test.ts`: proves site_engineer rejected from PM_OR_ABOVE / allowed on FIELD, pm allowed on both, client_viewer rejected from both.
- [x] `npx tsc --noEmit` clean; `bun test src/lib/supabase/auth-guard.test.ts` 6/6 pass (full-repo `bun test` has a pre-existing, unrelated e2e/*.spec.ts vs bun-test-glob collision -- confirmed present before this change too, not fixed here per "avoid unrelated changes").
- [x] `get_advisors(security)` on the `projexa` Supabase project: identical finding set before/after the migration -- zero new findings.
- [x] PROJEXA PR opened.

## Remaining
- [ ] compliance-tracker: extend `designerTimesheetReport()` in `construction-reports-service.ts` with Category/Designer/Project/Status Budget-vs-Actual breakdown, reusing the existing budget-vs-actual pattern.
- [ ] compliance-tracker: tests proving correct Budget-vs-Actual figures across all 4 dimensions against a fixture.
- [ ] compliance-tracker: `bun test` + `npx tsc --noEmit` clean.
- [ ] compliance-tracker PR opened.
