# PROJEXA local-first: the contract between a laptop and the backend

Owner order 2026-10-02: the user's laptop is a daughter server (so Vercel does little or nothing), it syncs two ways with our backend and with other laptops of the same
organisation, everything on the laptop carries a **version number and a date**, and the backend **records** those versions so update history is kept and versions drive sync.
This file is the one spec the laptop code (`projexa/src/lib/local-first/**`) and the backend (`compliance-tracker/supabase/functions/projexa-sync/**`, `drizzle/0677..0684`) share.

**Which side is the truth.** The backend's handler (`supabase/functions/projexa-sync/handler.ts`, with its SQL and `README.md`) is the implemented behaviour, and this file
describes it. It is no longer "the file wins": this file drifted from the code once (see the change list at the end) and the laptop was built against the drift. Every rule
below is checked against the REAL handler by `src/lib/local-first/conformance/wire.integration.test.ts` and `conformance/parity.test.ts` (how to run them:
`docs/local-first/CONFORMANCE.md`). When this file and the handler disagree, the conformance run says which; fix this file, or file a backend bug when the handler's behaviour
is the wrong one, and say which you did.

**Synced with the backend on 2026-10-02 (package lf-e6)** against `compliance-tracker` branch `feat/lf-sync-backend` (`supabase/functions/projexa-sync/README.md`, `handler.ts`,
`sign.ts`, `drizzle/0681`, `drizzle/0684`). The backend is being hardened in parallel (an independent review found 80 issues: CORS, push exactly-once, change-feed ordering,
retention; packages D1-D3). This file describes the wire as that README and handler document it today; everything the hardening may change is listed in section 7, "May change".

Base URL of every call: `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync` (a Supabase Edge Function, never Vercel).
Every call: `Authorization: Bearer <the person's PROJEXA Supabase access token>` and header `X-Px-Client: <release_version>; protocol=<n>; schema=<n>` (today `protocol=2; schema=3`).
Authority is never decided on the laptop: the person, the project, the row scope and every redaction are decided by SQL (`projexa_*`), which reuses the AI work link's own rules.
An unknown project, an unknown kind, another organisation's project and a project the person may not read are ONE answer: `404 {"error":"Not found"}`. A sign-in that does not resolve
to a PROJEXA person: `403 {code:"NOT_LINKED"}`. A bad token: `401`. The database unreachable: `503`.

**CORS and the browser.** Allowed origins: `https://projexa-ai.com`, `https://www.projexa-ai.com`, `http://localhost:3100`, `http://localhost:3101`. A preflight (`OPTIONS`) is answered
`204` with `Access-Control-Allow-Methods: GET, POST, OPTIONS`. Because every call carries `Authorization` and `X-Px-Client`, a browser sends a preflight first: the preflight must allow
`x-px-client` and be cacheable, or every call fails in the browser / costs a second invocation. On `feat/lf-sync-backend` the allow-list is still `authorization, content-type` with a
600 s max-age (**a browser blocks every call**); the fix (allow `authorization, content-type, x-px-client`, expose `Retry-After`, `Access-Control-Max-Age: 7200`) is on
`claude/lf-d1-edge-fixes` (commit `3b62d5c6`) and must be merged before any laptop syncs from a browser. Every error answer carries the CORS headers so the laptop can read it.

**Limits.** 120 requests a minute per person (per Edge isolate; then `429` with `Retry-After: 60`); request bodies 4 KB (push 256 KB, jobs 300 KB).

## 0. Versions (the heart of it)

