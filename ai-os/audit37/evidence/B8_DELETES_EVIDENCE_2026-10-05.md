# AUDIT-100 B8: deletes and record kinds sync. Evidence, 2026-10-05

## Verdict
- **Server (backend) leg: FIXED and VERIFIED live.** A meeting deleted through the real `POST /push` (`delete_meeting`) no longer comes back from `/pull` or `/ids`, and `/changes` carries its `D`.
- **Laptop leg: NOT YET.** Laptop B still held the deleted meeting after 10 min (run 1) and after 20 min (run 2). The cause is in the laptop's peer sync, not the backend (see below). The spec keeps this leg as a `test.fail` with that exact reason.

## The backend defect and fix
- `delete_meeting` is a soft delete. It sets `compliance.pms_meetings.deleted_at` (drizzle/0687), and the 0687 tracking (mode `col_unset`) tombstoned the sync head (`projexa_record_head.deleted = true`, v2).
- The READ side never learned about the column. `projexa_sync__src('meetings')` (0683) and `ai_work_link__records_core('meetings')` (0643) still scoped meetings on project and org only. So `/pull` kept serving the row, `/ids` kept listing it, and pull-by-ids returned it.
- Fix: compliance-tracker PR #2081, merged as `862ce1254963e233ba5db0e047230e66f0e1d97a`. Migration `0727_projexa_sync_meeting_soft_delete_read` adds `AND t.deleted_at IS NULL` to the meetings scope in both functions. Both are otherwise identical to the live definitions, and grants are unchanged (owner-only).
  - Applied live 2026-10-05 through the Management API; recorded as `supabase_migrations.schema_migrations` version `20261005161701`. The SQL layer only, so no Edge function redeploy.
- Committed test that fails without the fix: `src/lib/services/projexa-sync-meeting-delete.pglite.test.ts`. It runs the real projexa-sync handler on PGlite and re-reads the DB.
  - With `B8_BREAK=1` (0727 not applied): 2 fail.
  - With 0727: 5 pass.

## Every delete-like function in `platform.ai_work_link_functions` (16)
| function | service effect | sync effect |
|---|---|---|
| delete_meeting | soft delete (`deleted_at`) | was served after delete; fixed by 0727 |
| delete_attendance, delete_progress_entry, delete_time_entry, delete_permit (a `documents` row), delete_boq (+ its lines and progress) | hard DELETE | source row gone; delete trigger tombstones it. OK |
| remove_mood_board_item, remove_room, remove_placement | hard DELETE of child rows | child tables are not synced kinds. N/A |
| archive_task, delete_mom (status `deleted`), delete_boq_category (`is_active` false), void_material_receipt, cancel_change_order, archive_project, remove_sprint_task | status change by design | synced as a versioned update carrying the new status, the same on tracking and read side. OK |

## Live runs (`e2e/audit37-real-b8-kinds-deletes.spec.ts`, real projexa-sync, E2E test org `4ecc472f-...`, project `x2dtwimz8t809y1l5d27gccx`)
- Run 1, meeting `hphnwxifswyjlrazs3v2nqhh` (created 16:24:20, deleted 16:24:34 UTC):
  - kinds test passed.
  - Server assertions passed: not in `/pull`, not in `/ids`, `D` in `/changes` after the pre-delete head.
  - The laptop-drop poll (600 s) failed.
- Run 2, meeting `rcm093byq8c1jh496x30dtko` (created 16:39:32, deleted 16:39:47 UTC): the same result, with the laptop-drop poll at 1200 s.
- Database re-read after both runs:
  - Live `projexa_sync__src('meetings')` scope = `t.project_id = $1 AND t.org_id = $2 AND t.deleted_at IS NULL`.
  - 0 of the two deleted meetings are in the candidate set.
  - `ai_work_link__records_core` by id returns 0 items.
  - `projexa_sync__items` for both ids returns 0 items.
  - Both source rows are soft-deleted (`deleted_at` set), and there are 2 `D` entries in `platform.projexa_change_log`.

## The remaining laptop gap (cause from code reading; not yet proven live)
1. A server `D` makes the laptop delete the local row with no tombstone (`src/lib/local-first/local-db.ts` `deleteRecords`, `store.delete(id)`).
2. The peer protocol refuses an older row only when a local row EXISTS (`src/lib/local-first/peer/protocol.ts`, `not_newer` check). Laptop A still holds version 1 until its own next feed run, so it can hand the deleted meeting back to B. B's page showed "Synced with 1 laptop".
3. B's change cursor is already past the `D`, and the laptop never calls `/ids` (0 `/ids` requests in the traces), so B keeps the row for good.
- Fix direction: keep a server tombstone (kind, id, deleted version) locally, and make the peer `local()` lookup report it so an older row is refused as `not_newer`. Alternatively, reconcile against `/ids`.
- Also measured: B's first full copy of ~18 projects runs at the 100 requests/min pace for about 6 minutes. In run 1, laptop requests aborted after 10-21 s from 16:30 UTC under that load.

## Cleanup (E2E org only)
- Deleted 11 leftover RFIs: subject `B7 online RFI audit100-<ts>` / `B18 offline RFI audit100-<ts>`, all older than 60 min.
- Deleted 3 leftover meetings from the earlier B8 attempts (`vy0p6dho...`, `e9oz3fze...`, `aufz17yy...`).
- The two meetings from these runs (above) were deleted after the evidence was recorded.

## Laptop fix (2026-10-06, branch `audit100/b8-laptop-tombstones`)
- `src/lib/local-first/local-db.ts` schema 5: a `tombstones` store. Every server delete (feed `D`, pull `deleted`, `/ids` reconcile, server-confirmed peer hint) and the person's own applied `delete_*` leaves `{kind, id, version, deletedAt}`; `putRecords` never stores that record again at that version or older (a newer server version replaces the tombstone). Bounded: 30 days, at most 5,000, cleared with the project.
- `src/lib/local-first/peer/protocol.ts`: a row covered by a tombstone is refused (`deleted`); tombstones go in `want.known`; a `gone` HINT (unsigned, so it deletes nothing) tells the stale laptop, which stops sharing the row and asks the server by id (`replica.ts verifySuspects`).
- `src/lib/local-first/replica.ts`: a pair that took peer rows is reconciled against `/ids` at its next run (one-project runs included, at most hourly, inside the budget).
- Tests, each seen failing on the old code: `src/lib/local-first/peer/tombstones.test.ts`, `src/lib/local-first/local-db-v5.test.ts`, `e2e/lf-peer-deletes.spec.ts` (real Chromium, two laptops, real peer link). The real-backend laptop leg in `e2e/audit37-real-b8-kinds-deletes.spec.ts` is an ordinary test again, kept for a by-hand run.
