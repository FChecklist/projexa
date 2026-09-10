# R80 PART 5 — RIGHT-SIDE ERP SCREEN GAP AUDIT (CHECK ONLY)

**Date:** 2026-09-08
**Scope:** owner requirement item (9) — CHECK THE GAP. No source file was modified, nothing committed.
**Method:** source-code reading in `C:\ct\projexa` + SQL against CRR Supabase `pcrjmlpuqsbocqfwoxod`. No browser, no dev server, no Playwright.
**Ground truth used:** `C:\ct\projexa\src\lib\module-catalogue.ts`, every `page.tsx` under `C:\ct\projexa\src\app\(app)`, every `route.ts` under `C:\ct\projexa\src\app\api`, every `*.tsx` under `C:\ct\projexa\src\components`.

---

## 0. HEADLINE COUNTS (all measured, not estimated)

| Measure | Value | How measured |
|---|---|---|
| Real page routes under `src/app/(app)` | **175** | recursive `page.tsx` count |
| Modules in `module-catalogue.ts` | **14** | `MODULE_CATALOGUE` array, `src/lib/module-catalogue.ts:95-327` |
| Distinct route prefixes the catalogue claims | **17** | union of all `prefixes` arrays |
| Routes matched by a catalogue prefix | **59** | prefix match per `moduleForPathname()`, `src/lib/module-catalogue.ts:348-361` |
| Routes NOT matched by any catalogue prefix | **116** (66%) | same |
| API route files | **288** | recursive `route.ts` count |
| API routes exposing `DELETE` | **16** (5.6%) | exported-verb scan |
| API routes exposing `PATCH`/`PUT` | **46** (16%) | exported-verb scan |
| Object (detail) screens | **46** | components matching `*ObjectClient.tsx` / `*OverviewClient.tsx` rendering an ObjectScreen |
| Object screens exposing **Edit** | **18** (39%) | `onEdit=` prop present |
| Object screens exposing **Delete** | **14** (30%) | `onDelete=` prop present |
| Create screens | **64** | `*CreateClient.tsx` + `*UploadClient.tsx` |
| Create screens pre-filling **any** field | **22** (34%) | initial-state seed scan |
| Create screens pre-filling from **stored backend record data** | **1** (1.6%) | `GoodsReceiptCreateClient.tsx:49-52` |
| Create screens with required-field validation | **61 / 64** (95%) | `missing*`/`saveDisabled` present |
| Create routes with no detail page at all | **16** | sibling `[id]` route check |

---

## 1. ARCHITECTURAL FACT THAT SHAPES EVERY FINDING BELOW

There are **three** ObjectScreen archetypes in this repo, not one:

1. `@fchecklist/veridian-ui-kit/screens` → `ObjectScreen` — **104 importers**. Real prop contract at `C:\ct\projexa\node_modules\@fchecklist\veridian-ui-kit\src\screens\ObjectScreen.tsx:24-47`: `mode`, `hasDraft`, `onEdit?`, `onSave?`, `onCancel?`, `onDelete?`, `headerStatus?`, `facets?`, `documentFlow?`, `onAutosave?`. Edit and Delete are **optional props** — a screen that omits them renders no such button (`ObjectScreen.tsx:101-124` of that file).
2. `C:\ct\projexa\src\components\screens\KitObjectScreen.tsx` — a deliberate verbatim fork (rationale at `KitObjectScreen.tsx:13-36`), used by the 7 hand-built construction object pages.
3. `C:\ct\projexa\src\components\screens\ObjectScreen.tsx` — the "PROJEXA-native" archetype with Edit/Delete/inline-confirm built in (`ObjectScreen.tsx:43-51`, `:99-159`). **No screen client imports it.** Its only importers are `KitObjectScreen.tsx` and two test files.

Consequence: Edit and Delete are per-screen opt-ins, and the 2026-08-30 real-screen conversion opted in on a small minority.

---

## 2. (a) PER-MODULE MATRIX

Legend: `T` = TRUE, `F` = FALSE, `P` = PARTIAL. **Cat** = route covered by a `module-catalogue.ts` prefix (i.e. the left composer can name the module). **Prefill** = any field pre-populated before the user types.
Structural codes: `H` header/entity identity (title), `Fa` facets, `St` status badge, `Ln` child line-item table, `Va` field validation, `Au` audit/meta fields (created/updated by/at).

### 2.1 The 14 catalogued modules

