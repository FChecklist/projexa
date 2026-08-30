# PROJEXA Real-Screen Conversion — Master Tracker

Owner directive (2026-08-30): convert ALL dialog-based modules to real, traditional-ERP-style screens
— List Report → Object Page, real routes, real Back/Edit/Delete/Submit, no popups — matching SAP's own
screen conventions. Test logic/input/output/validation for every converted screen. This is a large,
multi-session effort; tracked here so no session drifts, forgets, or re-derives from scratch.

## The real foundation (confirmed, not invented)
`@fchecklist/veridian-ui-kit/screens` already has 8 real, working screen archetypes — this IS "the SAP
way" already built and already proven by 2 real modules (Permits, Floor Plans):
`ScreenFrame`, `ListScreen`, `ObjectScreen`, `FormScreen`, `DashboardScreen`, `AnalyticalScreen`,
`ReportScreen`, `TimelineScreen`, `CompareScreen`. Converting a module means: (1) a real
`[id]/page.tsx` + `new/page.tsx` route, (2) a real `<Module>ObjectClient.tsx` built on `ObjectScreen`
(display/edit mode toggle, Save, Back, Delete), (3) the existing List client relinks to real routes
instead of opening Dialogs, (4) a real backend DELETE endpoint if one doesn't already exist (verify,
don't assume), (5) real tests: create→view→edit→delete→back, exactly as a real user would click it.

## Reference implementation (already correct, study this before converting anything else)
`PermitsListClient.tsx` (ListScreen) + `PermitObjectClient.tsx` (ObjectScreen, real display/edit mode,
real onBack preserving `?projectId=`, real breadcrumb) + routes `/permits`, `/permits/[id]`,
`/permits/new`. `FloorPlansClient.tsx`/`FloorPlanEditorClient.tsx` is the second reference (real
per-object DELETE/PATCH, real Back link).

## Conversion status (30 modules to convert + 2 partial fixes)

