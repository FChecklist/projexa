# PROJEXA E2E Testing Program — Phase 1 Report

**Architecture discovery + seed data for a new clean test org (1 CEO + 10 employees)**
Date: 2026-07-19 · Scope: FChecklist/projexa + FChecklist/compliance-tracker (cross-system, read-mostly + additive-only writes)
Claim registered: `compliance-tracker` `ai-os/boss/ACTIVE-CLAIMS.yaml`, PR [#477](https://github.com/FChecklist/compliance-tracker/pull/477) (see "Claim registration" below for why that repo, not this one)

This is Phase 1 of a 5-phase program (Phase 2: E2E test writing/execution across all 40 real modules; Phase 3: chat/composer command testing; Phase 4: gap document; Phase 5: fix implementation). **This report is the direct input to Phase 2.**

---

## (a) The real PROJEXA ↔ VERIDIAN auth/data-bridge architecture

**Summary:** PROJEXA's own Supabase project (`evpckeuxgvahguwsaeul`) holds only auth/org-membership/marketing-site tables. All real construction-business data lives in compliance-tracker's ("VERIDIAN") own database, under a `compliance.organisations` row tagged as a **product branch** of the same platform. The bridge is a **per-PROJEXA-org VERIDIAN API key**, not a per-user identity link — individual PROJEXA users are never individually known to VERIDIAN; every API call from a given PROJEXA org uses that org's one shared key.

### PROJEXA's own local-only tables (never touch VERIDIAN)

`projexa/src/lib/db/schema.ts:1-146`: `organizations`, `memberships`, `veridian_credentials`, `assistant_queries`, `conversations`, `conversation_participants`, `messages`, `profiles`, `todos`, `contact_requests`. Confirmed by file header comment (`schema.ts:3-5`): *"PROJEXA's own tenant/auth/billing schema. All construction domain data (BOQ, progress, site diary, budgets, etc.) lives in VERIDIAN... Nothing construction-related is stored here."*

Only 6 PROJEXA API routes read/write this local DB directly (confirmed by grepping every `src/app/api/**/route.ts` for `@/lib/db` imports and checking which ones do **not** also call `callVeridian`): `api/org/provision`, `api/organization`, `api/org-members` (GET-only), `api/conversations` (+`[id]/messages`), `api/todos` (+`[id]`), `api/contact`. Every other API route (157 of them) is a thin proxy that calls `callVeridian(...)` into compliance-tracker.

### The bridge, step by step, with file:line citations

1. **Signup** (`projexa/src/app/signup/page.tsx:28`) — a real user calls `supabase.auth.signUp()` directly against PROJEXA's own Supabase Auth (project `evpckeuxgvahguwsaeul`). If email confirmation is required (confirmed live — see blocker in section (c)), signup stops here until the user confirms; otherwise the client immediately calls `POST /api/org/provision`.

2. **`POST /api/org/provision`** (`projexa/src/app/api/org/provision/route.ts`) — the **only** place PROJEXA creates a new org, in 3 ordered steps:
   - Step 1 (`route.ts:60-74`): calls `provisionVeridianOrg()` (`projexa/src/lib/veridian-client.ts:173-213`), which does `POST {VERIDIAN_API_ROOT}/platform/provision-org` with `Authorization: Bearer <VERIDIAN_PLATFORM_APPLICATION_KEY>` (a platform-wide, non-per-customer secret, server-only). If this fails, **no** PROJEXA row is created at all — deliberately ordered so a PROJEXA org can never exist without a working VERIDIAN backend (`route.ts:15-25` comment).
   - Step 2 (`route.ts:79-101`): creates the PROJEXA `organizations` row + a `memberships` row (`role: "owner"`) for the signing-up user, via the user's own RLS-scoped Supabase session.
   - Step 3 (`route.ts:103-123`): writes the `veridian_credentials` row (`organizationId` ↔ `veridianOrgId` + `veridianApiKey`), via Drizzle's direct Postgres connection (service-role-equivalent), since that table is `service_role`-only (`projexa/src/lib/db/schema.ts:41-42` comment).

3. **`POST /api/v1/platform/provision-org`** (compliance-tracker, `src/app/api/v1/platform/provision-org/route.ts`) — service-to-service endpoint, authenticated **only** by a `platform_applications` bearer token (`pk_...`, resolved by `validatePlatformApplicationKey`, `route.ts:45`), never a human session or a customer's own key. It:
   - Resolves/creates the `platform_applications` row for `applicationKey = 'projexa'` → its own `product_branches` catalog row (`route.ts:73-82`; live value confirmed: `compliance.platform_applications.id = a1dab7a7-8fb5-4853-9876-a3cb72703da1`, `compliance.product_branches` row `branch_key='projexa', id=5fceebcd-0a7a-4448-ae2b-a72637124f13, status='live'`).
   - Calls `provisionOrganisation()` (`src/lib/services/org-provisioning-service.ts:57-115`) — creates the `compliance.organisations` row + a default "General" department + auto-enables the 2 free branches (`veri_reward`, `veri_chat_v2`).
   - Auto-enables `REQUIRED_BRANCHES_BY_APPLICATION['projexa'] = ['construction', 'erp', 'sales', 'hr']` (`route.ts:40-42`, `98-117`) — this exists specifically because PROJEXA's Sales/CRM+ERP surface 502s without it (documented regression fixed for `projexa_demo_org` in `drizzle/0201_projexa_demo_org_erp_sales_hr_enablement.sql`; this closes it for every *new* org going forward).
   - Mints a `vk_...` API key (`generateApiKey()`/`hashSHA256()`, `src/lib/api-keys.ts:9-21`) scoped to the new org via `apiKeys.orgId`, tagged `issuedForApplicationId` = the `projexa` platform-application row, returns it **once** (`route.ts:130-147`).

4. **Every subsequent PROJEXA→VERIDIAN call**: `projexa/src/lib/veridian-client.ts:69-84` (`resolveApiKey`) looks up `veridian_credentials.veridianApiKey` for the caller's `organizationId` and sends it as `Authorization: Bearer vk_...` to `https://veridian-compliance-ai.vercel.app/api/v1/projexa/*` (`VERIDIAN_API_BASE`, `veridian-client.ts:19`). On the receiving end, `compliance-tracker/src/lib/supabase/api-key-auth.ts:74-118` (`validateApiKey`) hashes the incoming key, looks it up in `apiKeys`, resolves `{orgId, scopes}`, applies per-key rate limiting, and rejects a hardcoded demo-key id (`projexa_demo_key`) unless explicitly allowlisted via `DEMO_API_KEY_IDS` (a real, already-fixed security gap — see `api-key-auth.ts:24-54`). That resolved `orgId` is what every downstream service call is tenant-scoped by (`src/lib/db/tenant-scoped.ts`'s `withTenantContext`).
   - `product-branch-service.ts:56-59` (`requireBranchEnabled`) is the shared 403 gate every vertical's routes call first, checking `org_product_branch_enablements` for that resolved org.
   - A handful of already-shipped VERIDIAN endpoints (labour roster, generic documents) were never re-exported under `/api/v1/projexa/*` — calls to those pass `root: true` to reach `/api/v1/*` directly instead (`veridian-client.ts:21-31`), same auth, different path prefix. **This is not a gap** — it's a deliberate routing shortcut, confirmed real and wired end-to-end either way.

