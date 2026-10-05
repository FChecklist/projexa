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
