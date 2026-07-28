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

# PROGRESS -- task-20260728-050845-project-records--permits--drawingsand3d

## Architecture finding (read this before reviewing the diff)

PROJEXA carries no construction-domain data of its own -- everything is
proxied through `callVeridian()` to `compliance-tracker`'s `/api/v1/projexa/*`
surface (confirmed in PROJEXA's own AGENTS.md). `constructionBoqLineItems`
and its sibling `construction*` tables live in
`compliance-tracker/src/lib/db/schema.ts`, so new construction-record schema
work belongs there too.

**Permits, Drawings, and Documents already have a real home in
compliance-tracker: the unified `documents` table** (`schema.ts:373`),
explicitly built (Wave 61, Wave 117, Wave 142 -- see comments at
`schema.ts:386-397` and `schema.ts:412-418`) so that permits/drawings/site
photos/mood-board images are `category`-discriminated rows on ONE table
with `linkedEntityType`/`linkedEntityId` project-scoping, not one table per
category. Forking new `constructionPermits`/`constructionDrawings`/
`constructionDocuments` tables now would fragment retention/legal-hold/
correspondent/versioning/auto-classification/expiry-dashboard functionality
that already works for these categories, and directly contradicts two
explicit design decisions already recorded in the schema file.

**Decision: reuse `documents` + `category`, do not fork new tables.**
This means the SUCCESS_CRITERIA grep
(`grep -rn "constructionPermits\|constructionDrawings\|constructionDocuments" src/lib/db/schema.ts`)
will find zero matches by design -- flagging this explicitly per the task's
own CONSTRAINTS instruction to write real findings plainly rather than
inventing a stand-in. The real, working table is `documents`
(`category='permit'|'drawing'|'drawing_3d'|...`), reachable via
`/api/v1/documents` and `/api/v1/projexa/permits` / `/api/v1/projexa/drawings`.

MoMs: confirmed `veri-meeting-service.ts` (compliance-tracker) already
implements real live-meeting-notes CRUD + AI summary/action-item extraction,
but it was never wired to PROJEXA (only `pms-meeting-service.ts`'s basic
CRUD is, via the existing `/api/meetings` PROJEXA route). WhatsApp-send:
confirmed zero implementation anywhere in either repo (grep across both
trees found only marketing copy) -- building a real send integration is out
of scope for this task; flagged as an open item below.

## Completed
- [x] Surveyed real architecture: proxy-only PROJEXA, `documents` table
      reuse convention, `veri-meeting-service.ts`, PDF pattern (jsPDF relay,
      no PDF lib in PROJEXA), no WhatsApp integration anywhere.
- [x] compliance-tracker: isolated git worktree at
      `/opt/veridian/repos/compliance-tracker-projexa-records-wt`
      (branch `feat/projexa-permits-drawings-moms` off `origin/main`) --
      the shared checkout at `/opt/veridian/repos/compliance-tracker` has
      unrelated in-progress dirty state from other concurrent tasks, left
      untouched.

## Completed (continued)
- [x] compliance-tracker (worktree, branch `feat/projexa-permits-drawings-moms`):
      `createDocumentRecord()` shared upload service fn in document-service.ts
      -- the real storage pattern (Supabase Storage `compliance-documents`
      bucket) reused by Permits/Drawings/Documents.
- [x] compliance-tracker: `POST /api/v1/documents` (Bearer-compatible upload,
      the follow-up that route's own old comment predicted).
- [x] compliance-tracker: `/api/v1/projexa/permits` -- added POST (create:
      PDF + name/issueDate/endDate/permitAuthority/permitNumber), fixed GET
      to support `projectId` scoping + `all=true` full listing (previously
      org-wide expiring-only, no project filter -- a real gap, now closed).
- [x] compliance-tracker: `/api/v1/projexa/drawings` GET+POST, new route --
      DWG file upload (category='drawing') and 3D walkthrough as either an
      uploaded file or an external link (category='drawing_3d',
      metadata.isExternalLink).
- [x] compliance-tracker: widened `veri-meeting-service.ts`'s
      `VeriMeetingContext` from a hardcoded `dbUser` to the codebase's
      existing `ServiceActor` (dbUser|apiKey) union -- zero behavior change
      for the ~9 existing internal callers, and now callable with a Bearer
      API key. Fixed the one downstream type error this surfaced in
      `voice-ticket-service.ts` (`Extract<VeriMeetingContext, {dbUser:
      unknown}>` instead of a naive union index). New routes:
      `/api/v1/projexa/veri-meetings` (GET list w/ projectId scoping, POST
      create), `.../[id]` (GET, PATCH minutes/publish),
      `.../[id]/generate-intelligence` (POST, real AI summary/key-decisions/
      action-items via veri-meeting-service.ts's existing LLM call), and
      `.../[id]/pdf` (GET, real binary PDF via new
      `src/lib/pdf/meeting-minutes-pdf.ts`, same jsPDF stack as the existing
      quotation PDF -- no new PDF dependency).
- [x] compliance-tracker: `npx tsc --noEmit` (full project, via
      `NODE_OPTIONS=--max-old-space-size=8192` -- default heap OOMs on this
      repo's size) -- **clean for every file this task touched.** The only
      two remaining errors (`@mlc-ai/web-llm`, `@huggingface/transformers`
      module-not-found in `src/lib/browser-execution/*`) are pre-existing,
      unrelated to this diff, and present because those optional deps
      aren't installed in this sandbox's node_modules.
- [x] compliance-tracker: wrote real tests --
      `src/lib/pdf/meeting-minutes-pdf.test.ts` (proves a real, non-empty
      `%PDF-`-header binary buffer from a pure call, satisfying the PDF
      success criterion) and
      `src/lib/services/projexa-records-tenant-isolation.test.ts` (org A/B
      isolation for `listDocuments`/`createDocumentRecord` -- covers
      Permits/Drawings/Documents -- and `listVeriMeetings`/`createVeriMeeting`
      -- covers MoMs -- following the existing `tenant-isolation.test.ts`
      pattern exactly).
- [x] PROJEXA: added `callVeridianUpload()` to `veridian-client.ts` -- the
      multipart/FormData twin of `callVeridian()`, needed because file
      uploads can't be JSON-encoded.
- [x] PROJEXA: Permits -- `PermitsClient.tsx` now takes `projectId`, has a
      real create dialog (PDF + name/issueDate/endDate/authority/number),
      lists all-or-expiring per project; `permits/page.tsx` now resolves
      the selected project (previously didn't pass one at all).
- [x] PROJEXA: new Drawings & 3D screen -- `DrawingsClient.tsx` +
      `app/(app)/drawings/page.tsx` + `api/drawings/route.ts` proxy.
- [x] PROJEXA: Documents -- `api/documents/route.ts` gained POST (was
      explicitly read-only before); `DocumentsClient.tsx` gained a real
      upload dialog with category selection (category filter already
      existed).
- [x] PROJEXA: new MoMs screen -- `MoMsClient.tsx` (create meeting, live
      minutes editor, "Generate AI Summary" button, PDF download link,
      WhatsApp button **disabled** with an explicit tooltip disclosing the
      gap) + `app/(app)/moms/page.tsx` + 4 proxy routes under `api/moms/`.
- [x] Sidebar nav + i18n: added "Drawings & 3D" and "Minutes of Meeting"
      items to `AppSidebar.tsx` and `messages/en.json`/`hi.json`.

## Remaining (not completed this session -- ran out of budget)
- [ ] **PROJEXA-side verification not run**: `npx tsc --noEmit` and
      `bun test` were NOT executed against the PROJEXA repo in this
      session (budget exhausted immediately after the compliance-tracker
      verification pass). The compliance-tracker half is independently
      verified clean; the PROJEXA half (new/edited routes and 3 new client
      components) is unverified by a compiler/test run and needs that pass
      before merge.
- [ ] **PROJEXA-side tests not written**: no proxy-route tests (the
      `scope/[id]/revisions/route.test.ts`-style mock.module() pattern) were
      added for the new/edited `api/permits`, `api/drawings`, `api/documents`,
      `api/moms/*` routes.
- [ ] compliance-tracker: `bun test` could not be confirmed to run in this
      sandbox in the time remaining (`bun` resolved via `which` but the test
      invocation produced no output/hung under the harness's command
      wrapper) -- the two new test files above are believed correct (they
      follow existing, working test patterns exactly and the PDF test has
      no DB dependency) but were not observed to actually pass in this run.
      **Re-run `bun test src/lib/pdf/meeting-minutes-pdf.test.ts
      src/lib/services/projexa-records-tenant-isolation.test.ts` before
      merge.**
- [ ] Neither repo's changes have been committed/pushed or opened as a PR
      yet as of this PROGRESS.md update -- see next session.
- [ ] `grep -rn "constructionPermits\|constructionDrawings\|constructionDocuments" src/lib/db/schema.ts`
      will return **zero matches** -- by design, see the Architecture
      finding at the top of this file. Not a missed requirement; a
      documented, reasoned deviation.
- [ ] No end-to-end manual verification (starting the dev server, uploading
      a real file through the browser) was performed this session.

## Open items / disclosed gaps
- [ ] WhatsApp-send for MoMs: **no implementation exists anywhere in either
      repo.** Not built here (would require a WhatsApp Business API
      integration + credentials, a real architecture change per PROJEXA's
      own AGENTS.md governance). PDF export is real; WhatsApp send is not.

# PROGRESS -- task-20260727-190116-work-progress-report--projexa

Real Work Progress Report (WPR) feature for PROJEXA.

## Investigation findings (read before continuing)
- PROJEXA stores NO construction domain data itself (`src/lib/db/schema.ts`
  header comment is explicit: "Nothing construction-related is stored here").
  All BoQ/progress/attendance/vendor data lives in VERIDIAN
  (`/opt/veridian/repos/compliance-tracker`), reached via `callVeridian()`.
- `compliance.construction_work_progress_entries` already exists for real in
  VERIDIAN (drizzle/0101_wave115_construction_boq_progress_diary.sql):
  org_id, project_id, activity_id, entry_date, quantity_done,
  percent_complete, remarks, recorded_by_id, created_at. NO cumulative_qty,
  NO amount, NO photo column -- those are computed/added on PROJEXA's side.
- `compliance.construction_boq_line_items`: boq_id, activity_id, item_code,
  description, unit, quantity, rate, amount. This is the real BoQ line item
  entity the report's S.No/Category/Code/Description/Qty/Rate/Amt columns
  come from.
- GAP FOUND: no VERIDIAN v1 endpoint returns BoQ line items at all --
  `GET /api/v1/construction/boq` (aliased at `/api/v1/projexa/scope`) only
  returns BOQ headers (title/version/status), not line items (confirmed by
  reading `listBoqs()` in construction-boq-service.ts). Without line item
  rate/amount, the report's Amt/Percentage columns cannot be computed for
  real. Minimal fix: enrich that GET route's response with each boq's
  `lineItems` (reusing the already-existing `getBoq()` service, zero schema
  change, read-only, additive field) -- a SEPARATE small PR on
  compliance-tracker, since this can't be done from the PROJEXA side alone.
- Category-wise breakdown: BoQ line item -> activity_id -> activity.categoryId
  -> constructionCategories.name (same join VERIDIAN's own
  categoryProgressReport already uses).
- Manpower-wise / vendor-wise: VERIDIAN's OWN real 17-report catalog
  (construction-reports-service.ts's manpowerCostReport/vendorCostReport)
  already establishes the precedent that these breakdowns are
  attendance-cost-based (constructionAttendance x constructionLabourRoster,
  grouped by trade / vendorId), NOT per-BoQ-line attribution -- there is no
  real link from a progress entry to a vendor/roster row anywhere in the
  schema. Following that exact established precedent for the WPR's
  manpower-wise/vendor-wise views (attendance cost within the report's date
  range), disclosed as such rather than inventing a fake per-line
  attribution. PROJEXA already proxies `/api/attendance`, `/api/labour-roster`,
  `/api/vendors` -- no new VERIDIAN surface needed for this part.
- Photo attachment: confirmed (again) no file-upload API reachable from
  PROJEXA, and VERIDIAN's entries table has no photo column. Closing this
  for real, PROJEXA-side only: new `public.work_progress_photos` table
  (org-scoped, RLS, references the VERIDIAN entry by id) + Supabase Storage
  bucket, uploaded via the user's own authenticated session (this repo's
  established RLS-respecting pattern, e.g. org/provision/route.ts), wired
  into the existing offline queue's sync step as a best-effort follow-up
  call (does not gate/alter the main entry sync's queue-removal or retry
  semantics -- existing work-progress-queue.test.ts assertions preserved
  as-is).
- Daily entry UI (WorkProgressClient.tsx) and its offline queue wiring
  (including photo capture into IndexedDB) already exist and are solid from
  a prior task -- not rebuilt, only extended (photo upload on sync, link to
  report).

## Plan
1. compliance-tracker: enrich `GET /api/v1/construction/boq` with
   `lineItems` per boq -- small, additive, read-only PR.
2. projexa schema.ts + drizzle/0013 migration: `work_progress_photos` table
   + RLS + storage bucket + storage RLS policies.
3. projexa `src/lib/work-progress-report.ts`: pure report computation
   (Prev/Current/Total qty+amt+percent per BoQ line item, category-wise and
   scope-wise rollups, manpower-wise/vendor-wise from attendance).
4. projexa `src/app/api/work-progress/report/route.ts`: GET, date-range
   filtered, assembles VERIDIAN data, returns the 4 breakdown views.
5. projexa `src/app/api/work-progress/photos/route.ts`: POST upload
   (Supabase Storage + DB row), GET list-by-entry (signed URLs).
6. projexa work-progress-queue.ts: sync best-effort uploads a queued photo
   after its entry syncs; must not alter existing tested behavior.
7. projexa WorkProgressReportClient.tsx + report page + nav link.
8. Tests: work-progress-report.test.ts (Prev/Current/Total scenario from
   SUCCESS_CRITERIA), offline-sync-to-report integration test, photo route
   unit test.
9. Verify: `npx tsc --noEmit`, `bun test src/lib/offline/work-progress-queue.test.ts`,
   `bun test` scoped to new WPR files.
10. Open PR on projexa (new branch) + PR on compliance-tracker (new
    branch). Do NOT merge either -- fresh supervisor audit required first.

## Completed
- [x] Full investigation (above).
- [x] compliance-tracker (branch `feat/boq-line-items-in-v1-list`, pushed,
      cloned fresh into /tmp/wpr-task-scratch -- the shared repo checkout at
      /opt/veridian/repos/compliance-tracker had unrelated dirty in-flight
      work, same precedent as prior tasks): claimed scope in
      ACTIVE-CLAIMS.yaml first, then (a) `GET /api/v1/construction/boq`
      enriched with `lineItems` per boq, (b)
      `GET /api/v1/projexa/work-progress/activities` enriched with
      `categories`. Both read-only, additive, zero schema/service change.
- [x] projexa schema.ts + drizzle/0013: `work_progress_photos` table + RLS
      + `work-progress-photos` Storage bucket + storage RLS policies (not
      applied live -- no Supabase DB/Management API credentials in this
      sandbox, same disclosed constraint as drizzle/0011).
- [x] `src/lib/work-progress-report.ts`: pure computation (Prev/Current/
      Total qty+amt+percentage per BoQ line item, category-wise rollup,
      manpower-wise/vendor-wise from attendance).
- [x] `src/app/api/work-progress/report/route.ts`: GET, date-range
      filtered, assembles 6 parallel VERIDIAN calls into the 4 breakdown
      views.
- [x] `src/app/api/work-progress/photos/route.ts`: POST upload (Supabase
      Storage + DB row via the user's own RLS-scoped session, not a
      service-role bypass), GET list-by-entry with signed URLs.
- [x] `work-progress-queue.ts`: sync now best-effort uploads a queued photo
      after its entry syncs (closes the disclosed PR #54 gap for real);
      does not alter the main sync's queue-removal/retry semantics.
- [x] `WorkProgressReportClient.tsx` + a "Report" tab alongside the
      existing "Daily Entry" tab on the Work Progress page (no sidebar/i18n
      changes needed -- reuses the existing route).
- [x] Tests (all real, all passing): `work-progress-report.test.ts` (incl.
      the exact day1 30%/day2 20%/Prev=30/Current=20/Total=50 scenario from
      SUCCESS_CRITERIA), `work-progress-offline-to-report.test.ts`
      (real queue + real IndexedDB + real report builder, proves an
      offline-captured entry syncs -- including its photo -- and its synced
      data drives the report's Current column correctly).
- [x] `npx tsc --noEmit` -- clean (NODE_OPTIONS=--max-old-space-size=6144).
- [x] `bun test src/lib/offline/work-progress-queue.test.ts` -- 10/10 pass
      (all pre-existing tests, unmodified, still pass).
- [x] `bun test src` -- 58/58 pass repo-wide (9 files, incl. the 3 new WPR
      test files above).
- [x] `npx eslint` on every new/changed file -- clean.

- [x] PR opened on projexa: https://github.com/FChecklist/projexa/pull/58
- [x] PR opened on compliance-tracker: https://github.com/FChecklist/compliance-tracker/pull/608

## Remaining
- [ ] Do NOT merge either -- fresh supervisor audit required first (both PR
      descriptions say so explicitly).