| Thing | Number | Where it lives | What it is for |
|---|---|---|---|
| **Release** (the downloaded app, one bundle) | `release_version` = `YYYY.MM.DD-NNN`, e.g. `2026.10.02-003` (date + a 3-digit build number, `scripts/make-release.mjs`: `BUILD_NUMBER`, or where none is set (Vercel) the build's UTC time of day in 86.4 s steps, so string order is build order -- the `min_compatible` gate below relies on it; AUDIT-100 B13), plus `git_sha`, `built_at`, `manifest_sha256` (the image digest) | `platform.projexa_release` (backend), `meta['app:release']` (laptop) | the laptop's code and the backend must match; the backend can say "update required" |
| **App file** (each file inside the bundle) | `file_no` (permanent number of that path, never reused), `file_version` (1, 2, 3 ... bumps when the bytes change), `sha256`, `size` | `platform.projexa_release_file`, `app_files` store on the laptop | exact update history per file; an update downloads only files whose version moved |
| **Install** (one laptop got one release) | `device_id`, `release_version`, `downloaded_at`, `installed_at`, `previous_release`, `files`, `bytes`, `status` | `platform.projexa_client_install` | who has what, when; the history of every update of every laptop |
| **Record** (a project / task / BOQ line ...) | `version` (integer, +1 on every real change, a delete included; 0 = never changed since versioning began), `content_hash`, `updated_at` | `platform.projexa_record_head` + append-only `platform.projexa_change_log` (`seq`) | conflict detection on push, change/delete propagation on pull, peer exchange |
| **Sync protocol** | `protocol` integer (now `2`) and the laptop database `schema` integer (now `3`) | header `X-Px-Client`, `LOCAL_DB_VERSION` | see the gate below |

**The update gate (426).** A request is answered `426 {error, code:"UPDATE_REQUIRED", current, min_compatible, protocol, reason:"protocol"|"release"}` when the laptop speaks
another `protocol`, or when its release matches `YYYY.MM.DD-NNN` AND is below `min_compatible` (string order). A release that does not have that form (`dev`, a commit SHA, a
short build number such as `-3`) is never gated, on purpose: development builds keep syncing. A release with a short build number also cannot be registered
(`/release/register` refuses it). `release/current`, `release/register` and `install` stay reachable for a laptop that must update.

## 1. Pull

`GET /manifest` -> `{user:{id, auth_user_id, name, role, org_id}, projects:[{id, name, status}], kinds:[{kind, project_scoped, cursor_field, deletes_supported}], view_class,
org_kinds:[...], org_view_class, release:{current, min_compatible, protocol}, server_time}`
- **`user.id` is the VERIDIAN person (`compliance.users.id`, a cuid). `user.auth_user_id` is the verified token subject: the SIGN-IN id the laptop knows the person by
  (`supabase.auth.getUser().id`). They are different strings.** A laptop stores a manifest only when `user.auth_user_id` equals its own sign-in id (an older service without
  the field is compared by `user.id`); its database is named by the sign-in id (`sync-client.ts manifestSignInId`).
- `kinds`: the **28** project kinds of `handler.ts SYNC_KINDS` (0677 + 0683); `cursor_field` is `updated_at`, or `created_at` for a table that has none.
- `org_kinds` / `org_view_class`: the organisation kinds (0684; not yet consumed by the laptop engine).
- `view_class`: 16 hex, a fingerprint of what this person's role redacts. Two laptops exchange rows directly only when it is equal.
- `release.current` is the newest registered release, `release.min_compatible` the oldest still allowed to sync; both `null` when the registry is empty.
- `deletes_supported: true` on a kind means the change feed carries EVERY change of that kind, tombstones included: the laptop then keeps a pulled-to-the-end (project, kind) current by `/changes` + pull by ids alone and never re-sweeps it (package lf-e6, `replica.ts`). A kind with `deletes_supported` false or absent keeps the keyset pull.
- `internal_ai` (or `features.internal_ai`): **not sent today.** Absent = PROJEXA's own AI is OFF on the laptop (the backend's default, `PROJEXA_INTERNAL_AI_ENABLED` unset); the laptop
  sends no internal-AI request and points the person at their own AI (`ai-off/internal-ai.ts`). Only an explicit `true` turns those entry points on.

`POST /pull {project_id, kind, after, limit}` (keyset; `limit` 1..500, default 200) **or** `{project_id, kind, ids:[1..200 ids]}` (exact rows) ->
`{items:[{id, updated_at, version, data, sig}], kid, next_cursor, has_more, hidden_fields, redacted, server_time}`
- `version`: the record version above. `sig`: ES256 signature (base64url raw r||s) over the message below; `kid`: the key id (null = unsigned, never pass such a row to a peer).
- `next_cursor` is opaque (today base64url of `[ts, id]`); send it back unchanged. A malformed one is `400 Bad cursor`.
- `ids` mode exists because a table without `updated_at` cannot be seen by the keyset cursor when a row changes; `/changes` names such rows and `ids` fetches them.
- `data` is the AI work link's record: the table's own **snake_case** column names, numbers as JSON numbers (`{id, boq_id, item_code, quantity: 120.5, rate: 450, ...}`),
  not the online screens' camelCase shapes. A `boq_lines` row has no BOQ title/version/status: those are the `boqs` kind. The laptop maps rows to its screens' shapes
  (`boq-local.ts linesFromReplica`); it never assumes the screen shape on the wire.