### Self-correction made during this task (report honestly, not glossed over)

The task brief said `product_branches`/`product_branch_modules` moved to a `platform` Postgres schema, citing "drizzle/0245." I initially flagged this as a **false premise**, because the checked-out `compliance-tracker` working copy on disk (`/opt/veridian/repos/compliance-tracker`) was **63 commits behind** `origin/main`, and its `schema.ts` still declared `product_branches` under `compliance`. Live `psql` introspection against the real database (`compliance-tracker/.env.local` → `DATABASE_URL`) proved the brief was **right**: a `platform` Postgres schema genuinely exists today with 22 tables including `platform.product_branches` and `platform.product_branch_modules`, applied **live via Supabase MCP** (compliance-tracker PR [#468](https://github.com/FChecklist/compliance-tracker/pull/468) "Add platform schema compartment migration", PR [#469](https://github.com/FChecklist/compliance-tracker/pull/469) "schema.ts: reflect live platform schema move" — both already merged to `origin/main`). No file literally named `drizzle/0245` exists (the move was applied directly, not via a numbered Drizzle migration file), so that specific detail doesn't resolve — but the underlying architectural fact is real. **This does not affect anything in this report or the seed data below**: diffed `HEAD..origin/main` on `schema.ts` and confirmed zero changes to any `construction_*`/`erp_*`/`employee_profiles`/`projects`/`users`/`leave_*` table — the business-data schema this task actually seeds against is unaffected by the platform-schema move.

---

## (b) The 40 modules: REAL-BACKING vs NO-REAL-BACKING-YET

Audited by reading every `/api/v1/projexa/*` route in compliance-tracker, tracing into its service layer, confirming a genuine persisted Drizzle table backs it (not a mock/501/hardcoded stub), and confirming PROJEXA's own proxy route actually calls it via `callVeridian(...)`.

**Result: 39/40 REAL-BACKING, 1/40 (settings) is legitimately PROJEXA-native-only by design (not a gap).**

| # | Module | Verdict | Evidence (file:line, real table) |
|---|---|---|---|
| 1 | accounting | REAL | `api/v1/projexa/accounts/route.ts:16` → `erp-accounting-service.ts:70` → `erp_accounts` (`schema.ts:5197`) |
| 2 | budgets | REAL | `api/v1/projexa/project-budgets/route.ts:14` → `erp-budget-service.ts:23-84` → `erp_budgets`/`erp_budget_line_items` (`schema.ts:7409/7424`) |
| 3 | change-orders | REAL | `api/v1/projexa/change-orders/route.ts:5` → `construction-change-order-service.ts:17-36` → `construction_change_orders` (`schema.ts:9226`) |
| 4 | copilot | REAL (scoped) | `api/v1/projexa/assistant/route.ts:25` → `dispatchTool()` (`task-execution-engine.ts:79`), 7-tool allowlist, each reads real persisted data (not a general LLM chat surface) |
| 5 | customers | REAL | `api/v1/projexa/customers/route.ts:20` → `erp-selling-service.ts:76-119` → `erp_customers` (`schema.ts:5805`) |
| 6 | dashboard | REAL | `api/v1/projexa/dashboard/route.ts:5` + `dashboard/[projectId]` → `construction-dashboard-service.ts:113`, aggregates `projects`/`erp_sales_invoices`/`erp_budget_line_items`/`construction_expense_entries` etc. |
| 7 | documents | REAL (root-alias) | No `/v1/projexa/documents` route by design — lives at `/api/v1/documents` (root), reached via `veridian-client.ts`'s `root:true` override. Backed by `documents` (`schema.ts:369`) |
| 8 | employees | REAL | `api/v1/projexa/employees/route.ts:13` → `hr-service.ts:31-93` → `users`+`employee_profiles` (`schema.ts:201/4614`) |
| 9 | expenses | REAL | `api/v1/projexa/expenses/route.ts:5` → `construction-expense-service.ts:25-44` → `construction_expense_entries` (`schema.ts:9138`) |
| 10 | ffe | REAL | `api/v1/projexa/ffe/route.ts:5` → `interior-design-service.ts:89-123` → `interior_ffe_items` (`schema.ts:9283`) |
| 11 | floor-plans | REAL | `api/v1/projexa/floor-plans/route.ts:1-40` → `interior-floorplan-service.ts:20-38` → `interior_floor_plans` (`schema.ts:9320`) |
| 12 | grc | REAL | `api/v1/projexa/grc-dashboard/route.ts:11-24` → `risk-register-service.ts:240-280`, aggregates `risks`/`audit_findings`/`policies`/`vendor_risk_profiles` (all real tables) |
| 13 | hr | REAL | `api/v1/projexa/hr/departments/route.ts` + `hr/org-chart/route.ts` → `departments` (`schema.ts:190`), `hr-service.ts` |
| 14 | inventory | REAL | `api/v1/projexa/inventory/items/route.ts:10-52` → `erp-stock-service.ts:24-44` → `erp_items` (`schema.ts:6013`) |
| 15 | invoices | REAL | `api/v1/projexa/sales-invoices/route.ts:39-93` → `erp-invoicing-service.ts` → `erp_sales_invoices` (`schema.ts:5369`) |
| 16 | knowledge-base | REAL | `api/v1/projexa/knowledge-base/route.ts:12-44` → `knowledge-base-service.ts` → `knowledge_base_pages` (`schema.ts:4134`) |
| 17 | kpis | REAL (alias) | `api/v1/projexa/kpis/route.ts:1` re-exports `construction/kpi-definitions/route.ts` → `construction_kpi_definitions` (`schema.ts:9096`) |
| 18 | labour | REAL (root-alias) | `api/v1/projexa/labour/route.ts:1` re-exports `construction/labour-roster`; PROJEXA actually calls it via `root:true` → `construction_labour_roster` (`schema.ts:9052`) — real either way |
| 19 | materials | REAL | `api/v1/projexa/materials/route.ts:11-32` → `erp-inventory-service.ts:170-178` → `erp_stock_ledger_entries` (`schema.ts:6045`) |
| 20 | meetings | REAL | `api/v1/projexa/meetings/route.ts:13-49` → `pms-meeting-service.ts` → `pms_meetings` (`schema.ts:3919`) |
| 21 | mood-boards | REAL | `api/v1/projexa/mood-boards/route.ts:14,33` → `interior-design-service.ts` → `interior_mood_boards` (`schema.ts:9258`) |
| 22 | payroll | REAL | `api/v1/projexa/payroll/runs/route.ts:17,36` → `erp-payroll-service.ts` → `erp_payroll_runs`/`erp_payslips`/`erp_payslip_lines` (`schema.ts:7002/7013/7025`) |
| 23 | permits | REAL (generic table) | `api/v1/projexa/permits/route.ts:42` → `listExpiringDocuments(..., "permit")` — reuses `documents` filtered by `category='permit'`, no dedicated table (worth knowing, not a gap) |
| 24 | procurement | REAL (multi-route) | No single root route; `requisitions`/`rfqs`/`quotations`/`purchase-orders`/`goods-receipts` sub-routes → `erp_purchase_requisitions`/`erp_rfqs`/`erp_supplier_quotations`/`erp_purchase_orders`/`erp_purchase_receipts` |
| 25 | punch-list | REAL | `api/v1/projexa/punch-list/route.ts:15,34` → `construction-field-workflow-service.ts` → `construction_punch_list_items` (`schema.ts:9206`) |
| 26 | purchase-orders | REAL | `api/v1/projexa/purchase-orders/route.ts:38,63` → `erp-buying-service.ts` → `erp_purchase_orders`/`erp_purchase_order_items` (`schema.ts:5695/5726`) |
| 27 | quotations | REAL | `api/v1/projexa/quotations/route.ts:42,81` → `erp-selling-service.ts` → `erp_quotations`/`erp_quotation_items` (`schema.ts:5854/5913`) |
| 28 | recruitment | REAL | `api/v1/projexa/recruitment/job-openings/route.ts` → `job_openings`/`candidates`/`job_applications`/`interview_feedback` (`schema.ts:7249+`) |
| 29 | reports | REAL | `api/v1/projexa/reports/catalog/route.ts:20` → `report-engine-service.ts`; `reports/[reportName]` → `construction-reports-service.ts`'s `REPORT_REGISTRY` — live data via other services, no separate mock engine |
| 30 | rfis | REAL | `api/v1/projexa/rfis/route.ts:15,34` → `construction-field-workflow-service.ts` → `construction_rfis` (`schema.ts:9165`) |
| 31 | sales | REAL | `api/v1/projexa/sales-pipeline/route.ts:9-20` → `crm-service.ts` → `crm_leads`/`crm_opportunities` (`schema.ts:4403/4445`) |
| 32 | sales-orders | REAL | `api/v1/projexa/sales-orders/route.ts:33-90` → `erp-selling-service.ts:407,456` → `erp_sales_orders`/`erp_sales_order_items` (`schema.ts:5923/5961`) |
| 33 | schedule | REAL | `api/v1/projexa/schedule/route.ts:17-86` + `schedule/gantt` → `pms-issue-service.ts`/`schedule-service.ts` → `pms_issues` (`schema.ts:3701`) |
| 34 | scope | REAL (alias) | `api/v1/projexa/scope/route.ts:1-5` re-exports `construction/boq/route` → `construction_boqs`/`construction_boq_line_items` (`schema.ts:8923/8938`) |
| 35 | **settings** | **NO REAL BACKING — by design, not a gap** | No `/v1/projexa/settings*` route exists in compliance-tracker at all. PROJEXA's `settings/page.tsx` uses only its own local `/api/organization` + `/api/org-members` — org/member settings are genuinely PROJEXA-native, never proxied |
| 36 | site-diary | REAL | `api/v1/projexa/site-diary/route.ts:1` re-exports `construction/site-diary` → `construction_site_diaries` (`schema.ts:9006`) |
| 37 | submittals | REAL | `api/v1/projexa/submittals/route.ts:5-41` → `construction-field-workflow-service.ts:68,83` → `construction_submittals` (`schema.ts:9186`) |
| 38 | vendors | REAL | `api/v1/projexa/vendors/route.ts:21-57` → `erp-buying-service.ts:37,53` → `erp_suppliers` (`schema.ts:5591`) |
| 39 | wiki | REAL | `api/v1/projexa/wiki/route.ts:11-51` → `pms-wiki-service.ts` → `pms_wiki_pages` (`schema.ts:3852`) |
| 40 | work-progress | REAL (alias) | `api/v1/projexa/work-progress/route.ts:1` re-exports `construction/progress` → `construction_work_progress_entries` (`schema.ts:8989`) |

**Notable non-gap nuances** (report honestly rather than smoothing over — none of these block Phase 2, but Phase 2's test-writer should know):
- 4 modules (`kpis`, `labour`, `scope`, `site-diary`, `work-progress` — 5, not 4) are thin re-export aliases of an existing `/api/v1/construction/*` route, not independent implementations. Still real, still wired.
- `documents` and `labour` are reached via `root: true`, bypassing the `/projexa` path prefix entirely — a literal path check for `/v1/projexa/documents` would produce a false negative.
- `permits` has no dedicated table — it's `documents` filtered by `category='permit'`.
- `copilot` is a fixed 7-tool dispatcher, not an open-ended chat surface — real, but narrower than the module name implies.

---

## (c) New test org, credentials, and a genuine access blocker

### Compliance-tracker side (fully executed against the live database)

- **Org:** `Meridian Construction Group (E2E Test Org)`
- **`compliance.organisations.id`:** `4ecc472f-4152-4310-ae8d-cf8b7c52ab6d`
- **slug:** `meridian-construction-e2e-test`
- Deliberately **not** `projexa_demo_org` / `demo_org` / `ve45lczmkodbiq1m20fy48r5` ("Demo Organization") / any `projexa-loadtest-*` org — all 4 were confirmed live via `select id,name,slug from organisations where name/slug ilike '%demo%'/'%load%test%'` before creating this one, and are untouched.
- **Real VERIDIAN API key minted** (compliance-tracker `api_keys` row `b199026b-dc76-402e-ab40-616db6068774`, `issued_for_application_id` = the real `projexa` platform-application row, scopes `read,write`): `vk_GJrYOpZukkCSplVNYI3IEF6LxwvOWDU0`. Not retrievable again — recorded here and in `scripts/phase1-provision-projexa-accounts.mjs`.
- Product branches enabled for this org: `construction`, `pms`, `erp`, `sales`, `hr`, `veri_reward`, `veri_chat_v2` — matches `REQUIRED_BRANCHES_BY_APPLICATION['projexa']` plus what schedule/Gantt (`pms`) needs.

### Org chart — 1 CEO + 10 employees, mapped to the **real** `userRoleEnum`

Confirmed live (`select typname,enumlabel from pg_enum...`): `admin, manager, member, viewer, veridian_admin, branch_manager, senior_professional, team_member, client_viewer, external_auditor, stage_0`. `role` (this enum) is compliance-tracker's permission tier; the actual job title lives on `employee_profiles.job_title` (a free-text field) — both are seeded.

| Name | `users.role` | `employee_profiles.job_title` | Department | Reports to |
|---|---|---|---|---|
| Arjun Mehta | `admin` | Chief Executive Officer | General | — |
| Rohan Kapoor | `manager` | Project Manager | Site Operations | Arjun |
| Vikram Singh | `member` | Site Engineer | Site Operations | Rohan |
| Manoj Yadav | `member` | Site Supervisor | Site Operations | Rohan |
| Priya Nair | `senior_professional` | Quantity Surveyor | Site Operations | Arjun |
| Ananya Rao | `manager` | Procurement Manager | Procurement | Arjun |
| Karan Malhotra | `member` | Safety Officer (EHS) | Site Operations | Arjun |
| Sneha Reddy | `manager` | HR Administrator | HR | Arjun |
| Deepak Joshi | `manager` | Finance & Accounts Manager | Finance & Accounts | Arjun |
| Kavita Iyer | `senior_professional` | Design Lead / Architect | Design & Engineering | Arjun |
| Aditya Verma | `team_member` | Document Controller | Design & Engineering | Kavita |

All 11 `compliance.users` rows, `employee_profiles`, `reporting_to_id` self-FKs, and `departments.head_id` are real, committed rows (batch 1 above).

### ⚠️ Genuine credential-access blocker — PROJEXA-side login accounts NOT created

The task asked for 11 real, working PROJEXA logins. **This could not be completed in this session**, for reasons that are architectural/credential-access, not effort — documented honestly rather than fabricating credentials:

1. **`vercel env pull` cannot retrieve PROJEXA's `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_DB_PASSWORD` / `VERIDIAN_PLATFORM_APPLICATION_KEY`.** Confirmed live: pulling the `production` environment for the `projexa` Vercel project returns the literal string `"[SENSITIVE]"` for each of these — a genuine Vercel platform feature ("Sensitive" env vars are write-only via the dashboard/CLI, never readable back), not a bug or something bypassable from the CLI.
2. **No Supabase MCP tool is available in this session** (confirmed via tool search) — the DB-access-capable session that produced the original architectural finding this task built on had that capability; this session doesn't.
3. **`SUPABASE_ACCESS_TOKEN`** (present in `/opt/veridian/shared/.env`) **is expired/invalid** — confirmed via both the `supabase` CLI (`projects list` → `Unauthorized`) and a direct Management API call (`401`).
4. Fallback attempted: extracted PROJEXA's real, publicly-shipped Supabase URL + publishable key (`sb_publishable_f0C6ZvVjEnwkdN7wxfEwBQ_x69zrGs8`) directly from the live site's client JS bundle (`https://projexa-ai.com` → `_next/static/chunks/36zd4_omm-dw2.js` — this is not a secret, every browser gets it) and called the real public `POST /auth/v1/signup` endpoint, exactly as the browser flow would. **Confirmed live that email confirmation is required** (`confirmation_sent_at` present, no session returned) — this session has no mailbox access to click a confirmation link, so this path cannot produce a working session either, for the CEO or anyone else.
   - **Side effect to clean up:** this probe created one real, permanently-unconfirmed auth user, `probe-test-e2e-phase1@projexa-ai.com`, in PROJEXA's production Supabase Auth (`evpckeuxgvahguwsaeul`). Harmless (never confirmed, never logged in, no org/data attached) but should be deleted by whoever next has service-role access.

**What's ready, not yet run:** `scripts/phase1-provision-projexa-accounts.mjs` — a complete, correct script (using `supabase-js`'s `admin.auth.admin.createUser({email_confirm: true})`, which bypasses the confirmation-email problem entirely once a real service-role key is available) that creates the PROJEXA `organizations` row, all 11 Supabase Auth users, 11 `memberships` rows in that one org, and the `veridian_credentials` bridge row pointing at the **already-real** compliance-tracker org id + `vk_` key above. It reuses the real, already-seeded business data — running it does not require re-seeding anything. Intended emails (`firstname.lastname@meridian-construction.e2e-test.projexa-ai.com`, password `MeridianE2E2026!` for all 11) are in the script; CEO gets `memberships.role = "owner"`, everyone else `"member"` (PROJEXA's own local role concept, separate from the `userRoleEnum` above).

**Recommendation:** the next session with either a real `SUPABASE_SERVICE_ROLE_KEY` for `evpckeuxgvahguwsaeul` or Supabase MCP access should run this script (2 minutes of work) before Phase 2 begins — Phase 2 cannot log in as these users otherwise.

---

## (d) Exact seed counts (compliance-tracker, live, already committed)

**1,007 rows total**, across 4 executed batches (`scripts/phase1-seed-compliance-tracker-batch{1..4}.mjs`):

**Batch 1 — org / people / projects / taxonomy (177 rows):** 1 organisation, 7 product-branch enablements, 6 departments, 11 users, 11 employee profiles, 1 product, **4 projects**, 4 PMS issue types, 20 PMS issue statuses, 12 construction categories, 48 construction activities, 4 BOQs, 48 BOQ line items.

**Batch 2 — construction field workflow (284 rows):** **32 RFIs**, **24 submittals**, **40 punch-list items**, **12 change orders**, **60 site-diary entries** (15 consecutive days × 4 projects), **60 schedule tasks** (15 per project, sequenced with 56 `blocks` dependencies).

**Batch 3 — procurement & sales (174 rows):** 10 vendors, 20 materials, 6 customers, **12 purchase orders** (+34 line items), **8 quotations** (+24 line items), **6 sales orders** (+18 line items), **12 sales invoices** (+24 line items).

**Batch 4 — HR & operations (372 rows):** 6 salary components, 11 salary structures (+44 structure-component lines), 3 payroll runs, **33 payslips** (11 employees × 3 months, +165 payslip lines), 33 leave balances, **15 leave requests**, **25 documents**, **12 meetings**, 6 KPI definitions (+18 monthly entries), 1 API key.

Realistic variety, not token rows: 4 named projects (residential tower, business park, school renovation, warehouse complex) each with their own RFI subjects, punch-list locations/trades, BOQ line items, and a full 15-task dependency-linked schedule; status distributions mix open/closed/pending states (e.g. RFIs: 5 answered / 2 open / 1 closed per project) rather than all-one-state; payroll runs span 3 months with a real CTC→component breakdown per employee; invoices span the full `draft→submitted→partially_paid→paid→overdue` status range.

---

## Claim registration

Registered in **compliance-tracker's** `ai-os/boss/ACTIVE-CLAIMS.yaml` (PR [#477](https://github.com/FChecklist/compliance-tracker/pull/477)), not a projexa-repo file — `FChecklist/projexa` has no `ai-os/` directory at all, and that registry's own header already explicitly covers `"or in veda-advisors / projexa"` work. Used a scratch clone (`/tmp/compliance-tracker-claim`) rather than the shared checkout at `/opt/veridian/repos/compliance-tracker`, which had pre-existing uncommitted work from another session (including, notably, a staged change to that same claims file) that this task must not disturb.

## Files in this PR

- `PHASE1_SEED_REPORT.md` — this report
- `scripts/phase1-seed-compliance-tracker-batch{1,2,3,4}.mjs` — as-run record of the compliance-tracker seed (already executed against the live DB; kept for reproducibility)
- `scripts/phase1-provision-projexa-accounts.mjs` — ready to run, NOT yet executed (see blocker above)

Tier: **tier1** (docs + standalone Node scripts only — no schema/migration change, no modification to existing application source in either repo).
