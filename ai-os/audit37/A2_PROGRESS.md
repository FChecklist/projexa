# AUDIT-100 A2: server functions moved off Vercel to Supabase (progress notes)

Branch `audit100/a2-edge-proxy` in both repos (PROJEXA and compliance-tracker).

- PHASE 0 done (2026-10-05): read the plan, inventory, policy table, auth guard, client, projexa-sync pattern. Design: one generic Edge
  Function `projexa-api` (compliance-tracker `supabase/functions/projexa-api`), deny by default, policy + route table generated from this
  repo (`scripts/projexa-api-edge.mjs`), parity contract recorded from the real Next pipeline (`src/lib/projexa-api-parity.test.ts`) and
  replayed against the edge handler in compliance-tracker. Client switch: `src/lib/px-api.ts` (`NEXT_PUBLIC_PX_API_BASE`).
- PHASE 1 done (local + tests, 2026-10-05): compliance-tracker `supabase/functions/projexa-api` (handler, lookups, index, generated policy,
  parity contract; 137 tests) and this repo's generator (`scripts/projexa-api-edge.mjs`), route list (`ai-os/audit37/projexa-api-routes.json`,
  7 routes / 10 route+methods: the 7 shell-reachable proxies), parity recorder (`src/lib/projexa-api-parity.test.ts`, 122 cases through the REAL
  middleware + handlers), gate-equivalence + switch tests (`src/lib/projexa-api-edge.test.ts`) and the switch (`src/lib/px-api.ts`, default
  same-origin). Seen to fail: PM_OR_ABOVE + client_viewer in roles.ts (3 tests here), the same in the edge copy (5 there), deny-by-default
  removed in the edge handler (1 there); all reverted, diffs clean.
- PHASE 1 merged: compliance-tracker #2082 (e5f3471a); projexa #392 (phase 1).
- PHASE 2 done (Supabase live, 2026-10-05): secrets set through the management API (PROJEXA_SUPABASE_URL, PROJEXA_SUPABASE_ANON_KEY,
  PROJEXA_SERVICE_ROLE_KEY, VERIDIAN_API_BASE_URL: names only, values never printed); `projexa-api` deployed from a clean checkout of
  compliance-tracker origin/main e5f3471a with the CLI recipe (`--no-verify-jwt --use-api`): version 1, ACTIVE. `GET .../projexa-api/_policy`
  answers SOURCE_SHA256 122618857bbf... = this repo's generated file. LIVE SMOKE (`scripts/verify/projexa-api-live-smoke.mjs`, test org only,
  sessions minted by admin magic link, no email, no password, no data written): 24 of 24 probes identical edge vs Vercel (projexa-ai.com):
  dashboard / exceptions / BOQ analysis 200 as owner, pm and client_viewer (client_viewer's redacted body identical too), documents /
  drawing URL / permit 404 for an unknown id, BOQ line PATCH and permit PATCH 403 for client_viewer, BOQ line PATCH 404 for an unknown line,
  400 without projectId, 401 signed out, 404 for an unlisted route (/api/shell, deny by default). CORS preflight from https://projexa-ai.com: 204.
- PHASE 3 (code flip, this PR): `src/lib/px-api.ts` default = the edge function on https://projexa-ai.com and www (the function's CORS origins);
  preview / rig / dev stay same-origin. Callers switched: the shell (snapshot-cache, documents-file-cache, pending-edits) and the online
  screens' shared readers (`fetch-json.ts`, `use-submit.ts`, DashboardProjectClient, BOQ grid / budget / scope line edits, change order BOQ
  read, document and permit edits). Inventory: `served_by` per route, 7 routes `edge:projexa-api`; shell-reachable routes answered by Vercel in
  production: 8 -> 1 (the usage beacon), guarded (`shell_vercel_routes_budget` 1). e2e `lf-lifecycle-vercel-budget` (fast rig, real Chromium):
  passes; the production view of a daily walk is beacon-only; falsified by putting the dashboard back on Vercel (both tests failed, restored).
  ROLLBACK: revert this PR, or set `PX_API_EDGE_ENABLED = false` in src/lib/px-api.ts (one line), or build with NEXT_PUBLIC_PX_API_BASE="".
