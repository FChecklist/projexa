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

## Remaining
- [ ] Steps 1-10 above, in order.