| # | Module | Route | Create | Read | Edit | Delete | Submit | Prefill | Cat | Structural present |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Dashboard | `/dashboard` | n/a | T | n/a | n/a | n/a | n/a | T | H |
| 2 | Permits | `/permits` | T | T | T | T | F | F | T | H, Va, docflow, autosave |
| 3 | Drawings & 3D | `/drawings`, `/floor-plans` | T | T | T | T | F | P (`"dwg"` default) | T | H, Fa, St, Va, Au |
| 4 | Documents | `/documents` | T | T | T | P (dispose) | F | F | T | H, Fa, St, Va, Au |
| 5 | Minutes of Meeting | `/moms`, `/meetings` | T | T | T | T | F | F | T | H, Fa, St, Va, Au |
| 6 | Scope of Work (BOQ) | `/scope` | T | T | P (inline lines only) | T | T | F | T | H, Fa, St, **Ln**, Va, Au |
| 7 | Work Progress | `/work-progress` | T | T | T | T | F | P (date) | T | H, Fa, Va, Au |
| 8 | Manpower / Labour | `/labour` | T | T | T | T | F | **T** (last-choice) | T | H, Fa, St, **Ln**, Va |
| 9 | Material | `/materials`, `/site-materials` | T | T | T | T | F | **T** (last-choice) | T | H, Fa, St, Va |
| 10 | Budget | `/budgets` → redirect | T | T | T | P (cancel) | T | F | **F** (see GAP-1) | H, Fa, St, Ln, Va |
| 11 | Schedule | `/schedule` | T | T | T | T | F | F | T | H, Fa, St, Va |
| 12 | Reports | `/reports` | n/a | T | n/a | n/a | n/a | n/a | T | H |
| 13 | Customers | `/customers` | T | T | T | **F** | F | F | T | H, Fa, Ln, Va |
| 14 | Vendors | `/vendors` | T | T | T | **F** | F | F | T | H, Fa, St, Va, Au |

### 2.2 The broader ERP surface — every row below is `Cat = F`

