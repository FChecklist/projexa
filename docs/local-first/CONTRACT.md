# PROJEXA local-first: the contract between a laptop and the backend

Owner order 2026-10-02: the user's laptop is a daughter server (so Vercel does little or nothing), it syncs two ways with our backend and with other laptops of the same
organisation, everything on the laptop carries a **version number and a date**, and the backend **records** those versions so update history is kept and versions drive sync.
This file is the one spec the laptop code (`projexa/src/lib/local-first/**`) and the backend (`compliance-tracker/supabase/functions/projexa-sync/**`, `drizzle/0677..0684`) share.
When the two disagree, this file wins and the loser is a bug.

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
| **Release** (the downloaded app, one bundle) | `release_version` e.g. `2026.10.02-3` (date + build number), plus `git_sha`, `built_at`, `manifest_sha256` (the image digest) | `platform.projexa_release` (backend), `meta['app:release']` (laptop) | the laptop's code and the backend must match; the backend can say "update required" |
| **App file** (each file inside the bundle) | `file_no` (permanent number of that path, never reused), `file_version` (1, 2, 3 ... bumps when the bytes change), `sha256`, `size` | `platform.projexa_release_file`, `app_files` store on the laptop | exact update history per file; an update downloads only files whose version moved |
| **Install** (one laptop got one release) | `device_id`, `release_version`, `downloaded_at`, `installed_at`, `previous_release`, `files`, `bytes`, `status` | `platform.projexa_client_install` | who has what, when; the history of every update of every laptop |
| **Record** (a project / task / BOQ line ...) | `version` (integer, +1 on every real change; 0 = never changed since versioning began), `content_hash`, `updated_at` | `platform.projexa_record_head` + append-only `platform.projexa_change_log` (`seq`) | conflict detection on push, change/delete propagation on pull, peer exchange |
| **Sync protocol** | `protocol` integer (now `2`) and the laptop database `schema` integer (now `3`) | header `X-Px-Client`, `LOCAL_DB_VERSION` | a laptop whose release is below `min_compatible` gets `426` and must update before it syncs |

## 1. Pull (exists; extended)

`GET /manifest` -> `{user:{id,name,role,org_id}, projects:[{id,name,status}], kinds, view_class, org_kinds, org_view_class, release:{current, min_compatible, protocol}, server_time}`
- `kinds`: the **28 project kinds** (`handler.ts` `SYNC_KINDS` = SQL `projexa_sync__kinds()`): `project, tasks, boqs, boq_lines, activities, progress, rfis, submittals, punch_list,
  change_orders, milestones, materials, documents` (0677) and `roster, attendance, timesheets, meetings, meeting_minutes, site_diaries, site_instructions, progress_claims, interim_bills,
  material_receipts, material_issues, expenses, schedule_baselines, ffe_items, wiki_pages` (0683). Each is `{kind, project_scoped:true, cursor_field, deletes_supported:true}`.
  `deletes_supported: true` means the change feed carries EVERY change of that kind, tombstones included: the laptop then keeps a pulled-to-the-end (project, kind) current by
  `/changes` + pull by ids alone and never re-sweeps it (package lf-e6, `replica.ts`). A kind with `deletes_supported` false or absent keeps the keyset pull.
- `org_kinds`: the **9 organisation kinds** this person's ROLE may read (0684; see "Organisation kinds" below), each `{kind, project_scoped:false, cursor_field, deletes_supported, peer_shareable}`.
- `view_class`: 16 hex, a fingerprint of what this person's role redacts. Two laptops exchange project rows directly only when it is equal. `org_view_class` is the same for organisation rows.
- `release.current` is the newest registered release; `release.min_compatible` the oldest release still allowed to sync.
- `internal_ai` (or `features.internal_ai`): **not sent today.** Absent = PROJEXA's own AI is OFF on the laptop (the backend's default, `PROJEXA_INTERNAL_AI_ENABLED` unset); the laptop
  sends no internal-AI request and points the person at their own AI (`ai-off/internal-ai.ts`). Only an explicit `true` turns those entry points on.

`POST /pull {project_id, kind, after, limit<=500}` (keyset, as before) **or** `{project_id, kind, ids:[<=200]}` (exact rows) ->
`{items:[{id, updated_at, version, data, sig}], kid, next_cursor, has_more, hidden_fields, redacted, server_time}`
- `version`: the record version above. `sig`: ES256 signature (base64url raw r||s) over the message below; `kid`: the key id (null = unsigned, never pass such a row to a peer).
- `ids` mode exists because a table without `updated_at` cannot be seen by the keyset cursor when a row changes; `/changes` names such rows and `ids` fetches them.

