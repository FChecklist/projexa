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