| # | Module | Route | Create | Read | Edit | Delete | Submit | Prefill | Cat | Structural present |
|---|---|---|---|---|---|---|---|---|---|---|
| 15 | Finance Budgets | `/finance/budgets` | T | T | T | P (cancel) | T | F | F | H, Fa, St, Ln, Va |
| 16 | Accounting — Journal Entries | `/accounting/journal-entries` | T | T | **F** | **F** | T | P (date) | F | H, Fa, St, **Ln**, Va |
| 17 | Accounting — Companies | `/accounting/companies/new` | T | **F** | **F** | **F** | F | F | F | Va only |
| 18 | Sales Invoices | `/invoices` | T | T | **F** | P (cancel, draft only) | T | P (date) | F | H, Fa, St, Ln, Va |
| 19 | Credit Notes | `/invoices/credit-notes` | T | T | **F** | **F** | T | P (date) | F | H, Fa, St, Ln, Va |
| 20 | Sales Quotations | `/quotations` | T | T | **F** | **F** | P (convert) | P (date) | F | H, Fa, St, Ln, Va |
| 21 | Sales Orders | `/sales-orders` | T | T | **F** | **F** | F | P (date) | F | H, Fa, St, Ln, Va, docflow |
| 22 | Sales Leads | `/sales/leads` | T | T | **F** | **F** | F | F | F | H, Fa, St, Va |
| 23 | Sales Opportunities | `/sales/opportunities` | T | T | **F** | **F** | F | F | F | H, Fa, St, Va |
| 24 | Purchase Orders | `/purchase-orders` + `/procurement/purchase-orders/[id]` | T | T | **F** | **F** | T | P (date) | F | H, Fa, St, **Ln**, Va |
| 25 | Purchase Requisitions | `/procurement/requisitions` | T | T | **F** | **F** | T | P (date) | F | H, Fa, St, Ln, Va |
| 26 | RFQs | `/procurement/rfqs` | T | T | **F** | **F** | F | P (date) | F | H, Fa, St, Ln, Va |
| 27 | Purchase Quotations | `/procurement/quotations/new` | T | **F** | **F** | **F** | F | P (date) | F | Va only |
| 28 | Goods Receipts | `/procurement/goods-receipts` | T | T | **F** | **F** | T | **T** (supplier from PO) | F | H, Fa, St, Ln, Va |
| 29 | Inventory Items | `/inventory/items` | T | T | **F** | **F** | F | F | F | H, Fa, Va |
| 30 | Inventory Warehouses | `/inventory/warehouses/new` | T | **F** | **F** | **F** | F | F | F | Va only |
| 31 | Inventory Stock Entries | `/inventory/stock-entries/new` | T | **F** | **F** | **F** | F | P (date, `"receipt"`) | F | Va only |
| 32 | Expenses | `/expenses` | T | **F** | **F** | **F** | F | P (date) | F | Va only |
| 33 | Employees | `/employees` | T | T | T | **F** | F | F | F | H, Fa, St, Va |
| 34 | Departments | `/employees/departments/new` | T | **F** | **F** | **F** | F | F | F | Va only |
| 35 | Leave Requests | `/employees/leave/new` | T | **F** | **F** | **F** | F | F | F | Va only |
| 36 | Leave Balances | `/employees/leave/balance/new` | T | **F** | **F** | **F** | F | P (date) | F | Va only |
| 37 | Payroll Runs | `/payroll/runs` | T | T | **F** | **F** | P (process) | P (date) | F | H, Fa, St, Ln, Va |
| 38 | Payslips | `/payroll/runs/[id]/payslips/[id]` | n/a | T | **F** | **F** | P (finalize) | n/a | F | H, St, Ln |
| 39 | Salary Components | `/payroll/components/new` | T | **F** | **F** | **F** | F | P (`"earning"`) | F | Va only |
| 40 | Salary Structures | `/payroll/structures/new` | T | **F** | **F** | **F** | F | F | F | **Ln**, Va |
| 41 | Income Tax Slabs | `/payroll/tax-slabs/new` | T | **F** | **F** | **F** | F | F | F | **Ln**, Va |
| 42 | Statutory Rules | `/payroll/statutory-rules/new` | T | **F** | **F** | **F** | F | P (`"pf"`) | F | Va only |
| 43 | Recruitment — Openings | `/recruitment/openings` | T | T | **F** | **F** | P (status) | F | F | H, Fa, St, Va |
| 44 | Recruitment — Applications | `/recruitment/applications` | T | T | **F** | **F** | P (stage/hire) | F | F | H, Fa, St, Va |
| 45 | Recruitment — Candidates | `/recruitment/candidates/new` | T | **F** | **F** | **F** | F | F | F | Va only |
| 46 | GRC — Policies | `/grc/policies` | T | T | T | **F** | F | F | F | H, Fa, St, Va |
| 47 | GRC — Risks | `/grc/risks` | T | T | **F** | **F** | P (advance) | F | F | H, Fa, St, Va |
| 48 | GRC — Fraud Cases | `/grc/cases` | T | T | **F** | **F** | F | P (date) | F | H, Fa, St, Va |
| 49 | GRC — Access Review | `/grc/access-review` | T | T | **F** | **F** | F | F | F | H, Fa, St, **Ln**, Va |
| 50 | GRC — Audit Engagements | `/grc/audits/new` | T | **F** | **F** | **F** | F | F | F | Va only |
| 51 | GRC — Audit Findings | `/grc/findings/new` | T | **F** | **F** | **F** | F | F | F | Va only |
| 52 | GRC — Vendor Risk | `/grc/vendors/new` | T | **F** | **F** | **F** | F | F | F | Va only |
| 53 | KPIs | `/kpis` | T | T | **F** | **F** | P (approve) | F | F | H, Fa, **Ln**, Va, Au |
| 54 | Wiki | `/wiki` | T | T | **F** | **F** | F | F | F | H, Fa, Va, Au |
| 55 | Knowledge Base | `/knowledge-base` | T | T | T | P (archive) | F | F | F | H, Fa, St, Va |
| 56 | FF&E | `/ffe` | T | T | T | **F** | F | F | F | H, Fa, St, Va |
| 57 | Mood Boards | `/mood-boards` | T | T | T | P (items only) | F | F | F | H, Fa, St, Va |
| 58 | Change Orders | `/change-orders` | T | T | **F** | **F** | P (approval) | F | F | H, Fa, St, Va |
| 59 | Punch List | `/punch-list` | T | T | **F** | **F** | P (transition) | F | F | H, Fa, St, Va |
| 60 | RFIs | `/rfis` | T | T | **F** | **F** | P (answer/close) | F | F | H, Fa, St, Va |
| 61 | Submittals | `/submittals` | T | T | **F** | **F** | F | F | F | H, Fa, St, Va |
| 62 | Site Diary | `/site-diary` | T | T | **F** | **F** | F | P (date) | F | H, Fa, Va |
| 63 | Design Studio Timesheets | `/design-studio` | T | T | T | T | T | F | **F** | H, Fa, St, Va |
| 64 | Projects | `/projects` | T | **F** | **F** | **F** | F | F | F | Va only |
| 65 | Analysis / Copilot / HR / Settings | `/analysis`, `/copilot`, `/hr`, `/settings` | n/a | T | P | F | F | n/a | F | H |

**Totals across the 61 transactional modules (rows 2-64):** full manual CRUD (create + read + edit + delete all TRUE or better-than-PARTIAL) = **11**. Edit absent = **34**. Delete absent = **38**.

---

