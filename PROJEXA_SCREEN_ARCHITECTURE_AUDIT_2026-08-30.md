# PROJEXA Screen Architecture Audit — "Is every right-pane screen a real traditional-ERP screen?"

Owner request: confirm every "right screen" (the M24 shell's right-pane content area) is a REAL
screen — like a traditional ERP (SAP GUI/Fiori: List Report → Object Page, real Back/Next/Submit/
Delete/Edit navigation) — not a popup. Checked against the real, test-verified route list
(`src/lib/nav-routes.ts`'s `SHIPPED_ROUTES`, 60 routes) and by reading every module's real component
code. Code-level audit only (production is down, no local DB access this pass — see the companion
`PROJEXA_SUMEET_SCREEN_AUDIT_2026-08-30.md` for that constraint's full explanation).

## The SAP benchmark, stated precisely
A traditional ERP object (a permit, a BOQ, an invoice, a customer) should have:
1. A **List Report** screen — a real table, with search/filter/sort.
2. A separate **Object Page** screen, reached by real navigation (a route, e.g. `/permits/[id]`, or at
   minimum a real `<Link>`/`router.push`) — never a modal stacked on the list.
3. Real **Display ⇄ Edit** mode toggle, a real **Save**, a real **Back** (returning to the list, ideally
   preserving filters), and a real **Delete** where deletion is a legitimate business action.

## Modules confirmed DONE RIGHT (match the SAP pattern)
| Module | Evidence |
|---|---|
| **Permits** | `PermitObjectClient.tsx`: real display/edit mode toggle (`mode` state), real `onEdit`/`onSave`/`onCancel`/`onBack` handlers, `onBack` explicitly preserves `?projectId=` (a real, documented bug fix), real breadcrumb. Routes: `/permits`, `/permits/[id]`, `/permits/new` — all real, test-verified. |
| **Floor Plans** | Real routes `/floor-plans`, `/floor-plans/[id]`, `/floor-plans/[id]/walkthrough`, reached by real `<Link>` navigation. Real per-object DELETE/PATCH endpoints for rooms/placements inside the editor. Real Back links (`FloorPlanEditorClient.tsx:254`, `FloorPlanWalkthroughClient.tsx:75`). One shortfall: the editor's own happy-path view has no persistent Back button outside its error-fallback branch; new-floor-plan creation is still a lightweight Dialog (arguably fine for something this small). |
| **Settings** | Correctly a different archetype (org config, not a business object) — no popups anywhere, real inline-edit fields. This is the right pattern for a config screen, not a defect. |
| **Copilot** | Correctly excluded — a tool-launcher for construction AI tools, not a business-object screen. The real chat UI is docked globally in the app shell, not this route. |

## Modules confirmed FAILING the pattern (Dialog/popup-based, not a real screen)

**Every one of these creates/views/edits via `Dialog`/`DialogContent` popups on a single flat list
route — confirmed against `nav-routes.ts`: none has a `[id]` or `/new` sub-route.** Customers has a
real `/customers/[id]` route but is missing Edit/Delete entirely (a different, still-real gap, see
below).

| Module | Delete exists? | Edit/View after creation? | Worst gap |
|---|---|---|---|
| Scope (BOQ) | **No** — grepped, zero Delete anywhere despite a real backend `deleteBoq` + a real proxy route (`api/scope/[id]/route.ts:22` DELETE) already wired | Yes, via Dialog (revise/compare) | No delete UI despite the backend fully supporting it |
| Schedule | Dialog-heavy (14 dialog references in the Board client alone) | Partial | Same anti-pattern as Scope |
| Accounting | No | No per-row edit/view | Bank reconciliation table is read-only by its own comment |
| Budgets | No | No | Create-only, view-only table |
| Change Orders | No | Status-advance button only | No way to review/amend before submitting for signature |
| Documents | No | No | Fully static table post-upload |
| Drawings & 3D | No | "Open" external link only | No edit/delete of the drawing record |
| Employees | No | **Best of this group** — real View→Edit dialog chain (stacked dialogs) | Still stacked popups, not a route |
| Expenses | No | No | Log-only, view-only |
| FF&E | No | Status-advance button only | Can't correct qty/cost/price after creation |
| GRC | No | No | 7 separate create dialogs, **zero** click-to-view for any logged Risk/Finding/Case/Policy/Vendor |
| Inventory | No | No | 3 create dialogs, fully static tables |
| Invoices | Cancel (draft-only) | No detail view | Can't see line items after creation |
| Knowledge Base | No | Inline (same-page `selected` state, no URL) | Also disclosed-broken create/edit (no per-user identity bridge) |
| KPIs | No | No edit of definitions | "View Entries" is inline expansion, not a route |
| Labour | No | No | 2 create-only dialogs |
| Materials | No | No | 2 create-only dialogs |
| Meetings | No | Dialog-based "View" with Add Outcome | No edit/delete of the meeting itself |
| MoMs | No | Inline minutes-editing panel | No delete of a meeting |
| Mood Boards | No | Status buttons only | No detail/edit view for a board or item |
| Payroll | No (Trash2 icons only remove unsaved draft rows) | Two read-only view dialogs | No edit of a saved run/payslip anywhere |
| Procurement | No | Real status-workflow buttons (best functional depth) | Still 4 stacked create dialogs, no `[id]` route |
| Punch List | No | Status-only (Mark Done/Verify) | No edit of description/location/trade |
| Purchase Orders | No | **None at all** | Weakest — read-only row after creation, zero further interaction |
| Quotations | No | Status-workflow buttons | No field-edit after creation |
| Recruitment | No | Nested dialog-on-dialog (closest to Object Page feel) | Literally a popup inside a popup |
| RFIs | No | Status-only (Answer/Close) | No edit of the original question |
| Sales (Leads/Opportunities) | No | Inline stage `Select` (partial) | Stage-history is a Dialog, not a route, despite separate `/sales/leads` `/sales/opportunities` routes existing |
| Sales Orders | No | Inline status Select + bulk action | No edit of order lines after creation |
| Site Diary | No | **None** — not even Scope's level of edit | Weaker than Scope: create-only, nothing after |
| Site Materials | No | No | Inline forms, no dialog, no route — same result |
| Submittals | No | Status-only via review Dialog | Once non-pending, record is inert, unreachable |
| Vendors | No | **None** — table rows aren't even clickable | Thinnest module of all |
| Wiki | **No** | Inline Edit/Save (real, no dialog) | Best of the "no route" group, but still no `/wiki/[id]` and no delete |

## Customers — a distinct, real gap (route exists, navigation controls don't)
`/customers/[id]` IS a real, separate route (correct pattern) — but `CustomerOverviewClient.tsx` has
**zero** Back button, zero breadcrumb, zero Edit capability, and zero Delete (confirmed by grep,
`CustomersClient.tsx` has none either). A real route without real navigation controls is only half
the fix.

## Dashboard — 4 real routes, but 2 are disconnected islands
`/dashboard`, `/dashboard/hierarchy`, `/dashboard/overview`, `/dashboard/project` are all real routes.
Only `/dashboard → /dashboard/project` actually cross-links (`DashboardHomeView.tsx:206`, a real
`<Link>`). **`/dashboard/hierarchy`** and **`/dashboard/overview`** each show project-level summary
data but have zero navigation into `/dashboard/project` for a given project — clicking a project row
in either just expands local state on the same page. A user drilling Company→Department→Project in
the hierarchy view cannot jump to the canonical per-project dashboard without manually re-navigating.
`/dashboard/project` itself has real outbound links (Scope/Work-Progress/Permits) but no breadcrumb
back up to the other 3 dashboard routes.

## Reports — a different, legitimate archetype
`ReportsClient.tsx` has no Dialog and no sub-route — it's a report-picker with inline, interactive
results (recharts Bar/Line/Pie + Table/Pivot/Chart tabs). This matches SAP's own "Selection Screen →
ALV List" pattern reasonably well for a read-only, ad-hoc query surface — reports aren't persisted
business objects a user edits/deletes, so the List+Object-Page+Delete requirement doesn't cleanly
apply here. Not flagged as a defect, noted for completeness.

## Scale of what a full fix would mean
**Confirmed: 30 of ~37 audited business-object modules use the Dialog/popup anti-pattern, and
essentially none of them (Scope included, despite having a real backend delete function already
wired) expose a Delete control at all.** Rebuilding all 30 as real List-Report → Object-Page screens
with proper Back/Edit/Delete/Submit navigation is a substantial, multi-week UI engineering effort —
each module needs its own `[id]`/`new` route, page-level layout, and real navigation wiring — not a
same-pass "fix the bugs" task. Recommend the owner prioritize which modules matter most for the next
real customer demo/walkthrough (Scope, Schedule, and Work Progress are the ones most directly tied to
Sumeet's own named requirements) rather than attempting all 30 at once.
