# PROJEXA E2E Testing Program — Phase 2 Batch B Report

**Real Playwright E2E tests for the Resources, Field & Design modules, run against the live https://projexa-ai.com deployment**
Date: 2026-07-19 · Scope: materials, inventory, procurement, purchase-orders, vendors, labour, ffe, floor-plans, mood-boards, permits, documents
Claim registered: `compliance-tracker` `ai-os/boss/ACTIVE-CLAIMS.yaml`, PR [#478](https://github.com/FChecklist/compliance-tracker/pull/478) (merged)

This is Phase 2 (of 5) of the PROJEXA E2E testing program. Phase 1 (merged, [FChecklist/projexa #45](https://github.com/FChecklist/projexa/pull/45)) documented the real PROJEXA↔VERIDIAN architecture and seeded a real test org, "Meridian Construction Group (E2E Test Org)" (`compliance.organisations.id = 4ecc472f-4152-4310-ae8d-cf8b7c52ab6d`), with 1,007 rows across 4 projects. This report covers Batch B's 11 modules only; two sibling sessions covered Batch A (execution/field: dashboard, schedule, scope, rfis, submittals, punch-list, change-orders, site-diary, work-progress, meetings — PR #480, merged) and Batch C (finance/sales/HR + copilot) concurrently, on disjoint module lists, against the same shared live org.

---

## Correction to the task brief

The task brief stated "this repo's `playwright.config.ts` already wires `bunx playwright test` in CI, currently `--pass-with-no-tests` since no real tests exist." **This was not true at the start of this session** — no `playwright.config.ts`, no `e2e/` directory, and no Playwright CI job existed anywhere in the repo or on any sibling branch (`worker/...batch-a...`, `worker/...batch-c...`) at the time this session started. Built from scratch in this PR: `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/credentials.ts`, `e2e/helpers.ts`, 12 spec files, and a new `e2e` job in `.github/workflows/ci.yml`. Reported honestly per this program's own precedent (Phase 1's report did the same for a different false premise) rather than silently working around the discrepancy.

## Test execution summary

31 real tests across 12 spec files, run with a real admin login (`arjun.mehta@meridian-construction.e2e-test.projexa-ai.com`, CEO) and a real non-admin login (`manoj.yadav@meridian-construction.e2e-test.projexa-ai.com`, `users.role="member"`), against the live site, using `bunx playwright test` inside the official `mcr.microsoft.com/playwright` Docker image (this sandbox has no system Chromium dependencies installable without root; Docker was the only way to run a real browser here — see "Environment note" below).

**Final clean run (undisturbed host, no concurrent sibling load): 31 passed / 1 failed.**

The 1 failure is the real requisition-creation 500 bug (below) — every other test, including a dedicated regression test for the second real bug found (the procurement tab-reset), passes.

Getting to this result took several iterations during authoring, each traced to one of four categories (documented honestly rather than only reporting the final clean state):
1. **Real application bugs** (2, both below) — reported to Phase 4 with exact reproduction steps. Neither was fixable from this test-only PR.
2. **This suite's own early test-design bugs**, found and fixed during authoring: (a) `getByLabel()` cannot find any dialog field because of a real, separately-reported accessibility gap (see below) — worked around with a DOM-sibling-based `fieldByLabel()` helper; (b) several "assert page matches a pre-fetched snapshot" baseline checks raced against the page's own client-side fetch — fixed by capturing the page's *own* network response instead of a separately-timed one; (c) 3 procurement write tests used `.first()` to locate a just-created row by vendor name, which broke once repeated runs left multiple rows for the same vendor (an older, already-"sent"/"posted" row sorted first) — fixed by locating each row by its own real, unique number (`RFQ-`/`SQ-`/`GRN-{n}`) returned in the create response, not by position.
3. **A real, live-observed instance of cross-batch interference**: Batch A's own concurrently-running suite created 14 undeleted "test project" rows in this shared org, one of which became the new org-wide default project mid-session, breaking a test that assumed the default project would have data — fixed by making every project-scoped test explicit about which real project it targets (see "Operational notes" below for the full writeup; this is a live example of the operational risk that section describes, not a hypothetical).
4. **Host-level environment flakiness** (`ETIMEDOUT` on live network calls, one Docker OOM-kill) during a window when this session was simultaneously hammering GitHub's API with rapid CI-retrigger pushes for the claims-registry PR — reproduced, diagnosed via the exact error text, and resolved by simply not doing both at once; not a code or test defect.

---

## Per-module results

### materials — read-only, DIVERGES from seed report
- **Route:** `/materials`. `MaterialsClient.tsx` fetches `/api/materials` (org-wide `erp_stock_ledger_entries`), no filters/search/sort, no write form (page's own text explains why: no warehouse/item discovery API exposed to PROJEXA for this module).
- **Real finding:** PHASE1_SEED_REPORT.md's Batch 3 line "20 materials" reads as if 20 rows would appear on this page. They don't — **`/api/materials` returns 0 rows** for this org. The 20 seeded rows actually landed in `erp_items` (VERIDIAN's item catalog), which is what `/inventory`'s **Items** tab shows (confirmed: `/api/inventory/items` returns exactly 20). This is a real, precise divergence between the seed report and this module's actual backing table — not a bug in the app, but a seed-data/documentation mismatch worth Phase 4/5 knowing about.
- Test: 1/1 passing. Asserts the real (0) count, cross-checks the page against the live API, confirms no stray filter/write controls.

### inventory — works correctly, partially empty seed
- **Route:** `/inventory`, 3 tabs (Stock Balance / Warehouses / Items), 3 write dialogs (New Warehouse, New Item, Record Stock Movement).
- **Real finding:** Items tab has the real 20 seeded items (`/api/inventory/items` = 20 ✓). **Warehouses and Stock Balance are genuinely empty (0)** at authoring time — no warehouses or stock balances were seeded for this org, only the item catalog.
- **Write flow verified end-to-end and correct**: created a warehouse, created an item, recorded a stock receipt against them — all 3 persisted (confirmed via reload + fresh API fetch), and critically, **the stock balance correctly populated** after the receipt (qty=50 as posted), proving the receipt→balance computation genuinely works.
- Tests: 3/3 passing.

### vendors — works correctly, matches seed
- **Route:** `/vendors`. Read + create only (no edit/delete UI). No filters/search/sort.
- 10 real seeded vendors confirmed (`/api/vendors` ≥ 10 ✓). GST column correctly shown (org country = `IN`, confirmed via `/api/organization`).
- **Write flow verified correct**: created a vendor with all optional fields (type, trade, GST, credit limit) — persisted correctly, all field values round-tripped exactly.
- Tests: 2/2 passing.

### purchase-orders (standalone `/purchase-orders`) — works correctly, matches seed
- **Route:** `/purchase-orders`. Independent from procurement's own "Purchase Orders" tab (different component, richer multi-line/multi-currency form) but **both read/write the same `erp_purchase_orders` table** — confirmed via direct cross-check (`/api/purchase-orders` and `/api/procurement/purchase-orders` return identical row counts).
- 12 real seeded purchase orders confirmed (≥ 12 ✓, exact match at authoring time).
- **Real, live-observed nuance:** the Company/Office selector and Currency selector are correctly conditional on `/api/companies` / `/api/currencies` returning any rows. At authoring time both were empty (selectors correctly absent); **mid-session, Batch C's own concurrent test run created a real company** ("E2E Batch C Test Office ...") in this shared org, and the selector correctly appeared once that happened. This suite's test asserts the *live, current* state rather than a hardcoded assumption, specifically because this cross-batch interference is real, not hypothetical (see "Operational notes" below).
- **Write flow verified correct**: created a multi-line PO (2 lines, different qty/rate) — persisted correctly, both line items found by their unique descriptions.
- Tests: 3/3 passing.

### procurement — 2 REAL BUGS FOUND, otherwise correct
- **Route:** `/procurement`, 5-stage tab workflow (Requisitions → RFQs → Quotations → Purchase Orders → Goods Receipts).
- **Real finding (seed completeness):** Requisitions, RFQs, Quotations, and Goods Receipts stages are all genuinely empty (0 rows) at authoring time — PHASE1_SEED_REPORT.md's Batch 3 seeded vendors/materials/customers/purchase-orders/quotations(sales)/sales-orders/invoices, but never seeded this module's own precursor entities (`erp_purchase_requisitions`, `erp_rfqs`, `erp_supplier_quotations`, `erp_purchase_receipts`). Only the terminal Purchase Orders stage has data, and it's confirmed identical to the standalone module's 12 rows (cross-module consistency check passes).

- #### 🔴 REAL BUG 1 — Requisition creation is broken (500 error)
  `POST /api/procurement/requisitions` reliably returns **HTTP 500** with body `{"error":"Failed to create purchase requisition"}` when submitted through the real "New Requisition" dialog with a completely valid, correctly-filled payload (`purpose` + one line item with `description`+`quantity` — every field the dialog itself collects, nothing invented). **Reproduced consistently across every one of ~6 full suite runs during this session, plus an isolated single-request repro outside the test framework.** This makes the entire Requisitions stage of the procurement workflow non-functional for any real user via the UI.
  - **Reproduction:** log in, go to `/procurement`, "1. Requisitions" tab, "New Requisition", fill any Purpose + Item description + Quantity, click "Create Requisition".
  - **Expected:** 201, new row appears as `PR-{n}`, status `draft`.
  - **Actual:** 500, dialog stays open (or silently fails — no visible error to the user beyond a generic toast), no row created.
  - One curiosity for whoever fixes this: the response body's exact text (`"Failed to create purchase requisition"`) matches `src/app/api/procurement/requisitions/route.ts`'s **non-`VeridianApiError` fallback branch**, which per that file's own code should pair with HTTP **502**, not 500 — worth checking whether the deployed code differs from this repo's `HEAD`, or whether something upstream is re-wrapping the error.

- #### 🔴 REAL BUG 2 — Every write action silently resets the active tab
  After **any** create/submit/send/convert action anywhere in `ProcurementClient.tsx` (all 5 stages), the UI silently jumps back to the "1. Requisitions" tab, even if the user was on a completely different tab. **Root cause, read directly from source:** `load()` calls `setLoading(true)` synchronously on every refetch (including the ones every write handler triggers on success), and the component's render guard is `if (loading) return <spinner>` — which unmounts the *entire* `<Tabs defaultValue="requisitions">` tree. Since `Tabs` is uncontrolled (no `value=`/`onValueChange=` wiring it to state that would survive the remount), it always re-mounts back to its `defaultValue`.
  - **User impact:** a real user who just sent an RFQ, recorded a quotation, converted one to a PO, or posted a goods receipt is silently bounced back to Requisitions with no error, toast, or explanation. The action they just took *worked* (confirmed: the RFQ/quotation/PO/goods-receipt data is genuinely persisted, verified via direct API reads in every case) — but it visually looks like it vanished, which is confusing and makes the workflow feel broken even though the backend is fine.
  - **Reproduction / proof:** a dedicated regression test (`06-procurement.spec.ts`, "real bug: every create/submit/send/convert action resets the active tab") clicks "3. Quotations", records a quotation, and asserts `aria-selected` — confirmed the tab flips back to "1. Requisitions" every single time.
  - **Fix sketch for Phase 5:** lift the active tab into a `useState` and pass `value={activeTab} onValueChange={setActiveTab}` to `<Tabs>`, so it survives the loading-state remount. (Better still: don't fully unmount the Tabs tree on refetch at all — gate only the table bodies on `loading`, the same pattern `LabourClient.tsx` already uses correctly.)
  - This bug affects RFQ, Quotation, and Goods Receipt flows identically; Requisitions never surfaces it because "Requisitions" happens to already be the `defaultValue` it resets to.

- **Write flows, once the tab-reset bug is worked around, are otherwise correct**: RFQ create+send, Quotation record+convert-to-PO (verified the resulting PO appears in *both* Purchase Orders surfaces and the standalone endpoint's count increments by exactly 1), and Goods Receipt create+post-to-stock all persist correctly (confirmed via reload + fresh API reads).
- Tests: 5/6 passing (baseline 1/1, RFQ 1/1, Quotation+convert 1/1, Goods Receipt 1/1, tab-reset regression 1/1; Requisition create 0/1 — real bug above).

### labour — works correctly, empty seed
- **Route:** `/labour` ("Manpower & Attendance"), project-scoped, 2 tabs (Roster/Attendance).
- **Real finding (seed completeness):** roster and attendance are genuinely empty (0) for **all 4 projects** at authoring time — no labour roster or attendance data was seeded anywhere in this org, despite this being an in-scope module.
- **Write flow verified correct**: added a worker (with trade), then marked attendance for that worker ("Half Day", 4 hours) — both persisted correctly (worker's trade round-tripped exactly; "Mark Attendance" correctly disabled with an empty roster, correctly enabled once a worker exists).
- Tests: 2/2 passing.

### ffe — works correctly, empty seed
- **Route:** `/ffe` ("FF&E Specification"), project-scoped. 3 summary cards (Total Cost/Client Price/Margin) derive independently from `/api/ffe/margin-summary`.
- **Real finding (seed completeness):** 0 FF&E items for all 4 projects at authoring time.
- **Write flow verified correct**: created an item (furniture category, qty 2, cost/price set), confirmed status `specified`, clicked "Advance" → `ordered`, confirmed persistence after reload including quantity and status.
- Tests: 2/2 passing.

### floor-plans — works correctly, empty seed
- **Route:** `/floor-plans`, project-scoped, card grid (not a table).
- **Real finding (seed completeness):** 0 floor plans for all 4 projects at authoring time.
- **Write flow verified correct**: created a floor plan, confirmed `draft` status badge, confirmed the "2D Editor" and "3D Walkthrough" links point at the real created plan's id (`/floor-plans/{id}` and `/floor-plans/{id}/walkthrough`) after reload.
- Tests: 2/2 passing. (The nested `[id]` editor/walkthrough routes themselves are out of this module list's scope, per the task brief, and were not tested beyond confirming the links are correctly wired.)

### mood-boards — works correctly, empty seed
- **Route:** `/mood-boards`, project-scoped, card grid with a nested boards→items shape. One shared "Add Item" dialog reused across all board cards.
- **Real finding (seed completeness):** 0 mood boards for all 4 projects at authoring time.
- **Write flow verified correct**: created a board, added an item to that *specific* board (confirmed the shared dialog targets the right card), transitioned status `draft` → `shared` (the "Share with Client" action) — all persisted correctly, including the item's label inside the correct board.
- Tests: 2/2 passing.

### permits — read-only, DIVERGES from seed report (0 permits found)
- **Route:** `/permits`, org-wide (no project scoping), backed by VERIDIAN's generic `documents` table filtered to `category='permit'` — no dedicated permits table (already documented as a non-gap nuance in PHASE1_SEED_REPORT.md).
- **Real finding:** **zero permit-category documents exist anywhere in this org**, at any expiry window (checked all 4 real Select options: 30/60/90/365 days — every one returns 0). Cross-verified by inspecting the categories actually present among the 25 seeded documents in one project: `other`, `drawing`, `contract`, `site_photo` — **`permit` is never used**, despite Batch 4's seed script creating 25 "documents" and this being a named, in-scope module expected to show data.
- **Control verified correct:** the "expiring within" window Select genuinely re-fetches on every option change (confirmed via network capture for all 4 options), and correctly renders the empty state each time.
- Tests: 3/3 passing (all read-only assertions; confirmed no write controls exist, matching source).

### documents — works correctly, matches seed exactly (with one caveat)
- **Route:** `/documents`, project-scoped, read-only.
- 25 real seeded documents confirmed, split 7/7/7/4 across the 4 projects exactly as PHASE1_SEED_REPORT.md's Batch 4 total implies (verified per-project, not just the org-wide total, so no project is silently empty).
- **Control verified correct:** the category filter Select re-fetches correctly for every real category with matching data (`drawing`, `contract`, `site_photo`) and correctly shows the empty state for `permit` (0 matches, consistent with the permits finding above).
- **Caveat, worth Phase 4 knowing:** `DocumentsClient.tsx`'s fetch does **not check `res.ok`** before reading `data.documents` — an unexpected non-200 response (e.g. a transient auth hiccup) would silently render as "no documents found" with zero visible error, rather than a toast or retry. This suite's baseline test initially (and reproducibly, for several runs) observed exactly this shape of result — root-caused to something else entirely (Batch A's test-project pollution shifting the *default* project, not an app-level fetch-error issue; see "Operational notes" below) and fixed by making the test explicit about which project it targets. The silent-failure-mode itself is still real, independently confirmed by reading the source (same pattern found in every other in-scope module except the write-path error handlers, which do surface a toast) — just not what actually caused this particular test's flakiness.
- Tests: 4/4 passing.

---

## Cross-cutting findings (not specific to one module)

### Systemic accessibility/testability gap: no `<Label htmlFor>` ↔ `<Input id>` association anywhere
Every dialog form field across **all 11 in-scope modules** (Vendor Name, Warehouse Name, Item Name, Purpose, Worker Name, FF&E Item Name, Floor Plan Name, Mood Board Title, etc. — every single one) uses `<Label>Text</Label><Input .../>` with **no `htmlFor`/`id` pairing**, unlike `/login`'s `#email`/`#password` fields which do this correctly. Confirmed by reading `src/components/ui/label.tsx` (a bare Radix `Label.Root` with no auto-id generation) and every dialog's JSX. This means:
- Screen readers and other assistive technology cannot programmatically associate these labels with their controls — every one of these ~60+ form fields is effectively unlabeled for accessibility purposes.
- Standard testing-library-style `getByLabel()` queries (the normal way to interact with a labeled field in Playwright/Testing Library) cannot find any of these fields — this suite had to build a workaround (`fieldByLabel()` in `e2e/helpers.ts`, locating by DOM-sibling proximity instead of programmatic association) specifically because of this gap.

This is a real, systemic, easy-to-fix (add matching `htmlFor`/`id` pairs) accessibility gap affecting every write form in the product, not a one-off.

### Middleware route-protection inconsistency
`src/middleware.ts`'s `PROTECTED_PREFIXES` list does not include `/inventory`, `/procurement`, `/purchase-orders`, or `/permits` — an unauthenticated visit to any of these 4 pages is **not** redirected to `/login`, unlike `/materials`, `/vendors`, `/labour`, `/ffe`, `/floor-plans`, `/mood-boards`, `/documents`, which correctly do redirect. **Not a data-security hole** — every underlying API route still calls `requireAuth()` and correctly 401s — but since none of the affected client components check `res.ok` on their GET calls, an unauthenticated visitor to these 4 pages sees a normal-looking empty page (e.g. "No vendors added yet." on `/procurement`... actually verified live) rather than being bounced to login like every other page. A real, if low-severity, UX/consistency gap. Confirmed live with a fully unauthenticated browser context (`12-member-access.spec.ts`).

### Operational note: Batch A's own test suite creates real, undeleted "test project" rows that shift the org-wide default project
Every project-scoped page (`/labour`, `/ffe`, `/floor-plans`, `/mood-boards`, `/documents`, plus Batch A's own scope: `/dashboard`, `/schedule`, `/rfis`, etc.) defaults to `projects[0]` from `/api/projects` when navigated without an explicit `?projectId=` (`resolveSelectedProject()`, `src/lib/project-selection.ts:36`). Mid-session, `/api/projects` was observed returning **18 projects**, not the original 4 — 14 additional rows named `E2E-BatchA-<timestamp> Test Project`, evidently created by Batch A's own write-flow tests (a "create project" flow is presumably in-scope for Batch A's `dashboard`/`schedule` modules) with no corresponding cleanup. Critically, **one of those new test projects sorted first**, silently shifting every other module's "default project" away from the original seeded "Meridian Heights - Residential Tower A" — which broke this suite's `documents` baseline test (asserted the default project would have ≥1 document; the new default, a freshly-created empty test project, correctly has 0). **Fixed** by making every project-scoped test explicitly pass `?projectId=<the original, known Meridian Heights id>` rather than relying on default-project resolution, since that default is no longer a stable assumption in this shared, concurrently-polluted org. Reporting this to Phase 4 as a real, observed instance of cross-batch interference beyond the `companies` one noted below — worth Batch A's own session knowing its test-project rows aren't being cleaned up, and worth Phase 4/5 considering whether `resolveSelectedProject()`'s org-wide "first project" default is fragile by design once *any* module can create new projects.

### Operational note: this suite runs real, additive writes against a live, shared, persistent org with no teardown
There is no isolated/ephemeral environment for this suite to target — it writes real rows into the same "Meridian Construction Group (E2E Test Org)" that Batch A and Batch C's own suites also write into, concurrently, with **no reset mechanism between runs**. Two real consequences, both designed around rather than papered over:
1. **Repeated runs monotonically accumulate data.** This suite ran 6+ times during authoring; by the final run, several modules already had leftover rows from earlier runs (extra warehouses, vendors, roster entries, floor plans, etc.). Every assertion in this suite is therefore written as either a **minimum-count check** (`toBeGreaterThanOrEqual`) against the real original seed values, or a **before/after delta check** for this suite's own writes — never a brittle "must equal exactly N forever" assertion. One consequence: this report's exact-count confirmations (10 vendors, 20 items, 12 purchase orders, 25 documents) are only meaningfully verifiable against the *original* seed state on this, the first real run — a future CI run's counts will legitimately be higher.
2. **Cross-batch interference on org-wide (non-module-scoped) entities is real, not hypothetical.** Mid-session, Batch C's own concurrent test run created a real `company` row in this shared org (confirmed: `"E2E Batch C Test Office ..."` appeared in `/api/companies` between two of this suite's own runs) — this suite's Purchase Orders test was written to assert against the *live* state of that org-wide entity rather than an assumption, specifically to stay correct under this real condition.

The `e2e` CI job added in this PR is wired as `continue-on-error: true` for exactly this reason — a real, already-reported production bug (or a sibling batch's concurrent write) can legitimately turn this job red for a PR that has nothing to do with either, and that shouldn't permanently block unrelated merges. See the job's own comment in `.github/workflows/ci.yml` for the full rationale.

### Environment note: this sandbox has no installable system Chromium dependencies
`bunx playwright install --with-deps chromium` requires `sudo`, unavailable in this session (no passwordless sudo). Ran the entire suite via the official `mcr.microsoft.com/playwright:v1.61.1-noble` Docker image instead (`docker run --network host -v $PWD:/work ... npx playwright test`), which matches the installed `@playwright/test@1.61.1` version exactly. The GitHub Actions job added to CI uses the standard `playwright install --with-deps` (a real GitHub-hosted runner has the needed system packages), so this workaround is authoring-environment-specific, not something baked into the committed CI config.

---

## Top-line summary for Phase 4/5

| # | Finding | Severity | Module(s) |
|---|---|---|---|
| 1 | Requisition creation 500s — the entire Requisitions stage of Procurement is non-functional | **High** | procurement |
| 2 | Every write action in Procurement silently resets the active tab (loading-state remount losing uncontrolled Tabs state) | **Medium** (confusing UX, no data loss) | procurement |
| 3 | No `htmlFor`/`id` label association on any dialog form field, anywhere | **Medium** (accessibility) | all 11 modules |
| 4 | 6 of 11 in-scope modules have zero seeded data (materials' own table, permits, labour, ffe, floor-plans, mood-boards, procurement's 4 precursor stages) despite being named in-scope for this test round | **Low/Process** (test-coverage gap, not app bug) | materials, permits, labour, ffe, floor-plans, mood-boards, procurement |
| 5 | `/inventory`, `/procurement`, `/purchase-orders`, `/permits` missing from middleware's protected-routes list (APIs still correctly 401, no real data exposure) | **Low** | inventory, procurement, purchase-orders, permits |
| 6 | `DocumentsClient.tsx` (and others) don't check `res.ok`, so a transient error silently renders as an empty list | **Low** | documents (pattern likely repeated elsewhere) |
| 7 | Batch A's own test suite left 14 undeleted "test project" rows in the shared org, which shifted every project-scoped page's default-project resolution mid-session | **Process** (cross-batch hygiene, not an app bug) | all project-scoped modules |

---

## Files in this PR

- `playwright.config.ts`, `e2e/global-setup.ts`, `e2e/credentials.ts`, `e2e/helpers.ts` — new Playwright infrastructure
- `e2e/01-materials.spec.ts` … `e2e/12-member-access.spec.ts` — 12 spec files, 31 tests
- `.github/workflows/ci.yml` — new `e2e` job (`continue-on-error: true`, see rationale above)
- `.gitignore` — excludes `test-results/`, `playwright-report/`, `blob-report/`, `playwright/.cache/`, `playwright/.auth/`
- `package.json` / `bun.lock` — added `@playwright/test` dev dependency
- `PHASE2_BATCH_B_FINDINGS.md` — this report

Tier: **TIER1** (test files, CI config, and a dev dependency only — no schema/migration change, no modification to existing application source).