Signed message (UTF-8): `px2|<org>|<project>|<kind>|<id>|<version>|<updated_at>|<sha256hex(canonicalJSON(data))>`.
`canonicalJSON` = JSON with object keys sorted at every level (arrays keep order, `undefined` members dropped). Fixed vector (both repos assert it):
`{"b":[1,2.5,"x"],"a":{"z":null,"y":"é\n\"","x":-0.5},"c":true}` -> `{"a":{"x":-0.5,"y":"é\n\"","z":null},"b":[1,2.5,"x"],"c":true}` -> sha256 `bcbc2a5c6e5947a6e1ed5e22aaa51395f6b040407127c6d9a870c7872ce8e565`.

`POST /changes {project_id, after_seq: int|null, limit<=1000}` -> `{changes:[{seq, kind, id, version, op:"I"|"U"|"D"}], next_seq, has_more, head_seq, server_time}`
- `after_seq: null` returns no changes and the current `head_seq` (read it BEFORE the first full pull and store it, so nothing is missed in between).
- `D` is a tombstone: delete the local row. `I`/`U`: if the local `serverVersion` is lower, fetch the row (`ids` mode). Only the 28 project kinds appear (the organisation kinds have their own feed, `project_id:"__org__"`).
- COST: one `/changes {after_seq: <stored>}` is both the "did anything move?" check and the catch-up; the laptop reads the open project's feed on every scheduled run and every
  other project's at most hourly, and a whole sync (manifest + every feed) every 6 hours (`peer/server-step.ts`). Measured cost per laptop: `docs/local-first/COST_MODEL.md`.

**Organisation kinds (0684).** `vendors` (`erp_suppliers`), `customers`, `companies`, `boq_categories`, `currencies`, `exchange_rates`, `departments`, `org_people` (`users`; not the AI link's
project kind `people`) and `cost_visibility`. Same routes, no project: `POST /pull {kind, after, limit}` or `{kind, ids:[<=200]}` with `project_id` absent, null or `"__org__"`;
`POST /ids {kind, after_id, limit}`; `POST /changes {project_id:"__org__", after_seq, limit}`. Rows are signed exactly like project rows with project `"__org__"`. Every query is the
person's own organisation; rank >= 2 (member) for every kind but `cost_visibility` (>= 1); below it, the one 404. Columns are an explicit allow-list (no tax ids, bank accounts,
passwords, auth ids, internal notes); `org_people` is `id, name, role, is_active, email` with every email but the person's own masked, and is `peer_shareable: false`; `credit_limit`
is null below rank 3. **The laptop's sync engine does not consume organisation kinds yet** (another package adds them; module adapters take masters through their own interface).
- A person only ever sees changes of projects they may read now (same bind as pull); one answer (404) for a project they may not.

`POST /ids {project_id, kind, after_id, limit<=5000}` -> `{ids, has_more, next_id}` : full id inventory, the repair path for deletes made before change tracking existed. Run at most once per project and kind per day.

## 2. Push (new)

