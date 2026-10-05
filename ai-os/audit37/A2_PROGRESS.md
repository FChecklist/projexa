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