- Role redaction: a hidden column is sent as `null` (or omitted when its kind says so) and the row carries `redacted: true`; the page lists `hidden_fields` and says `redacted`.

Signed message (UTF-8): `px2|<org>|<project>|<kind>|<id>|<version>|<updated_at>|<sha256hex(canonicalJSON(data))>`.
`canonicalJSON` = JSON with object keys sorted at every level (arrays keep order, `undefined` members dropped). Fixed vector (both repos assert it):
`{"b":[1,2.5,"x"],"a":{"z":null,"y":"é\n\"","x":-0.5},"c":true}` -> `{"a":{"x":-0.5,"y":"é\n\"","z":null},"b":[1,2.5,"x"],"c":true}` -> sha256 `bcbc2a5c6e5947a6e1ed5e22aaa51395f6b040407127c6d9a870c7872ce8e565`.

`POST /changes {project_id, after_seq: int|null, limit 1..1000}` -> `{changes:[{seq, kind, id, version, op:"I"|"U"|"D"}], next_seq, has_more, head_seq, server_time}`
- `after_seq: null` returns no changes, `next_seq = head_seq` = the project's current head (read it BEFORE the first full pull and store it, so nothing is missed in between).
- An empty page answers `next_seq = after_seq`; otherwise `next_seq` is the last `seq` of the page.
- `D` is a tombstone: delete the local row. `I`/`U`: if the local `serverVersion` is lower, fetch the row (`ids` mode). Only the 28 synced kinds appear.
- **Overlap (laptop rule).** `seq` is taken when a row is written, not when its transaction commits, so a long transaction becomes visible with seqs BELOW a position a laptop
  already holds (`drizzle/0679` header, KNOWN LIMIT). The backend now serves the feed under a commit-order-safe horizon (drizzle/0679, package D3: change rows carry their transaction id and a page never passes an open transaction), so the overlap is only a safety margin; a laptop still re-asks the first page of every run from
  `max(0, position - 200)` (`replica.ts CHANGE_FEED_OVERLAP`; it may be set to 0 once the deployed backend is confirmed to carry D3). Re-reading is idempotent (versions already held are skipped).
- COST: one `/changes {after_seq: <stored>}` is both the "did anything move?" check and the catch-up; the laptop reads the open project's feed on every scheduled run and every
  other project's at most hourly, and a whole sync (manifest + every feed) every 6 hours (`peer/server-step.ts`). Measured cost per laptop: `docs/local-first/COST_MODEL.md`.

**Organisation kinds (0684).** `vendors` (`erp_suppliers`), `customers`, `companies`, `boq_categories`, `currencies`, `exchange_rates`, `departments`, `org_people` (`users`; not the AI link's
project kind `people`) and `cost_visibility`. Same routes, no project: `POST /pull {kind, after, limit}` or `{kind, ids:[<=200]}` with `project_id` absent, null or `"__org__"`;
`POST /ids {kind, after_id, limit}`; `POST /changes {project_id:"__org__", after_seq, limit}`. Rows are signed exactly like project rows with project `"__org__"`. Every query is the
person's own organisation; rank >= 2 (member) for every kind but `cost_visibility` (>= 1); below it, the one 404. Columns are an explicit allow-list (no tax ids, bank accounts,
passwords, auth ids, internal notes); `org_people` is `id, name, role, is_active, email` with every email but the person's own masked, and is `peer_shareable: false`; `credit_limit`
is null below rank 3. **The laptop's sync engine does not consume organisation kinds yet** (package E7 adds them; module adapters take masters through their own interface). The feed also answers `GET /heads` (migration 0686): `{heads:{<project>:head, "__org__":head}, projects_etag, role, view_class, org_view_class, epoch}`, the one-call poll: call `/changes` only for a project whose head moved, `/manifest` only when `projects_etag` changed, and reset the copy when a class or the epoch changed; `reset_required` on a feed page means resync that project.
- A person only ever sees changes of projects they may read now (same bind as pull); one answer (404) for a project they may not.

