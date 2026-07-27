# PROGRESS -- task-20260727-203638-company-dept-project-dashboard-hierarchy

## Completed
- [x] Investigated whether Company/Department already exist (SCOPE item 1). Findings:
  - "Company" maps to a real, existing PROJEXA `organizations` + many-to-many `memberships` row -- a user with memberships in multiple orgs (e.g. a UAE org + an India org) already has real multi-company data; the only gap was that `requireAuth()` always hard-picked the first membership with no selector. VERIDIAN's own `erp_companies` ("multi-entity/consolidation") is a *different*, unrelated concept (sub-entities within one org's accounting, already exposed at PROJEXA's existing `/api/companies`) with no link to projects/cost-centers at all -- deliberately not reused here to avoid a fake/no-op filter.
  - "Department" already has real server-side support: VERIDIAN's `getOrgDashboard(orgId, {departmentId})` (construction-dashboard-service.ts) already filters projects by the project lead's HR department -- just never exposed as a UI level in PROJEXA.
  - Project "Details" (Revenue/Budget/Expense/Progress) already exists via VERIDIAN's `getProjectDashboard`, exposed at `/v1/projexa/dashboard/[projectId]` -- but with no date-range filtering.
  - Work Progress Report (category completion %) has already landed (`category-progress` report) -- real, not fabricated.
  - Found and closed a genuine gap: no VERIDIAN endpoint exposed BOQ line-item amounts grouped by category (only a whole-BOQ total via `scopeReport`). Added one small, additive, read-only report (`category-boq-amounts`) to compliance-tracker, mirroring the existing `categoryProgressReport` pattern exactly -- see "Cross-repo dependency" below.
- [x] Built the real Company -> Department -> Project drill-down (`/dashboard/hierarchy`), each level filtering the next via real VERIDIAN calls, with membership-verified `companyId` scoping (`src/lib/company-scope.ts`) so a caller can never read another company's data by guessing an org UUID.
- [x] Added the Details view's date-range filter for Revenue/Expense/Progress (Budget is disclosed as a period-invariant annual total, not date-sliceable).
- [x] Built the category-distribution pie chart (share of BOQ total) + bar chart (completed vs. total amount per category), sourced from real BOQ line-item amounts (grouped via `activityId -> category`) and real WPR completion %.
- [x] Built the separate, lightweight multi-project status-bar overview (`/dashboard/overview`) -- one horizontal % complete bar per project, intentionally not folded into the drill-down.
- [x] Added sidebar nav entries ("Company Dashboard", "Projects Overview") + en/hi i18n strings.
- [x] Tests: `src/lib/company-scope.test.ts` (membership-boundary scoping) + 2 route-level test files under `src/app/api/dashboard-hierarchy/**` (cross-company scoping, department filter passthrough, category-distribution percentages sum to 100% and match seeded BOQ amounts). 12/12 pass.
- [x] `npx tsc --noEmit` -- clean, zero errors.
- [x] `npx eslint` on all new/changed files -- clean.

## Cross-repo dependency (disclosed, not silently worked around)
This task's category-distribution chart genuinely required one small backend
addition in **compliance-tracker** (VERIDIAN) that didn't exist yet: a
`category-boq-amounts` report grouping real BOQ line-item amounts by
category (see `src/lib/services/construction-reports-service.ts`, function
`categoryBoqAmountsReport`, registered in `REPORT_REGISTRY`). It is
additive-only (one new function + one registry entry), read-only, and
mirrors the existing `categoryProgressReport` function's exact
activityId->category attribution pattern -- no existing behavior changed.
Committed on branch `feat/category-boq-amounts-report` in the
compliance-tracker checkout at `/opt/veridian/repos/compliance-tracker`.
**Not pushed/PR'd without explicit sign-off** -- this task's EXPECTED_OUTPUT
names only a projexa PR, and compliance-tracker is a live production
service, so opening a PR there was left for the supervisor/Owner to
authorize explicitly rather than assumed. The projexa category-distribution
route (`.../category-distribution/route.ts`) depends on this endpoint
existing at `GET /v1/projexa/reports/category-boq-amounts?projectId=` --
until that VERIDIAN branch is deployed, the category-distribution charts in
`/dashboard/hierarchy` will 502.

## Remaining
- [ ] Supervisor decision + push/PR for the compliance-tracker companion change above (or an alternative if the supervisor prefers a different approach).
- [ ] Fresh supervisor audit of the projexa PR before merge (per task protocol -- not to be merged by this worker).
- [ ] `bun test` was run scoped to the new dashboard files (12/12 pass) and `npx tsc --noEmit` for the whole project (clean) -- the full existing `bun test` suite was not re-run end-to-end due to session budget; worth a full run in CI/audit.
- [ ] UI was not visually verified in a running browser (session budget) -- functional correctness verified via tsc + unit/route tests only, per instructions this is disclosed rather than claiming visual confirmation.
