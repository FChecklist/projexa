# PROJEXA / Sumeet Screen Audit — 2026-08-30

Owner request: test and check (1) all Sumeet-required modules' UI/UX, (2) the right-pane "traditional
ERP screens" convention, (3) the 70 tracked screens (`platform.sumeet_requirements`), (4) dashboard
screens, (5) report screens, (6) analysis screens — all working or not.

**Scope note, agreed with the owner up front**: projexa-ai.com (production) is down (503, Vercel
spend-cap incident, same as compliance-tracker's). Setting up a full local PROJEXA dev server was
blocked on a Supabase DB-password reset requiring dashboard access outside this session's sandbox.
Owner chose: **code-level audit only**, no live click-through this pass. Every verdict below says so
honestly — VERIFIED-REAL means "the code correctly implements this," not "clicked and confirmed."

Real backend data used for cross-reference: `platform.sumeet_requirements` (70 rows, Supabase project
pcrjmlpuqsbocqfwoxod) and `platform.screen_spec`/`platform.mode_pills` (design specs). PROJEXA repo
freshly cloned to `C:\projexa` (was previously stray node_modules only, no real source present).

## Legend
VERIFIED-REAL (code correctly implements it) | BUG-FOUND (real, confirmed defect) | INCOMPLETE (partial)
| CANNOT-VERIFY-FROM-CODE (needs a live click)

---

## 1. BOQ / Scope (sumeet_requirements rows 1-22, 70)

Audited: `src/components/ScopeClient.tsx` (886 lines, full read) + 5 real API routes it calls.

| # | Requirement | Verdict | File:line |
|---|---|---|---|
| 1 | BOQ saves without server error | VERIFIED-REAL | ScopeClient.tsx:350-418 |
| 2 | Amount = QTY×RATE displayed | VERIFIED-REAL | ScopeClient.tsx:699 |
| 3 | Title-only, zero-line BOQ allowed | **BUG-FOUND**: client blocks submission with zero line items ("Add at least one complete line item"), even though the backend is documented to allow it | ScopeClient.tsx:273, 350-356 |
| 4 | Missing title rejected, field named | **BUG-FOUND**: blank title is a silent no-op — `if (!title.trim()) return;` with NO toast/error shown at all, button stays enabled | ScopeClient.tsx:351, 605 |
| 5 | Item Code/Parent Item Code/Breakdown % — 3 real fields | VERIFIED-REAL | ScopeClient.tsx:590-592, 803-805 |
| 6 | Sub-task amount = ROOT qty×rate×% | VERIFIED-REAL (renders server value, no client override) | ScopeClient.tsx:194-201, 699 |
| 7 | Sub-task own Qty/Rate ignored server-side | **BUG-FOUND (UX)**: fields are NOT disabled/greyed for sub-task rows, typed values silently forwarded and dropped — no user-visible signal | ScopeClient.tsx:588-589, 803-804, 357-365 |
| 8 | Weights not forced to sum to 100 | VERIFIED-REAL | ScopeClient.tsx:162-181, 221-275 |
| 9 | Running total of child % shown per parent | VERIFIED-REAL | ScopeClient.tsx:175-181, 583/593, 796/806 |
| 10 | Child w/ parent, no % rejected, field named | VERIFIED-REAL | ScopeClient.tsx:248-253, 264-266 |
| 11 | Parent code matching nothing rejected | VERIFIED-REAL (passthrough only, exact wording is backend-controlled) | ScopeClient.tsx:384-393 |
| 12 | Circular reference doesn't hang UI | VERIFIED-REAL (flat map, no recursive walk) — but a SEPARATE unguarded `while` loop exists for BOQ-revision-chain walking (`findOriginalBoqId`, 538-546) | ScopeClient.tsx:183-192, 538-546 |
| 13 | Nested (grandchild) sub-task prices off ROOT | **BUG-FOUND**: `derivedSubQtyRate()` only resolves ONE level up — a true grandchild reads its mid-level parent's own (unreliable/display-only) qty/rate, not the true root's | ScopeClient.tsx:183-192 |
| 14 | Revision preserves parent links & % | VERIFIED-REAL | ScopeClient.tsx:115-141, 452-457 |
| 15 | Revision variation vs prior — real Compare view | VERIFIED-REAL | ScopeClient.tsx:548-569, 835-882 |
| 16 | Removing line WITH progress blocked | VERIFIED-REAL (real 409 handling, override path) | ScopeClient.tsx:438-479, 818-827 |
| 17 | Reducing qty WITH progress blocked | VERIFIED-REAL (same code path as #16) | ScopeClient.tsx:438-479 |
| 18 | %-only change shown as variation | INCOMPLETE: row is visible, not dropped, but the "changed" highlighting only checks qty/rate delta, not %-delta | ScopeClient.tsx:62-71, 99-102 |
| 19 | Can SEE line items of a BOQ | VERIFIED-REAL | ScopeClient.tsx:481-503, 662-786 |
| 20 | Sub-task rows indented + "% of parent" label | VERIFIED-REAL | ScopeClient.tsx:685-690 |
| 21 | BOQ total excludes sub-tasks | VERIFIED-REAL | ScopeClient.tsx:194-201, 705-708 |
| 22 | Negative variation / WPR block surfaced | VERIFIED-REAL (generic 409 passthrough) | ScopeClient.tsx:438-479 |

**4 real bugs found in this area**: #3, #4, #7, #13.

---

## 2. Work Progress + Dashboard (sumeet_requirements rows 24-35)

Audited: WorkProgressFormClient/ListClient/AnalyticalClient/ReportClient/PageClient.tsx,
DashboardHierarchyClient/HomeView/ProjectClient.tsx (8 files) + supporting lib/route files.

| # | Requirement | Verdict | File:line |
|---|---|---|---|
| 1 | Partial progress against weighted sub-task | VERIFIED-REAL | WorkProgressFormClient.tsx:145,150-151 |
| 2 | Previous/Current/Total % columns | VERIFIED-REAL on the Report tab only — **gap**: List/Analytical tabs show only one raw % column | WorkProgressReportClient.tsx:135-160 vs WorkProgressListClient.tsx:26 |
| 3 | Previous/Current/Total Qty columns | same pattern as #2 | WorkProgressReportClient.tsx:136,168-170 |
| 4 | Cumulative/Current/Balance Amt columns | VERIFIED-REAL on Report tab only, real Previous/Current + toggled Total-or-Balance | WorkProgressReportClient.tsx:137,172-174 |
| 5 | Parent cum qty = Σ(child cum qty×%) | VERIFIED-REAL, but PROJEXA has its OWN parallel re-implementation of this math (not calling the backend's rollup directly) — a drift risk; also explicitly documented broken beyond one nesting level | work-progress-report.ts:370-414, 351-368 |
| 6 | Parent %complete = amt-weighted, not average | VERIFIED-REAL on dashboards (raw backend value rendered); Report tab's own recompute is genuinely amount-weighted too; Analytical tab explicitly and correctly labels its OWN metric as a different, flat average | DashboardProjectClient.tsx:146-149; WorkProgressAnalyticalClient.tsx:65,76-88 |
| 7 | Progress recorded twice keeps history | VERIFIED-REAL | WorkProgressListClient.tsx:48-52,70-85 |
| 8 | Progress >100% rejected/capped, surfaced | VERIFIED-REAL (client pre-check + real backend passthrough) | WorkProgressFormClient.tsx:181-185,216-220 |
| 9 | Daily progress report with photos | VERIFIED-REAL for upload (real Storage write); **INCOMPLETE**: no screen ever displays photos back — upload-only, no "report with photos" view exists | WorkProgressFormClient.tsx:154,199-228; api/work-progress/photos/route.ts |
| 10 | Project value matches BOQ total | **STILL DEFECTIVE** (tracker's "fixed" note is stale/partial): fixed in DashboardHierarchyClient only; DashboardProjectClient fetches the field but never renders it (shows a DIFFERENT figure, Contract Value, instead); and even where shown, it's `COALESCE(user-entered, PO-sum)`, never actually compared against/equal to the BOQ total anywhere | DashboardHierarchyClient.tsx:99-110 vs DashboardProjectClient.tsx:60 (unused) |
| 11 | Dashboard earned value from real API | VERIFIED-REAL, honest null-states | DashboardHomeView.tsx:209-218; DashboardProjectClient.tsx:120,146-149 |
| 12 | Only latest revision counted | CANNOT-VERIFY-FROM-CODE (pure backend concern, dashboards don't re-filter revisions client-side) | — |
| 13 | Shared currency helper, no hardcoded symbol | INCOMPLETE: no hardcoded ₹ bug found anywhere (confirmed clean), but `WorkProgressReportClient.tsx`'s own `money()` has ZERO currency indication at all (not wrong — just missing) | WorkProgressReportClient.tsx:54-56 |

**1 confirmed still-open defect** (#10, worse than the tracker's stale "fixed" claim suggested), **2 real gaps** (#2/#3/#4's List/Analytical tabs, #9's missing photo display).

---

## 3. The 10 Sumeet modules (rows 60-73)

| Module | Requirement | Verdict | File:line |
|---|---|---|---|
| Permits | Name/issue date/end date/PDF upload, real endpoint | VERIFIED-REAL | PermitCreateClient.tsx:62-90,37,100; api/permits/route.ts:34-44 |
| Drawings & 3D | Real upload + real 3D walkthrough viewer | VERIFIED-REAL | DrawingsClient.tsx:174-176; FloorPlanScene3D.tsx:1-107 (real three.js/`@react-three/fiber` scene, not a placeholder) |
| Documents | Upload + list, any file type | VERIFIED-REAL | DocumentsClient.tsx:169-172,93-209 |
| MoMs | Live minutes, PDF export, WhatsApp share | **BUG-FOUND**: PDF real; WhatsApp is a disabled dead button — `title` attribute literally says "not implemented anywhere in this codebase yet" | MoMsClient.tsx:214-219 |
| Manpower | ID/Name/Trade/Salary, attendance, trade-wise summary, cost report | VERIFIED-REAL (all 4 roster fields incl. explicit ID=employeeCode; trade summary lives under Reports, not Labour page, but functionally present) | LabourClient.tsx:206-216,258-320,48; work-progress-report.ts:463-474 |
| Material | Spec/cost/qty, inbound updates visible stock | VERIFIED-REAL | MaterialsClient.tsx:209-211; SiteMaterialsClient.tsx:145-146 |
| Budget | 25%-default, editable, vendor name+amount per line, summary report | VERIFIED-REAL (lives in ScopeClient.tsx, not the generically-named BudgetsClient.tsx) | ScopeClient.tsx:710-779; api/construction-budget/summary/route.ts |
| Schedule | Board/Gantt/Sprints/Tabs/Timesheet, real working set | **BUG-FOUND**: all 5 screens are real (incl. a genuine `@svar-ui/react-gantt` Gantt with critical path/baseline) but time-logging is DISCLOSED-BROKEN — every submission 400s in production because PROJEXA's shared API key has no per-user identity bridge to VERIDIAN's `pms_time_entries.user_id` FK | ScheduleTimesheetClient.tsx:3-12; ScheduleBoardClient.tsx:57-64 |
| Reports | Revenue/Budget/Actual scope+category-wise, dashboard-format, interactive | INCOMPLETE: real, genuinely interactive charts (recharts Bar/Line/Pie, Table/Pivot/Chart tabs) exist, but NO single report actually combines revenue+budget+actual — each is a separate selectable report; also no PDF export or WhatsApp share anywhere in Reports | ReportChart.tsx:1-133; ReportOutput.tsx:61-87 |
| Design Studio | Daily timesheets, designer enters + **manager validates**, cost analysis | **BUG-FOUND**: the module/route does not exist at all (0 of 60 shipped routes named design-studio, 0 grep hits for "Design Studio" anywhere) — closest candidate (ScheduleTimesheetClient) is generic PM timesheet, entry-only, with NO approve/reject/validate control anywhere in the codebase | nav-routes.ts:20-84 (SHIPPED_ROUTES) |

**3 real bugs found in this area**: MoMs WhatsApp (dead button), Schedule timesheet (disclosed-broken submission), Design Studio (module doesn't exist, manager-validation absent entirely). **1 real gap**: Reports has no unified revenue+budget+actual view and no PDF/WhatsApp export anywhere.

---

## 4. M24 shell / right-pane convention (screen_spec's GLOBAL archetype) — audited directly by me

`src/components/shell/M24Shell.tsx` (706 lines, full read). **Real, well-engineered, matches spec**:
one shared shell wraps all 42 route directories, Top Rail / Task Master (left) / Composer (docked) /
right-pane content exactly as `platform.screen_spec`'s GLOBAL row specifies. Extensive real historical
bug-fix documentation in comments (F_025 stale-identity-across-tabs, R48_TWO_OF_THREE_PER_PAGE_500S,
R55_BUDGETS_TAB_NOT_IN_URL, F_019 composer-overlap) — all real, specific, reproduced-live fixes.

**REAL, CONFIRMED BUG in the pill-click flow** (directly explains why sumeet_requirements rows 43/44
— "ONE full pill path works end to end" / "no visible pill may be unwired" — are BOTH still marked
"NOT DONE"):

- The 14 "universal" pills (Customers/Vendors/Projects/MoM/Reports/**Analysis**/Email/Policies/
  Department/Teams/Calendar/Task Master/To Do/Other — `pillConfig.ts`, cross-checked against real
  `platform.mode_pills` rows) are top-level CATEGORY entry points, each meant to start a chain that
  narrows to a specific action (per `mode_pills.boundary_note`, e.g. "the chain narrows to the ACTION").
- `onPillSelect` (M24Shell.tsx:433-457) looks up a `functionId` for the clicked pill from
  `pillFnRef.current[sel.pillKey]`, which is populated ONLY from `/api/pill-usage`'s response
  (M24Shell.tsx:369-388) — and that endpoint (compliance-tracker's real
  `api/v1/projexa/pill-usage/route.ts`, read in full) returns a user's **past usage history**
  (`compliance.pill_usage` rows), not a static catalog mapping every universal pill to a functionId.
- **Consequence, traced precisely**: the FIRST time any user ever clicks a given universal pill (no
  prior `pill_usage` row for that key), `pendingFunctionId` stays `null` (M24Shell.tsx:456). If the
  user then hits Send without also typing free text, `onSubmit`'s own guard
  (`if (!typed && !pendingFunctionId) return;`, M24Shell.tsx:470) makes the button a **silent no-op**
  — nothing is submitted, no error shown, no chain narrows further. There is no secondary
  narrowing/param-collection UI anywhere in M24Shell for a pill with no prior usage.
- This is a real, structural gap, not a guess — traced end-to-end through 3 real files (pillConfig.ts,
  the real pill-usage API route, M24Shell.tsx) without needing a live click to establish it exists.

---

## 5. Analytical / "Analysis" screens — audited directly by me

Real, working screens DO exist: `CostVarianceAnalyticalClient.tsx` (budget variance bar chart + table,
reached from a dashboard KPI click, calling the already-verified `boqBudgetVarianceReport` backend
function) and `WorkProgressAnalyticalClient.tsx` (see section 2, row 6). Both use the shared
`AnalyticalScreen`/`BarChart`/`ListScreen` primitives from `@fchecklist/veridian-ui-kit/screens`,
matching `screen_spec`'s `ANALYTICAL.GLOBAL` archetype (arrived at via a KPI/chart click, filters
pre-applied).

**Gap**: there is no generic `/analysis` landing route — these are both deep-linked, single-purpose
analytical views, not a browsable "Analysis" section a user could reach directly. Combined with the
pill-click bug above, clicking the "Analysis" universal pill for the first time very likely does
nothing, since no functionId/route exists to resolve it to either of these two specific screens.

---

## Currency (rows 36-39) — audited directly by me

`src/lib/currency.ts`: real, already-correct shared helper — `CURRENCY_FALLBACK_LABEL` falls back to a
blank string (or an explicit env-configured code), never a hardcoded rupee/AED symbol
(currency.ts:40-52). Matches the exact fix pattern applied to compliance-tracker's own equivalent
helper this session (F046) — this repo already had it independently. VERIFIED-REAL.

## Final summary (all 3 areas complete)
- **Confirmed real bugs (9 total)**: BOQ create allows-zero-line client-block (#3), BOQ blank-title silent no-op (#4), BOQ sub-task qty/rate not disabled (#7), BOQ grandchild pricing reads mid-parent not root (#13), Dashboard project-value stale-fix/two-different-numbers (#10), composer pill-click first-use silent no-op (section 4), MoMs WhatsApp dead button, Schedule timesheet submission disclosed-broken, Design Studio module doesn't exist at all.
- **Confirmed real gaps/incomplete (6 total)**: BOQ %-only-change highlighting incomplete (#18), Work Progress List/Analytical tabs missing the 3-column split (#2-4), Work Progress daily photos upload-only/never displayed (#9), no generic `/analysis` landing route, Reports has no unified revenue+budget+actual view, Reports has no PDF/WhatsApp export anywhere.
- **Confirmed working correctly**: the large majority of both BOQ/Work-Progress/Dashboard logic, all 3 dedicated dashboard screens' currency handling, 7 of 10 Sumeet modules fully correct (Permits/Drawings&3D/Documents/Manpower/Material/Budget/Schedule-minus-timesheet), the M24 2-pane shell architecture itself, and both real Analytical screens that do exist.
- **Not verifiable from code alone**: exact backend error wording for a few specific validation cases, and anything requiring an actual live session (revision-latest-only filtering, live click confirmation of the pill-click bug's real-world symptom).