## 3. (b) NUMBERED GAPS, WITH THE FILE A FIX MUST TOUCH

### GAP-1 — The Budget module's real screens are outside the left catalogue (owner points 2 & 5)
`module-catalogue.ts:248-268` declares module `budgets` with `prefixes: ["/budgets"]` only, and its own create leaf points at `/finance/budgets/new` (`module-catalogue.ts:265`). `/budgets`, `/budgets/new` and `/budgets/[id]` are all pure redirects into `/finance/budgets/*` (`src/app/(app)/budgets/new/page.tsx:18`, `src/app/(app)/budgets/[id]/page.tsx:6`, `src/app/(app)/budgets/page.tsx:1-16`). `moduleForPathname("/finance/budgets")` returns `null` (`module-catalogue.ts:348-361`), so `chainModuleForPathname()` returns null (`module-catalogue.ts:415-418`) and `M24Shell.tsx:1600-1604` emits **no module segment**. The catalogue's own leaf navigates the user off the catalogue.
**Fix location:** `C:\ct\projexa\src\lib\module-catalogue.ts:251` — add `/finance/budgets` to the `budgets` prefixes.

### GAP-2 — Design Studio has no catalogue entry at all
`/design-studio`, `/design-studio/timesheets/new`, `/design-studio/timesheets/[id]`, `/design-studio/cost-analysis`, `/design-studio/review` match no prefix in `MODULE_CATALOGUE` (`module-catalogue.ts:95-327`). This is requirement **R-C12**, which the DB marks "VERIFIED LIVE 24 AUG". Its screens work; the left strip cannot name them.
**Fix location:** `C:\ct\projexa\src\lib\module-catalogue.ts` — new `ModuleDef`.

### GAP-3 — 116 of 175 routes (66%) cannot show a module segment in the left panel
Full list of uncovered routes is in §5. The shell's own route registry knows all 175 are shipped (`src/lib/nav-routes.ts:27` `SHIPPED_ROUTES`, cross-checked: every on-disk page route is present), so the shell renders the frame but `useScreenModule()` returns `chainModule: null` (`src/components/shell/use-screen-module.ts:59-71`). This is the single largest left/right sync gap.
**Fix location:** `C:\ct\projexa\src\lib\module-catalogue.ts` — the `MODULE_CATALOGUE` array.

### GAP-4 — 38 of 61 transactional modules have no Delete anywhere in the UI
Only 14 object screens pass `onDelete=`. Only 16 of 288 API route files export `DELETE`. Modules with a create screen but no delete path at any layer include: Customers, Vendors, Employees, Inventory Items, KPIs, Wiki, FF&E, Change Orders, Punch List, RFIs, Submittals, Site Diary, Sales Leads, Sales Opportunities, Sales Orders, Sales Quotations, Purchase Orders, Requisitions, RFQs, Goods Receipts, Payroll Runs, all four Payroll masters, all three Recruitment entities, and five of the seven GRC entities.
**Fix locations:** per module, `C:\ct\projexa\src\app\api\<module>\[id]\route.ts` (add `DELETE`) **and** the matching `C:\ct\projexa\src\components\<X>ObjectClient.tsx` (add `onDelete=`).

