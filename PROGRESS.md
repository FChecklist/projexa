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