`POST /push` body `{device_id, ops:[{op_id, function_id, project_id, params, record?:{kind, id, base_version}, record_kind?, resolution?:"overwrite", client_at}]}` (<= 50 ops, <= 256 KB, applied in order)
-> `{results:[{op_id, status, record_id?, route?, version?, base_version?, server?:{kind,id,version,updated_at,data,sig,kid}, error?:{code, missing?}}], server_time}`
- `device_id`: 8-64 of `[A-Za-z0-9_-]`. One op as JSON <= 64 KB. Every TEXT value in `params` <= **2,000 characters** (the AI link's text rule, `_shared/ai-link/core.ts` `textMax`);
  a longer one is `rejected` by the pipeline, so the laptop should refuse it at the edit, not after a round trip.
- `record_kind` (optional): a hint naming the kind (one of the 28) of the row the op creates or touches, used when the pipeline's answer does not name it, so the server can record its
  version and return it. **The laptop's outbox does not send it yet** (`creates.kind` is the value it should send).
- Caps (SQL, `projexa_sync_push_begin`): 600 ops an hour and 5 `create_project` a day per person. Each op is ONE more Edge invocation (`ai-work-link-exec`), on top of the push.

`function_id` is a function of the AI work link registry (the same ids the PROJEXA pills use). The backend runs it through the **real pipeline** as the person with their LIVE role
(role gates, cost visibility, text rules, money validation, same-project checks are the existing TypeScript services', not reimplemented). A laptop only **proposes**: money and
approval figures are never accepted as computed by the browser; only the person's intent (`params`) is sent and the server recomputes.

Statuses:
- `applied` - done; `record_id`/`route` as the pipeline answered, `version` the record's new head version.
- `duplicate` - this `op_id` was already applied; the stored answer is returned again (idempotent; safe to retry after a lost response).
- `conflict` - `record.base_version` is older than the head version: nothing was written; `server` carries the current signed row. The laptop shows both and the person chooses *keep theirs* (drop the op) or *keep mine* (resend with `resolution:"overwrite"` and `base_version` = the server's version).
- `rejected` - permanent no (role, validation, unknown function, project not readable). Drop the op, tell the person why in plain words. Never retried.
- `failed` - nothing was written, or nobody knows. By `error.code`:
  - transient (the pipeline's own transient codes, `IN_PROGRESS` = the same op is still running, `PREVIOUS_OP_BLOCKED` = an earlier op of this batch on the same record did not apply):
    keep the op, retry with the same `op_id` after a back-off; the ledger guarantees at most one effect.
  - **`EXECUTION_UNCERTAIN`**: the op was sent to the pipeline and no answer came back (or its ledger row could not be closed), so **the write may have happened**. The ledger row is
    `uncertain`, and every later push of the same `op_id` answers `failed EXECUTION_UNCERTAIN` again **without running it**: it is **never re-run, and the laptop must not auto-retry
    it** (each retry is a wasted invocation and can never succeed). Keep the op, stop sending it, and show it to the person as "may or may not have been saved" (check the record after
    the next pull). The laptop's outbox today still retries every `failed` with back-off up to 5 minutes, which for an uncertain op means ~12 wasted pushes an hour while online:
    to be fixed in `outbox.ts` (client-core owner).
- `needs_server` - the function cannot run on the edge (stubbed dependency). Keep the op; the laptop offers the normal online path.

A laptop edit is applied locally at once (optimistic, row marked `dirty` with the op id) and the op waits in the **outbox** until it is `applied`/`duplicate`; then the row is replaced by the server's row at its new version.
A `dirty` row is never overwritten by a pull or a peer and is never deleted by a reconcile, and it is never handed to a peer.

## 3. Release bundle, files and installs (new)

Build output (`scripts/make-release.mjs` after `next build`): `public/_release/release.json` and `public/_release/px-<release_version>.tar.gz` (ONE file holding every static asset, like an image).
`release.json`: `{release_version, git_sha, built_at, protocol, schema, bundle:{path, size, sha256}, files:[{path, size, sha256}...], manifest_sha256}` where `manifest_sha256` = sha256 of the canonical JSON of everything before it.
- `GET /release/current` -> `{current:{release_version, manifest_sha256, built_at, files:[{path, file_no, file_version, sha256, size}]}, min_compatible, registered:boolean}` (file numbers and versions are assigned by the registry, not by the build).
- `POST /release/register {}` -> the server fetches `release.json` from the allow-listed origin `https://projexa-ai.com` itself and registers it (idempotent: the same `manifest_sha256` is a no-op; a path whose sha256 changed gets `file_version + 1`; a new path gets the next `file_no`). Takes no input from the caller, so it cannot register anything the owner did not publish.
- `POST /install {device_id, release_version, manifest_sha256, previous_release?, downloaded_at, installed_at, files, bytes, status:"installed"|"updated"|"failed", error?}` -> records one row of that laptop's history.
The laptop installs by downloading the bundle (or only the files whose `file_version` moved), verifies every `sha256`, writes them into Cache Storage under `px-release-<release_version>`, stores the file table (`app_files`) and `meta['app:release']`, switches the service worker to the new cache, then deletes the old cache. Verification fails -> nothing switches.

## 4. Peers (laptop <-> laptop)

`POST /attest {}` -> `{token, expires_at, org_id, user_id, view_class, projects, channel, public_keys:[{kid,alg,jwk,active}], server_time}`; `token` is a compact ES256 JWS, `typ:"px-peer"`, claims `{sub, org, projects, view, iat, exp}`, valid **24 hours** (`sign.ts` `ATTEST_TTL_SECONDS = 86400`). The laptop keeps it (and the public keys) in its own database and asks for
a new one only when fewer than 2 hours are left (`peer/attest.ts`): about one call a day, and peers keep working through a server outage until it expires. `503` when no signing key is loaded.
Signalling and presence use a Supabase Realtime channel named `px:<channel>` (the name is not guessable without the server key); the data itself goes over a WebRTC data channel. Every peer starts with `hello {token}`; a peer that does not present a valid, unexpired token of the SAME `org` and the SAME `view` is dropped. A peer only ever receives rows of projects present in BOTH tokens, only rows that carry a valid server `sig`, and never a `dirty` row. When no direct link can be made, laptops simply use the server (Supabase is the relay). Peers never deliver tombstones or version numbers of their own; they hand over signed rows only, and a row is applied only if its `version` is higher than the local one.

## 5. Jobs (work offload to an online laptop)

`POST /jobs/enqueue {project_id, type, params}`, `POST /jobs/claim {types, device_id}`, `POST /jobs/result {job_id, lease_id, result}` ; a claim is a LEASE (default 60 s, renewable). A job runs only on a machine whose person may already read the data (same org, project in their list). A result is a proposal: anything that feeds money, approvals, billing or permissions is recomputed by the server before it is accepted. A vanished claimant's job is re-queued after the lease expires.
`POST /jobs/heartbeat {job_id, lease_id}` extends a lease (never past 5 minutes from its start); `POST /jobs/get {job_id}` lets the requester read its job. Only four display-only types
(`boq_rollup`, `csv_export`, `report_preview`, `search_index`); 30 open jobs and 200 a day per person. COST: the claim loop backs off on empty claims (doubling to 15 minutes,
`jobs/runner.ts`); neither the claim loop nor the requester is started by the app today.

## 6. Cost rules every laptop follows (measured in `docs/local-first/COST_MODEL.md`, enforced by `src/lib/local-first/cost/cost-budget.test.ts`)

- No timer polls anything while the laptop is offline, while the tab has been hidden for an hour with no peer, or while a 426 paused sync.
- A whole sync (manifest + every project's feed) at most every 6 hours, on open, and when a project has no feed position yet; otherwise the open project's feed on every scheduled run
  (5 minutes while things change, backing off to 30) and every other project's at most hourly. A screen opening reads that project's feed at most once every 2 minutes.
- No keyset sweep of a (project, kind) the feed covers; `/ids` at most weekly per feed-covered (project, kind), at most 12 per whole sync, never right after a fresh copy.
- With a verified peer connected, the server step runs at most every 30 minutes (always on open / online / manual).
- The person's edits are sent when made (one push per flush) and are never batched away or delayed to save cost.

## 7. May change (the backend is being hardened in parallel; packages D1-D3 of the 2026-10-02 review)

- **CORS** (D1, BLOCKER): `x-px-client` in `Access-Control-Allow-Headers`, `Retry-After` exposed, preflight cached 2 hours. Fixed on `claude/lf-d1-edge-fixes`, not yet on `feat/lf-sync-backend`.
- **Peer attestation holder binding** (D1): `POST /attest` may accept `{device_pub_jwk}` and put its thumbprint in the token as `cnf.jkt`; the signed-row message may start to commit to
  the view class (a new `px3|...` message). The laptop then needs a device key and a new verifier; old tokens keep working while no key is sent.
- **Push exactly-once and concurrency** (D2): a resolution path for `uncertain` ops (so EXECUTION_UNCERTAIN can be settled instead of parked), a `RECORD_BUSY` retry while another op
  on the same record is running, the conflict check bound to the op's own project, possibly `overwrote_concurrent: true` on `applied`. Error classes in push are being re-derived from
  the pipeline's real transient codes (a transient failure must never come back as `rejected`).
- **Change feed** (D3): ordering of `seq` under concurrent writers (a laptop must not skip a lower `seq` committed after a higher one), retention of the change log (a laptop away longer
  than the retention window would then have to re-copy from scratch: the backend will need to say so, e.g. a `410`/"resync" answer to `/changes`), and the cost of the per-row trigger.
- **The 426 gate** (D1): only a client OLDER than `min_compatible`, or on another protocol, is blocked; never a newer one.
- **`internal_ai` in the manifest**: not sent today; if added, the laptop already reads it (section 1).