### GAP-5 — 34 of 61 transactional modules have no field-level Edit
`onEdit=` appears on 18 of 46 object screens. Where a PATCH exists without `onEdit`, it is a **workflow verb, not a field editor** — verified: `RfiObjectClient.tsx` PATCHes `{action:"answer"}` / `{action:"close"}`; `ChangeOrderObjectClient.tsx` PATCHes `{action:"submit", signers:[…]}`; `PunchListObjectClient.tsx` PATCHes `{action}`; `RiskObjectClient.tsx` PATCHes `{status: next}`. None lets the user correct a typed field.
**Fix locations:** the 34 `<X>ObjectClient.tsx` files under `C:\ct\projexa\src\components\`, plus `PATCH` handlers where absent under `C:\ct\projexa\src\app\api\`.

### GAP-6 — Purchase Orders: the screen self-documents its own missing Edit/Delete
`C:\ct\projexa\src\components\PurchaseOrderObjectClient.tsx:6` states verbatim: `No generic Edit/Delete -- no updatePurchaseOrder() exists.` Confirmed at the API layer: `/api/procurement/purchase-orders/[id]` exports `GET` only.
**Fix location:** `C:\ct\projexa\src\app\api\procurement\purchase-orders\[id]\route.ts` + the buying service that backs it.

### GAP-7 — Six document types can only ever be created with ONE line item, and the line can never be edited afterwards
The create screen hardcodes a single-element child array:
- `InvoiceCreateClient.tsx:53` — `items: [{ description, quantity: … }]`
- `RequisitionCreateClient.tsx:29` — `items: [{ description: itemDesc, quantity: … }]`
- `QuotationCreateClient.tsx:47` — `items: [{ description, quantity, rate }]`
- `CreditNoteCreateClient.tsx:44` — `items: [{ description, quantity: 1, rate }]`
- `RfqCreateClient.tsx:43` — `items: [{ description: itemDesc, quantity: … }]`
- `GoodsReceiptCreateClient.tsx:69` — `items: [{ itemId, quantity, warehouseId }]`

Only 7 create screens have a repeatable line editor at all (`JournalEntryCreateClient`, `SalesOrderCreateClient`, `SalesQuotationCreateClient`, `PurchaseOrderCreateClient`, `ScopeCreateClient`, `SalaryStructureCreateClient`, `IncomeTaxSlabCreateClient`), and only 3 of those support **removing** a row. Separately, **17 object screens render a child line-item table and 0 of them can add a row** — the only `ADD_ROW` on any object screen is `MoodBoardObjectClient.tsx`. For a header/item ERP document this is the largest single SAP-fidelity gap.
**Fix locations:** the six `*CreateClient.tsx` files above, plus the matching `*ObjectClient.tsx` files, under `C:\ct\projexa\src\components\`.

### GAP-8 — Owner point 7 (pre-populate before the user asks) is essentially unimplemented
- **1** create screen of 64 derives a field from a stored backend record: `GoodsReceiptCreateClient.tsx:49-52` copies `po.supplierId` when `?poId=` is present. It does **not** copy the PO's line items, quantities or rates — `GoodsReceiptCreateClient.tsx:69` still posts a single hand-typed row with `quantity: Number(quantity) || 1`. This is the one "create with reference" flow and it is 10% complete.
- **2** create screens offer a remembered previous choice, and the memory is browser `localStorage`, not backend data: `AttendanceCreateClient.tsx` and `MaterialReceiptCreateClient.tsx`, via `C:\ct\projexa\src\lib\last-choice.ts:45-54`. `lastChoiceKey()` even scopes to the literal string `"self"` because no screen knows the user id (`last-choice.ts:40-42`).
- **22** of 64 create screens seed any field at all, and every one of those seeds is either today's date or a static enum constant (`"dwg"`, `"earning"`, `"pf"`, `"receipt"`).
- **42** of 64 create screens open completely blank.
- Server-side: 26 of 65 create `page.tsx` files read `searchParams`, and spot-checks confirm they read **`projectId` only** — routing context, not field seeds (`src/app/(app)/permits/new/page.tsx:53-54`, `scope/new/page.tsx:32-33`, `site-diary/new/page.tsx:6-7`, `kpis/new/page.tsx:6-7`). The single exception is `goods-receipts/new` reading `poId`.
**Fix locations:** each `*CreateClient.tsx` under `C:\ct\projexa\src\components\`, plus the corresponding `page.tsx` under `C:\ct\projexa\src\app\(app)\**\new\` to resolve defaults server-side.

### GAP-9 — 16 entities can be created but never opened, edited or deleted
`/accounting/companies/new`, `/employees/departments/new`, `/employees/leave/new`, `/employees/leave/balance/new`, `/expenses/new`, `/grc/audits/new`, `/grc/findings/new`, `/inventory/stock-entries/new`, `/inventory/warehouses/new`, `/payroll/components/new`, `/payroll/statutory-rules/new`, `/payroll/structures/new`, `/payroll/tax-slabs/new`, `/projects/new`, `/recruitment/candidates/new`, `/schedule/sprints/new` — none has a sibling `[id]` page. `/procurement/quotations/new` is a 17th case: the only `/quotations/[id]` page is `SalesQuotationObjectClient`, a different entity on a different table, so a **purchase** quotation is unreachable after save.
**Fix location:** new `page.tsx` files under `C:\ct\projexa\src\app\(app)\<module>\[id]\`.

### GAP-10 — Purchase Orders and Quotations are split across two route families
Create lives at `/purchase-orders/new` (`PurchaseOrderCreateClient`), the list at `/purchase-orders` (`PurchaseOrdersClient`), the object page at `/procurement/purchase-orders/[id]` (`PurchaseOrderObjectClient`) — whose Back button goes to `/procurement?tab=purchase-orders` (`PurchaseOrderObjectClient.tsx:93`), i.e. neither the list the user came from nor a catalogued route. `/quotations/*` (sales) and `/procurement/quotations/new` (purchase) are two different entities sharing one word.
**Fix location:** `C:\ct\projexa\src\app\(app)\purchase-orders\` and `C:\ct\projexa\src\app\(app)\procurement\` — choose one tree.

### GAP-11 — No SAP-style audit block on any screen
Across all 369 components, `createdAt` is displayed on 13, `updatedBy` on 3 (all Wiki), and **`createdBy` on zero**. No screen shows the SAP "Created by X on <date> / Changed by Y on <date>" pair. Files that show anything: `DocumentObjectClient`, `DocumentsClient`, `DrawingObjectClient`, `DrawingsClient`, `KpiObjectClient`, `LeadsClient`, `MeetingObjectClient`, `MoMObjectClient`, `ScheduleGanttClient`, `ScopeClient`, `ScopeObjectClient`, `VendorObjectClient`, `WorkProgressObjectClient`, `WikiClient`, `WikiCreateClient`, `WikiObjectClient`.
**Fix location:** `C:\ct\projexa\node_modules\@fchecklist\veridian-ui-kit\src\screens\ObjectScreen.tsx` is the natural home, but it is a pinned external dependency — so realistically `C:\ct\projexa\src\components\screens\KitObjectScreen.tsx` (the existing sanctioned fork) plus each object client's `facets`.

### GAP-12 — A third object-screen archetype exists with zero screen consumers
`C:\ct\projexa\src\components\screens\ObjectScreen.tsx` implements exactly what the owner asks for — display-first with `Edit | Back | Delete`, an inline confirm naming the blast radius, and a persistent footer receipt (`:43-51`, `:99-177`). No screen client imports it; only `KitObjectScreen.tsx` and two tests reference it. The delete-confirmation wording helper `deleteConfirmation()` at `src/lib/create-screen.ts:178-187` is likewise wired into only 4 components (`useDeleteConfirmation`).
**Fix location:** either retire `src/components/screens/ObjectScreen.tsx` or migrate screens onto it — a decision, not a defect, but it is dead surface today.

### GAP-13 — WITHDRAWN 2026-09-08. FALSE FINDING; no fix was made because none is warranted.

**This gap does not exist.** It was raised on a grep result and disproved on the behaviour.
`MaterialCreateClient.tsx`, `MoMCreateClient.tsx` and `ScheduleTaskCreateClient.tsx` all delegate
to `src/components/screens/CreateScreen.tsx`, which owns both halves:
`const missing = missingCreateFields(fields, values, files, extraMissing);`
`const blocked = missing.length > 0 || saving || saved;`
and then guards twice over -- the submit button is `disabled={blocked}` AND the form's own
`onSubmit` refuses when blocked. Empty submission is already impossible on all three.

The denominator below is also wrong. Measured: **63** create clients, not 64. **55** hand-roll
`saveDisabled`; **8** delegate to the shared archetype. The 8 without the string are exactly the
8 that delegate -- AttendanceCreateClient, BudgetCreateClient, MaterialCreateClient,
MaterialReceiptCreateClient, MoMCreateClient, RosterCreateClient, ScheduleTaskCreateClient,
ScopeCreateClient. This gap named 3 of those 8 arbitrarily; by its own criterion the other 5 are
equally "broken", and none of them is.

Required fields were re-derived from what the servers actually reject and all three already match:
Material -> name/projectId/unit (`C:\ct\ct\src\lib\services\construction-materials-service.ts:115-118`);
MoM -> title/scheduledAt (`C:\ct\ct\src\lib\serviceseri-meeting-service.ts:287-289`);
Schedule task -> projectId/title/startDate (`src/app/api/schedule/tasks/route.ts:37-43`).
R-04 ("a missing title is rejected naming the field") is satisfied on all three today.

One real but inert observation, disclosed and deliberately NOT changed: `ScheduleTaskCreateClient`
marks `priority` `required: true` although no server rejects it. It never blocks, because state is
seeded `{ priority: "no_priority" }`. Loosening it is a behaviour change outside this gap.

ORIGINAL TEXT OF THE WITHDRAWN FINDING, kept for the record:

### GAP-13 (WITHDRAWN) — Three create screens have no required-field validation
`MaterialCreateClient.tsx`, `MoMCreateClient.tsx`, `ScheduleTaskCreateClient.tsx` contain neither a `missing*` computation nor `saveDisabled`, against 61 of 64 that do. Two of the three are core Sumeet modules (Material, MoMs).
**Fix location:** those three files under `C:\ct\projexa\src\components\`.

### GAP-14 — Scope/BOQ has Delete but no field Edit; Customers/Vendors have Edit but no Delete
`ScopeObjectClient.tsx:222-230` implements `runAction("delete")` against `DELETE /api/scope/[id]`, and `/api/scope/[id]` exports `GET, DELETE` with **no `PATCH`** — BOQ header fields are not editable; only line items are, via `PATCH /api/scope/line-items/[id]`. Conversely `CustomerOverviewClient.tsx` and `VendorObjectClient.tsx` pass `onEdit=` but no `onDelete=`, and `/api/customers/[id]` and `/api/vendors/[id]` export `GET, PATCH` only.
**Fix locations:** `C:\ct\projexa\src\app\api\scope\[id]\route.ts` (add `PATCH`); `C:\ct\projexa\src\app\api\customers\[id]\route.ts` and `...\vendors\[id]\route.ts` (add `DELETE`).

---

## 4. (c) `platform.sumeet_requirements` — WHAT IT ACTUALLY CONTAINS

Queried live against `pcrjmlpuqsbocqfwoxod`.

- **Real row count: 70.** (`SELECT count(*)` → 70.)
- Table has 22 columns; `status` is free text as warned — observed values include `DONE - VERIFIED`, `DONE - CODE`, `DONE - UNTESTED`, `PARTIAL`, `NOT TESTED`, `NOT TESTABLE YET`, `NOT DONE`, `PASS`, `OUT OF R46 SCOPE`, plus multi-paragraph narrative statuses. It is not an enum and was not treated as one.
- 29 distinct `area` values.

**Which rows actually bear on right-side ERP-screen behaviour — 46 of 70 (66%):**

| Area | Rows | IDs | Bears on right-side screens? |
|---|---|---|---|
| Weighted Sub-Tasks | 10 | R-10…R-19 | **YES** — R-11 is explicitly "enterable in create form"; R-15 wants a running total shown per parent |
| Work Progress | 9 | R-40…R-48 | **YES** — R-41/42/43 are literal column specs for the WPR screen |
| Revisions | 5 | R-20…R-24 | **YES** — revise/compare screens (`/scope/[id]/revise`, `/scope/[id]/compare` both exist) |
| BOQ Create | 4 | R-01…R-04 | **YES** — R-04 "missing title rejected naming the field" is a validation requirement |
| Currency | 4 | R-60…R-63 | **YES** for R-60/R-62 (display); R-61/R-63 are backend/provisioning |
| BOQ View | 3 | R-30…R-32 | **YES** |
| Dashboard | 3 | R-50…R-52 | **YES** |
| Import | 3 | R-70…R-72 | **YES** — `/scope/import`, `/labour/import`, `/schedule/import` all exist |
| Module: * (10 areas) | 10 | R-C01,02,03,04,07,08,09,10,11,12 | **YES** — one per module, these are the screen mandates |
| Scope / Variations | 2 | R-C13, R-C14 | **YES** (R-C14 "upload site instruction form" is a screen) |
| Error Visibility | 2 | R-90, R-91 | **YES** — toast/message behaviour on save |
| Export / Share | 1 | R-C15 | **YES** |
| Reports Roll-up | 1 | R-33 | Backend |
| Selection Layer | 2 | R-80, R-81 | **NO** — left-side pills |
| Assistant | 1 | R-82 | **NO** — left-side chat |
| Security | 5 | R-A1…R-A6 | **NO** |
| Legal | 2 | R-A5, R-A7 | **NO** |
| Test / Gate | 2 | R-B1, R-B2 | **NO** — process |
| Platform: CRR | 1 | R-C16 | **NO** — backend initiative, row itself says "OUT OF R46 SCOPE" |

**Critical observation for items (10)-(12):** not one of the 70 rows asks for Edit or Delete on any screen, and not one asks for pre-population. The owner's points (4), (7) and (8) are **new requirements beyond the table**. Anyone closing this gap from `sumeet_requirements` alone will close none of GAP-4, GAP-5, GAP-7 or GAP-8.

**Also worth flagging:** `R-B2`'s own status text (read live today) still records an unresolved contradiction — CI demo-gate passes but a manual click-through found TC-10 (BOQ with weighted children silently not persisting) and TC-30 unfixed, and its 2026-08-28 audit correction says the underlying persistence defect "is NOT independently confirmed fixed". If true that would undercut row 6 of the matrix above. It is not verifiable from source.

---

## 5. ROUTES NOT COVERED BY `module-catalogue.ts` (116)

`/accounting`, `/accounting/companies/new`, `/accounting/journal-entries/[id]`, `/accounting/journal-entries/new`, `/analysis`, `/change-orders`, `/change-orders/[id]`, `/change-orders/new`, `/copilot`, `/design-studio`, `/design-studio/cost-analysis`, `/design-studio/review`, `/design-studio/timesheets/[id]`, `/design-studio/timesheets/new`, `/employees`, `/employees/[id]`, `/employees/departments/new`, `/employees/leave/balance/new`, `/employees/leave/new`, `/employees/new`, `/expenses`, `/expenses/new`, `/ffe`, `/ffe/[id]`, `/ffe/new`, `/finance/budgets`, `/finance/budgets/[id]`, `/finance/budgets/new`, `/grc`, `/grc/access-review/[id]`, `/grc/access-review/new`, `/grc/audits/new`, `/grc/cases/[id]`, `/grc/cases/new`, `/grc/findings/new`, `/grc/policies/[id]`, `/grc/policies/new`, `/grc/risks/[id]`, `/grc/risks/new`, `/grc/vendors/new`, `/hr`, `/inventory`, `/inventory/items/[id]`, `/inventory/items/new`, `/inventory/stock-entries/new`, `/inventory/warehouses/new`, `/invoices`, `/invoices/[id]`, `/invoices/credit-notes/[id]`, `/invoices/credit-notes/new`, `/invoices/new`, `/knowledge-base`, `/knowledge-base/[id]`, `/knowledge-base/new`, `/kpis`, `/kpis/[id]`, `/kpis/new`, `/mood-boards`, `/mood-boards/[id]`, `/mood-boards/new`, `/payroll`, `/payroll/components/new`, `/payroll/runs/[id]`, `/payroll/runs/[id]/payslips/[payslipId]`, `/payroll/runs/new`, `/payroll/statutory-rules/new`, `/payroll/structures/new`, `/payroll/tax-slabs/new`, `/procurement`, `/procurement/goods-receipts/[id]`, `/procurement/goods-receipts/new`, `/procurement/purchase-orders/[id]`, `/procurement/quotations/new`, `/procurement/requisitions/[id]`, `/procurement/requisitions/new`, `/procurement/rfqs/[id]`, `/procurement/rfqs/new`, `/projects`, `/projects/new`, `/punch-list`, `/punch-list/[id]`, `/punch-list/new`, `/purchase-orders`, `/purchase-orders/new`, `/quotations`, `/quotations/[id]`, `/quotations/new`, `/recruitment`, `/recruitment/applications/[id]`, `/recruitment/applications/new`, `/recruitment/candidates/new`, `/recruitment/openings/[id]`, `/recruitment/openings/new`, `/rfis`, `/rfis/[id]`, `/rfis/new`, `/sales`, `/sales/leads`, `/sales/leads/[id]`, `/sales/leads/new`, `/sales/opportunities`, `/sales/opportunities/[id]`, `/sales/opportunities/new`, `/sales-orders`, `/sales-orders/[id]`, `/sales-orders/new`, `/settings`, `/site-diary`, `/site-diary/[id]`, `/site-diary/new`, `/submittals`, `/submittals/[id]`, `/submittals/new`, `/wiki`, `/wiki/[id]`, `/wiki/new`

---

## 6. (d) NOT VERIFIABLE FROM SOURCE ALONE

Everything below needs a live authenticated browser run and is marked **UNVERIFIED**:

1. **Whether any screen actually renders.** This audit proves a `page.tsx` and a client component exist and which props they pass. It does not prove the screen paints, that its fetch succeeds, or that RLS lets the demo user see rows.
2. **Whether the left strip visually loses its module segment on the 116 uncovered routes.** The code path is proven (`use-screen-module.ts:59-71` → `M24Shell.tsx:1600-1604`); the rendered result is not.
3. **R-B2 / TC-10 — whether a BOQ with weighted children actually persists through the real UI.** The DB row asserts it may still fail. Source cannot settle it.
4. **Whether workflow `submit` endpoints succeed end-to-end** (draft → submitted → received). Only the presence of 21 `/submit`-style POST routes is proven.
5. **Whether `onEdit` buttons produce a working editable form.** `onEdit=` presence is proven; whether the resulting `mode="edit"` form saves is not.
6. **Whether soft-delete verbs behave as the owner means by "delete".** Budget→cancel, Invoice→cancel (draft only), KnowledgeBase→archive, Document→dispose are marked PARTIAL on that basis; whether the record disappears from the list is unverified.
7. **Actual pre-population at runtime from AI/composer.** No source mechanism was found that pushes composer-extracted values into a create form — `M24Shell.tsx:1582-1586` states band 2 is deliberately empty on create routes because "the page's own form IS the card". Whether some runtime path does it anyway is UNVERIFIED, but no code supports it.
8. **Whether the 16 `DELETE` API routes are reachable for the demo role.** `src/lib/authz/api-write-policy.ts` exists and was not evaluated per-route.
9. **Owner point 8 ("95% work reduction").** Not measurable from source. On the evidence above, 42 of 64 create screens open blank and 1 of 64 pulls a stored value, so the current figure is closer to 0% than 95% — but that is an inference, not a measurement.