- BATCH 2 (2026-10-06, branch `audit100/a2-batch-2` in both repos): 40 more routes, the most-used PLAIN proxies of the online screens.
  RANKED by the number of browser source files that call each route (fetchJson / use-submit / fetch call sites; the shell's own routes were
  batch 1); `scripts/projexa-api-candidates.mjs` (new) derives each spec from the handler's own source and refuses anything that is not a plain
  proxy (own requireRole, Promise.all, caches, uploads, other imports, body validation): 106 of the 275 remaining proxies qualify today.
  Generator: 3 new keys (`forward_search`, `success_status` 201, `cache_control` private only) + a route-level `batch`. Parity contract:
  750 cases (was 122, the 122 unchanged) recorded from the REAL Next pipeline, upstream path compared AS IT GOES ON THE WIRE on both sides.
  Callers: 43 direct `fetch("/api/<batch route>")` call sites in 30 components + `shell-cache.ts` now go through `viaPxApi` (fetchJson /
  use-submit already did), so on projexa-ai.com every browser call of the 40 routes goes to the edge. Inventory: 47 routes
  `edge:projexa-api`; Vercel-served /api routes 304 -> 264, guarded (`vercel_served_routes_budget` 264, may only go down).
  SEEN TO FAIL: Next side `/payroll/runs` ORG_ADMIN -> PM_OR_ABOVE in api-write-policy.ts (the recorder failed: pm 201 vs recorded 403);
  edge side the same loosening in the edge copy (compliance-tracker parity "POST /api/payroll/runs as pm" failed + hash check); both reverted.
  ORDER: compliance-tracker PR merged + `projexa-api` deployed + live smoke BEFORE this repo's PR (the client list) merges.
- BATCH 3 (2026-10-06, branch `audit100/a2-batch-3`, stacked on batch 2): the next 33 plain proxies by browser callers (procurement POs /
  quotations, sales quotations / orders, recruitment applications, risks, vendor risk, submittals, schedule task, GRC findings and register,
  AR aging, balance sheet, bank reconciliation, credit-note and journal submit, customer overview, FF&E margin, finance dashboard, floor plans,
  org chart, inventory item / stock balance / stock entries, journal entry). No new spec key. Parity contract 1126 cases (the 750 unchanged);
  16 more direct fetch() sites in 11 components -> viaPxApi. Inventory: 80 routes `edge:projexa-api`; Vercel-served 264 -> 231 (budget 231).
  SEEN TO FAIL: `/journal-entries/[id]/submit` ORG_ADMIN -> FIELD, Next side (recorder: pm 200 vs 403) and edge copy (parity "POST
  /api/journal-entries/:id/submit as pm / as site_engineer" + hash); both reverted.
- BATCH 4 (2026-10-06, branch `audit100/a2-batch-4`, stacked on batch 3): the LAST 33 plain proxies (every route
  `scripts/projexa-api-candidates.mjs` calls PLAIN today is now on the edge): lead / opportunity history and bulk reassign, meetings,
  MoM share-link revoke, mood-board item delete, requisition and RFQ comparison, P&L (+ by project), project budget read/edit/submit/cancel,
  quotation convert, report catalog, sales-invoice submit/cancel/payments, sales-order bulk status, sales pipeline, schedule baselines /
  sprint edit / task completion / types, BOQ submit + approve (explicit acting person), site instruction, tax templates, trial balance,
  wiki page. No new spec key. Parity 1422 cases (the 1126 unchanged); 15 more direct fetch() sites -> viaPxApi. Inventory: 113 routes
  `edge:projexa-api`; Vercel-served 231 -> 198 (budget 198). SEEN TO FAIL: `/scope/[id]/approve` PM_OR_ABOVE -> ANY_ROLE on the Next side
  (recorder fails) and in the edge copy (parity "POST /api/scope/:id/approve as site_engineer / member / client_viewer" + hash); reverted.
- BATCH 2 LIVE (2026-10-06): compliance-tracker #2086 merged (3bb2d06d); `projexa-api` deployed from a clean checkout of that commit with
  the CLI recipe: version 2, ACTIVE; `/_policy` SOURCE_SHA256 194c7e96... = this repo's generated file, 47 routes. LIVE SMOKE (test org,
  sessions by admin magic link, nothing written): 104 of 104 probes identical edge vs Vercel (79 x 200 incl. every batch-2 GET as owner and
  as client_viewer, 16 x 404 unknown ids, 5 x 403 role refusals incl. client_viewer creating a vendor and pm starting a payroll run, 400,
  401, deny-by-default 404, policy hash check): `evidence/a2-batch2-live-smoke-2026-10-06.txt`. Only then did projexa #398 (the client list)
  merge. ROLLBACK if needed: redeploy compliance-tracker e5f3471a (v1 table) AND revert #398 first (client before function, reverse order).