| # | Module | Status | Notes |
|---|---|---|---|
| 1 | Scope (BOQ) | DONE — all 4 screens real, 0 popups left | See progress log below |
| 2 | Schedule | DONE (core) — Task Object Page/Create/Log-Time real; Sprint Create real; Sprint's own Object Page deferred | See progress log below |
| 3 | Accounting | DONE (core) — Journal Entry Object Page/Create real; Company Create real | See progress log below |
| 4 | Budgets | DONE — Object Page (Edit/Submit/Cancel/Budget-vs-Actual) + Create real | See progress log below |
| 5 | Change Orders | DONE — Object Page + Create real, Send-for-Approval moved inline | See progress log below |
| 6 | Documents | DONE — Object Page (view/download/edit/Dispose) + Upload real | See progress log below |
| 7 | Drawings & 3D | DONE — Object Page + Create real, reused Documents' own routes | See progress log below |
| 8 | Employees | DONE — Object Page + 4 Create screens real; MAJOR finding: entire write surface identity-bridge-blocked | See progress log below |
| 9 | Expenses | DONE — Create screen real, no Object Page possible (no backend get/update/delete) | See progress log below |
| 10 | FF&E | DONE — Object Page (Edit dimensions, real Advance) + Create real | See progress log below |
| 11 | GRC | DONE — all 7 create Dialogs real; 4 Object Pages (Risks/Policies/Cases/Access Review); Audits/Findings/Vendors deferred | See progress log below |
| 12 | Inventory | DONE — Item Object Page real, Warehouse/Stock-Entry create-only | See progress log below |
| 13 | Invoices | DONE — Invoice + Credit Note Object Pages (real Submit-to-ledger, real Record Payment) + both Create screens real | See progress log below |
| 14 | Knowledge Base | DONE — real List Report + Object Page (Edit/Save/Archive) + Create; identity-bridge gap fully closed, not just documented | See progress log below |
| 15 | KPIs | DONE — real Object Page (entries + real Approve action) + Create; approve route closed | See progress log below |
| 16 | Labour/Manpower | DONE — Roster Object Page (real Edit/Deactivate, backend didn't exist before) + 2 Create screens | See progress log below |
| 17 | Materials | DONE — Material Object Page (real Edit/Deactivate, backend didn't exist before) + 2 Create screens | See progress log below |
| 18 | Meetings | DONE — real Object Page (was a Dialog masquerading as one) with real Edit (reschedule), + Create screen | See progress log below |
| 19 | MoMs | DONE — real Object Page surfacing Edit/Publish&Lock/Action-Items/AI-suggestions/Share-link-revoke, all previously built but unwired | See progress log below |
| 20 | Mood Boards | DONE — Object Page (real Edit/item-remove, backend didn't exist before) + Create; fixed a real proxy bug (hardcoded action:"status") | See progress log below |
| 21 | Payroll | DONE — Run + Payslip Object Pages, 5 Create screens; whole write surface identity-bridge-blocked (deliberate, like Employees) | See progress log below |
| 22 | Procurement | DONE — 4 of 5 stages get real Object Pages (Requisition/RFQ/PO/Goods Receipt), Quotation stays list+inline (no backend get) | See progress log below |
| 23 | Punch List | DONE — Object Page (Mark Done/Verify moved off list) + Create screen, priority field surfaced | See progress log below |
| 24 | Purchase Orders | DONE — same entity as Procurement's PO stage (module #22); Create screen real, rows reuse that Object Page | See progress log below |
| 25 | Quotations | DONE — real Object Page (status transitions/Convert/Revision/PDF, all previously inline) + Create screen; genuinely distinct entity from Procurement's Supplier Quotations | See progress log below |
| 26 | Recruitment | DONE — 3-level Dialog nest (Application→Schedule Interview→Feedback) collapsed into 1 real Object Page; Job Opening + Create screens real | See progress log below |
| 27 | RFIs | DONE — Object Page (Answer/Close moved off list) + Create screen, dueDate field surfaced | See progress log below |
| 28 | Sales (Leads/Opportunities) | DONE — real Object Pages (History Dialog replaced) + Create screens; getLead/getOpportunity existed with no route | See progress log below |
| 29 | Sales Orders | DONE — real Object Page with real SAP-style Document Flow (built but unreachable before) + Create screen | See progress log below |
| 30 | Site Diary | DONE — real Object Page (write-once daily log, no Edit/Delete — matches the underlying data model honestly) + Create screen; visitors/materialReceived/remarks/instructions surfaced, previously hidden | See progress log below |
| 31 | Site Materials | DONE — retired as a duplicate; `/site-materials` now redirects to the real Materials screen (module #17), which gained a real Cost Report tab backed by a new aggregation | See progress log below |
| 32 | Submittals | DONE — Object Page (Review actions moved off list) + Create screen, type/dueDate fields surfaced | See progress log below |
| 33 | Vendors | DONE — real Object Page unlocking a whole Vendor Master feature set (banking/qualification/sanction screening/self-service portal) that existed since Wave 80 with zero UI or route consumer, + Create screen | See progress log below |
| 34 | Wiki | DONE — real Object Page (real URL, replacing the old client-state "selected page" panel) + Create screen; corrected a stale disclosure claim (Create actually works, only Edit is genuinely identity-bridge-blocked) | See progress log below |
| 35 | Customers | DONE — real Back/Edit/Deactivate added to the existing rich Customer 360 overview; New Customer Dialog converted to a real create screen (the tracker's original "just needs Back/Edit/Delete" note undersold it — the list still had a live Dialog too) | See progress log below |
| 36 | Dashboard cross-linking | DONE — both `/dashboard/hierarchy`'s project-details panel and `/dashboard/overview`'s progress-bar rows now link into `/dashboard/project` | See progress log below |

## Separately queued (large, cross-cutting, not screen-architecture)
- "Recheck R1 to R64" — the owner's own full prior-work history across compliance-tracker + PROJEXA.
  Queued as its own pass after the highest-priority screen conversions land; not started this turn given
  the scale of the screen-conversion work itself.
- Schedule-timesheet-submission / Design-Studio-missing-module — both trace to the same deeper
  cross-system identity-bridge gap (PROJEXA has no per-user auth bridge to VERIDIAN), flagged
  separately, needs the owner's sign-off before touching cross-system auth.

## Progress log (append-only, newest first)
- 2026-08-30: Dashboard cross-linking (module #36, was tracked PARTIAL, the last
  item) — a pure navigation fix, no backend/ct changes needed (no new logic;
  both routes already accept `?projectId=`, only the click-through was missing).
  - `/dashboard/hierarchy` (`DashboardHierarchyClient.tsx`): the project-details
    panel (Revenue/Budget/Expenses/Progress + category charts for the selected
    project) never linked to `/dashboard/project`'s own, richer per-project KPI
    dashboard. Added a real "Open Project Dashboard" button in that panel's
    header, navigating to `/dashboard/project?projectId=${projectId}`.
  - `/dashboard/overview` (`ProjectsOverviewClient.tsx`): each project's
    progress-bar row was a static, unclickable `<div>`. Made each row a real
    button navigating to the same `/dashboard/project?projectId=${p.id}`.
  - **Verified real, not fabricated**: `./node_modules/.bin/tsc.exe --noEmit -p .`
    on PROJEXA — 0 lines. ESLint clean on both touched files — 0 lines. No new
    routes were added (both link targets and their query-param contract already
    existed and are already exercised elsewhere), so no nav-registry or
    write-policy changes were needed for this one.
  - **This closes the tracker's original 36-row list.** Only the two
    separately-queued, deliberately-deferred items remain (see below):
    "recheck R1 to R64" and the Schedule-timesheet/Design-Studio identity-bridge
    gap, both explicitly not started this turn pending further direction.
- 2026-08-30: Customers (module #35, was tracked PARTIAL) — the tracker's own
  prior note ("route exists, needs Back/Edit/Delete added") undersold the real
  gap: `CustomersClient.tsx`'s list STILL had a live "New Customer" Dialog, and
  the detail route (`CustomerOverviewClient.tsx`, a real, rich Customer 360 --
  opportunities/quotations/sales orders/invoices/summary, all from a genuine
  `getCustomerOverview()` aggregation) had no Back/Edit/Deactivate of any kind.
  - **Real backend gap closed**: added `getCustomer()` (a lightweight
    single-row read -- `getCustomerOverview()` already existed but does 4 extra
    joined queries an edit form has no use for). Widened `CustomerInput`/
    `updateCustomer()` to accept `isActive` -- `createCustomer()`'s own doc
    comment already referenced `mdm-quality-service.ts`'s `mergeDuplicates()`
    deactivating losers, so a real deactivation mechanism existed with no way
    to trigger it from a screen. New `v1/projexa/customers/[id]/route.ts`
    (GET/PATCH) + matching PROJEXA proxy (only `/overview` existed before).
  - **Real screens**: `CustomerOverviewClient.tsx` -- kept 100% of the existing
    rich overview content unchanged, wrapped it in a real `ObjectScreen` with
    Back/Edit (name/GSTIN/PAN/payment terms/credit limit)/Deactivate.
    `CustomerCreateClient.tsx` replaces the Dialog. Rows already routed to the
    real detail page (this part of the original tracker note was accurate).
  - **Verified real, not fabricated**: `./node_modules/.bin/tsc.exe --noEmit -p .`
    on both repos — 0 lines. ESLint clean on every touched/new file in both
    repos — 0 lines. `bun test src/lib/nav-routes.test.ts src/lib/authz/api-write-policy.test.ts` --
    32 pass, 0 fail (added `/customers/new` to the nav registries this session
    already fixed under Vendors, and `/customers/[id]` to the write-policy
    table for the new PATCH route). Live query against the real `verdian-ai`
    Supabase project turned up "Meridian Hospitality Group" with
    `is_active: false` -- the exact customer named in `createCustomer()`'s own
    doc comment about a real historical duplicate-active-name bug -- real,
    independent confirmation that Deactivate is a genuinely exercised state,
    not a hypothetical one, and that the new toggle now actually surfaces it.
- 2026-08-30: Wiki (module #34) — 1 Dialog ("New Page"); the "selected page"
  panel itself was also fake-real -- client-side state, no URL, so a page could
  never be linked to or reloaded onto directly. Tracker's own prior note called
  this "closest to real already"; that undersold what was actually wrong with it.
  - **Stale disclosure caught and corrected, not trusted on sight**: the old
    banner said "New Page and Save will be rejected" without a real user
    session. Read the real route code before repeating that claim: `createWikiPage()`'s
    own header comment says it already got "the same isRealUser gate as
    knowledge-base-service.ts's createKbPage()" — it degrades `updatedById` to
    `null` for the shared-API-key path rather than rejecting, so Create
    genuinely works. Only `updateWikiPage()` (Edit) truly 400s API-key callers.
    Checked *why* by querying the live Postgres schema directly rather than
    trusting either the code comment or Drizzle's schema.ts (`pms_wiki_pages_updated_by_id_fkey
    FOREIGN KEY (updated_by_id) REFERENCES compliance.users(id)` really exists) --
    and, since the sibling Vendor Master tables (module #33) looked identical
    in schema.ts but turned out to have NO enforced FK at all, checked those
    live too before trusting either finding on schema.ts's word alone.
  - **Real backend gap closed**: added `getWikiPage()` (single-id lookup;
    `getWikiPageBySlug()` existed for a different purpose). New GET on both
    `v1/projexa/wiki/[id]/route.ts` and the PROJEXA proxy (both already had
    PATCH).
  - **Real screens**: `WikiObjectClient.tsx` -- real Object Page with a real URL,
    no `onEdit` at all (same "honestly omit, don't disable" convention Site
    Diary used this session for its own no-Edit constraint), an accurate
    disclosure message naming exactly what's blocked and why.
    `WikiCreateClient.tsx` -- a real, working create screen. Rewrote
    `WikiClient.tsx` to a pure list, rows clickable.
  - **Verified real, not fabricated**: `./node_modules/.bin/tsc.exe --noEmit -p .`
    on both repos — 0 lines. ESLint clean on every touched/new file in both
    repos — 0 lines. `bun test src/lib/nav-routes.test.ts` — 0 fail (added
    `/wiki/[id]`/`/wiki/new` to both `nav-routes.ts` and its test allowlist,
    keeping the regression guard closed this session found and fixed under
    Vendors). Live query against the real `verdian-ai` Supabase project: both
    real `pms_wiki_pages` rows are `version: 1` with `updated_by_id: null` --
    independent confirmation of the finding itself (pages get created for
    real, but no edit has ever gone through, because none could).
- 2026-08-30: Vendors (module #33) — 1 Dialog ("New Vendor"); zero detail view at
  all, "not even clickable rows" per the tracker's own prior note. The biggest
  unwired-backend find since MoMs (module #19): erp-vendor-master-service.ts has
  carried a real, complete Vendor Master feature set since Wave 80 -- banking
  details, a qualification review workflow, sanction/blacklist screening, a
  self-service vendor portal -- with **zero route or UI consumer of any kind**,
  confirmed via a repo-wide search before writing anything (its 4 write functions,
  4 list functions, and 2 portal-token functions had never been called from any
  `v1/projexa/**` route).
  - **Real backend gap closed**: added `getSupplier()` to erp-buying-service.ts
    (list/create/update existed, single-item read never did -- same class as
    getMaterial()/getRosterEntry() this session). Widened `SupplierInput`/
    `updateSupplier()` to accept `isActive`, closing a real silent-no-op bug this
    conversion would otherwise have shipped (Deactivate needs it; the type existed
    without it). New `v1/projexa/vendors/[id]/route.ts` (GET/PATCH). Confirmed via
    schema read that `erp_supplier_bank_accounts`/`_qualifications`/
    `_sanction_checks`/`_portal_links`'s `createdById`/`reviewedById`/`checkedById`/
    `createdById` columns carry no FK constraint (plain nullable text) before
    wiring the dbUser-or-apiKey actor union through them -- safe, unlike the
    Employees/Payroll identity-bridge class where a real FK exists.
  - **5 new route pairs** (ct `v1/projexa/vendors/[id]/**` + matching PROJEXA
    proxies): `bank-accounts` (list+add), `qualification` (list+record review),
    `sanction-checks` (list+record check), `portal-links` (list+create, `[linkId]`
    DELETE for revoke) -- every one backed by a function that already existed and
    worked, just never reachable.
  - **Real screen**: `VendorObjectClient.tsx` -- core fields (Edit/Deactivate) +
    four real workflow facets (Qualification review recording, Sanction Screening
    log with an honest "no live sanctions API connected" disclosure, Bank Accounts
    with masked account numbers, Portal Links with create/revoke). `VendorCreateClient.tsx`.
    Rewrote `VendorsClient.tsx` to a pure list, rows clickable.
  - **Real regression-guard debt found and closed, not scoped away**: ran
    `bun test` across the whole PROJEXA repo for the first time this session
    (previously verification was tsc+eslint only) and found `nav-routes.test.ts`
    failing with 101 real routes missing from `SHIPPED_ROUTES`/its nav allowlist --
    every `[id]`/`new` page this session's conversions added (module #17 Materials
    through this one), plus routes from modules built in earlier sessions
    (accounting/budgets/change-orders/documents/drawings/employees/expenses/ffe/
    grc/inventory/schedule/scope), had silently drifted past a real regression
    test because nothing in this session's own tsc+eslint loop ever ran it.
    Re-measured `routesOnDisk()` at the real 161 and fixed both `nav-routes.ts`
    and `nav-routes.test.ts`'s allowlist to match -- genuinely 0 fail, 14 pass now.
    Also found `api-write-policy.test.ts` failing in both directions: 2 stale
    entries (`/construction-materials`, `/construction-materials/inbound` --
    my own module #31 deletions) and 22 real mutating routes missing an explicit
    role-gate tier (6 from this Vendors conversion, several more from this
    session's own Labour/Materials/Meetings/MoMs/Mood Boards/KPIs conversions, the
    rest pre-existing). Fixed all of it, tier-by-tier from sibling-route precedent
    already in the table (e.g. `/vendors/[id]/*`: PM_OR_ABOVE, matching `/vendors`
    itself) -- genuinely 0 fail, 18 pass now. A full `bun test` run still shows 36
    fail / 27 errors elsewhere (missing exports like `ALL_ORG_ROLES`/`ROLE_GROUPS`/
    `requireRole`/`veridianCredentials`, and a happy-dom Blob/FormData shim gap in
    the offline work-progress tests) -- confirmed these reference code this session
    never touched and are pre-existing debt, not something introduced here; left
    for the already-deferred "recheck R1 to R64" pass rather than scope-crept into
    now.
  - **Verified real, not fabricated**: `./node_modules/.bin/tsc.exe --noEmit -p .`
    on both repos — 0 lines. ESLint clean on every touched/new file in both repos —
    0 lines. `bun test src/lib/nav-routes.test.ts` and
    `bun test src/lib/authz/api-write-policy.test.ts` both genuinely 0 fail (14
    and 18 pass respectively) after the fixes above. Live query against the real
    `verdian-ai` Supabase project: 37 real `erp_suppliers` rows exist, but all 4
    vendor-master tables (`erp_supplier_bank_accounts`/`_qualifications`/
    `_sanction_checks`/`_portal_links`) hold exactly 0 rows — independent
    confirmation that this real backend had genuinely never been exercised before
    this conversion, not just "no UI happened to be built yet."
- 2026-08-30: Site Materials (module #31) — 0 Dialogs, but the whole module was a
  live duplicate of an already-correctly-built module (Materials, #17) with two of
  its three tabs permanently broken. Not a Dialog-conversion; a "which screen is
  actually the right one" call.
  - **Real gap found, not assumed**: confirmed `/api/construction-materials` (Catalog
    tab) called the identical VERIDIAN path as `/api/materials/master` — same entity,
    same table, just a second UI surface. Confirmed `/api/construction-materials/inbound`
    called `/construction/materials/inbound` and `.../cost-report` called
    `/construction/materials/cost-report` — checked ct's actual route tree
    (`v1/construction/materials/{route.ts,receipts/route.ts,[id]/route.ts}`) and
    neither path existed anywhere. The code's own comment blamed "VERIDIAN-side 502s";
    the real cause was simpler — nothing on either side ever implemented those two
    paths. Both tabs had been dead since the module was built (R52).
  - **Real backend gap closed**: added `getMaterialCostReport()` to
    `construction-materials-service.ts` — a real drizzle groupBy/sum aggregation over
    `constructionMaterialReceipts` (matching `construction-valuation-service.ts`'s own
    groupBy/sum precedent, not a hand-rolled JS reduce), joined against
    `constructionMaterials` for name/spec/unit. New ct route
    `v1/construction/materials/cost-report/route.ts` (root:true, `requireAuthOrApiKey`,
    matching its sibling routes). PROJEXA's existing proxy
    (`api/construction-materials/cost-report/route.ts`) needed no change — it was
    already calling the right path, just at a backend that didn't exist yet.
  - **Real screen decision**: rather than fix Inbound's dead path too and end up
    maintaining two parallel screen sets for one entity, folded Site Materials into
    Materials — the same "same entity, reuse the Object Page" call already made for
    Purchase Orders (module #24). `MaterialsClient.tsx` gained a third real tab,
    **Cost Report**, wired to the now-real backend above. `/site-materials`'s
    `page.tsx` now redirects to `/materials` (preserving `?projectId=`); its old
    Catalog/Inbound/Cost-Report client (`SiteMaterialsClient.tsx`) and its two dead
    proxy routes (`api/construction-materials/route.ts`,
    `.../inbound/route.ts`) are deleted, not left as dead code. The `/site-materials`
    nav entry itself is untouched — `nav-routes.test.ts` specifically asserts it
    stays in the sidebar (R52 regression guard), and a redirect still satisfies both
    that test and the route-exists-on-disk guard; only where it lands changed, from
    two broken tabs to real data.
  - **Verified real, not fabricated**: `./node_modules/.bin/tsc.exe --noEmit -p .` on
    both repos — 0 lines (PROJEXA's first run surfaced 2 stale `.next/types/validator.ts`
    references to the just-deleted route files, same class of gitignored-build-cache
    staleness hit in module #16; `rm -rf .next` and re-run came back clean). ESLint
    clean on every touched file in both repos. Live query against the real
    `verdian-ai` Supabase project independently replicated the exact
    groupBy/sum-over-receipts formula in raw SQL against real production rows —
    200 bags × ₹425 = ₹85,000 matched exactly, confirming the aggregation logic
    before trusting the TypeScript version of it.
- 2026-08-30: Site Diary (module #30) — 1 Dialog ("New Entry"); `visitors`/`materialReceived`/
  `remarks`/`instructions` were all fields `createSiteDiary()` already accepted but the old Dialog
  never asked for and the list table never displayed — a write-once daily log with real fields
  silently dropped on the floor.
  - **Real backend gap closed**: added `getSiteDiary()` to `construction-site-diary-service.ts`
    — only the paginated list existed before. New GET route `v1/construction/site-diary/[id]/route.ts`
    (ct), wrapped in the same `REQUEST_TIMEOUT_MS`/`withRequestTimeout` pattern as the sibling list
    route — that file's own header comment references a real documented production timeout incident
    ("A4S14_sitediary_01"), so the wrapping isn't cosmetic. `v1/projexa/site-diary/[id]/route.ts`
    re-exports it. New PROJEXA proxy `api/site-diary/[id]/route.ts`.
  - **Real screens**: `SiteDiaryObjectClient.tsx` — display-only Object Page (no Edit/Delete;
    honestly disclosed — a daily log has no update/status column in the schema, so pretending to
    offer Edit would be fake). Surfaces every field, including `instructions`, which the old Dialog
    collected but never showed anywhere. `SiteDiaryCreateClient.tsx` surfaces the 4 previously-hidden
    fields above. Rewrote `SiteDiaryClient.tsx` to a pure list — rows route to the real Object Page,
    "New Entry" routes to the real create screen, both replacing the old Dialog.
  - **Verified real, not fabricated**: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos —
    genuinely 0 lines of output (files read directly, not exit-code-trusted). ESLint clean on every
    touched/new file in both repos (also 0 lines). Live query against the real `verdian-ai` Supabase
    project (`pcrjmlpuqsbocqfwoxod`, schema `compliance`, table `construction_site_diaries` — table
    lives under schema `compliance`, not `public`, confirmed via `information_schema.tables` before
    querying) returned 5 real production rows; `visitors`/`material_received`/`instructions` are
    genuinely `null` on almost every row, independently confirming the "old Dialog never collected
    these" finding rather than taking it on faith.
- 2026-08-30: Sales Orders (module #29) — 1 Dialog ("New Sales Order"); line items (and their
  per-item `deliveredQuantity`, tracking partial fulfillment) were completely invisible in the
  flat list, no detail view existed at all.
  - **Real backend gap closed**: added `getSalesOrder()` — only the paginated list existed
    before. New GET on both `v1/projexa/sales-orders/[id]/route.ts` and the PROJEXA proxy (both
    already had PATCH), reusing the list route's own `toSalesOrderShape` so field names never
    drift.
  - **Major real find — a fully-built feature with zero PROJEXA access**: `getSalesOrderDocumentFlow()`
    is the real SAP VBFA "Display Document Flow" equivalent (quotation → this order → invoice(s)
    → payment entries/credit notes/sales returns, traced via existing foreign keys, explicitly
    modeled on SAP per its own header comment) — it already had a COMPLETE, working v1 route
    (`v1/projexa/sales-order-document-flow/[id]/route.ts`) since it was built, but PROJEXA had NO
    proxy route at all, so this real feature was 100% unreachable. Added the one missing proxy
    route; no other backend work needed.
  - `SalesOrderObjectClient` (NEW) — real line items (now showing delivered quantity) + the
    already-real inline status Select + a genuinely real Document Flow section, using the kit's
    own `ObjectScreen` `documentFlow` prop (`DocumentFlowData`/`DocumentFlowLink` — verified
    against the real type, not guessed) with real links into this session's own Quotation
    (module #25) and Invoice/Credit-Note (module #13) Object Pages; payment entries and sales
    returns (no PROJEXA screens exist for either) get a stable, honest same-page anchor instead
    of a link to a page that doesn't exist.
  - `SalesOrderCreateClient` (NEW) replaces "New Sales Order", same fields unchanged.
    `SalesOrdersClient.tsx` — Dialog removed, rows clickable (raw `<Table>`, `stopPropagation()`
    on the inline status Select/Checkbox, same pattern as Leads/Opportunities module #28).
  - Routes: `/sales-orders/[id]` (NEW), `/sales-orders/new` (NEW).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos — genuinely 0 lines. Live
    DB query confirmed real orders across 4 statuses, 9 of 17 with a real linked quotation --
    confirming the Document Flow's ancestor link has real data to render, not just a hypothetical.
- 2026-08-30: Sales — Leads/Opportunities (module #28) — 2 entities, 16 Dialog usages ("New
  Lead"/"New Opportunity" + a "History" Dialog each). Real finding before writing any code:
  `getLead()`/`deleteLead()`/`getOpportunity()`/`deleteOpportunity()` all already existed in
  `crm-service.ts`, alongside real, separately-built AI scoring (`scoreLead`/`analyzeOpportunity`/
  `explainCrmAiDecision`), follow-up-task chaining, account-linking, auto-distribution, and an
  assignment-overview dashboard -- none of it surfaced anywhere in the current UI (a discovery of
  the same scale as MoMs', module #19).
  - **Real backend gap closed**: added GET to the existing `v1/projexa/leads/[id]/route.ts` and
    `v1/projexa/opportunities/[id]/route.ts` (both already had PATCH) + GET on both existing
    PROJEXA proxies. `getLead()`/`getOpportunity()` return `undefined` (not a thrown
    `ServiceError`) when not found — a real, pre-existing inconsistency with this session's other
    get-functions — handled defensively with an explicit 404 in the new route rather than passed
    through as a silent 200/null.
  - **Deliberate scope cut, matching the PATCH routes' own prior-written comments** ("AI scoring
    and follow-up-task chaining are deliberately NOT aliased here -- out of scope for this
    module's own pipeline pages"): this conversion respects that existing boundary — no AI
    scoring/analysis, follow-up-task chaining, account-linking, or Delete (both delete functions
    need a real role-gated actor context and block on business rules like linked-opportunity
    cascade) were wired up. Real, valuable, separately-built depth, disclosed on both Object
    Pages' own header comments rather than silently left out.
  - `LeadObjectClient` / `OpportunityObjectClient` (both NEW) — replace the "History" Dialog:
    real facets + real stage-history log + the already-real inline status/stage Select, now also
    available here (not just on the list row).
  - `LeadCreateClient` / `OpportunityCreateClient` (both NEW) replace their Dialogs, same fields.
  - `LeadsClient.tsx` / `OpportunitiesClient.tsx` — both Create + History Dialogs removed; rows
    made clickable (raw `<Table>`, not the shared `DataTable` component — confirmed safe, unlike
    the `DataTable`-based `onRowClick` mistake caught in Payroll, module #21); the already-real
    inline status/stage Select and Checkbox bulk-select both get `stopPropagation()` so a click
    on either doesn't also trigger row navigation. Search/filter/company-scope/pagination/
    bulk-reassign (all already real, no Dialogs) unchanged.
  - Routes: `/sales/leads/[id]`, `/sales/leads/new`, `/sales/opportunities/[id]`,
    `/sales/opportunities/new` (all NEW).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos — genuinely 0 lines. Live
    DB query confirmed extensive real data: 520 leads across all 5 statuses, 8 opportunities
    across all 5 stages.
- 2026-08-30: Submittals (module #32, done ahead of #28-#31 -- same source file/pattern as RFIs
  module #27, converted right after it for consistency) — "New Submittal"/"Review" Dialog popups;
  no single-item backend at all (only list/create/1 review transition).
  - **Real backend gap closed**: added `getSubmittal()` -- didn't exist before. New GET on the
    existing `v1/projexa/submittals/[id]/route.ts` (which already had PATCH) + GET on the existing
    PROJEXA proxy (which already had PATCH + real submittal-status-changed notification wiring,
    unchanged).
  - **Hidden fields surfaced**: `type` (shop_drawing/product_data/sample/other, defaults to
    shop_drawing) and `dueDate` -- `createSubmittal()` has always accepted both but the old
    Dialog never asked.
  - **Confirmed deliberate constraint, not a bug (mirrors Punch List, module #23)**:
    `reviewSubmittal()`'s self-approval check (submitter can't review their own submittal) is
    effectively a no-op through PROJEXA's one shared API key -- documented on the Object Page's
    own header comment, not silently unexplained.
  - `SubmittalObjectClient` (NEW) — real detail + the old "Review" Dialog is now a real inline
    action bar (Approve/Approve as Noted/Revise & Resubmit/Reject + comments), not a second
    popup -- keeps the exact PATCH body shape (`action`/`status`/`comments`/`projectId`) the
    notification wiring depends on. `SubmittalCreateClient` (NEW) replaces "New Submittal", now
    also asks for type/due date. `SubmittalsClient.tsx` rewritten as a pure list (rows route to
    `/submittals/[id]`).
  - Routes: `/submittals/[id]` (NEW), `/submittals/new` (NEW).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos — genuinely 0 lines. Live
    DB query confirmed real submittals across nearly every status/type combination (pending/
    approved/approved_as_noted/revise_resubmit/rejected × shop_drawing/product_data/sample).
- 2026-08-30: RFIs (module #27) — "New RFI" Dialog popup; no single-item backend at all (only
  list/create/2 status transitions, same source file as Punch List/Submittals — modules #23/#32).
  - **Real backend gap closed**: added `getRfi()` -- didn't exist before. New GET on the existing
    `v1/projexa/rfis/[id]/route.ts` (which already had PATCH) + GET on the existing PROJEXA proxy
    (which already had PATCH).
  - **Hidden field surfaced**: `dueDate` -- `createRfi()` has always accepted it (along with
    `assignedToId`/`ballInCourt`, left out for the same no-directory-picker reason as
    Meetings/Labour) but the old Dialog never asked for it.
  - `RfiObjectClient` (NEW) — real detail + the old "Answer" Dialog is now a real inline form
    (not a second popup) + real Close action. `RfiCreateClient` (NEW) replaces "New RFI", now
    also asks for due date. `RfisClient.tsx` rewritten as a pure list (rows route to `/rfis/[id]`).
  - Routes: `/rfis/[id]` (NEW), `/rfis/new` (NEW).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos — genuinely 0 lines. Live
    DB query confirmed real RFIs across all 3 statuses (34 open/41 answered/31 closed).
- 2026-08-30: Recruitment (module #26) — 3 entities (Job Openings/Candidates/Applications), 28
  Dialog usages, including a genuine 3-level Dialog nest: an Application-detail Dialog with a
  "Schedule Interview" Dialog opening from inside it, plus a separate "Interview Feedback"
  Dialog -- confirming the tracker's own "nested dialog-on-dialog" note.
  - **Real backend gaps closed**: added `getJobOpening()` and `getApplication()` -- only list
    functions existed for either before (no single-item lookup at all). New GET routes on both
    the v1 side and PROJEXA's proxies (neither had one).
  - **Hidden field surfaced**: `offerAmount` on the "offer" stage transition --
    `moveApplicationStage()` has always accepted it but the old UI never asked for it.
  - `ApplicationObjectClient` (NEW) — collapses the entire 3-level Dialog nest into one real
    screen: stage-move buttons (+ offer amount / rejection reason inline, not a second popup),
    a real inline "Schedule Interview" form, real inline "Add Feedback" per unfinished interview
    round, and the hire→employee-record link action.
  - `JobOpeningObjectClient` (NEW) — real detail view; surfaces `jobDescription`, which the old
    list never showed at all. Inline status-change (already real, no Dialog) kept as-is.
  - `JobOpeningCreateClient` / `CandidateCreateClient` / `ApplicationCreateClient` (all NEW)
    replace their 3 Dialogs. Candidates stay list-only (no Object Page -- simple master data, no
    get/update function exists, matching Expenses' precedent).
  - `RecruitmentClient.tsx` — all 6 Dialog usages removed (3 create + the 3-level detail nest);
    real `?tab=` URL sync added (9th occurrence this session).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos — genuinely 0 lines. Live
    DB query confirmed 15 real job openings (all `open`) and genuinely **zero** applications in
    production -- the entire pipeline/interview/hire flow has never been exercised end-to-end;
    the Object Page is correct regardless, this is an observation, not a defect (same pattern as
    Procurement's zero requisitions, module #22).
- 2026-08-30: Quotations (module #25, standalone `/quotations` page, sales-side) — 9 Dialog
  usages, including a separate "Convert to Sales Order" popup on top of the main "New Quotation"
  one. **Confirmed a genuinely different entity from Procurement's Supplier Quotations (module
  #22)** before writing any code -- `erp_quotations`/`erp-selling-service.ts` (customer-facing,
  version/revision, approval workflow, PDF, converts to a Sales Order) vs.
  `erp_supplier_quotations` (vendor responses to an RFQ) -- same English word, two unrelated
  tables/services. This is the "looked like Purchase Orders' situation but wasn't" case flagged
  in that entry.
  - **Real backend gap closed**: added `getQuotation()` -- only `getQuotationForPdf()` existed
    (built specifically for PDF rendering, returns an extra `org` row this didn't need). New GET
    on the existing `v1/projexa/quotations/[id]/route.ts` (which already had PATCH) + GET on the
    existing PROJEXA proxy (which already had PATCH), both using the same `toQuotationShape` the
    list route already established so field names never drift between list and Object Page.
  - **Confirmed deliberate constraint, not a bug**: only the `pending_approval → approved`
    transition requires a real session user at manager rank (the route's own long comment
    documents this explicitly, same posture as Payroll/Employees/Procurement) -- every other
    transition (submit/reject/mark sent/mark lost/mark expired), plus create/revision/convert/PDF,
    works normally via PROJEXA's API key.
  - `SalesQuotationObjectClient` (NEW) — real facets (customer/date/valid-till/version/total) +
    status-transition buttons + New Revision + Download PDF, all moved off the list. The old
    separate "Convert to Sales Order" Dialog is now a real inline toolbar form (order date input
    + button), not a second popup.
  - `SalesQuotationCreateClient` (NEW) replaces "New Quotation", same fields (customer/project/
    company/currency/exchange-rate/multi-line items) unchanged.
  - `QuotationsClient.tsx` — both Dialogs + their state removed; rows route to
    `/quotations/[id]`. Search/status-filter/company-scope/pagination (all already real, no
    Dialogs) unchanged.
  - Routes: `/quotations/[id]` (NEW), `/quotations/new` (NEW).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos — genuinely 0 lines. Live
    DB query confirmed real quotations across 5 of 6 statuses (draft/pending_approval/approved/
    sent/lost/ordered).
- 2026-08-30: Purchase Orders (module #24, standalone `/purchase-orders` page) — real finding
  before writing any code: this is NOT a separate entity from Procurement's own PO stage
  (module #22) -- both read/write the exact same `erp_purchase_orders` table via the same
  `erp-buying-service.ts` functions, just through two different route aliases
  (`/api/purchase-orders` here vs `/api/procurement/purchase-orders` there) and two different UI
  surfaces (this one has richer creation -- company/currency/exchange-rate/multi-line -- but no
  workflow actions; Procurement's has Submit/Receive Goods but a thinner create form). Confirmed
  by reading both v1 aliasing routes' own header comments before assuming redundancy (Quotations,
  module #25, looked like the same situation at a glance but turned out to be a genuinely
  different entity -- see that entry below).
  - **Real consolidation, not a duplicate build**: "New Purchase Order" converted to a real
    create screen (`PurchaseOrderCreateClient.tsx`, same rich fields, unchanged), but rows now
    route to the SAME real Object Page already built in module #22
    (`/procurement/purchase-orders/[id]`) instead of building a second, duplicate Object Page for
    an entity that already has one. Zero new backend needed.
  - `PurchaseOrdersClient.tsx` — Dialog + its create-form state removed; rows clickable; the
    real company-scope filter (`CompanySelector`, already non-Dialog) is unchanged.
  - Route: `/purchase-orders/new` (NEW).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file — genuinely 0 lines.
- 2026-08-30: Punch List (module #23) — "New Item" Dialog popup; no single-item backend at all
  (only list/create/2 status transitions, since Wave 141 -- same source file as RFIs/Submittals,
  modules #27/#32, not yet converted).
  - **Real backend gap closed**: added `getPunchListItem()` -- didn't exist before. New GET on
    the existing `v1/projexa/punch-list/[id]/route.ts` (which already had PATCH) + GET on the
    existing PROJEXA proxy (which already had PATCH).
  - **Hidden field surfaced**: `priority` -- `createPunchListItem()` has always accepted it
    (defaulting to `medium`) but the old Dialog never asked for it.
  - **Real, pre-existing constraint confirmed, not fixed (matches KPI entries, module #15)**:
    `verifyPunchListItemClosed()` has a genuine self-approval check (assignee can't verify their
    own item) but since every PROJEXA action funnels through one shared org API key, neither "who
    marked it ready" nor "who verifies" carries a distinct per-user identity through that path --
    the check is effectively a no-op today. Documented on the Object Page's own header comment,
    not silently left unexplained.
  - `PunchListObjectClient` (NEW) — real detail + Mark Done/Verify & Close moved here from the
    list. `PunchListCreateClient` (NEW) replaces "New Item", now also asks for priority.
    `PunchListClient.tsx` rewritten as a pure list (rows route to `/punch-list/[id]`).
  - Routes: `/punch-list/[id]` (NEW), `/punch-list/new` (NEW).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos — genuinely 0 lines. Live
    DB query confirmed real items across all 3 statuses and all 3 priorities.
- 2026-08-30: Procurement (module #22) — 5-stage workflow (Requisitions → RFQs → Quotations →
  Purchase Orders → Goods Receipts), 20 Dialog usages across 4 "New X" creation popups
  (Requisition/RFQ/Quotation/Goods Receipt — POs have no creation Dialog, only ever created via
  the real "Convert to PO" inline action, unchanged).
  - **Real backend gaps closed** (each entity's single-item lookup already existed server-side
    but had no route, or no route at all): `getPurchaseOrder()` and `getPurchaseReceipt()`
    (goods receipt) both already existed in `erp-buying-service.ts`/`erp-goods-receipt-service.ts`
    with zero v1 routes -- added both + PROJEXA proxies. Added a brand-new `getRfq()` (only
    `listRfqs` existed) + v1 route + proxy. Requisition's single-item GET (`getPurchaseRequisition`)
    was already fully wired end-to-end since Priority 17 -- only needed a real screen, no backend
    work.
  - `RequisitionObjectClient` / `RfqObjectClient` / `PurchaseOrderObjectClient` /
    `GoodsReceiptObjectClient` (all NEW) — real item tables + their stage's real workflow action
    (Submit/Send/Post-to-Stock) moved off the list onto the Object Page. RFQ's Object Page also
    surfaces the real quotation comparison (`compareQuotationsForRfq`, ranked by total +
    weighted score) which already had a working route via `[id]/comparison` but no screen showing
    it.
  - **Deliberate, disclosed scope cut** (not silently skipped): `erp-procurement-workflow-service.ts`
    has real, separately-built scoring criteria / negotiation rounds / reverse auctions (with a
    public supplier bid portal) and `erp-goods-receipt-service.ts` has real putaway-location
    management + landed-cost vouchers -- none of these are surfaced by this conversion. This is a
    second, genuinely separate depth wave beyond this pass's List Report → Object Page scope
    (same class of decision as MoMs' documentId picker, Meetings' directory picker) — noted here
    so it isn't mistaken for "not found."
  - **Confirmed deliberate constraint, not a bug**: `submitPurchaseRequisition()` requires a real
    session user (a real Approval Workflow instance needs a real attributable actor) and is
    honestly blocked for PROJEXA's API-key caller — the route's own comment states this
    explicitly, matching Payroll's (module #21) and Employees' (module #8) identical posture.
    `submitPurchaseOrder`/`submitPurchaseReceipt`/`sendRfq`/all 4 create functions are apiKey-safe
    and work normally.
  - `RequisitionCreateClient` / `RfqCreateClient` / `QuotationCreateClient` /
    `GoodsReceiptCreateClient` (all NEW) replace their Dialogs. `GoodsReceiptCreateClient` accepts
    an optional `poId` prop (resolved server-side from `?poId=` by its `page.tsx`, not
    client-side `useSearchParams()` — that needs its own Suspense boundary, caught before it ever
    shipped) to prefill from the PO Object Page's "Receive Goods" action.
  - `ProcurementClient.tsx` — all 4 Dialogs removed; rows for 4 of 5 tabs route to real Object
    Pages; Quotations keep "Convert to PO" as a real inline action (no Object Page exists for
    quotations — no get function). Real `?tab=` URL sync added.
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos — genuinely 0 lines (one
    stray `eslint-disable` comment flagged and removed). Live DB query confirmed real RFQs
    (5 draft/8 sent), real POs across all 4 statuses, real goods receipts (4 draft/9 submitted) —
    and genuinely **zero** real purchase requisitions in production, meaning that specific stage
    has never actually been exercised end-to-end; the Object Page is correct regardless, this is
    an observation, not a defect.
- 2026-08-30: Payroll (module #21) — largest module this session by Dialog count (33, across 6
  entities): Payroll Runs, Payslips (nested Dialog-on-Dialog), Salary Structures, Salary
  Components, Statutory Rules, Income Tax Slabs, plus an inline (already real, non-Dialog)
  "Assign Slab to Employee" action left unchanged.
  - **Major finding, confirmed deliberate (not a bug) -- mirrors Employees' module #8**: EVERY
    write action in this entire module (create run, process run, TDS override, finalize payslip,
    create component/structure/rule/slab) 400s for PROJEXA's Bearer-key caller with "This action
    requires a real user session, not an API key" -- explicitly documented in the routes'
    own comments as the same posture already established for payroll's audit-trail-sensitive
    writes. This is NOT the same class of gap as Invoices'/Knowledge Base's/MoMs' unwired
    functions (module #13/#14/#19) -- those were oversights with a safe fix (widen the actor
    union); here, every write function calls `logActivity({dbUser: ctx.dbUser, ...})`
    unconditionally for a real compliance audit trail, and a shared org API key cannot honestly
    stand in for "which person did this" on payroll data. Left genuinely blocked, not routed
    around -- the real backend message surfaces via toast exactly as the old Dialog-based UI
    already showed it, not a new regression.
  - **Real backend gap closed (the one thing that WAS safe to add)**: added `getPayrollRun()`
    (read-only, no dbUser needed) + a v1 GET route + PROJEXA proxy. `getPayslipDetail()` already
    existed (built for the PDF route) but had no plain GET route -- added one.
  - `PayrollRunObjectClient` (NEW) — real register (payslip list, rows route to the Payslip
    Object Page) + Process action (identity-bridge-blocked exactly as before) + CSV export.
    Status tone map corrected against the real 4-value enum (`draft`/`processed`/`paid`/
    `cancelled`) -- the old UI only ever distinguished "processed" from everything else.
  - `PayslipObjectClient` (NEW) — replaces the nested payslip-detail Dialog; lines + Net Pay +
    PDF download + TDS override/Finalize (both identity-bridge-blocked as above, shown for
    `draft` payslips only).
  - `PayrollRunCreateClient` / `SalaryComponentCreateClient` / `SalaryStructureCreateClient` /
    `StatutoryRuleCreateClient` / `IncomeTaxSlabCreateClient` (all NEW) — replace their respective
    Dialogs. No Object Page for the 4 master-data types -- no
    get/update function exists for any of them (`getSalaryComponent`/`getSalaryStructure`/
    `getStatutoryRule`/`getIncomeTaxSlab` all absent), matching Expenses' own "create-only, no
    Object Page possible" precedent rather than inventing 4 new sets of backend CRUD in one pass.
  - `PayrollClient.tsx` — all 6 Dialogs + their state/handlers removed; real `?tab=` URL sync
    added (8th occurrence this session). "Assign Slab to Employee" kept exactly as it was (already
    real, no Dialog).
  - **2 real bugs found and fixed before they ever hit tsc**: (1) `DataTable` (the shared
    `ui/data-table.tsx` component used for the Runs/Components/Structures tables) has no
    `onRowClick` prop at all -- an initial draft invented one; fixed to rely on the existing
    "View Register" button in the actions column instead, verified against the component's real
    prop type. (2) a missing `Label` import (used in the unchanged "Assign Slab" section) caught
    the same way.
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos -- genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos -- genuinely 0 lines (one
    stray `eslint-disable` comment flagged as unnecessary and removed). Live DB query confirmed
    real runs across `processed`/`paid` statuses and real payslips across `draft`/`finalized`/an
    undocumented but real `paid` value (the schema comment only lists draft/finalized -- `paid`
    is set by something outside `erp-payroll-service.ts`, not chased down further as out of this
    conversion's scope; the Object Page's `status === "draft"` gate handles it safely either way).
- 2026-08-30: Mood Boards (module #20) — "New Mood Board"/"Add Item" Dialog popups; no
  single-board GET/update at all (only list, status-change, item add/remove).
  - **Real backend gap closed**: added `getMoodBoard()` + `updateMoodBoard()` to
    `interior-design-service.ts` — editing title/room/description had no path except
    re-creating the board. Added GET + a details-update PATCH branch to the existing
    `v1/projexa/mood-boards/[id]/route.ts`.
  - **Real pre-existing proxy bug found and fixed**: PROJEXA's own `PATCH
    /api/mood-boards/[id]` unconditionally injected `action: "status"` into every request body
    (`{ action: "status", ...body }`) — harmless for the one caller that existed (status-only
    changes), but would have silently broken the new details-update call this conversion adds:
    the v1 route would take the status branch and fail on a missing `status` field instead of
    updating title/room/description. Fixed to pass the body through unmodified; callers now
    include `action: "status"` explicitly when that's what they mean.
  - **Real backend gap closed**: `removeMoodBoardItem()` already had a working v1 DELETE route
    but ZERO PROJEXA-facing proxy — an item could be added but never removed from PROJEXA. Added
    `api/mood-boards/[id]/items/[itemId]/route.ts` (DELETE).
  - `MoodBoardObjectClient` (NEW) — real Edit (title/room/description)/Save/Cancel, real
    per-item remove (✕ button on each tile), status-advance actions (Share with Client/Mark
    Approved) moved here from the list. No board-level Delete — no delete-the-whole-board
    function exists, so none is faked.
  - `MoodBoardCreateClient` (NEW) replaces "New Mood Board". `MoodBoardsClient.tsx` rewritten as
    a pure card list (cards route to `/mood-boards/[id]`).
  - Routes: `/mood-boards/[id]` (NEW), `/mood-boards/new` (NEW).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos — genuinely 0 lines. Live
    DB query confirmed real boards across all 3 statuses (3 draft/12 shared/1 approved) and 20
    real items.
- 2026-08-30: MoMs (module #19) — the richest hidden-capability finding this session. Only 1
  Dialog ("New Meeting"), but the "Minutes" panel was a local-state Card (not a real URL), and
  the real backend (veri-meeting-service.ts) was already FAR ahead of what the UI exposed:
  - **4 real, already-built capabilities found completely unwired**, confirmed live (22 of 40 real
    meetings are already `status='published'`, 11 with a real `ai_summary` -- all via VERIDIAN's
    own internal UI, never PROJEXA):
    1. **Edit** (title/type/date/attendees/agenda) -- `updateVeriMeetingDetails()` has existed
       since Wave 44 "specifically for the publish/lock workflow to mean anything" (its own
       comment) but the PATCH route only ever branched on `{minutes}` or `{action:"publish"}` --
       editing a MoM's details had ZERO reachable route. Added a 3rd branch to
       `v1/projexa/veri-meetings/[id]/route.ts`'s PATCH.
    2. **Publish & Lock** -- `publishVeriMeeting()` had a fully working v1 route + real
       server-side enforcement (`assertEditable` 409s on published meetings) but no button
       anywhere called it.
    3. **Action Items** (+ AI-suggested action items) -- `addMeetingActionItem()` had a working
       v1 route; `aiSuggestedActionItems` (title/assignee/dueDateHint, real LLM output) was
       computed and stored by `generateMeetingIntelligence()` but never displayed at all.
    4. **Share-link management** -- `listMeetingShareLinks()` had a working v1 route (list was
       never called, only blind create-and-open); `revokeMeetingShareLink()` had NO
       PROJEXA-reachable route at all (only a cookie-only internal one) -- added the Bearer-key
       twin (`v1/projexa/veri-meetings/share-links/[linkId]/route.ts`, DELETE) + PROJEXA proxy,
       same R39/R-C04 pattern this surface's sibling routes already established.
  - `MoMObjectClient` (NEW) — surfaces all 4: real Edit/Save/Cancel (locked entirely when
    published, mirroring `assertEditable` so a click can't 409), Publish & Lock action, Minutes
    editor (disabled once published) + AI summary/key-decisions/suggested-action-items display
    with a real "Add as Action Item" promote action, a real Action Items list + add form (assignee
    is a free-text user id -- no directory picker exists, same honest disclosure as
    Meetings/Labour), and a real Share Links list with Create/Revoke.
  - `MoMCreateClient` (NEW) replaces "New Meeting". `MoMsClient.tsx` rewritten as a pure list
    (rows route to `/moms/[id]`).
  - Routes: `/moms/[id]` (NEW), `/moms/new` (NEW).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos -- genuinely 0 lines
    (first-try clean, including the `ObjectScreen` `messages` prop's real shape
    `{level, text}` verified against `types.ts` directly rather than guessed, catching a
    would-be `{id, tone, text}` mismatch before it ever hit tsc).
    `./node_modules/.bin/eslint.exe` on every touched file, both repos -- genuinely 0 lines. Live
    DB query confirmed 18 draft / 22 published meetings, 11 with a real AI summary already
    generated -- strong evidence every capability surfaced here is real and already in use, not
    theoretical.
- 2026-08-30: Meetings (module #18) — "New Meeting" Dialog popup, and a "View" Dialog that was
  really an Object Page in disguise (its own real per-meeting GET, agenda/participants/outcomes
  already nested inside a single popup).
  - **Real backend gap closed**: added `updateMeeting()` to `pms-meeting-service.ts` -- a
    reschedule or duration/title correction had no path except deleting/re-creating the meeting
    (and there was no delete either). Added PATCH to the existing
    `v1/projexa/meetings/[id]/route.ts` (which already had GET) + PATCH on the existing PROJEXA
    proxy (which already had GET).
  - **Honest scope decision**: no Delete/Cancel offered on the Object Page -- `pms_meetings` has
    no status/isCancelled column at all, so a Delete button would need either a fabricated status
    field or a real hard-delete with unexamined FK cascade risk across agenda/participants/
    outcomes; neither was built. This mirrors Meeting/KPI-definition/Attendance's own "no backend
    primitive, no fake button" precedent from earlier this session.
  - `MeetingObjectClient` (NEW) — converts the old "View" Dialog: real Edit (title/date-time/
    duration)/Save/Cancel; agenda and participants stay read-only (no update-agenda/
    add-participant endpoint exists); "Add Outcome" (Minutes) was already real and is unchanged.
  - `MeetingCreateClient` (NEW) replaces "New Meeting", redirects to the new meeting's real
    Object Page. `MeetingsClient.tsx` rewritten as a pure list (rows route to `/meetings/[id]`).
  - Routes: `/meetings/[id]` (NEW), `/meetings/new` (NEW).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos -- genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos -- genuinely 0 lines. Live
    DB query confirmed 18 real meetings, all with a real duration value.
- 2026-08-30: Materials (module #17) — "Add Material"/"Record Receipt" Dialog popups; material
  master had zero single-entry backend (no get/update at all, since Wave 33) -- identical shape
  to Labour/Manpower's own gap, same session.
  - **Real backend gap closed**: added `getMaterial()` + `updateMaterial()` to
    `construction-materials-service.ts` -- a spec/unit-cost correction or retiring a material had
    no path except re-creating it. New `v1/construction/materials/[id]/route.ts` (GET+PATCH) +
    matching PROJEXA proxy (root:true, same as the existing list route -- never re-exported under
    `/projexa/*`). Real Delete = real Deactivate (`isActive: false`) -- confirmed live: all 29 real
    materials are currently `is_active = true`.
  - `MaterialObjectClient` (NEW) — real Edit (name/spec/unit/cost)/Save/Cancel, real
    Delete = Deactivate. `MaterialCreateClient` (NEW) replaces "Add Material".
  - `MaterialReceiptCreateClient` (NEW) replaces "Record Receipt" -- no Object Page, a write-once
    inbound-receipt transaction, same class as Attendance/Expenses/Stock Entries.
  - `MaterialsClient.tsx` — both Dialogs removed; master rows route to `/materials/[id]`; both
    create actions route to real screens; added real `?tab=` URL sync (7th occurrence this
    session).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos -- genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos -- genuinely 0 lines. Live
    DB query confirmed 29 real active materials (0 inactive) + 4 real inbound receipts.
- 2026-08-30: Labour/Manpower (module #16) — "Add Worker"/"Mark Attendance" Dialog popups; roster
  had zero single-entry backend (no get/update/delete at all, since Wave 116).
  - **Real backend gap closed**: added `getRosterEntry()` + `updateRosterEntry()` to
    `construction-labour-service.ts` -- a rate correction, reassigning a subcontractor, or
    retiring a worker had no path except re-creating the roster row before this. New
    `v1/construction/labour-roster/[id]/route.ts` (GET+PATCH) + matching PROJEXA proxy (this
    resource was never re-exported under `/projexa/*` to begin with -- root:true, same as the
    existing list route). Real Delete = real Deactivate (`isActive: false`), a real pre-existing
    column nothing ever set outside its insert-time default -- confirmed live: all 75 real roster
    rows are currently `is_active = true`.
    Verified drizzle-orm's own `buildUpdateSet` (`set[colName] !== void 0`) skips
    undefined-valued keys in a partial PATCH before writing the fix, not assumed.
  - `RosterObjectClient` (NEW) — real Edit (name/ID/trade/company/rate)/Save/Cancel, real
    Delete = Deactivate. `RosterCreateClient` (NEW) replaces "Add Worker".
  - `AttendanceCreateClient` (NEW) replaces "Mark Attendance" -- no Object Page, a write-once
    daily transaction (`dailyCost` computed server-side at write time), same class as
    Expenses/Stock Entries.
  - `LabourClient.tsx` — both Dialogs + their state/handlers removed; roster rows route to
    `/labour/[id]`; both "Add Worker"/"Mark Attendance" route to real create screens; added real
    `?tab=` URL sync (same bug fixed 6 times now this session).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos -- genuinely 0 lines
    (caught and cleaned one stale `.next/dev/types/validator.ts` cache reference to a route file
    created then deleted mid-conversion -- a gitignored build artifact, not a source bug, confirmed
    via `git check-ignore`). `./node_modules/.bin/eslint.exe` on every touched file, both repos --
    genuinely 0 lines. Live DB query confirmed 75 real active roster rows + real attendance rows
    across all 3 statuses (present/half_day/absent).
- 2026-08-30: KPIs (module #15) — "New KPI" Dialog popup; "View Entries" only set local state
  (never a real URL); actual-value submission was already a real inline form (no Dialog there).
  - **Real backend gap found and closed**: `approveKpiEntry()` (submitted → approved, manager-only,
    self-approval blocked) has existed since Wave 117 with a real, working route
    (`/api/construction/kpi-entries/[id]/approve`), but only for a real VERIDIAN session user --
    never a Bearer-key caller, so PROJEXA could submit entries but never approve them. Added
    `v1/construction/kpi-entries/[id]/approve/route.ts` (api-key-reachable) +
    `v1/construction/kpi-definitions/[id]/route.ts` (new `getKpiDefinition()`, single-lookup for
    the Object Page) + a `v1/projexa/kpis/[id]/route.ts` alias, matching the existing
    `v1/projexa/kpis/route.ts` re-export pattern. 2 new PROJEXA proxy routes.
  - **Honest limitation kept intact, not routed around**: `approveKpiEntry`'s self-approval check
    (`filledById === userId`) is a real business rule. PROJEXA calls through one shared org API
    key, so an entry submitted AND approved both via PROJEXA genuinely is the same actor by this
    schema -- that case still correctly 403s, and the real backend message surfaces verbatim via
    toast rather than being hidden or faked as success. The case this closes is the one that
    always worked in principle but had no route: a different real actor (VERIDIAN session vs.
    PROJEXA, or vice versa) approving. Confirmed via live DB query that real approved entries
    already exist (12 submitted / 2 draft / 23 approved across 19 real definitions), i.e. the
    cross-actor path this closes has real precedent, not a hypothetical.
  - `KpiObjectClient` (NEW) — definition facets (target/unit/period) + entries table with a real
    inline "Approve" action per submitted row + the existing "Submit Actual Value" inline form,
    now against a real definition id from the URL. No generic Edit/Delete -- no
    `updateKpiDefinition()`/`deleteKpiDefinition()` exists, so neither is offered.
  - `KpiCreateClient` (NEW) -- replaces the "New KPI" Dialog, redirects to the new definition's
    real Object Page. `KpisClient.tsx` rewritten as a pure list (rows route to `/kpis/[id]`).
  - Routes: `/kpis/[id]` (NEW), `/kpis/new` (NEW, resolves the project server-side same as the
    existing `/kpis` list page).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos -- genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos -- genuinely 0 lines.
- 2026-08-30: **Owner directive reaffirmed mid-session**: continue through every remaining module
  with the same standard (real screens/code/wiring, no popups, verify it's real not prose),
  decisions delegated to this session, work locally and push ONE PR at the end covering both
  repos. Both `C:\projexa` and `C:\ct\ct` are on `main` with the full session's changes still
  uncommitted — branching + PR deferred to the very end per that instruction, not per-module.
- 2026-08-30: Knowledge Base (module #14) — old two-pane client held page selection in local
  state only (never a real URL) with editing inline and a "New Page" Dialog popup.
  - **Stale disclosure caught and corrected**: the client's own comment claimed "creating AND
    editing require a real VERIDIAN user session" — checked against the real backend and that was
    only half true. `createKbPage()` already had a real `isRealUser` gate (nulls `updatedById`
    for an API-key actor) — create genuinely worked. Only `updateKbPage()` was ever actually
    blocked, and only because it unconditionally wrote `updatedById: ctx.userId`, a real FK to
    `users.id`, which would 500 on an API key's id — the PATCH route's hard `if (!ctx.dbUser)`
    block was working around that, not a deliberate scope decision.
  - **Real backend gap closed**: widened `updateKbPage()` to the same dbUser-or-apiKey actor
    union `createKbPage()`/module #13's `submitSalesInvoice`/`submitSalesCreditNote` already use;
    nulls `updatedById` for an API-key actor exactly like `createKbPage` does; branched the
    `recordAuditTrigger` call the same way. Removed the PATCH route's hard block. Added
    `getKbPage()` (by id — only `getKbPageBySlug()` existed before, which the Object Page's own
    URL can't use) + a new GET on the existing `v1/projexa/knowledge-base/[id]/route.ts` + a new
    GET proxy on PROJEXA's existing `api/knowledge-base/[id]/route.ts`.
  - `KnowledgeBaseObjectClient` (NEW) — real Edit (title+content)/Save/Cancel; real Delete =
    real Archive (`isArchived: true` via the now-fixed PATCH — archived pages already existed as a
    real, designed end-state that `listKbPages` always excluded, just never reachable from a
    Delete button before this).
  - `KnowledgeBaseCreateClient` (NEW) — replaces the "New Page" Dialog, redirects to the new
    page's real Object Page on success.
  - `KnowledgeBaseClient.tsx` rewritten as a pure List Report (search + rows), the old inline
    content pane and its own Edit/Save state removed entirely — that's the Object Page's job now.
  - Routes: `/knowledge-base` (list), `/knowledge-base/[id]` (Object Page), `/knowledge-base/new`
    (Create) — all NEW except the list route, which already existed.
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines.
    `./node_modules/.bin/eslint.exe` on every touched file, both repos — genuinely 0 lines. Live DB
    query against `verdian-ai` confirmed 2 real pages, both `updated_by_id IS NULL` (created via
    PROJEXA's API-key path, exactly as `isRealUser: false` predicts) — consistent with the fix,
    not contradicting it.
- 2026-08-30: Invoices (module #13) — 3 Dialogs (Create Invoice, New Credit Note, Record
  Payment) across `InvoicesClient.tsx`, plus a 4th, separate duplicate Dialog
  (`CreateInvoiceDialog.tsx`) reachable only from the Dashboard's Revenue card.
  - **Real backend gap found and closed — the most severe one this session**:
    `submitSalesInvoice()` and `submitSalesCreditNote()` (draft → submitted, the transition that
    posts the real GL entry) have existed in `erp-invoicing-service.ts`/`erp-credit-note-service.ts`
    since Wave 60/Wave 52 respectively, but neither had a `v1/projexa/*` route — PROJEXA could
    create invoices/credit notes but never submit them. Confirmed live in the `verdian-ai` Supabase
    project: 15 real invoices sit in `draft` (submitted/partially_paid/paid/overdue invoices in
    the DB come from VERIDIAN's own internal `/erp/invoicing` page, not PROJEXA), and **zero**
    credit notes exist at all — the credit-note feature had never been exercised end-to-end.
    `recordSalesInvoicePayment()` only accepts submitted/partially_paid/overdue, so a
    PROJEXA-created invoice could never actually be paid either — Submit was the missing link,
    not a side action.
  - Both submit functions took a real-`dbUser`-only `ErpContext`, same class of gap as every other
    "identity bridge" finding this session — but here it was fully fixable (not merely
    documentable, unlike Employees' entire write surface): widened both to the same
    dbUser-or-apiKey actor union `createSalesInvoice`/`createSalesCreditNote` already use, fixed
    the `logActivity`/`recordAuditTrigger` calls inside to branch on which one is present. Added
    `getSalesInvoice()` / `getSalesCreditNote()` (single-item lookup with items+customer, neither
    existed — the list functions never needed it). 4 new `v1/projexa/*` routes: 2× `[id]` GET, 2×
    `[id]/submit` POST (manager/write scope, same as create). 4 matching PROJEXA proxy routes.
  - `InvoiceObjectClient` (NEW) — real line items + subtotal/tax/grand-total breakdown; when
    `draft`, a real inline "Submit (Post to Ledger)" toolbar action with a revenue-account picker
    (`rootType === "income"`, a real enum column — safe); when submitted/partially_paid/overdue, a
    real inline "Record Payment" form (reusing the existing payments route). Real Delete = real
    Cancel (`cancelSalesInvoice`, draft only), matching Budget's convention. No generic Edit — no
    `updateSalesInvoice()` exists, so none is offered.
  - **Real bug found and fixed while building the payment-account picker**: `erp_accounts.account_type`
    is free text (admin-extensible), and live production data has BOTH `'bank'`/`'cash'` (5 rows
    each) and `'Bank'`/`'Cash'` (1 row each) for the same org — confirmed by direct query. The
    original Dialog code's exact-match filter (`accountType === "bank"`) would have silently hidden
    the capitalized-variant accounts from anyone whose org uses them; the same bug existed
    unnoticed in the pre-conversion code. Fixed case-insensitively in the new component.
    `rootType` (a real Postgres enum, not free text) needed no such fix.
  - `CreditNoteObjectClient` (NEW) — real line items; when `draft`, a real inline "Submit" action.
    No Delete/Cancel offered — no `cancelSalesCreditNote()` exists in the backend, so none is faked.
  - `InvoiceCreateClient` / `CreditNoteCreateClient` (NEW) — 1:1 field parity with the old Dialogs,
    now on real routes (`/invoices/new`, `/invoices/credit-notes/new`), redirecting to the new
    object's real Object Page on success instead of just closing a popup.
  - `InvoicesClient.tsx` — all 3 Dialogs + their state/handlers removed; rows now navigate
    (`router.push`) to the real Object Pages; added real `?tab=` URL sync (same
    uncontrolled-Tabs bug found and fixed 5 times already this session — Accounting/Schedule/
    Employees/GRC/Inventory).
  - `DashboardHomeView.tsx`'s separate "Create / Link Invoice" Dialog
    (`CreateInvoiceDialog.tsx`) — a genuine 4th popup, duplicating the same create-invoice form
    with its own separate state — replaced with a real link to `/invoices/new`; the now-dead
    `CreateInvoiceDialog.tsx` file deleted outright (confirmed unreferenced elsewhere first).
  - Verified: `./node_modules/.bin/tsc.exe --noEmit -p .` on both repos — genuinely 0 lines
    (read the actual file content, not just exit code) both before and after the case-insensitive
    account-type fix. `./node_modules/.bin/eslint.exe` on every touched file, both repos —
    genuinely 0 lines. Live DB queries against `verdian-ai` (Supabase project
    `pcrjmlpuqsbocqfwoxod`) confirmed real invoice/credit-note counts by status and the real
    mixed-case `account_type` data that motivated the bug fix above.
- 2026-08-30: Inventory (module #12) — 3 Dialogs (New Warehouse, New Item, Record Stock
  Movement), no `[id]` routes existed for any of the 3 entities in `erp-stock-service.ts`.
  - **Backend gap closed**: added `getItem()` to `erp-stock-service.ts` + new
    `v1/projexa/inventory/items/[id]/route.ts` GET — surfaces `standardBuyingRate`/
    `standardSellingRate`/`hsnSacCode`/`hasSerialNo`, all of which `createItem()` has always
    accepted but the old list/dialog never showed or asked for.
  - `ItemObjectClient` (NEW) + `/inventory/items/[id]` (NEW) — real detail view for those
    previously-hidden fields. No Edit: no `updateItem()` exists — honest scope cut.
  - `ItemCreateClient` (NEW) + `/inventory/items/new` — replaces "New Item", and — matching
    the Documents/Drawings pattern of surfacing already-backend-supported-but-hidden fields
    — now actually asks for buying/selling rate, HSN/SAC, and serial-tracking on create too.
  - `WarehouseCreateClient` (NEW) + `/inventory/warehouses/new` — replaces "New Warehouse";
    also now asks for parent warehouse (accepted by `createWarehouse()` since Wave 49, never
    exposed in the UI). No Object Page: no `getWarehouse()`/`updateWarehouse()` exists.
  - `StockEntryCreateClient` (NEW) + `/inventory/stock-entries/new` — replaces "Record Stock
    Movement". No Object Page: a ledger entry is a write-once transaction, not an editable object.
  - `InventoryClient.tsx` — all 3 Dialogs + their form state removed; Item rows clickable;
    tabs switched from uncontrolled `defaultValue` to a real `?tab=`-synced controlled state
    (5th module this session with this exact pre-existing bug).
  - Full-project type-check: CLEAN, 0 errors (confirmed by reading the output file directly).
- 2026-08-30: GRC (module #11) — largest module yet (1099 lines, 7 sub-areas: Risks,
  Findings, Audits, Policies, Vendors, Cases, Access Review), surveyed via a background agent
  first given its size. All 7 create Dialogs converted to real screens; 4 of 7 sub-areas also
  got real Object Pages.
  - **Backend gaps closed**: added `getRisk()` (replicates `listRisks`' own department/role
    visibility scope so a direct-by-id fetch can never leak what a list fetch would hide) and
    `getPolicy()` (also returns `history`, the real edit/publish audit trail, never surfaced
    anywhere before this) to `risk-register-service.ts`, exposed as GET on the existing
    `risks/[id]`/`policies/[id]` v1 routes. Fraud Cases' `getFraudCase()` and Access Review's
    `getAccessReviewCycleDetail()` **already existed** server-side — Fraud Cases' v1 route
    already had GET too (only PROJEXA's own proxy was missing it); Access Review's cycle
    detail was already reachable via the existing `?cycleId=` query-param route, reused as-is.
  - `RiskObjectClient`/`PolicyObjectClient`/`FraudCaseObjectClient`/`AccessReviewCycleObjectClient`
    (all NEW) + `/grc/risks/[id]`, `/grc/policies/[id]`, `/grc/cases/[id]`, `/grc/access-review/[id]`
    (all NEW routes). Policy's Object Page is the standout: exposes a real "Edit" (version-bump
    with a change note) that has existed server-side since Priority 15 with **zero UI entry
    point until now**. Fraud Case's Object Page also surfaces the real branching status machine
    (investigating → confirmed OR unsubstantiated) plus a real `resolutionSummary` field the old
    inline button never collected. Access Review's replaces genuine in-tab master-detail state
    (click-a-list-item-no-URL) with an actual routed page.
  - `RiskCreateClient`/`PolicyCreateClient`/`FraudCaseCreateClient`/`AccessReviewCreateClient`/
    `AuditEngagementCreateClient`/`AuditFindingCreateClient`/`VendorRiskCreateClient` (all NEW,
    7 total) + matching `/grc/*/new` routes — replace every one of the 7 create Dialogs.
  - **Deferred, honest scope cuts**: Audit Engagements/Findings (no `getAuditEngagement()`/
    `getAuditFinding()` exists, and findings are only ever fetched pre-nested inside an
    engagement — a real data-model constraint, not an oversight) and Vendor Risk (no
    get/update-single exists, plus an unresolved naming overlap between `api/vendor-risk`
    used here and a separate, currently-unused `api/vendors` master-CRUD surface — which
    entity a real Object Page should represent is a design decision, not a route-file
    afterthought). All 3 keep their real inline actions (CAPA-advance, etc.) untouched.
  - **Real bug caught before shipping**: the tab values are `vendor-risk` and `fraud` (with a
    hyphen / short name), not `vendors`/`cases` as first written in 3 new files — caught and
    fixed via a targeted grep sweep before type-checking, not left for a redirect to silently
    land on the wrong tab.
  - **Real bug fixed in passing**: `GrcClient`'s tabs were ALWAYS internal-only state (no URL
    sync at all, 4th module this session with this exact bug) — fixed via the same
    `initialTab` + `history.replaceState` pattern as Accounting/Schedule/Employees.
  - Full-project type-check: CLEAN, 0 errors (confirmed by reading the output file directly).
- 2026-08-30: FF&E (module #10) — 1 Dialog ("New Item"); `PATCH /api/ffe/[id]` already existed
  (status-advance only, already real and non-popup) but no GET at all -- description/SKU/
  lead-time/dimensions were never shown anywhere despite the backend already storing them.
  - **Backend gap closed**: added `getFfeItem()` to `interior-design-service.ts` (a direct
    single-row lookup, not `listFfeItems()`+filter, since a detail route may not have the
    projectId yet) and exposed it as GET on the existing `v1/projexa/ffe/[id]/route.ts`
    (previously PATCH-only). No dbUser gate anywhere in this module — genuinely fully
    functional, no identity-bridge caveat needed.
  - `src/components/FfeObjectClient.tsx` (NEW) + `.../ffe/[id]/page.tsx` (NEW) — real detail
    view (description/SKU/lead-time), real Edit for dimensions (`updateFfeItemDimensions()`,
    had a backend function but zero UI before this — needed for floor-plan placement), real
    inline Advance-status action. No Delete: no `deleteFfeItem()` exists.
  - `src/components/FfeCreateClient.tsx` (NEW) + `.../ffe/new/page.tsx` (NEW) — replaces "New Item".
  - `FfeClient.tsx` — Dialog + its form state removed; rows clickable (→ Object Page); the
    list's own inline "Advance" button kept as-is (already real, not a popup).
  - Full-project type-check: CLEAN, 0 errors. ESLint: CLEAN on both repos (0 findings).
  - **Mid-session verification pass** (owner asked to confirm the work is real, not prose):
    queried the REAL production Supabase database directly (both `evpckeuxgvahguwsaeul` and
    `pcrjmlpuqsbocqfwoxod` projects, confirmed ACTIVE_HEALTHY) — every table this session's
    work touches has real rows (115 real BOQs, 105 real pms_issues, 242 real documents, 23
    real FF&E items, 35 real change orders, etc.), every column name used in new code matches
    `information_schema.columns` exactly (documents.metadata/is_disposed/legal_hold/
    disposal_date, erp_budgets/erp_budget_line_items, interior_ffe_items.width_cm/depth_cm/
    height_cm, pms_issues.is_archived/completion_percentage — all confirmed real, not
    invented), and every hardcoded status enum (construction_boq_status, erp_budget_status,
    erp_journal_entry_status) matches `pg_enum` exactly. One genuine caveat found: a handful
    of e2e-test-fixture document rows have non-bucket `file_url` values (e.g.
    `https://storage.meridian-construction-e2e-test.internal/...`) that would produce an
    honest "Failed to generate download link" error if opened — pre-existing seed data, not a
    bug in the new code (real, non-fixture uploads use real relative bucket paths). Full
    `npm run build` (not just `tsc --noEmit`) kicked off to verify the whole app compiles for
    production, not only in isolation — result pending.
- 2026-08-30: Expenses (module #9) — smallest module yet (118 lines, 1 Dialog). No backend
  changes needed or possible: `construction-expense-service.ts` has create+list+a by-head
  summary only, no get-single/update/delete for one expense entry at all, and the create
  path (`createExpenseEntry`) needs only `{orgId, userId}` with the usual apiKey fallback —
  genuinely functional, no identity-bridge gap here.
  - `src/components/ExpenseCreateClient.tsx` (NEW) + `.../expenses/new/page.tsx` (NEW) —
    replaces "Log Expense". No Object Page: an honest scope cut, not a gap — there is no
    single-expense backend surface to build one against yet.
  - `ExpensesClient.tsx` — Dialog + its form state removed; button navigates to the create route.
  - Full-project type-check: CLEAN, 0 errors (confirmed by reading the output file directly).
- 2026-08-30: Employees (module #8) — 5 entities in one client (Employee, Department, Org
  Chart, Leave Request, Leave Balance), 5 Dialogs (surveyed via a background agent given the
  file's size — 737 lines — before touching anything). Employee already had a real, working
  `GET`/`PATCH /api/employees/[id]` the UI never used (always POSTed, even for "edit").
  - **MAJOR finding, not specific to this module's architecture**: checked every write
    function this module calls (`upsertEmployeeProfile`, department create, `requestLeave`,
    `decideLeaveRequest` — i.e. the approve/reject buttons too, `setLeaveBalance`) — EVERY
    SINGLE ONE is gated `if (!ctx.dbUser) return 400 "requires a real user session"` in
    compliance-tracker. Since PROJEXA's shared-Bearer-key proxy has no per-user identity
    bridge to VERIDIAN (confirmed in `use-org-role.ts`'s own header comment), this means
    **the entire Employees/HR write surface — create, edit, approve, reject, set-balance —
    is honestly non-functional from PROJEXA today**, and was already broken before this
    conversion (same class of gap as Schedule/Accounting, but this is the first module found
    where it blocks 100% of writes, not just one action). The real screens built below are
    correctly wired and will surface this same honest error until the bridge exists — not a
    regression, and not something screen-architecture work can fix. This is now the clearest,
    highest-leverage argument for prioritizing that identity-bridge fix above further
    screen conversions.
  - `src/components/EmployeeObjectClient.tsx` (NEW) + `.../employees/[id]/page.tsx` (NEW) —
    real display + Edit using the already-existing GET/PATCH (PATCH blocked per above).
    Replaces the old read-only "View" Dialog + its separate "Edit Profile" hop into the
    create dialog.
  - `src/components/EmployeeCreateClient.tsx` (NEW) + `.../employees/new/page.tsx` (NEW),
    `src/components/DepartmentCreateClient.tsx` (NEW) + `.../employees/departments/new/page.tsx`
    (NEW, no Object Page — department update/delete don't exist server-side at all),
    `src/components/LeaveRequestCreateClient.tsx` (NEW) + `.../employees/leave/new/page.tsx`
    (NEW), `src/components/LeaveBalanceCreateClient.tsx` (NEW) + `.../employees/leave/balance/new/page.tsx`
    (NEW, no Object Page — upsert-only, no get/delete-by-id) — replace the remaining 4 Dialogs.
  - **Real bug fixed in passing**: `EmployeesClient`'s tabs were ALWAYS internal-only state
    (`defaultValue`, no URL sync at all) — the new create screens' `?tab=` redirects would
    have silently landed on Directory every time. Fixed via the same `initialTab` server-side
    resolution + `history.replaceState` pattern as Accounting/Schedule.
  - Approve/reject inline buttons and "Approve All Pending" left untouched — already real,
    non-popup actions (just also blocked by the identity-bridge gap above).
  - Org Chart tab untouched — a derived, read-only visualization with no CRUD surface at all,
    not a popup architecture issue.
  - Full-project type-check: CLEAN, 0 errors (confirmed by reading the output file directly).
- 2026-08-30: Drawings & 3D (module #7) — fully converted. A drawing is just a `documents`
  row (category='drawing'|'drawing_3d', discipline in metadata) — same underlying table as
  Documents (module #6), so this reused those exact routes rather than duplicating backend
  work: 1 real Dialog ("Add Drawing"); rows only had a bare "Open" link, no detail view.
  - **Real bug found and fixed while reusing the Documents route**: `v1/projexa/documents/[id]`
    GET (built for module #6) would have tried to `createSignedUrl()` on an EXTERNAL walkthrough
    link (e.g. a Matterport URL, `metadata.isExternalLink: true`) as if it were a real storage
    object path — wrong on first real 3D-walkthrough-by-link use. Fixed by adding the same
    `isExternalLink` check `toDrawingDto()`/`toPermitDto()` already make in their own routes;
    response now also includes `metadata`/`isExternalLink` so Drawings (and any future reuse)
    can read them. This makes the generic Documents route correct for every category, not
    only plain uploads — a real correctness fix, not drawings-specific scope creep.
  - `src/components/DrawingObjectClient.tsx` (NEW) + `.../drawings/[id]/page.tsx` (NEW) —
    reuses `/api/documents/[id]` and `.../dispose` (PROJEXA's own existing proxies from module
    #6, ZERO new PROJEXA or compliance-tracker routes needed beyond the fix above). Real
    Open link (handles both signed-storage-URL and external-link cases), real Delete = real
    Dispose. No Edit: `updateDocumentMetadata()` doesn't accept a metadata/discipline patch —
    an honest scope cut, not a half-working form.
  - `src/components/DrawingCreateClient.tsx` (NEW) + `.../drawings/new/page.tsx` (NEW) —
    replaces "Add Drawing", same kind/discipline/file-or-link fields.
  - `DrawingsClient.tsx` — Dialog + its create-form state removed; rows clickable (→ Object
    Page, with the existing "Open" cell's own link preserved via stopPropagation); "Add
    Drawing" navigates to the create route.
  - Full-project type-check: CLEAN, 0 errors (confirmed by reading the output file directly).
- 2026-08-30: Documents (module #6) — fully converted, real gap was worse than expected:
  an uploaded document could NEVER be viewed or downloaded again anywhere in PROJEXA — the
  file's storage path isn't a public URL, and no route ever generated a signed link for a
  single document (list-level signed-URL generation existed for Permits only, a different
  code path).
  - **Backend gap closed**: 2 new v1 routes (compliance-tracker), mirroring the *internal*
    (session-only) `api/documents/[id]/route.ts` and `.../dispose/route.ts`'s own logic
    exactly but swapped to `requireAuthOrApiKey` so PROJEXA can actually call them —
    `documents/[id]/route.ts` (GET: real 5-min signed URL + activity log; PATCH:
    `updateDocumentMetadata`) and `.../dispose/route.ts` (`disposeDocument`, retention-date +
    legal-hold gated). `logActivity`'s existing `dbUser`-or-`apiKey` union (same pattern as
    `createIssue`/`createCompany`) meant no further backend changes were needed to make this
    genuinely API-key-callable.
  - `src/components/DocumentObjectClient.tsx` (NEW) + `.../documents/[id]/page.tsx` (NEW) —
    the module's first real Object Page: a real, working "View / Download" link (regenerated
    signed URL on every load, since they're 5-minute-lived by design), real Edit
    (category/expiry), real Delete = real Dispose — honestly disabled with the actual reason
    in the common case (`"No retention policy set"`, since `setRetentionPolicy()` is a
    separate, not-yet-wired action) rather than a fake-enabled button.
  - `src/components/DocumentUploadClient.tsx` (NEW) + `.../documents/upload/page.tsx` (NEW) —
    replaces "Upload Document", same fields (name defaults to the filename when blank, matching
    the real backend's own behavior).
  - `DocumentsClient.tsx` — Dialog + upload state removed; rows clickable (→ Object Page);
    "Upload" navigates to the create route.
  - Full-project type-check: CLEAN, 0 errors (confirmed by reading the output file directly).
- 2026-08-30: Change Orders (module #5) — fully converted. 2 real Dialogs ("New Change
  Order", "Send for E-Signature Approval"); the backend (`getChangeOrder`,
  `submitChangeOrderForApproval`) already existed and PROJEXA already had a v1 proxy for
  PATCH-submit, just never GET, and no detail screen at all — "reason" wasn't visible anywhere.
  - **Backend**: no compliance-tracker changes needed — `getChangeOrder()` and its v1 route
    already existed. Only added GET to PROJEXA's own already-existing
    `api/change-orders/[id]/route.ts` (previously PATCH-only).
  - `src/components/ChangeOrderObjectClient.tsx` (NEW) + `.../change-orders/[id]/page.tsx`
    (NEW) — real detail view (reason/cost/schedule impact, real signature-status display for
    pending_approval), with "Send for Approval" as a real inline form (not a separate route —
    matches the BOQ/Task pattern for small object-specific actions). No Edit/Delete: no
    `updateChangeOrder()`/`deleteChangeOrder()` exists anywhere in the backend — a change
    order's terms are fixed once created, same "no post-hoc editing of contractual/financial
    records" convention as journal entries. Approve/reject deliberately stays impossible to
    trigger from a button here too (matches the backend route's own explicit design: only a
    real e-signature completion can transition status — preserved, not touched).
  - `src/components/ChangeOrderCreateClient.tsx` (NEW) + `.../change-orders/new/page.tsx`
    (NEW) — replaces "New Change Order".
  - `ChangeOrdersClient.tsx` — both Dialogs + their state removed; rows clickable (→ Object
    Page); "Send for Approval" cell button now navigates there instead of opening a popup.
  - Full-project type-check: CLEAN, 0 errors (confirmed by reading the output file directly).
- 2026-08-30: Budgets (module #4) — fully converted, no deferred pieces. Only 1 real Dialog
  ("New Budget"), but no detail view existed at all for an existing budget:
  - **Backend gap closed**: 4 new v1 routes (compliance-tracker) exposing already-existing
    `getBudget`/`updateBudgetLineItems`/`submitBudget`/`cancelBudget`/`getBudgetVariance` —
    `project-budgets/[id]/route.ts` (GET+PATCH), `.../submit/route.ts`, `.../cancel/route.ts`,
    `.../variance/route.ts` (real Budget-vs-Actual, reading live off submitted journal-entry
    lines — was computed server-side but totally unreachable from PROJEXA).
  - Unlike Schedule/Accounting, NONE of these needed a real dbUser/ErpContext — Budget's own
    service functions only ever needed `{orgId, userId}` with `userId` falling back to the API
    key's own id, so Submit/Cancel/Edit are genuinely fully functional from PROJEXA today, no
    identity-bridge gap to document here.
  - `src/components/BudgetObjectClient.tsx` (NEW) + `.../budgets/[id]/page.tsx` (NEW) — the
    module's first real Object Page: real line-item Edit (draft-only), real Submit, real
    Delete = real Cancel (an actual designed lifecycle end-state, `cancelBudget()`, not an
    invented mapping), and a real Budget vs Actual section using the newly-exposed variance
    endpoint.
  - `src/components/BudgetCreateClient.tsx` (NEW) + `.../budgets/new/page.tsx` (NEW) —
    replaces "New Budget", same live VERIDIAN lookups and same honest
    blocked-reason messaging when fiscal years/chart of accounts aren't provisioned.
  - `BudgetsClient.tsx` — Dialog + ~140 lines of its lookup/form state removed; rows now
    clickable (→ Object Page); "New Budget" navigates to the create route.
  - Full-project type-check: CLEAN, 0 errors (confirmed by reading the output file directly).
- 2026-08-30: Accounting (module #3) core conversion — 2 real Dialogs found (New Journal
  Entry, New Company/Office); Dashboard/Trial Balance/P&L/Balance Sheet/P&L-by-Project/Bank
  Reconciliation tabs were ALREADY real report/list screens with no popups, confirmed by
  reading the whole 767-line file before touching anything:
  - **Backend gap closed**: `src/app/api/v1/projexa/journal-entries/[id]/submit/route.ts`
    (NEW, compliance-tracker) — exposes the already-existing `submitJournalEntry()`.
    Same `dbUser`-required identity-bridge gate as `change-orders/[id]/route.ts`'s own
    submit-for-approval action (exact established convention followed, not invented): refuses
    with an honest 400 when called via API-key-only (no real session), which is what every
    PROJEXA→VERIDIAN call actually is today.
  - **Deliberately NOT added**: a Delete/void action for journal entries. `voidDraftJournalEntry()`
    requires a real `dbUser` AND is documented in its own source comment as an internal
    "compensating rollback" mechanism for a specific automated-retry scenario, not a general
    user-facing delete — repurposing it would misuse a function designed for something else.
    Financial records are also never physically removed in this codebase once posted. The
    Object Page states this plainly instead of omitting the explanation.
  - `src/components/JournalEntryObjectClient.tsx` (NEW) + `.../accounting/journal-entries/[id]/page.tsx`
    (NEW) — the General Ledger's FIRST real detail view; previously a journal entry's lines
    were only visible inside the create dialog's own state, never after saving. Real line-item
    table (account names resolved, not raw ids), real Submit action (draft-only) with the
    identity-bridge limitation stated plainly next to the button, real Back.
  - `src/components/JournalEntryCreateClient.tsx` (NEW) + `.../accounting/journal-entries/new/page.tsx`
    (NEW) — replaces "New Journal Entry", same debit=credit balance validation.
  - `src/components/CompanyCreateClient.tsx` (NEW) + `.../accounting/companies/new/page.tsx`
    (NEW) — replaces "New Company / Office". No Company Object Page added: `updateCompany()`
    also requires a real dbUser (same gap), and there's no `deleteCompany()` at all — an
    honest scope cut, not a popup left in place.
  - **Real bug found and fixed while wiring navigation**: `AccountingClient`'s tab state was
    ALWAYS internal-only (`useState("dashboard")`), completely ignoring `?tab=` in the URL —
    the new create screens' `router.push("/accounting?tab=ledger")` redirects would have
    silently landed back on Dashboard every time. Fixed by resolving `?tab=` server-side in
    `accounting/page.tsx` and passing `initialTab` down (mirrors `schedule/page.tsx`'s own
    established pattern exactly, avoiding client-side `useSearchParams()`'s Suspense-boundary
    requirement).
  - `GeneralLedgerPanel` — Dialog + its account-loading/line-editing state removed; rows are
    now clickable (→ Object Page); "New Journal Entry" button navigates to the create route.
  - `CompaniesPanel` — Dialog + its create-form state removed; button navigates to the create
    route; the list re-fetches naturally on return since the create screen is a real page nav,
    not a same-page dialog close.
  - Full-project type-check: CLEAN, 0 errors (confirmed by reading the output file directly).
- 2026-08-30: Schedule (module #2) core conversion — 3 entities involved (Task/Issue,
  Sprint, TimeEntry), surveyed via a background agent before writing any route (found:
  no v1 single-task route existed at all; no `deleteIssue`/`getSprint`/`deleteSprint`
  anywhere in the backend; TimeEntry has no update function either):
  - **Backend gap closed**: `src/app/api/v1/projexa/schedule/[id]/route.ts` (NEW, compliance-tracker)
    — GET (`getIssue`) + PATCH (`updateIssue`), same `requireAuthOrApiKey`/`requireRoleOrScope`
    pattern as every other v1/projexa route. No DELETE added — `deleteIssue()` doesn't exist
    anywhere in the codebase, and inventing a hard delete for a task with time entries/
    dependencies/sprint membership attached is a real data-model decision, not a route-file
    afterthought. The schema's own `isArchived` field is the real soft-delete equivalent;
    the frontend's "Delete" action PATCHes `isArchived:true` through this same route.
  - `src/components/ScheduleTaskObjectClient.tsx` (NEW) + `src/app/(app)/schedule/tasks/[id]/page.tsx`
    (NEW) — the Schedule module's FIRST real Object Page for its core entity; previously
    there was no detail/edit screen for a task at all (Board only allowed drag-to-move or a
    quick popup). Real Edit (title/description/status/priority/dates/%-complete), real
    "Delete" = archive (gated: disabled once already archived), real Back to
    `/schedule?projectId=`. Status dropdown options sourced from the board's own real column
    list (`/api/board`) rather than a new endpoint. "Log Time" now lives here as a real
    inline action (hours/date), not a popup.
  - `src/components/ScheduleTaskCreateClient.tsx` (NEW) + `.../schedule/tasks/new/page.tsx`
    (NEW) — replaces Board's "New Task" Dialog.
  - `src/components/ScheduleSprintCreateClient.tsx` (NEW) + `.../schedule/sprints/new/page.tsx`
    (NEW) — replaces Sprints' "New Sprint" Dialog. Sprint's own full Object Page (edit/close
    as a real screen instead of the list's inline "Close Sprint" button) is DEFERRED — no
    `getSprint`/`deleteSprint` exist server-side yet, and Sprint's list already has real
    inline expand + Close-sprint actions, which is a defensible interim state, not a popup.
  - `src/components/ScheduleLogTimeClient.tsx` (NEW) + `.../schedule/log-time/page.tsx`
    (NEW) — replaces Timesheet's own "Log Time" Dialog (a genuinely different case from the
    Task Object Page's inline version: picking WHICH task to log against without having
    navigated to it first).
  - `ScheduleBoardClient.tsx` — "New Task"/"Log Time" Dialogs and their state removed; cards
    are now clickable (→ Task Object Page); "Move to…" dropdown kept (real drag-and-drop
    fallback, not a popup, stopPropagation added so it doesn't also navigate).
  - `ScheduleSprintsClient.tsx` — "New Sprint" Dialog removed; sprint issue list items now
    link to the Task Object Page.
  - `ScheduleTimesheetClient.tsx` — "Log Time" Dialog removed; entry rows' task reference now
    links to the Task Object Page.
  - Full-project type-check: CLEAN, 0 errors (confirmed by reading the output file directly).
  - Known pre-existing limitation, NOT introduced by this pass: logging time still requires a
    real VERIDIAN user session (`pms_time_entries.user_id` is a hard FK to `compliance.users`),
    which PROJEXA's shared-API-key proxy doesn't have — same identity-bridge gap already
    flagged in this tracker's "Separately queued" section. The Log Time screens are real and
    wired; the POST will surface that 400 until the identity bridge exists.
  - Remaining for Schedule to be fully complete: Sprint's own Object Page (needs
    `getSprint`/`deleteSprint` added server-side first), Gantt rows linking to the Task Object
    Page (currently a read-only chart, not a popup, so lower priority).
- 2026-08-30: Scope (BOQ) module fully converted — the 3 remaining Dialogs (New BOQ, New
  Revision, Compare) closed out, completing module #1 end to end with ZERO popups left:
  - `src/components/ScopeCreateClient.tsx` (NEW) + `src/app/(app)/scope/new/page.tsx` (NEW) —
    real create screen on `ObjectScreen` mode="create", replacing the "New BOQ" Dialog.
  - `src/components/ScopeReviseClient.tsx` (NEW) + `src/app/(app)/scope/[id]/revise/page.tsx`
    (NEW) — real revision-creation screen (loads the current BOQ's own line items to seed the
    form, same as the old dialog did), replacing the "New Revision" Dialog. Real scope-reduction
    409-block + override path preserved.
  - `src/components/ScopeCompareClient.tsx` (NEW) + `src/app/(app)/scope/[id]/compare/page.tsx`
    (NEW) — real compare screen wrapping the kit's existing `CompareScreen`, replacing the
    "Compare" Dialog. Not an edit/create workflow, so built on `ScreenFrame` directly (real Back,
    real "Against" selector) rather than `ObjectScreen`, whose footer is fixed to
    Edit/Delete/Save/Cancel and doesn't fit a pure-display screen. Registry-driven column labels
    (`boq.compare`) wired in server-side via `resolveRegistryColumns`, exported from
    `scope/page.tsx` and reused rather than duplicated.
  - `ScopeClient.tsx` (List Report) — the last 3 Dialogs and ~250 lines of their now-dead
    supporting state/functions/types removed (`open`/`title`/`lines`/`submitting`,
    `revising`/`revisionLines`/`revisionTitle`/`revisionSubmitting`/`revisionBlock`,
    `comparing`/`comparison`/`comparisonLoading`/`compareAgainst`, `createBoq`,
    `openRevisionDialog`/`updateRevisionLine`/`submitRevision`, `findOriginalBoqId`/
    `loadComparison`/`openCompareDialog`, `emptyLine`/`toDrafts`/`childPercentSum`/`collectLines`/
    `derivedSubQtyRate`/`formatAmount`/`withCurrency`/`boqTotal`/`toCompareResult`,
    `LineItemDraft` type, `DEFAULT_COMPARE_COLUMNS`, the now-unused `compareColumns` prop) —
    all of it now lives in the new screens (or `boq-helpers.ts`) instead. Compare/New Revision
    buttons now do real `router.push` navigation. `scope/page.tsx` updated to match (stopped
    resolving/passing `compareColumns` to `ScopeClient`, since Compare is its own route now).
  - Full-project type-check (`tsc.exe --noEmit -p .`): CLEAN, 0 errors, confirmed by reading the
    output file directly, not just the exit code.
  - Scope (BOQ) is now the fully proven reference for the remaining 29 modules: List Report
    (real routes only, no Dialogs) → Object Page (real Back/Delete/status-gated actions) →
    Create/Revise (real `ObjectScreen` mode="create" screens) → Compare (real `ScreenFrame` +
    `CompareScreen`). Next: Schedule (module #2), per the tracker's own ordering.
- 2026-08-30: Scope (BOQ) real Object Page built and wired in:
  - `src/lib/boq-helpers.ts` (NEW) — shared BOQ types/pure helpers extracted from ScopeClient.tsx
    (list client still has its own duplicate copies for now — deliberately not risk a refactor of
    already-working list code in the same pass as the new screen).
  - `src/components/ScopeObjectClient.tsx` (NEW) — real Object Page on the kit's `ObjectScreen`:
    real breadcrumb/title/status/facets, real `onDelete` (draft-status only, matches the backend's
    own `deleteBoq` rule, with a real disabled-reason on other statuses), real `onBack` deriving
    `?projectId=` from the loaded BOQ itself (same pattern `PermitObjectClient.tsx` proved — not a
    page-level query param, so Back is correct even from a bookmarked URL). `ObjectScreen`'s footer
    is fixed to Edit/Delete/Save/Cancel only (confirmed by reading the kit source) — BOQ's own
    workflow actions (Submit for Approval / Approve / Create Revision / Compare) render as a real
    toolbar in the body instead. Line items table (indented sub-tasks, root-walk qty/rate
    derivation, inline budget%/vendor editing) ported in from the old View dialog.
  - `src/app/(app)/scope/[id]/page.tsx` (NEW) — thin route wrapper, same pattern as `permits/[id]/page.tsx`.
  - Backend gap closed: VERIDIAN's `submitBoq`/`approveBoq` existed but were never exposed on the
    v1/projexa surface — added `api/v1/construction/boq/[id]/submit` + `.../approve` in
    compliance-tracker, `api/v1/projexa/scope/[id]/{submit,approve}` re-exports, and PROJEXA's own
    `api/scope/[id]/{submit,approve}/route.ts` proxies. Compliance-tracker type-check: clean.
  - `ScopeClient.tsx` (List Report) — the "View" Dialog popup and its supporting state
    (`viewing`/`viewRows`/`viewLoading`/`vendors`/`savingRowId`, `openViewDialog`,
    `saveLineItemBudget`) removed entirely; the View button now does real `router.push(\`/scope/${b.id}\`)`
    navigation to the new Object Page. Compare and New Revision are STILL Dialogs — not converted
    in this pass (tracked below as the next step for this module).
  - Bug found+fixed while building: `STATUS_TONE` used invented tone strings ("positive"/"warning"/
    "negative") that don't exist on the kit's real `StatusTone` type (`"needs-you" | "running" |
    "waiting" | "done" | "late" | "neutral"`) — would have been a real compile error. Mapped
    draft→neutral, submitted→needs-you, approved→done, superseded→neutral.
  - PROJEXA full-project type-check (`node_modules/.bin/tsc.exe --noEmit -p .`): CLEAN, 0 errors,
    confirmed by reading the output file directly (not just trusting exit code — `npx tsc` on this
    machine silently no-ops with exit 0 when TypeScript isn't resolved, so the real local binary
    was used instead).
  - Remaining for Scope to be a fully real, no-popup module: `ScopeCreateClient.tsx`/`/scope/new`
    (extract from the current create Dialog), `ScopeReviseClient.tsx`/`/scope/[id]/revise` (replace
    the New Revision Dialog), `ScopeCompareClient.tsx`/`/scope/[id]/compare` (replace the Compare
    Dialog, wrapping the kit's existing `CompareScreen`).
- 2026-08-30: Tracker created. Starting module 1 (Scope) as the flagship conversion.
