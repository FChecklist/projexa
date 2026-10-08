# Delta only: a laptop downloads only what changed

Owner rule (binding): the laptop downloads ONLY WHAT IS NEEDED, never everything again. An app update brings only the changed files. Laptop to laptop moves only what changed. Laptop to Supabase moves only what changed, in both directions, never the full data and never the full app again.

Each path below says what is sent, the committed test that fails if it regresses, and the documented exceptions. Every test was proved with a throwaway mutant (the code broken on purpose, the test seen to fail, the code restored).

Run any of them with `bun test --isolate <file>`.

## 1. App update (release files)

| Situation | What crosses the wire | Proof |
|---|---|---|
| Same release already installed (sign in again, sign out and in as the same person, refresh, the 6-hourly check) | `GET /_release/release.json` only (about 1 KB). No bundle, no file | `release/installer.test.ts` "installing the release that is already installed and complete does nothing but read the manifest"; `persistence.test.tsx` "an installed, complete release is not looked at again for six hours" |
| E-mail submit on the login page (pre-warm, `release/prewarm.ts`) with a release already installed | the manifest only. The bundle is NOT downloaded | `release/prewarm.test.ts` "a laptop that already has a release installed reads only the small manifest: no bundle, however often the e-mail is submitted" |
| New release N+1 (the 6-hourly check, `persistence.ts`) | the manifest and ONLY the files whose sha256 differs, each from its own URL. The other files are copied from the old cache (re-hashed). The service worker then switches to the new cache | `release/installer.test.ts` "fewer than half..." and "half or more of the files changed: STILL only the changed files"; `release/release-update.test.ts`; `persistence.test.tsx` "a newer release is picked up when the check comes due" (asserts no bundle request and exactly 2 requests) |

Fixed in this package (it sent more than the change):
- `prewarm.ts` downloaded the whole bundle (the full tar.gz) every time the e-mail was submitted, even on a laptop that already had the release. Now it reads the small manifest and stops when a release is installed (`hasInstalledRelease`, default: the device meta).
- `installer.ts` fetched the whole bundle when half or more of the files changed. Now it fetches only the changed files whenever the old copy is still on the laptop and at least one file is unchanged.

Documented exceptions (the bundle is used):
- a first install (nothing on the laptop to reuse; the pre-warm then holds the bundle so the installer does not download it a second time);
- the old release cache was emptied by the browser;
- every single file differs (nothing to reuse, so the one bundle is the cheapest way).

## 2. Data pull from Supabase (laptop <- server)