`POST /ids {project_id, kind, after_id, limit 1..5000}` -> `{ids, has_more, next_id, server_time}` (`next_id` = the page's last id): full id inventory, the repair path for
deletes made before change tracking existed. Run at most once per project and kind per day.

## 2. Push

`POST /push` body `{device_id, ops:[{op_id, function_id, project_id, params, record?:{kind, id, base_version}, record_kind?, resolution?, client_at}]}`
-> `{results:[{op_id, status, record_id?, route?, version?, base_version?, server?:{kind,id,version,updated_at,data,sig,kid}|null, error?:{code, missing?}}], server_time}`
- `device_id`: 8..64 characters of `[A-Za-z0-9_-]`. `op_id`: 8..128 of the same (a UUID). 1..50 ops, a body of at most 256 KB, and each op at most 64 KB as JSON
  (a larger op is rejected `BAD_OP`). Ops are applied in order.
- `record` names the row an edit changes and the version the laptop edited (`base_version`). `record_kind` names the kind a CREATE makes (e.g. `"rfis"` for `create_rfi`), so the
  answer can carry the new row; without it a create's answer has no `server` row.
- `resolution` is accepted and IGNORED by the server: a conflict is decided by `base_version` alone (see `conflict`).
- Every TEXT value in `params` is at most **2,000 characters** (the AI link's text rule, `_shared/ai-link/core.ts` `textMax`); a longer one is `rejected` by the pipeline, so the laptop refuses it at the edit, not after a round trip.
- An edit (`update_*`, `set_*`, `delete_*`) MUST carry `record` {kind, id, base_version}, or the op is `rejected RECORD_REQUIRED` (package D2): the conflict rule cannot be skipped by leaving it out. A record of another project reads as version 0, exactly like a made-up id.
- Caps (SQL, `projexa_sync_push_begin`): 600 ops an hour and 5 `create_project` a day per person. Each op is ONE more Edge invocation (`ai-work-link-exec`), on top of the push.
- The laptop's outbox sends `record_kind` for a create (package FB) and refuses an op over 64 KB or a text over 2,000 characters BEFORE queueing, so the person's text stays in the form (an op over the edge's 60,000-byte cap is `TOO_LARGE` at the edge, package D1).
- A whole-request **403** (`NOT_LINKED`) pauses the laptop's outbox with one message until the person tries again; other whole-request refusals (400/404/413) are tried at most 3 times, then the person is asked.

`function_id` is a function of the AI work link registry (the same ids the PROJEXA pills use). The backend runs it through the **real pipeline** as the person with their LIVE role
(role gates, cost visibility, text rules, money validation, same-project checks are the existing TypeScript services', not reimplemented). A laptop only **proposes**: money and
approval figures are never accepted as computed by the browser; only the person's intent (`params`) is sent and the server recomputes.

Statuses:
- `applied` - done; `record_id`/`route` as the pipeline answered, `version` the record's new head version, `server` the signed row at that version (or `null` when it cannot
  be read back).
- `duplicate` - this `op_id` with the same content was already applied; the stored `record_id`/`route`/`version` are returned again, with NO `server` row (idempotent; safe to
  retry after a lost response). The same `op_id` with other content is `rejected OP_ID_REUSED`; an op that was rejected answers its stored refusal again.
- `conflict` - the head `version` is above `record.base_version` (a delete counts): nothing was written; the answer carries `version` (the head), `base_version`, and
  `server` = the current signed row, or `null` when the row was deleted or is no longer readable. The laptop shows both and the person chooses *keep theirs* (drop the op) or
  *keep mine* (resend with `base_version` = the server's version).
- `rejected` - permanent no. Drop the op, tell the person why in plain words. Never retried. Codes the service sends: `BAD_OP` (shape), `FUNCTION_NOT_ALLOWED` (not a write the
  laptop may send), `ROLE_TOO_LOW`, `PROJECT_NOT_READABLE`, `OP_ID_REUSED`, `CAP_DAY` (5 `create_project` a day), and the pipeline's own validation codes
  (`VALUE_REQUIRED`, ...). The laptop's sentences for them are in `src/lib/task-errors.ts`.
- `failed` - transient or uncertain (`EXECUTION_UNCERTAIN`, `IN_PROGRESS`, `RATE_LIMITED` at 600 ops/hour, `PREVIOUS_OP_BLOCKED`, a transient pipeline code). Keep the op,
  retry with the same `op_id` after a back-off; the ledger guarantees at most one effect. A record whose op did not apply holds its later ops in the same request
  (`PREVIOUS_OP_BLOCKED`).
- **`EXECUTION_UNCERTAIN` is resolved by the server, not parked** (package D2): a resend of the same `op_id` is `IN_PROGRESS` while the claim is fresh; once it is stale (a claim stuck `running` for ten minutes, or an `uncertain` one older than two) the SQL settles it by the record's version: for an edit, head still equal to `base_version` means the write never happened and it runs once more, head above `base_version` means it did (answer `conflict` with `uncertain_prior`, and the current signed row); a create has no such check and answers `rejected UNCERTAIN_CHECK_SERVER` (look at the record after the next pull). Push error classes come from the pipeline's real transient codes: a transient failure (`BACKEND_UNAVAILABLE`, `UPSTREAM_TIMEOUT`) is `failed`, never `rejected`.
- **What the laptop does** (package FB, `outbox-merge.ts`, `outbox.ts`): on `conflict` a field-level three-way merge (R12): fields only one side changed merge by themselves and the op is re-sent against `server.version`; an op whose every field already holds its value is "already in"; only a same-field disagreement (or any money/approval field) reaches the person: *keep theirs* (the newest server row the laptop knows) or *keep mine* (re-send with `base_version` = the newest server version). `server: null` means the row was DELETED: *keep my version as a new one* (where a create exists), *keep my text*, or *discard*. On `rejected` the person's text is kept as a **draft** (local schema 4) until they re-send or discard it. `failed` ops are retried with the same `op_id` after a back-off (2 s doubling to 5 min); an UNCERTAIN outcome is re-sent a bounded number of times ("checking"; the server now settles it by the record's version, see above), then the person chooses *send again* (same `op_id`) or *stop and keep my text*.
- `needs_server` - the function cannot run on the edge (stubbed dependency). Keep the op; the laptop offers the normal online path.
- Whole-request answers: `400` (bad `device_id` / op count), `401` sign in again, `403 {code:"NOT_LINKED"}` the sign-in is not linked to an active PROJEXA person (nothing
  ran), `413` body too large, `426`, `429`, `503 PUSH_NOT_AVAILABLE`.

A laptop edit is applied locally at once (optimistic, row marked `dirty` with the op id) and the op waits in the **outbox** until it is `applied`/`duplicate`; then the row is replaced by the server's row at its new version.
A `dirty` row is never overwritten by a pull or a peer and is never deleted by a reconcile, and it is never handed to a peer.

## 2a. Limits, errors and browsers (every route)

| Limit | Value | Answer |
|---|---|---|
| Request body, every route but push and jobs | 4,096 characters | `413 {error:"Body too large"}` |
| Push body / jobs body | 262,144 / 300,000 characters | `413` |
| Pull by ids | 1..200 ids of `[A-Za-z0-9._:-]{1,64}`; the laptop sends at most 80 ids and 3,500 characters per request (`sync-client.ts chunkIds`) so 200 uuid ids never meet the 4,096 cap | `400` |
| Requests per person | 120 a minute (per Edge isolate) | `429 Retry-After: 60` (the daily quota `429` carries no Retry-After) |
| Unknown / unreadable project, unknown kind | one answer | `404 {error:"Not found"}` |
| Unknown route / wrong method | | `404` / `405` |
| Not signed in / not linked | | `401` / `403 {code:"NOT_LINKED"}` |
| Service down | | `503` |

CORS: origins `https://projexa-ai.com`, `https://www.projexa-ai.com`, `http://localhost:3100`, `http://localhost:3101`. The laptop sends `authorization`, `content-type` and
`x-px-client`, and reads `Retry-After`; the preflight must allow the first three and the answers must expose the last (`Access-Control-Expose-Headers`). (At the time of
writing the deployed handler allows only `authorization, content-type` and exposes nothing: backend review COST-01/F02, being fixed; the conformance harness's W27/W27b are the
check.)

## 3. Release bundle, files and installs

Build output (`scripts/make-release.mjs` after `next build`): `public/_release/release.json` and `public/_release/px-<release_version>.tar.gz` (ONE file holding every static asset, like an image).
`release.json`: `{release_version, git_sha, built_at, protocol, schema, bundle:{path, size, sha256}, files:[{path, size, sha256}...], manifest_sha256}` where `manifest_sha256` = sha256 of the canonical JSON of everything before it.
- `GET /release/current` -> `{current:{release_version, manifest_sha256, built_at, files:[{path, file_no, file_version, sha256, size}]}, min_compatible, registered:boolean}` (file numbers and versions are assigned by the registry, not by the build).
- `POST /release/register {}` -> the server fetches `release.json` from the allow-listed origin `https://projexa-ai.com` itself and registers it (idempotent: the same `manifest_sha256` is a no-op; a path whose sha256 changed gets `file_version + 1`; a new path gets the next `file_no`). Takes no input from the caller, so it cannot register anything the owner did not publish. A `release_version` not of the form `YYYY.MM.DD-NNN` is refused.
- `POST /install {device_id, release_version, manifest_sha256, previous_release?, downloaded_at, installed_at, files, bytes, status:"installed"|"updated"|"failed", error?}` -> records one row of that laptop's history.
The laptop installs by downloading the bundle (or only the files whose `file_version` moved), verifies every `sha256`, writes them into Cache Storage under `px-release-<release_version>`, stores the file table (`app_files`) and `meta['app:release']`, switches the service worker to the new cache, then deletes the old cache. Verification fails -> nothing switches.

## 4. Peers (laptop <-> laptop)

`POST /attest {}` -> `{token, expires_at, org_id, user_id, view_class, projects, channel, public_keys:[{kid,alg,jwk,active}], server_time}`; `token` is a compact ES256 JWS, `typ:"px-peer"`, claims `{sub, org, projects, view, iat, exp}`, valid **24 hours** (`sign.ts ATTEST_TTL_SECONDS = 86400`, by design). `user_id` and the token's `sub` are the VERIDIAN person id (as `manifest.user.id`), not the sign-in id. The laptop keeps the token and the public keys and asks for a new token only when fewer than 2 hours are left (`peer/attest.ts`): about one call a day, and peers keep working through a server outage until it expires. `503` when no signing key is loaded.
Signalling and presence use a Supabase Realtime channel named `px:<channel>` (the name is not guessable without the server key); the data itself goes over a WebRTC data channel. Every peer starts with `hello {token}`; a peer that does not present a valid, unexpired token of the SAME `org` and the SAME `view` is dropped. A peer only ever receives rows of projects present in BOTH tokens, only rows that carry a valid server `sig`, and never a `dirty` row. When no direct link can be made, laptops simply use the server (Supabase is the relay). Peers never deliver tombstones or version numbers of their own; they hand over signed rows only, and a row is applied only if its `version` is higher than the local one.

## 5. Jobs (work offload to an online laptop)

`POST /jobs/enqueue {project_id, type, visibility, params}` -> `{job_id}`; `POST /jobs/claim {device_id, types:[1..8], lease_seconds 10..120 (default 60)}` -> `{job}`;
`POST /jobs/heartbeat {job_id, lease_id}`; `POST /jobs/result {job_id, lease_id, ok, result?, error?}`; `POST /jobs/get {job_id}`. A claim is a LEASE, renewable by heartbeat. A job runs only on a machine whose person may already read the data (same org, project in their list). A result is a proposal: anything that feeds money, approvals, billing or permissions is recomputed by the server before it is accepted. A vanished claimant's job is re-queued after the lease expires.

## 6. Cost rules every laptop follows (measured in `docs/local-first/COST_MODEL.md`, enforced by `src/lib/local-first/cost/cost-budget.test.ts`)

- No timer polls anything while the laptop is offline, while the tab has been hidden for an hour with no peer, or while a 426 paused sync.
- **One call per scheduled round** (package lf-fc, cost:COST-03): the server step asks `GET /heads` (5 minutes while things change, backing off to 30). It reads a
  project's feed (`/changes` from the stored position) only when that project's head is past it -- the open project at once, any other at most hourly; `/manifest` only
  when `projects_etag` changed; and when `view_class` or `epoch` changed it drops the copy's non-dirty rows and positions (`peer/reset-copy.ts`) and runs a whole sync.
  The first `/heads` answer after a recent whole sync is adopted as the baseline (meta `sync:heads`). A whole sync still runs at least daily (the spread delete repair),
  on open, and when a project has no feed position yet. The organisation feed's head (`"__org__"`) and `org_view_class` are handed to `onOrgHead` /
  `onOrgClassChanged`: an EXTENSION POINT for package E7, nothing reads them yet. A service without `/heads` (404) gets the earlier rule for a day: the open project's feed
  every round, every other project's at most hourly, a whole sync every 6 hours. A screen opening reads that project's feed at most once every 2 minutes, and a
  `/heads` round that found the project current counts as such a read.
- No keyset sweep of a (project, kind) the feed covers; `/ids` at most weekly per feed-covered (project, kind), at most 12 per whole sync, never right after a fresh copy.
- With a verified peer connected, the server step runs at most every 30 minutes (always on open / online / manual).
- The person's edits are sent when made (one push per flush) and are never batched away or delayed to save cost.
- **Flag off = zero** (package lf-fc, cost:COST-02/FLAG-16): with `px-local-first` not `"1"` the laptop makes NO sync request at all: WorkspacePrepare does nothing and
- **Default ON for a signed-in person** (owner order 2026-10-02, "the user never has to think"; found by the first real-browser run of the offline e2e: nothing in the app ever set the flag, so every real person would have stayed on the server-only path after the deploy). `<LocalFirstDefault/>` is mounted FIRST in the signed-in layout (`src/app/(app)/layout.tsx`) and, while that layout renders (before any component's mount effect reads the flag), turns `px-local-first` to `"1"` in a browser that has not decided (no flag, no opt-out). A flag that exists is a decision and is left alone. A person's or support's own "off" is `setLocalFirstEnabled(false)`: it removes the flag AND writes `px-local-first-off` = `"1"`, so the default does not quietly turn it back on at the next page load; `setLocalFirstEnabled(true)` clears that opt-out. A visitor of a public page never mounts the component, so a visitor's inertness (no request, no storage write, no DOM) is unchanged. The per-browser kill switch is therefore `localStorage.setItem("px-local-first-off", "1")` plus removing `px-local-first` (or `setLocalFirstEnabled(false)`); the remote lever stays the server side (a 5xx from the sync service reads as offline, `min_compatible` for an incompatible release). Tests: `src/lib/local-first/local-first-default.test.ts`, `src/components/local-first/LocalFirstDefault.test.tsx` (three planted bugs each caught).
  shows nothing, every call of the shared replica (`replica-shared.ts gateByFlag`) answers "idle" without a request, boot's re-download does not run, the outbox is not
  created, and a plain sign-out does not touch IndexedDB.
- **Pacing** (lf-fc, wire:F07): every replica request waits for a sliding-minute pacer of 100 a minute per tab (`rate-pacer.ts`), under the server's 120. A 429 with
  `Retry-After` pauses that pacer for every caller.
- **Circuit breaker** (lf-fc, cost:COST-04): 3 network / timeout / 5xx failures in a row, any 429, or a 403 stop the run (the remaining pairs are not tried) and store a stop
  in the person's database (`sync:cooldown`: 1 minute doubling to 30; a 429 without `Retry-After` -- the daily quota -- at least 1 hour, doubling to 6; a 403 one hour).
  Until it ends no run of any tab sends anything; a clean run clears it. The client never retries a 429 without `Retry-After`. A (project, kind) answered `400`/`413` is
  not asked again for a day (`sync:refused:<project>:<kind>`).

## 6a. Sign-out and this laptop's copy (decision of package lf-fc, 2026-10-02 -- THE OWNER MAY VETO IT)

**Decision.** By default "Sign Out" KEEPS the person's copy of the workspace (`projexa-local:<sign-in id>`) and its "workspace ready" key on this laptop. One explicit
choice, **"Sign out and delete this laptop's copy"** (AccountMenu, AppTopbar and Settings), deletes it.

**Why.** The owner's priority is cost first, ease of work second, security third. Deleting the copy at every sign-out made the next sign-in repeat the whole first sync
(one request per project x kind plus every row's egress: 401 requests at P=10 per morning for a person who signs out each evening) and left the person without an
offline workspace until it finished. Keeping it costs nothing and works offline at once. Two people on one laptop never mix (one database per sign-in id, and a manifest of
another person is refused).

**What stays true in both modes.** The outbox is flushed first while the session lives; pending edits and drafts the server turned down ALWAYS keep the database (even when
delete was chosen) and the person is told in words. A delete that fails or is blocked (PROJEXA open in another tab) is SAID, never silent, and the copy counts as kept.
The BOQ hints (`px-local-first-boq:*`, which name a BOQ, not a person) are removed at every sign-out. A sign-out whose person cannot be told apart (the shell's
`SIGNED_OUT` event before the person was known) deletes nothing -- the old "delete every local database with nothing pending" path, which could remove other people's
copies, is gone. Code: `src/lib/local-first/sign-out.ts`; tests: `sign-out.test.ts`, `sign-out-everywhere.test.ts`, `components/sign-out-everywhere-paths.test.tsx`.

**The residual risk (the security side of the trade-off).** The kept copy is protected at rest only by the browser profile's own storage: anyone who can use this
browser profile can read it. On a shared or borrowed computer the person should use "Sign out and delete this laptop's copy". If the owner prefers privacy over cost here,
the alternative is one line: make `deleteLocalCopy` default to true in `finishLocalWorkspaceOnSignOut` (and flip the two button labels).

## 7. Backend hardening (packages D1-D3 of the 2026-10-02 review: MERGED on `feat/lf-sync-backend`, not yet live until the migrations are applied and the functions deployed)

- **CORS** (D1, was the blocker): `x-px-client` is in `Access-Control-Allow-Headers`, `Retry-After` is exposed, the preflight is cached 2 hours, every error answer carries the CORS headers.
- **Update gate** (D1): `426` only for a client OLDER than `min_compatible` or on an older protocol; a newer protocol gets a retryable `503 SERVER_UPDATING`, never `426`.
- **Push** (D1, D2): one `/sync-run-batch` exec invocation per push; byte limits at the edge (an op over 60,000 bytes is `TOO_LARGE`); per-op isolation and a 30-second deadline (`RETRY_LATER`); exactly-once under concurrency; the version check bound to the op's own project; `uncertain` resolved by version (section above); `RECORD_REQUIRED` for an edit without `record`.
- **Peer attestation** (D1): `POST /attest` accepts `{device_pub_jwk}` and puts its RFC 7638 thumbprint in the token as `cnf.jkt`; signed rows may carry `sig3` committing to the view class. The laptop's device key and verifier are a later step; tokens without a key keep working.
- **Change feed** (D3): commit-order-safe cursor (transaction ids), `epoch` and `reset_required` (retention floor), one statement-level tracking trigger per statement, `GET /heads`, prune functions (change log 90 days; the owner's daily mechanism schedules them).
- **Manifest** carries `user.auth_user_id`; `internal_ai` is still not sent (absent = PROJEXA's own AI is OFF).

## Changes reconciled with the handler (package FA, 2026-10-02)

Every change below makes this file say what `handler.ts` (feat/lf-sync-backend, commit 3c0e6398) and its SQL already do; each is checked by the conformance harness.
1. Authority: "this file wins" replaced by "the handler is the implemented behaviour, the conformance run arbitrates" (top of file).
2. Release format: the example `2026.10.02-3` was wrong; it is `YYYY.MM.DD-NNN` (`2026.10.02-003`). Added the gate rule: only that form is gated, `dev`/SHA/short builds never are, and cannot be registered (review F13; harness W28, W28b).
3. Manifest: added `user.auth_user_id` (the sign-in id) and stated that `user.id` is the VERIDIAN id, a different string; the laptop compares the sign-in id (review F01/F1; W01, W02, W02b). Added `org_kinds`, `org_view_class`, `cursor_field` values, `null` release fields.
4. Kinds: 28, not 13 (review F15).
5. Pull: `limit` default 200; opaque cursor; ids 1..200 AND the 4,096-character body cap, with the laptop's 80-id / 3,500-character chunking (review F03/SYNC-06; W06, W06b, W25); the real `data` shape is snake_case with numbers and `boq_lines` carries no BOQ title (review F09; W18b); redaction nulls a column and marks the row `redacted`.
6. Changes: `next_seq` on an empty page and for `after_seq: null`; the laptop's 200-position overlap and why (review F08; W14, W14b).
7. Ids: the answer carries `server_time`; `next_id` is the page's last id.
8. Push: `record_kind` for creates; `resolution` is ignored by the server; per-op 64 KB, `device_id`/`op_id` formats; `duplicate` carries no `server`; `OP_ID_REUSED`; conflict carries `version`/`base_version` and `server: null` for a deleted row; the real refusal codes and where the laptop's sentences are (review F11; W21); `PREVIOUS_OP_BLOCKED`, `IN_PROGRESS`, `RATE_LIMITED`; whole-request `403 NOT_LINKED` (review F12, F14, F15).
9. New section 2a: limits table, 429 Retry-After, CORS headers the laptop needs (review COST-01/F02, a backend fix in flight; W27, W27b).
10. Attest: 24 hours, not 10 minutes, by design in `sign.ts`; `user_id`/`sub` are the VERIDIAN id (review F15; W29).
11. Jobs: the real routes and fields (`visibility`, `heartbeat`, `get`, `ok`, lease 10..120 s).
