# PROJEXA local-first: the contract between a laptop and the backend

Owner order 2026-10-02: the user's laptop is a daughter server (so Vercel does little or nothing), it syncs two ways with our backend and with other laptops of the same
organisation, everything on the laptop carries a **version number and a date**, and the backend **records** those versions so update history is kept and versions drive sync.
This file is the one spec the laptop code (`projexa/src/lib/local-first/**`) and the backend (`compliance-tracker/supabase/functions/projexa-sync/**`, `drizzle/0678..0682`) share.
When the two disagree, this file wins and the loser is a bug.

Base URL of every call: `https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync` (a Supabase Edge Function, never Vercel).
Every call: `Authorization: Bearer <the person's PROJEXA Supabase access token>` and header `X-Px-Client: <release_version>; protocol=<n>; schema=<n>`.
Authority is never decided on the laptop: the person, the project, the row scope and every redaction are decided by SQL (`projexa_*`), which reuses the AI work link's own rules.

## 0. Versions (the heart of it)

| Thing | Number | Where it lives | What it is for |
|---|---|---|---|
| **Release** (the downloaded app, one bundle) | `release_version` e.g. `2026.10.02-3` (date + build number), plus `git_sha`, `built_at`, `manifest_sha256` (the image digest) | `platform.projexa_release` (backend), `meta['app:release']` (laptop) | the laptop's code and the backend must match; the backend can say "update required" |
| **App file** (each file inside the bundle) | `file_no` (permanent number of that path, never reused), `file_version` (1, 2, 3 ... bumps when the bytes change), `sha256`, `size` | `platform.projexa_release_file`, `app_files` store on the laptop | exact update history per file; an update downloads only files whose version moved |
| **Install** (one laptop got one release) | `device_id`, `release_version`, `downloaded_at`, `installed_at`, `previous_release`, `files`, `bytes`, `status` | `platform.projexa_client_install` | who has what, when; the history of every update of every laptop |
| **Record** (a project / task / BOQ line ...) | `version` (integer, +1 on every real change; 0 = never changed since versioning began), `content_hash`, `updated_at` | `platform.projexa_record_head` + append-only `platform.projexa_change_log` (`seq`) | conflict detection on push, change/delete propagation on pull, peer exchange |
| **Sync protocol** | `protocol` integer (now `2`) and the laptop database `schema` integer (now `3`) | header `X-Px-Client`, `LOCAL_DB_VERSION` | a laptop whose release is below `min_compatible` gets `426` and must update before it syncs |

## 1. Pull (exists; extended)

`GET /manifest` -> `{user, projects, kinds, view_class, release:{current, min_compatible, protocol}, server_time}`
- `view_class`: 16 hex, a fingerprint of what this person's role redacts. Two laptops exchange rows directly only when it is equal.
- `release.current` is the newest registered release; `release.min_compatible` the oldest release still allowed to sync.

`POST /pull {project_id, kind, after, limit<=500}` (keyset, as before) **or** `{project_id, kind, ids:[<=200]}` (exact rows) ->
`{items:[{id, updated_at, version, data, sig}], kid, next_cursor, has_more, hidden_fields, redacted, server_time}`
- `version`: the record version above. `sig`: ES256 signature (base64url raw r||s) over the message below; `kid`: the key id (null = unsigned, never pass such a row to a peer).
- `ids` mode exists because a table without `updated_at` cannot be seen by the keyset cursor when a row changes; `/changes` names such rows and `ids` fetches them.

Signed message (UTF-8): `px2|<org>|<project>|<kind>|<id>|<version>|<updated_at>|<sha256hex(canonicalJSON(data))>`.
`canonicalJSON` = JSON with object keys sorted at every level (arrays keep order, `undefined` members dropped). Fixed vector (both repos assert it):
`{"b":[1,2.5,"x"],"a":{"z":null,"y":"é\n\"","x":-0.5},"c":true}` -> `{"a":{"x":-0.5,"y":"é\n\"","z":null},"b":[1,2.5,"x"],"c":true}` -> sha256 `bcbc2a5c6e5947a6e1ed5e22aaa51395f6b040407127c6d9a870c7872ce8e565`.