| Situation | What crosses the wire | Proof |
|---|---|---|
| Nothing changed anywhere | one `GET /heads` per 5 minutes while the tab is visible; zero row bodies, zero feed reads | `cost/cost-budget.test.ts` (a), (a'), (f) "quiet" |
| A colleague (or another laptop) changed one row | `/heads` says which project moved, then `POST /changes {after_seq}` for that project only, then `POST /pull {ids:[that one]}`: ONE row body | `cost/cost-budget.test.ts` (f) "colleagueChange"; `cost/delta-only.test.ts` "a change in ONE project" (exactly one project's feed read, the other four cost nothing) |
| 8 days open | the daily whole sync reads the manifest and the feeds from the stored position; zero row bodies | `cost/delta-only.test.ts` "8 days open and idle" |
| Reconciling deletes | `/ids` returns ids only, never a row body; a feed-covered pair is checked at most weekly | `cost/delta-only.test.ts` "the reconciliation of deletes"; the harness counts `idsListed` apart from `rowBodies` |

The stored cursor and feed position (`sync:cursor:*`, `sync:changes:*`) are what make the second and every later sync a delta. `replica.ts` skips a pair that the feed keeps current (`feedCovered`), and `applyChangePage` fetches only the ids whose version is newer than the laptop's.

Documented exception, metadata only: the first `/changes` read of a moved project re-reads up to `CHANGE_FEED_OVERLAP` (200) change entries below the stored position. This is the backend's documented commit-ordering limit (drizzle/0679). An entry is an id and a version (about 80 bytes), never a row body, and a version the laptop already holds is not fetched again. It costs at most about 16 KB per moved-project read. It is held by `DELTA_BUDGETS.changeEntriesPerRead` in `cost/budget.ts`. It disappears when the backend's commit-order-safe cursor lands (set the constant to 0).

The ONLY full re-copies of a project the laptop already holds, each rare and now written to the laptop's own short log (`sync:recopy-log`, last 20, no request):
- `view_class_changed` (the person's role or cost visibility changed, so rows were cut for another role);
- `epoch_changed` (the server's version tables were re-created);
- `reset_required` (the server pruned the feed past this laptop's position);
- `heads_view_class_or_epoch` (the same first two, seen by the 5-minute poll);
- storage wiped by the browser or by the person (nothing left to compare), and a schema bump.
Proof that the re-copy is logged and is the only one: `cost/delta-only.test.ts` "the documented full re-copies are rare and always logged on the laptop".

Fixed in this package: the re-copy cases above were silent. They now leave an entry (`replica-class.ts` `noteRecopy`).

## 3. Data push (laptop -> server)

An edit queues ONE op: `{op_id, function_id, project_id, params, record:{kind,id,base_version}, client_at}`. `params` holds the ids and ONLY the changed fields. The record is not sent, and the project is not sent. Each op is sent once: the outbox ledger removes it when acknowledged, and a second flush finds nothing.

- `local-writes.test.ts` "a title-only edit sends EXACTLY the title, the ids and the base version; flushing again sends nothing" (three flushes, one `/push`, one op, exact params).
- `cost/cost-budget.test.ts` (f): one edit is one push op (`pushOps` 1) and under 700 request bytes in the following half hour; (b) 30 edits are 30 pushes.
- Existing: `outbox-single-send.test.ts` (exactly-once), `file-queue.test.ts` (a file is never uploaded twice).

## 4. Laptop to laptop (peers)

The pair first exchanges a digest per (project, kind) (`have`). A kind with equal digests costs nothing. For a kind that differs, the receiver sends its ids and versions (`want`, no bodies) and the sender returns only rows strictly newer than those versions (`items`). Deletes travel as tombstones and as a `gone` hint that makes the laptop ask the server, never as row bodies. A reconnect after a sync finds equal digests and sends nothing.

Proof, `peer/delta-only.test.ts` (180 rows per project, a tap on the link counts rows and bytes):
- equal data: zero `items`, zero `want`;
- one row edited: exactly one row, one kind asked, bytes about one row;
- a reconnect straight after: nothing;
- changes on both sides: each row crosses once in one direction;
- a `want` never contains a row body.

Documented: for a kind whose digest differs, the `want` lists every id and version of that kind (about 20 bytes each, ids only).

## 5. Files

- An uploaded file is sent once. The job moves `waiting` to `uploaded` before the record is queued, and the bytes are dropped after. Proof: `shell/file-queue.test.ts` "uploaded but the record could not be kept just now: the file is NEVER uploaded twice", "two flushes at once share one run".
- A kept file is read from the laptop's file cache and is not downloaded again; download happens only on the person's explicit "keep" tap. Proof: `shell/modules/documents-shell.test.tsx` "a file kept on this laptop is shown offline" (zero requests), `documents-file-cache.test.ts`.

Documented: the file cache is keyed by document id. A new revision of a drawing is a new document id, so it is downloaded as a new file by design.

## The delta scenario in the budget

`cost/scenarios.ts` `delta()` (scenario (f) in `cost/cost-budget.test.ts`) runs two synced laptops on the real client code against the fake server and measures bytes and row bodies (`Wire` in `cost/harness.ts`, `DELTA_BUDGETS` in `cost/budget.ts`):

| Event | Row bodies on the wire | Bytes |
|---|---|---|
| first copy (yardstick) | 380 | about 155 KB |
| quiet half hour, per laptop | 0 | about 1.3 KB (the heads polls) |
| one edit on A | A: 0 received, 1 op sent; B: exactly 1 | about 13 KB for both laptops together, mostly the overlap entries above (under 10 percent of the first copy) |
| one colleague change on the server | 1 per laptop | about 1.1 KB per laptop |

A regression that re-pulls a project, sends an op twice or sends a record fails this scenario.

## Mutants proved

| Mutant (reverted afterwards) | Test that failed |
|---|---|
| prewarm: remove the installed-release check | `prewarm.test.ts` returning-person test |
| installer: restore the half-the-files rule | `installer.test.ts` "STILL only the changed files" |
| replica: treat every pair as not feed-covered and pull from cursor null | `cost-budget.test.ts` (f) (76 row bodies instead of 1) and `delta-only.test.ts` "ONE project" |
| sync client: send every op twice | `cost-budget.test.ts` (f) pushOps 2 instead of 1 |
| local-writes: send the whole row with the edit | `local-writes.test.ts` title-only test |
| peer protocol: ignore the receiver's known versions | `peer/delta-only.test.ts` (2 tests) |
| file queue: upload a job that is already uploaded | `file-queue.test.ts` "NEVER uploaded twice" |
