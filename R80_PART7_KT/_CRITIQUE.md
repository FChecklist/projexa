Inspection done. Here is the completeness verdict.

---

# COMPLETENESS CRITIQUE — 12 sheets vs. the actual repos

## THE HEADLINE FINDING: six sheets declare the backend unreadable; it is on disk

Six sheets (`PROJEXA_API_ROUTES`, `PROJEXA_ERP_BUSINESS_RULES`, `PROJEXA_REPORT_ANALYSIS_INVENTORY`, `PROJEXA_COMPOSER_FLOW_TRACE`, `PROJEXA_USER_PROCEDURES`, `AI_ROUTER_TIERS`) carry a caveat of the form *"VERIDIAN / compliance-tracker is a SEPARATE repo and is not present at C:\ct\projexa"* and stop their tracing at the HTTP boundary. That caveat is technically true and materially misleading: the repo is at **`C:\ct\ct`**, was in the stated task scope, and was in fact read by three other sheets (the DB inventory, env inventory, and AI router sheet all cite `C:\ct\ct` paths).

Verified counts in `C:\ct\ct`:

| Surface | Count | Path |
|---|---|---|
| API route handlers | **1,172** `route.ts` | `C:\ct\ct\src\app\api` |
| — under `/api/v1` | 332 | `src\app\api\v1` |
| — under `/api/v1/projexa` (PROJEXA's own upstream) | **274** | `src\app\api\v1\projexa` |
| — under `/api/v1/construction` | 31 | `src\app\api\v1\construction` |
| — under `/api/erp` | 162 | `src\app\api\erp` |
| Business-logic services (non-test) | **263** | `C:\ct\ct\src\lib\services` |
| Computation engines | 26 | `C:\ct\ct\src\lib\engines` |
| Page routes (its own UI) | **198** | `C:\ct\ct\src\app` |
| SQL migrations | **396** | `C:\ct\ct\drizzle\*.sql` |
| Architecture/runbook docs | 85 | `C:\ct\ct\docs` |

The four services the business-rules sheet names as unverifiable all exist and are large:

```
C:\ct\ct\src\lib\services\construction-reports-service.ts   3,448 lines
C:\ct\ct\src\lib\services\construction-boq-service.ts       1,652 lines
C:\ct\ct\src\lib\services\construction-progress-service.ts  1,024 lines
C:\ct\ct\src\lib\services\construction-labour-service.ts      608 lines
```

**Why it matters for handover:** PROJEXA's own README (`C:\ct\projexa\README.md:7-12`) states the repo *"carries no construction domain data of its own."* Every one of the 288 PROJEXA API rows is a proxy. So the KT set documents the *shell* of the product in high resolution and the *product* not at all. A new engineer reading all 12 sheets can find which button calls which URL, and cannot find a single line of the code that computes a BOQ total, an earned-value figure, a payroll run, or a report column. **No sheet covers `C:\ct\ct\src\lib\services` (263 files) or `C:\ct\ct\src\lib\engines` (26 files) at all.**

---

## ROW COUNTS THAT ARE IMPLAUSIBLY LOW

**`PROJEXA_ERP_BUSINESS_RULES` — 130 rows. Most under-scoped sheet in the set.**
Self-reported scope was "~15 API route.ts files" out of 288, plus a subset of `src/lib`. Against the real corpus — 288 PROJEXA routes, 274 upstream `/v1/projexa` routes, 263 services, 26 engines — 130 rules is roughly one rule per 6,000 lines of logic. The sheet is also structurally client-side: it admits the authoritative half is upstream, and the upstream is `C:\ct\ct\src\lib\services\construction-*.ts` (21 files) and `C:\ct\ct\src\lib\engines\{costing,accounting,payroll,inventory,procurement,project-management}-engine.ts`. The owner asked for "business logic"; this sheet delivers PROJEXA's input-validation layer.

**`AI_ROUTER_TIERS_CLASSIFICATION_CACHING` — 70 rows, scoped to the classification pipeline only.**
The sheet is rigorous about `C:\ct\ct\src\lib\pipeline` (35 files) and `src\lib\ai-router` (11). Untouched, and all present:
`src\lib\prompt-compiler` (29 files), `src\lib\browser-execution` (25), `src\lib\loops` (20), `src\lib\prompt-security` (16), `src\lib\monitors` (15), `src\lib\ai-team` (11), `src\lib\ai` (10), `src\lib\explainability` (2) — plus route surfaces `api\ai` (27), `api\orchestra` (6), `api\prompt-os` (4), `api\worker-agents` (3), `api\mcp` (3), `api\prompt-eval` (3), `api\fde` (1). The owner asked for "the software + AI combination"; what was delivered is an audit of one classifier and a correct dead-code finding.

**`PROJEXA_API_ROUTES` — 288 rows is exactly right for PROJEXA and covers ~20% of the real API surface** (288 of 1,460 handlers across both repos). Not a counting error — a scope boundary that should be stated on the sheet, not only in a footnote.

**`PROJEXA_MODULE_INVENTORY` — 39 rows is honest, but there is no route-level sheet anywhere.**
`src/lib/module-catalogue.ts:337` says in its own words that the catalogue covers **116 of 175** shipped routes. Verified on disk: **175** `page.tsx` under `src\app\(app)`, **186** total under `src\app`. So ~59 in-app routes and 11 public routes appear in no sheet in any form. The component sheet (357 rows) covers files, not routes; a route with no dedicated client component vanishes.

**Plausible / defensible:** `PROJEXA_COMPONENT_LAYER` 357 vs. 356 production files (490 − 134 tests) — matches. `VERIDIAN_PROJEXA_DATABASE_INVENTORY` 632 — matches live table counts and is the strongest sheet in the set. `ENV_AND_CONFIG_INVENTORY` 113 — reasonable and unusually honest about its own drift findings.

---

## MISSING SUBJECTS — what a new engineer or operator still cannot do

### 1. Cannot onboard a customer, or explain how a tenant comes into existence
**Missing subject:** the multi-tenant provisioning lifecycle. `src/lib/veridian-client.ts:36-46` documents it: every signup provisions an isolated VERIDIAN org and API key via `POST /api/v1/platform/provision-org`, stored per-org in `public.veridian_credentials`; a caller passing `organizationId` with no credentials row **throws rather than falling back to the shared key** (rule AR-04). The DB sheet records `veridian_credentials` as "RLS on, zero policies" and stops. No sheet traces the flow.
**Where the answer lives:** `C:\ct\projexa\src\lib\veridian-client.ts` (874 lines, `provisionVeridianOrg()`, `resolveApiKey()`); `C:\ct\projexa\src\app\api\org\provision\route.ts`; `C:\ct\projexa\src\app\api\org\repair\route.ts`; `C:\ct\ct\src\app\api\v1\platform\provision-org\route.ts`.
**Why it matters:** this is the single operation that turns a signup into a working account across two Supabase projects. Nobody can run the business without it.

### 2. Cannot get a user into the product at all
**Missing subject:** the entire unauthenticated surface. All 11 page routes outside `src\app\(app)` are absent from every sheet — the module inventory is `(app)`-scoped and `PROJEXA_USER_PROCEDURES` starts at flows that presuppose a session:
```
src\app\login\page.tsx              src\app\signup\page.tsx
src\app\auth\callback\page.tsx      src\app\invite\[token]\page.tsx
src\app\share\attendance\[token]\page.tsx   src\app\share\report\[token]\page.tsx
src\app\shared\mom\[token]\page.tsx
src\app\page.tsx  src\app\how-it-works\page.tsx  src\app\hi\page.tsx  src\app\hi\how-it-works\page.tsx
```
Plus the invite lifecycle: `src\app\api\org\invites\{route,preview,accept,[id]}\route.ts` and migration `drizzle\0015_org_invites.sql`. Plus 23 marketing components in `src\components\marketing`.
**Concrete operational hole:** there is **no password reset in PROJEXA** — `grep` for `resetPasswordForEmail|forgot-password|reset-password` across `src` returns nothing (the backend has one, at `C:\ct\ct\src\app\forgot-password\page.tsx`). A locked-out customer has no documented recovery path, and the only artifact resembling one is `C:\ct\projexa\supabase\functions\rotate-demo-password-r38\index.ts`, an edge function no sheet mentions. That belongs in a KT document as a stated gap.

### 3. Cannot deploy or restore the database
**Missing subject:** migration history and DB deployment. **412 SQL files** exist — 16 in `C:\ct\projexa\drizzle\0001..0016_*.sql`, **396** in `C:\ct\ct\drizzle\*.sql` (latest `0568_r75_phase0_backup_temp_bypassrls_revoke_2.sql`). The DB sheet is a snapshot of 632 live tables with zero ordering, zero dependency, zero "how do I apply these." Compounding it, the sheet itself records that `drizzle.config.ts` filters to schema `compliance` only, so **57 live `platform.*` tables need hand-written migrations** — the exact procedure a new engineer most needs, and it is described as a fact rather than a procedure.
**Where the answer lives:** `C:\ct\ct\drizzle.config.ts`, `C:\ct\ct\drizzle\*.sql`, `C:\ct\projexa\package.json` scripts `db:generate` / `db:push` / `db:studio`.

### 4. Cannot rebuild an environment — file storage is invisible
**Missing subject:** Supabase Storage buckets. The DB sheet deliberately excluded the `storage` schema as "platform-managed." Buckets are application config, not platform config. At least one is required for the product to work:
```
src\app\api\work-progress\photos\route.ts:6   const BUCKET = "work-progress-photos";
```
with signed-URL reads at line 77 and the backing table in `drizzle\0013_work_progress_photos.sql`. A restored environment without that bucket silently breaks site-photo capture.

### 5. Cannot ship a UI string — the product is bilingual and no sheet says so
**Missing subject:** localization. `C:\ct\projexa\messages\en.json` (21.5 KB) and `messages\hi.json` (38.8 KB) with the loader/negotiation layer at `src\i18n\{messages,client-messages,locales,request}.ts`, a parallel Hindi marketing tree at `src\app\hi\`, and `src\components\marketing\marketing-locale.ts`. Hindi is the larger file. Any engineer adding a screen without knowing this ships an untranslated string; any operator asked "do we support Hindi?" cannot answer from the sheets.

### 6. Cannot support a site engineer with no signal
**Missing subject:** offline capture. `src\lib\offline\work-progress-queue.ts` (236 lines) with two test files, consumed by `src\components\WorkProgressFormClient.tsx`. `PROJEXA_USER_PROCEDURES` describes the work-progress flow without mentioning that it queues offline and replays — the one behaviour that most affects the field persona it documents.

### 7. Cannot navigate the layer where the front-end logic actually lives
**Missing subject:** `src/lib`. **288 files, 132 non-test modules at the root alone**, plus `authz` (5), `supabase` (6), `services` (5), `offline` (3), `db` (2), `theme` (2). No sheet inventories it. Sheets reference perhaps 40 of these files incidentally. The unreferenced remainder includes the entire state, caching, and resilience layer a new engineer must understand before touching anything: `shell-store.ts`, `shell-cache.ts`, `shell-resilience.ts`, `prefetch-store.ts`, `module-prefetch.ts`, `report-result-cache.ts`, `schedule-cache.ts`, `public-page-cache.ts`, `click-budget.ts`, `perf-budget.ts`, `screen-budget.ts`, `autosave.ts`, `last-choice.ts`, `pane-state.ts`, `list-view-state.ts`. Same for `C:\ct\ct\src\lib` (929 files).
**Direct hit on the brief:** the owner asked for *"how the system works including its variables, their file paths, and memory."* `ENV_AND_CONFIG_INVENTORY` answered "variables" as environment variables. The in-app state and memory layer — these stores, plus `C:\ct\ct\src\lib\workspace-memory` / `api\workspace-memory` (6 routes) and `assistant-memory-service.ts` — went unanswered.

### 8. Cannot diagnose a failure, because the error contract is undocumented
**Missing subject:** the closed upstream-failure vocabulary defined at `src\lib\veridian-client.ts:74-88` — `UPSTREAM_TIMEOUT`, `UPSTREAM_500`, `STORAGE_UNAVAILABLE`, `NETWORK`, with 4xx deliberately carrying no code. Every screen and every proxy answers from this vocabulary. It is the first thing a support engineer needs and appears in no sheet. Related and also absent: `src\lib\{task-errors,read-outcome,source-status,storage-status,slow-load,screen-message,footer-message}.ts`.

### 9. Cannot start the system
**Missing subject:** a bootstrap runbook. `PROJEXA` has **no `.env.example`** (the env sheet found this and correctly flagged it). Its `README.md` is 33 lines and defers to `AGENTS.md`. The two-server local topology (`next dev -p 3100` against the backend on `:3000` via `VERIDIAN_API_BASE_URL`) is recorded in the infra sheet as a corrected mechanism, not as steps. Existing material the KT set should have absorbed rather than re-derived: `C:\ct\ct\docs\infra\ENVIRONMENT_CONFIG.md`, `docs\infra\DEPLOYMENT_ENVIRONMENTS.md`, `docs\ROLLBACK_RUNBOOK.md`, `docs\SEV1_INCIDENT_RUNBOOK.md`, `docs\runbooks\rollback.md`, `docs\master\ARCHITECTURE.md`, `docs\master\MODULE_MAP.md`, `docs\API-ROUTES-INDEX.md`, `docs\API_RATE_LIMITS.md`, `docs\ESCALATION_MATRIX.md`, `docs\MODEL_SELECTION.md`.

### 10. The requested flowchart was not produced
The brief asked for *"a complete business requirements document with logic, modules and flowchart."* All 12 deliverables are flat tables. Nothing depicts the request path end to end — browser → `src/middleware.ts` (310 lines) → `src/lib/authz/api-write-policy.ts` (460 lines) → `src/app/api/*/route.ts` → `callVeridian()` → `/api/v1/projexa/*` → `construction-*-service.ts` → Supabase `evpckeuxgvahguwsaeul` / `pcrjmlpuqsbocqfwoxod`. `PROJEXA_COMPOSER_FLOW_TRACE` (65 steps) is the closest thing and it stops at the proxy boundary by its own admission.

### 11. Half the product's UI is undocumented
`C:\ct\ct\src\app` contains **198 page routes** (172 under its own `(app)` group) with its own component library at `C:\ct\ct\src\components` (~180 files). The owner asked how *the whole product* works. The KT set describes PROJEXA's UI and treats VERIDIAN as an API.

---

## SMALLER GAPS, NAMED

- **CI/CD as executable procedure.** `PROJEXA\.github\workflows\{ci.yml,claude.yml,claude-nightly-maintenance.yml}` and 11 more in `C:\ct\ct\.github\workflows`. The infra sheet records workflow *names and enabled states*; workflow-level `env:`/`secrets:` were explicitly excluded by the env sheet. Nobody can say what CI actually asserts, or what a green build proves — which matters given the infra sheet's own finding that CI gates neither repo's `main`.
- **Test strategy.** 25 Playwright specs in `C:\ct\projexa\e2e` and `playwright.config.ts` pointed at live `https://projexa-ai.com`. `PROJEXA_USER_PROCEDURES` cites spec paths per flow but no sheet says how to run the suite, seed an org, or run it against local.
- **Custom lint enforcement.** `C:\ct\projexa\eslint-rules\money-format.mjs` — a repo-specific rule a new engineer will hit on their first currency change; it appears nowhere.
- **Operational scripts.** 12 files in `C:\ct\projexa\scripts` (perf harness, account provisioning, four seed batches, the `check-no-provider-api-keys.mjs` CI guard). Only the guard is documented, in the env sheet.
- **`src\components\veri-chat`** (5 files: `VeriChatPanel`, `VeriComposer`, `HomeThreadSlot`, `veri-chat-context`) is a second chat surface distinct from the shell composer the flow-trace covers. The brief asked for "chat flow" — one of two was traced.

---

## WHAT THE SET DOES WELL (so the gap list is read fairly)

The DB inventory's discovery that the app's own `DATABASE_URL` authenticates as `app_runtime` and silently returns `0` for RLS-protected counts is a genuine, reusable trap. The AI-router sheet's independent confirmation of dead code plus its correction of the source audit (a fifth deterministic tier, `tryTimesheetMatch`) is real verification, not restatement. The env sheet's discovery of a committed live test-account password in `e2e/users.ts:19` and `scripts/measure-perf.mjs:23` is a security finding that should be escalated on its own, not buried in a caveat block. Every sheet's "what I could not determine" section is unusually honest. The problem is not rigor — it is that the rigor was applied to the thin client and stopped at a repo boundary that did not actually exist.

## PRIORITY ORDER FOR CLOSING

1. Inventory `C:\ct\ct\src\lib\services` (263) and `src\lib\engines` (26) — the actual business logic. Blocks the BRD.
2. Inventory the 274 `/api/v1/projexa` upstream handlers and join them to the 288 PROJEXA proxy rows — turns the API sheet from a URL list into a contract.
3. A page-route sheet: all 186 `page.tsx`, flagging the 59 outside the module catalogue.
4. Tenant lifecycle: signup → `provision-org` → `veridian_credentials` → invite → accept, with the no-password-reset gap stated.
5. `src/lib` module inventory for both repos, with the state/cache/memory layer called out as its own section.
6. Migration + storage-bucket + env bootstrap runbook (412 SQL files, `work-progress-photos`, no `.env.example`).
7. One end-to-end request flowchart, as explicitly requested.
8. i18n and offline-queue sections.