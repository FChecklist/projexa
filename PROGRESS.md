# PROGRESS -- task-20260719-061256-projexa-e2e-phase-1--architecture-discov

## Completed
- [x] Located both repos: FChecklist/projexa (this workspace) and FChecklist/compliance-tracker (/opt/veridian/repos/compliance-tracker)
- [x] Registered claim in compliance-tracker's ai-os/boss/ACTIVE-CLAIMS.yaml (PR #477, via a scratch clone at /tmp/compliance-tracker-claim to avoid touching the shared checkout's pre-existing uncommitted work)
- [x] Confirmed real auth/data-bridge mechanism with file:line citations:
  - projexa/src/lib/veridian-client.ts (getVeridianApiKey/resolveApiKey/provisionVeridianOrg)
  - projexa/src/app/api/org/provision/route.ts (creates PROJEXA org + membership + veridian_credentials row)
  - compliance-tracker/src/app/api/v1/platform/provision-org/route.ts (mints vk_... apiKey scoped to a new compliance.organisations row)
  - compliance-tracker/src/lib/supabase/api-key-auth.ts (validateApiKey resolves vk_... -> orgId for every /api/v1/projexa/* call)
  - compliance-tracker/src/lib/services/product-branch-service.ts (branch enablement gate)
- [x] SELF-CORRECTED: initially misread the "platform schema" detail as a false premise because the shared checkout was 63 commits behind origin/main. Live `psql` introspection confirmed the task brief WAS right: `platform.product_branches` etc. really exist (compliance-tracker PR #468/#469, merged). No drizzle/0245 file exists by that name, but the schema-relocation fact is real. Construction/ERP/HR business tables (what seeding needs) are unaffected.
- [x] Confirmed real userRoleEnum (live pg_enum): admin, manager, member, viewer, veridian_admin, branch_manager, senior_professional, team_member, client_viewer, external_auditor, stage_0
- [x] Found existing account-provisioning precedent for democeo@projexa-ai.com (claude-control/CONTROLLER.yaml PROJEXA-DEMO-01 entry)
- [x] Full 40-module real-vs-placeholder backing survey complete (6 parallel research agents): 39/40 REAL-BACKING, 1/40 (settings) legitimately PROJEXA-native-only by design -- full table in PHASE1_SEED_REPORT.md section (b)
- [x] Full live-DB schema introspection (psql \d) for every table used in the seed script -- cross-checked against agent findings, all consistent
- [x] Designed 11-person org chart (CEO + 10) mapped to real userRoleEnum + realistic construction job titles -- see PHASE1_SEED_REPORT.md section (c)
- [x] Wrote and ran 4-batch seed script against compliance-tracker's live DB: new org "Meridian Construction Group (E2E Test Org)" (id 4ecc472f-4152-4310-ae8d-cf8b7c52ab6d), 1,007 rows total across projects/RFIs/submittals/punch-list/change-orders/site-diary/schedule/BOQ/vendors/materials/customers/POs/quotations/sales-orders/invoices/payroll/leave/documents/meetings/KPIs
- [x] Minted a real VERIDIAN vk_ API key (compliance-tracker api_keys row b199026b-dc76-402e-ab40-616db6068774) scoped to the new org, ready to bridge from PROJEXA
- [x] Attempted PROJEXA-side account creation; hit a genuine, well-evidenced credential-access blocker (Vercel Sensitive env vars unreadable via CLI, no Supabase MCP tool available, expired SUPABASE_ACCESS_TOKEN, public signup blocked by required email confirmation with no mailbox access) -- documented in full in PHASE1_SEED_REPORT.md section (c), including a side-effect probe account left in PROJEXA's Supabase Auth that needs cleanup
- [x] Wrote scripts/phase1-provision-projexa-accounts.mjs -- ready to run once a session has real PROJEXA service-role/DB access, reuses the already-minted real org id + vk_ key (no re-seeding needed)
- [x] Wrote PHASE1_SEED_REPORT.md with exact counts, credentials, and file:line citations
- [x] Committed report + seed scripts, opened PR against FChecklist/projexa

## Remaining
- [ ] (Blocked, handed off) Run scripts/phase1-provision-projexa-accounts.mjs once real PROJEXA Supabase service-role/DB credentials are available -- creates the 11 real working logins Phase 2/3 need
- [ ] (Handed off) Delete the dangling unconfirmed probe account probe-test-e2e-phase1@projexa-ai.com from PROJEXA's Supabase Auth once service-role access exists
- [ ] Phase 2 (E2E test writing/execution) -- separate, subsequent dispatch, not part of this task
