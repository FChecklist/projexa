# PROGRESS -- task-20260728-041200-resource-management--manpower--material

## Completed
- [x] Real construction schema/services live in `compliance-tracker`
      (VERIDIAN backend), not this repo -- confirmed via code + grep. Built
      there on branch `worker/task-20260728-041200-resource-management`
      (worktree, isolated from other workers' dirty shared-repo state),
      pushed, 2 commits:
  - Schema: `constructionMaterials`, `constructionMaterialInbound`,
    `constructionBudgetLineItems`, `constructionScheduleItems`. Manpower
    reuses existing `constructionLabourRoster`/`constructionAttendance`
    (no duplicate table).
  - Migration `drizzle/0268_wave174_resource_management.sql` (hand-written;
    `drizzle-kit generate` collided with an existing file due to known
    idx/filename drift in this shared repo -- reverted, verified 0268 is
    safe via `scripts/check-migration-collision.mjs`).
  - Services: `construction-material-service.ts`, `construction-budget-service.ts`
    (default-25%-overridable-per-line markup against the CURRENT BOQ
    revision via new `getCurrentBoq()` in `construction-boq-service.ts`),
    `construction-schedule-service.ts` (Excel import via this repo's `xlsx`
    dynamic-import pattern; progress reused live from
    `constructionWorkProgressEntries` -- no second progress tracker),
    `construction-labour-service.ts` extended with `getManpowerCostReport`.
  - Tests: 19 passing bun tests (pure-function, no DB) incl. the required
    default-25%-vs-overridden-per-line case and multi-entry Material/
    Manpower cost-report aggregation.
  - `npx tsc --noEmit` (needs `NODE_OPTIONS=--max-old-space-size=8192`,
    unrelated to these changes -- bare command OOMs on this repo's size
    regardless) is clean for all new/changed files.
  - API routes: `/api/v1/construction/materials[/inbound|/cost-report]`,
    `/api/v1/construction/manpower/cost-report`,
    `/api/v1/construction/budget/lines|/summary`,
    `/api/v1/construction/schedule[/import]`.
- [x] PROJEXA proxy routes: `/api/construction-materials` (+`/inbound`,
      `/cost-report`), `/api/manpower-cost-report`,
      `/api/construction-budget/lines|/summary`, `/api/schedule-tracker`
      (+`/import`), mirroring the existing `labour-roster` proxy pattern.
- [x] Material UI: `SiteMaterialsClient.tsx` + `/(app)/site-materials` page
      (Catalog / Inbound / Cost Report tabs).

## Remaining
- [ ] Budget summary UI screen (`ProjectBudgetClient.tsx` +
      `/(app)/project-budget`) -- S.No|Category|Code|Description|Qty|Rate|
      Amount|Vendor 1|Vendor Amount table + per-line % override. Backend
      (service+API, both repos) is done and tested; only the screen remains.
- [ ] Schedule tracker UI screen (`ScheduleTrackerClient.tsx` +
      `/(app)/schedule-tracker`) -- Excel upload + baseline-vs-progress
      table. Backend is done; only the screen remains. Note: the *existing*
      `/schedule` page (Timeline/Board/Sprints/Timesheet) is a different,
      pre-existing generic PM feature (migration
      `0122_wave140_pms_scheduling_core.sql`) -- deliberately left alone
      rather than overloaded.
- [ ] Manpower Cost Report tab: add to existing `LabourClient.tsx`
      (S.No/ID/Name/Company/Salary, trade filter, daily rollup) -- backend
      (`getManpowerCostReport`, `/api/manpower-cost-report`) is done and
      unit-tested; only the UI tab remains.
- [ ] `AppSidebar.tsx` nav + `middleware.ts` protected-prefix entries +
      `messages/` i18n keys for `site-materials`, `project-budget`,
      `schedule-tracker`.
- [ ] Route-level bun tests for the new PROJEXA proxy routes (mock
      `auth-guard`/`veridian-client`, mirroring
      `src/app/api/scope/[id]/revisions/route.test.ts`).
- [ ] `npx tsc --noEmit` not yet re-run in this PROJEXA repo against the
      new files.
- [ ] `/api/schedule-tracker/import`'s multipart passthrough
      (`callVeridianRaw` with a `FormData` body) is unverified -- confirm
      `callVeridianRaw` doesn't force a JSON content-type on the outbound
      request before relying on it.
- [ ] PRs not yet opened in either repo -- do not merge without a fresh
      supervisor audit per task protocol.

## Why this stopped here
Session USD budget was exhausted partway through the UI layer. All four
modules have real, tested backend (schema + service + API routes, in the
correct repo) satisfying both explicit SUCCESS_CRITERIA (default-25%-
overridable-per-line test; multi-entry Material/Manpower cost-report
aggregation test). What's left is UI wiring for Budget/Schedule/Manpower's
report tab, nav registration, and route-level tests -- mechanical work
following the pattern already established by `SiteMaterialsClient.tsx` and
the existing `LabourClient.tsx`/`ScopeClient.tsx`.