`POST /changes {project_id, after_seq: int|null, limit<=1000}` -> `{changes:[{seq, kind, id, version, op:"I"|"U"|"D"}], next_seq, has_more, head_seq, server_time}`
- `after_seq: null` returns no changes and the current `head_seq` (read it BEFORE the first full pull and store it, so nothing is missed in between).
- `D` is a tombstone: delete the local row. `I`/`U`: if the local `serverVersion` is lower, fetch the row (`ids` mode). Only the 13 synced kinds appear.
- A person only ever sees changes of projects they may read now (same bind as pull); one answer (404) for a project they may not.

`POST /ids {project_id, kind, after_id, limit<=5000}` -> `{ids, has_more, next_id}` : full id inventory, the repair path for deletes made before change tracking existed. Run at most once per project and kind per day.

## 2. Push (new)

`POST /push` body `{device_id, ops:[{op_id, function_id, project_id, params, record?:{kind, id, base_version}, resolution?:"overwrite", client_at}]}` (<= 50 ops, <= 256 KB, applied in order)
-> `{results:[{op_id, status, record_id?, route?, version?, server?:{kind,id,version,updated_at,data,sig,kid}, error?:{code, missing?}}], server_time}`

`function_id` is a function of the AI work link registry (the same ids the PROJEXA pills use). The backend runs it through the **real pipeline** as the person with their LIVE role
(role gates, cost visibility, text rules, money validation, same-project checks are the existing TypeScript services', not reimplemented). A laptop only **proposes**: money and
approval figures are never accepted as computed by the browser; only the person's intent (`params`) is sent and the server recomputes.

Statuses:
- `applied` - done; `record_id`/`route` as the pipeline answered, `version` the record's new head version.
- `duplicate` - this `op_id` was already applied; the stored answer is returned again (idempotent; safe to retry after a lost response).
- `conflict` - `record.base_version` is older than the head version: nothing was written; `server` carries the current signed row. The laptop shows both and the person chooses *keep theirs* (drop the op) or *keep mine* (resend with `resolution:"overwrite"` and `base_version` = the server's version).
- `rejected` - permanent no (role, validation, unknown function, project not readable). Drop the op, tell the person why in plain words. Never retried.
- `failed` - transient or uncertain (`EXECUTION_UNCERTAIN`, timeout). Keep the op, retry with the same `op_id` after a back-off; the ledger guarantees at most one effect.
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

`POST /attest {}` -> `{token, expires_at, org_id, user_id, view_class, projects, channel, public_keys:[{kid,alg,jwk,active}], server_time}`; `token` is a compact ES256 JWS, `typ:"px-peer"`, claims `{sub, org, projects, view, iat, exp}` (10 minutes).
Signalling and presence use a Supabase Realtime channel named `px:<channel>` (the name is not guessable without the server key); the data itself goes over a WebRTC data channel. Every peer starts with `hello {token}`; a peer that does not present a valid, unexpired token of the SAME `org` and the SAME `view` is dropped. A peer only ever receives rows of projects present in BOTH tokens, only rows that carry a valid server `sig`, and never a `dirty` row. When no direct link can be made, laptops simply use the server (Supabase is the relay). Peers never deliver tombstones or version numbers of their own; they hand over signed rows only, and a row is applied only if its `version` is higher than the local one.

## 5. Jobs (work offload to an online laptop)

`POST /jobs/enqueue {project_id, type, params}`, `POST /jobs/claim {types, device_id}`, `POST /jobs/result {job_id, lease_id, result}` ; a claim is a LEASE (default 60 s, renewable). A job runs only on a machine whose person may already read the data (same org, project in their list). A result is a proposal: anything that feeds money, approvals, billing or permissions is recomputed by the server before it is accepted. A vanished claimant's job is re-queued after the lease expires.