- BATCHES 3+4 LIVE (2026-10-06): compliance-tracker #2087 merged (86b7feb8); `projexa-api` deployed from a clean checkout of it: version 3,
  ACTIVE; `/_policy` SOURCE_SHA256 89a278e8... = this repo's generated file, 113 routes. LIVE SMOKE: 188 of 188 probes identical edge vs
  Vercel (137 x 200: every GET of batches 2-4 as owner and as client_viewer plus the batch-1 reads; 42 x 404 unknown ids; 5 x 403 role
  refusals; 400; 401; deny by default; policy hash): `evidence/a2-batches2-4-live-smoke-2026-10-06.txt`. Only then does this PR (the
  client list for batches 3+4) merge. ROLLBACK: revert the client PR(s) first, then redeploy the previous good function commit
  (3bb2d06d = v2 table, e5f3471a = v1 table); the Next handlers stay as the same-origin fallback throughout.
- BATCH 5 (2026-10-06, branch `audit100/a2-batch-5` in both repos): 72 more routes (110 route+methods), the proxies that were plain in all
  but FORM. `scripts/projexa-api-candidates.mjs` had a whitespace bug (a `const { id } = await params` taken out before the try left two
  spaces, so 36 truly plain routes were reported "not plain") and read the callVeridian options only in one fixed order; it now parses them
  key by key. New spec keys (generator + edge handler): `roles` (the handler's own `requireRole(ctx, ROLE_GROUPS.X)`, 8 routes), `root`
  (veridian-client `root: true`, /api/v1/construction/..., 16 routes), `body` `json_lenient` / `empty`, `body_defaults`. Parity 2358 cases
  (the 1422 unchanged), incl. a `null_role` identity (passes the write gate, refused only by the own role check: every own role set equals
  its route's write tier today, so it is the one case that tells them apart), empty / broken / JSON-null bodies, path-walking ids.
  FOUND AND FIXED (real): (1) 35 Next handler sites put a path parameter RAW into the upstream path (`/policies/${id}`), so `..%2F` in an
  id walked the VERIDIAN path with the org's key (e.g. `/api/sales-invoices/..%2F..%2Fx/submit` POSTed to another upstream path); 16 of
  them were already on the edge (which always encoded, a documented difference). All now `encodeURIComponent`; the deriver refuses a raw
  one. (2) Route precedence: the edge and the browser switch took the FIRST matching pattern, so `/api/materials/issues` would have been
  `/api/materials/:id` and GET `/api/drawings/export` (an xlsx download that stays on Vercel) the JSON route `/api/drawings/:id`. Both now
  resolve like the App Router (literal beats dynamic) and the generated `SHADOW_ROUTES` (8 Vercel routes that are literal siblings of a
  dynamic edge route) are 404 on the edge and same-origin in the browser. 56 more direct fetch() sites in 33 components -> viaPxApi.
  Inventory: 185 routes `edge:projexa-api`; Vercel-served 198 -> 126 (budget 126). SEEN TO FAIL (each reverted, diff clean): edge roles
  check removed (8 null_role cases), root ignored (88), first-match routing (21), lenient read strict (8), defaults over the caller (1),
  shadow list ignored (1 edge, 1 client); Next side: `requireRole` dropped in /api/change-orders POST (recorder: null_role 403 -> 201).
- BATCH 5 LIVE (2026-10-06): compliance-tracker #2091 merged (dbcc1947); `projexa-api` deployed from a clean checkout of it with the CLI
  recipe: version 5, ACTIVE; `/_policy` SOURCE_SHA256 da9014b5... = this repo's generated file, 185 routes. LIVE SMOKE (test org, sessions
  by admin magic link, nothing written): 286 of 286 probes identical edge vs Vercel (167 x 200 incl. every batch-5 GET as owner and as
  client_viewer, among them the 16 root routes; 108 x 404 unknown ids; 7 x 403 role refusals incl. the own-role change-order create and
  the root KPI entry; 400; 401; deny by default; the shadowed /api/materials/master is 404 on the edge; policy hash):
  `evidence/a2-batch5-live-smoke-2026-10-06.txt`. Only then does the client PR (#401) merge. ROLLBACK: revert #401 first, then redeploy
  compliance-tracker b94b0e32 (the v3/v4 113-route table); the Next handlers stay as the same-origin fallback.
- BATCH 6 (2026-10-06, branch `audit100/a2-batch-6` in both repos): 32 more routes (54 route+methods), the proxies with their OWN
  statements, each statement ported as spec data (generator + edge handler) and proven by the recorded contract: body validation
  (`body_required`, in the handler's order; `body_object_error`; `invalid_body_error`; `body_in_try`; `body_reject_if` = the client_viewer
  cost floor), body reshaping (`body_pick`, `body_const` + `upstream_method` for the vendor / customer deactivate = an upstream PATCH),
  query rebuilding (`optional_query` with encodeURIComponent and "?" / "&", `query_flags`, `search_params_omit_empty`,
  `forward_query_normalized`, `required_query_any`), `roles_also` (billing milestones: PM_OR_ABOVE + member) and answer reshaping
  (`response_pick` `{ k: data.k ?? [] }`, `response_wrap` `{ deactivated, id, vendor }`). Routes: schedule baselines / sprints / sprint
  issues / tasks / workload, wiki, work-progress activities and entry, timesheets (+ submit-day, review-day), tasks (+ :id), attendance
  summary, billing claims, material cost report (root), knowledge-base search, manpower cost, org users, budget variance, portfolio
  budget-vs-actual, BOQ compare / categories (+ :id) / lines / cost visibility (root), screen drafts, design materials, products, projects
  overview, vendor / customer :id. A JSON-null body where the handler reads a field THROWS in Next: next/dist/build/templates/app-route.js
  answers `new Response(null, { status: 500 })`; the recorder models exactly that and the edge answers the same empty 500 (parity, not a
  documented difference). Parity 3101 cases (the 2358 unchanged): good / missing / empty / 0 / false / JSON-null / array / number /
  broken bodies, every query form with and without its values, reshaped answers incl. a JSON-null and a number answer, the new forms under
  the upstream's failures. 20 more direct fetch() sites in 14 files -> viaPxApi. Shadows now: /api/work-progress/photos and /report
  (literal siblings of the new /api/work-progress/:id); review-day, /scope/categories/:id and /projects/overview are edge routes
  themselves (a method they lack is 405 on both sides). Inventory: 217 routes `edge:projexa-api`; Vercel-served 126 -> 94 (budget 94).
  SEEN TO FAIL (each reverted, handler byte-identical after): edge body_required removed (82 cases), body_pick ignored (21), JSON-null not
  an empty 500 (10), optional_query with URLSearchParams encoding (33), body_reject_if ignored (1), response_pick default dropped (17),
  own role check off (12), search_params "?" always (3), upstream_method ignored (17), body_object_error ignored (12), body_in_try as 400
  (2), forward_query_normalized byte for byte (7); Next side: requireRole dropped in /api/schedule/baselines POST and the title check
  dropped in /api/wiki POST (the recorder failed each time). The contract also caught a real spec mistake before commit (the cost-floor
  message taken from a code comment, not the handler's answer).

- BATCH 6 LIVE (2026-10-06): compliance-tracker #2093 merged (94647af1); `projexa-api` deployed from a clean checkout of it with the
  CLI recipe: version 6, ACTIVE; `/_policy` SOURCE_SHA256 e2e44a25... = this repo's generated file, 217 routes. LIVE SMOKE (test org,
  sessions by admin magic link, nothing written): 359 of 359 probes identical edge vs Vercel (every batch-6 GET as owner and as
  client_viewer, validation 400s on wiki / sprint / task / submit-day / review-day, the baseline own role set, the cost floor, a
  non-object progress edit, vendor / customer deactivate refusal and unknown id, timesheets without project or issue, manpower with a
  trade, categories incl. inactive, the reshaped projects overview, plus every earlier probe): `evidence/a2-batch6-live-smoke-2026-10-06.txt`.
  Only then does the client PR (#403) merge. ROLLBACK: revert #403 first, then redeploy compliance-tracker dbcc1947 (the 185-route table).

- BATCH 7 (2026-10-06, branch `a2-edge-batch7` here, `px-edge-batch7` in compliance-tracker): the 15 "cache" routes, 232 proxies on the edge (234 with G-09's two org routes), Vercel-served 92 -> 78
  (budget 78; +1 new Vercel route, see below). Cost centers, currencies and fiscal years (a 60 s per-organisation cache, the call made with NO acting
  person), documents / drawings / permits (list + multipart upload), labour roster, materials master (unit cost hidden from site_engineer and
  client_viewer), meetings, minutes, mood boards, knowledge base (+ :id), projects, BOQ list + create (with the create's own check of what came back).
  WHAT THE REAL HANDLERS REVEALED (the plan called these 15 "a cache in the handler"; only 3 are): the 12 others cache NOTHING in the route; their writes
  call revalidateTag / revalidatePath to clear the SERVER-RENDERED PAGE's 30 s list cache, which lives in Vercel's data cache and cannot be reached from a
  Supabase function. Design: the edge answers the write; the browser then asks ONE small Vercel route (`POST /api/cache/revalidate`, signed-in, allow-listed to
  exactly those tags and the /scope page) to clear the same entries, bounded to 2.5 s and never failing the write (`revalidate` in projexa-api-routes.json,
  `PX_EDGE_REVALIDATE` in px-api.ts). The recorder now captures what each real handler cleared (`revalidated`); projexa tests prove the browser's table
  equals it in both directions (every cleared entry is listed, every listed write cleared exactly its entries on success, "always" for /api/projects,
  which clears before it calls the backend). New spec keys: `cache_ttl` + `acting_user: "none"`, `body: "multipart"`, `search_param_defaults`,
  `include_allow`, `response_redact`, `boq_create_verify`, `revalidate`. Parity contract 3794 cases + 7 SEQUENCES (a cache that starts empty, a moving clock:
  one upstream read serves every role for 60 s, per organisation and per path, a failed read is never kept). Edge-only behaviour (the real cache serves
  the stale answer once after the TTL; the isolate refetches, never older than the TTL; the 20 MB upload ceiling; the 256-entry bound) is tested apart.
  FOUND AND FIXED (real, since batch 1): a body that is not JSON on a route whose handler reads `await request.json()` outside its try (almost all, the
  first route of the contract included) is an unhandled throw = an EMPTY 500 on Next; the edge answered 400 {"error":"Invalid JSON body"}. A non-JSON body is
  now recorded for EVERY route that reads one (+173 cases); the edge answers the empty 500, and 5 routes whose handler catches it (`/api/permits/:id`,
  `/api/drawings/:id`, `/api/moms/:id`, `/api/moms/:id/action-items`, `/api/screen-drafts/:id` PATCH/POST) got `body_in_try`. 10 direct fetch() sites -> viaPxApi.
  SEEN TO FAIL (each reverted, file byte-identical after, C:/ct/mutate-result-*-b7.json): 17 edge breaks (TTL never expires, key without the organisation,
  cache never read, acting person always sent, upload form dropped, JSON content type on an upload, default entity type, include not allow-listed,
  redaction for every role / setting nothing, BOQ one missing line / blank id accepted, friendly 400 again, no upload ceiling, entity type without an entity,
  non-form body swallowed, failures cached) and 14 Next / browser breaks (meetings / drawings / projects write stops clearing its cache, pm loses unit costs,
  BOQ check loosened, currencies TTL 30 s, permits all flag, documents default type, drawings kind dropped, knowledge-base title check dropped, browser table
  loses the /scope page, browser clears after a refused write, revalidate route clears any tag, route tier loosened only in the source).

## G-09: new-organisation provisioning inside the edge function (2026-10-06)

WHAT. `POST /api/org/provision` and `GET|POST /api/org/repair` are answered by `projexa-api` (compliance-tracker #2100, merged 79226210; function
version 7). The VERIDIAN side is one SQL transaction (`public.projexa_provision_org`, drizzle/0729); the organisation's VERIDIAN key lives on the
compliance side (`compliance.projexa_org_credentials`, RLS forced, no grants, service role only through functions); PROJEXA's `organizations` and
`memberships` rows are written with the caller's own token. No platform key, no database password, no key on any laptop, no Vercel invocation.
PROVEN: pglite SQL test (all-or-nothing, grants, idempotent file, down file); edge replay of 39 scenarios recorded from these Next routes through the
real pipeline (`ai-os/audit37/projexa-api/org-parity.golden.json`); 3 planted mutations each failed the replay and were reverted; live smoke with a
throwaway user: signed out 401, empty name 400, new org 201, again 200 alreadyProvisioned, a proxied call with the new org's key 200, repair GET, repair when
healthy, PROJEXA rows with the caller's token, anon cannot call any of the functions (401), a stranded org gets the AR-04 refusal (500) then repair 201 and
the proxied call works again; everything cleaned up in both projects (`evidence/g09-live-smoke-2026-10-06.txt`).
BACKFILL (PM-approved, run after the smoke): 13 live credentials copied, verified by sha256 comparison, none printed; 1 dead legacy row (the G-04 orphan, its
VERIDIAN org no longer exists) refused by the SQL; the legacy table is untouched (it is also still written for new orgs while the function's
`PX_MIRROR_LEGACY_CREDENTIALS` is not "false", so routes that still run on Vercel keep working).
NOT PROVEN / OPEN: a browser sign-up through the real UI on projexa-ai.com (the e2e needs the production origin and a signed-in browser; the function call
itself is proven with a real token); the Vercel-side reader switch (`VERIDIAN_CREDENTIALS_SUPABASE_URL` / `_SERVICE_ROLE_KEY`) is not configured (that is a Vercel
setting: owner), so Vercel routes read the legacy table; set `PX_MIRROR_LEGACY_CREDENTIALS=false` only after that. The Next routes remain as the kill-switched fallback.
ROLLBACK: set `PX_API_EDGE_ENABLED` false (or build with `NEXT_PUBLIC_PX_API_BASE=""`) so signup/login use the Vercel routes again; redeploy projexa-api v6
source (compliance-tracker 3 commits before 79226210); `drizzle/down/0729_projexa_org_credentials_and_provision.down.sql` only after confirming the
legacy table has every org you need (it does: untouched).

- BATCH 7 LIVE (2026-10-06): compliance-tracker #2105 merged; `projexa-api` deployed from a clean checkout of main with the CLI recipe (supabase-go via
  SUPABASE_GO_BINARY): `/_policy` SOURCE_SHA256 6357305dc97e... = this repo's generated file. LIVE SMOKE (test org, sessions by admin magic link): 410 of 410 probes
  identical edge vs Vercel (every batch-7 GET as owner and client_viewer, the three cached reads as three roles, validation 400s, role refusals of the uploads / project /
  BOQ creates, document filters, BOQ includes, unit costs hidden from client_viewer): `evidence/a2-batch7-live-smoke-2026-10-06.txt`. LIVE WRITES through the function
  (`evidence/a2-batch7-live-writes-2026-10-06.txt`): a multipart document upload with a real file 201 and found in the list, an external-URL document 201, a 3 MB
  upload 201 (Vercel's old ceiling was 4.5 MB), a knowledge page create 201 / title check 400 / edit 200 / read back edited, an invalid JSON body = the empty 500.
  NOT PROVEN LIVE: the mood-board create returned 400 from the backend for the test body I sent (validation, same body shape not reproduced; covered by the contract);
  the 413 ceiling (a client cannot set Content-Length; the gateway answered 400): unit-proven only. Test rows left in the E2E test organisation, tagged `a2b7-<ts>`:
  3 documents and 1 knowledge page (no API retires them, and a hard delete was not mine to run): the owner or a later session may remove them.
  ROLLBACK: revert the client PR (#407) first, then redeploy the previous good function commit (79226210, v7).


- BATCH 8 (2026-10-06, branches `a2-edge-batch8` / `px-edge-batch8`): 4 of the 7 "several calls combined" routes, 236 proxies on the edge (238 with G-09's two org routes), Vercel-served 78 -> 74 (budget 74):
  `/api/projects/:id/category-distribution` and the company-scoped `/api/dashboard-hierarchy/companies/:companyId/{dashboard,departments,projects/:projectId/category-distribution}`.
  New spec keys: `category_distribution` (two reads in parallel, combined by the projexa repo's own pure builder `src/lib/category-distribution.ts`, COPIED BYTE FOR
  BYTE to the function by `scripts/projexa-api-edge.mjs --write --ct`, checked by `--check-ct`; the first failing read in array order is the answer, a builder that
  throws on a malformed answer is the handler's catch = the fallback 502, `boq_id` appends the optional `&boqId=`), `company_scope` (src/lib/company-scope.ts
  requireCompanyScope: after the ordinary organisation step the person must be a member of THAT company, a second PostgREST read with the person's own token under RLS:
  403 "Not a member of this company"; a failed read or a company id that is not a UUID is an unhandled throw = an empty 500; the COMPANY, not the oldest membership,
  is the organisation whose key and answer are used: proven with an identity that is a member of two organisations) and `acting_user: "id_only"` (the company dashboard
  names the acting user id without the e-mail). The recorder gained per-URL upstream answers (`paths`) and a database mock for the company membership.
  Contract: 3923 cases + 7 sequences. SEEN TO FAIL (each reverted, byte-identical): 11 edge breaks (membership not required, works in the oldest organisation, a failed
  lookup answered 403, e-mail sent with id-only, boqId dropped, first-failure order swapped, a builder throw answered 200, progress read asking the amounts URL, tampered
  builder copy, wrong membership column, company taken from the oldest) and 6 Next / browser breaks (membership check dropped in requireCompanyScope, dashboard stops
  naming the acting user, `format=legacy` dropped, builder share changed, departments path changed, a company route left out of the browser's list).
  NOT MOVED, with the reason (stop-and-report cases of the brief): `/api/dashboard-hierarchy/companies/:companyId/projects/:projectId` (a four-way fan-out through
  revenueForProjectInRange / expensesForProjectInRange / progressAsOf, paginated helpers of its own: porting them would be a second implementation of ~300 lines);
  `/api/work-progress/report` (a 1004-line report builder, `src/lib/work-progress-report.ts`); `/api/shell` (PROJEXA's own Supabase session client, notifications,
  the capability tree and currencies in one answer). Each needs its own design step, not a spec key.

- BATCH 8 LIVE (2026-10-06): compliance-tracker #2109 merged (0147bb81); `projexa-api` deployed from a clean checkout of it: `/_policy` SOURCE_SHA256 eced11dcad7c... =
  this repo's generated file, 236 proxy routes (+ the 2 G-09 org routes). LIVE SMOKE: 431 of 431 probes identical edge vs Vercel (the company dashboard with and without
  filters, departments, both category distributions as owner and client_viewer, not a member of the company 403, a company id that is not a UUID, the category distribution
  of an unknown project with an unknown boqId, plus every earlier probe): `evidence/a2-batch8-live-smoke-2026-10-06.txt`. Only then does the client PR merge.
  ROLLBACK: revert the client PR first, then redeploy compliance-tracker 645133b4's parent main (batch 7 table, 232 routes).

