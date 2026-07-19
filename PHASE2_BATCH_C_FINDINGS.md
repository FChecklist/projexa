# PROJEXA E2E Testing Program — Phase 2 Batch C Findings

**Scope:** Finance/Sales/HR modules (accounting, budgets, invoices, quotations, sales-orders,
sales, customers, employees, payroll, recruitment, hr, kpis, reports, wiki, knowledge-base, grc)
plus real natural-language chat-command testing against the AI Copilot.
**Date:** 2026-07-19 · Against the live site (`https://projexa-ai.com`), real seeded
"Meridian Construction Group (E2E Test Org)" data from Phase 1 (`PHASE1_SEED_REPORT.md`, merged PR #45).
**Test users:** Arjun Mehta (CEO, `arjun.mehta@…`), Deepak Joshi (Finance & Accounts Manager,
`deepak.joshi@…`), Sneha Reddy (HR Administrator, `sneha.reddy@…`) — all confirmed live via direct
Supabase auth calls before writing any test (Phase 1's documented login-provisioning blocker had
been resolved by the time this session started, `email_confirmed_at: 2026-07-19T06:53:38Z`).

**Part 1 result: 71 passed / 0 failed / 1 skipped** (72 tests across 7 spec files, run
`bunx playwright test --project=chromium`), plus 3 passing auth-setup tests. The 1 skip is a
graceful `test.skip()` (no seeded quotation was still in `draft` status by the time this exact
run reached that test — a prior run in this same session had already transitioned the only
draft one; not a failure).

**Part 2 result: 12 distinct real chat-command test cases, all passing** — 9 with full verbatim
transcripts captured below.

**Top 3 most significant real gaps** (full detail in the relevant sections below):
1. **Every HR/Payroll/Leave write is permanently broken for every PROJEXA user, including the
   org owner** — a hard architecture wall (`ctx.dbUser` requirement PROJEXA's shared-API-key
   bridge can never satisfy), not a UI/role-gating issue. This is far more consequential than
   the isHrAdmin UI-gating gap it's usually mistaken for.
2. **The Wiki page (`/wiki`) never renders at all** — "Could not load projects: Unauthorized" on
   100% of loads, a one-line missing-parameter bug distinct from (and worse than) the disclosed
   "per-user session" write limitation, which claims viewing is unaffected. It isn't.
3. **The Copilot's structured Assistant/Chain Selector has zero Finance/Sales/HR actions** —
   it is 100% construction-only. The free-text Discuss chat correctly avoids fabricating figures,
   but its own recommended fallback ("use the Assistant pill") is a dead end for this batch's
   entire user base, and it was caught inventing a nonexistent `**DeleteProject**` action when
   pushed on an out-of-scope destructive request — a real hallucination, not a safe refusal.

---

## Part 1 — Module-by-module results

### Methodology note

Every count/behavior claim below was verified two ways before being written into a test: once via
a direct `fetch()` call against the real API from an authenticated browser context (fast,
unambiguous ground truth), and once through the actual rendered UI a user would see. Where the two
disagreed, the UI behavior is what's reported as the gap (real users don't call APIs directly).

All 16 modules use the same real seeded org (`compliance.organisations.id =
4ecc472f-4152-4310-ae8d-cf8b7c52ab6d`, slug `meridian-construction-e2e-test`) documented in
`PHASE1_SEED_REPORT.md`. No `data-testid`, `aria-label`, or `id` attributes exist anywhere in
these 16 modules' components (confirmed by grep) — every Playwright selector in this PR's test
files targets real visible text, ARIA roles, or placeholders, the same way a sighted user would.

**Re-run safety note:** several modules (Customers, Sales Orders, Invoices, Leads, Recruitment,
KPIs, GRC, Accounting Companies) have no delete UI anywhere in the app. This suite's own real
write tests permanently add rows to the live org on every re-run. Count assertions for these
modules use `>=` against the documented Phase 1 floor rather than exact equality, and "empty
state" assertions that are only true once are commented as such rather than re-asserted — see
inline comments in the affected spec files for the exact reasoning per module.

### Accounting (`/accounting`) — `e2e/finance-accounting-budgets.spec.ts`

| Check | Result |
|---|---|
| Dashboard renders (Cash Position card etc.) | ✅ real, honest empty state |
| General Ledger tab: empty state + real status filter (draft/submitted/…) | ✅ |
| Companies tab: create a real Company/Office, verify persistence | ✅ write succeeds |
| New Journal Entry dialog: chart-of-accounts dependency | ✅ confirmed empty (documented gap) |

**GAP:** Phase 1's 1,007 seeded rows never touched `erp_accounts`, journal entries, fiscal years,
or budgets (confirmed live: `GET /api/accounts` → 0, `/api/journal-entries` → 0 total,
`/api/project-budgets` → 0). The Accounting dashboard and General Ledger tab are honestly empty —
not broken, just nothing to show. The "New Journal Entry" dialog's account-line Select has zero
real options as a direct consequence, and **there is no "New Account" or "New Fiscal Year" UI
anywhere in PROJEXA** to bootstrap a chart of accounts. For this org, the General Ledger and
Budgets modules (below) are structurally unusable end-to-end until that setup data exists —
worth flagging to Phase 4/5 as a real onboarding gap, not just a seed-data gap.

### Budgets (`/budgets`) — same spec file

**GAP:** confirmed the "New Budget" dialog's Fiscal Year Select literally renders the placeholder
text "No fiscal years found in VERIDIAN" — the dependency chain (Budgets need Fiscal Years +
Accounts, neither creatable from PROJEXA's UI) makes budget creation a dead end for this org.
Also noted while reading `BudgetsClient.tsx`: the create form silently no-ops on missing required
fields (`if (!name.trim() || …) return;`) with **no validation toast** — a minor UX gap, don't
expect one in future tests here.

### Invoices (`/invoices`) — `e2e/finance-invoices-quotations.spec.ts`

| Check | Result |
|---|---|
| 12 seeded invoices render (Phase 1 floor) | ✅ |
| Status filter (draft/submitted/**partially paid**/paid/overdue/cancelled) — real enum, filters correctly | ✅ |
| AR Aging tab shows real bucketed overdue/outstanding data (not the empty state) | ✅ |
| Real write: create a new invoice for a seeded customer, verify persistence | ✅ (after fix below) |

**GAP found while writing the create-invoice test:** the Customer combobox's real option list is
lazy-fetched *after* the dialog opens. Selecting before that fetch resolves leaves only the static
"+ New customer…" entry available — picking it silently reveals an empty "New Customer Name"
field instead of a real `customerId`, which makes the "Create Invoice" button a **permanent,
silent no-op**: no toast, no network request, no error of any kind. There is no loading indicator
on the combobox to warn a real user this is happening. A user who clicks through quickly (a very
normal thing to do) will believe they created an invoice and nothing will have happened.

### Quotations (`/quotations`) — same spec file

| Check | Result |
|---|---|
| 8 seeded quotations render (exact, stable — no create-write test in this batch touches this count) | ✅ |
| Live search-by-customer (fires per keystroke, no debounce) — filters correctly, garbage query → real empty state | ✅ |
| Real write: status transition (draft → pending_approval) on a seeded row, verified via reload | ✅ (skipped on later re-runs once no draft rows remain) |

No gaps found in Quotations beyond the same customer-combobox lazy-load trap noted for Invoices
(this page's own "New Quotation" dialog wasn't exercised as a write in this batch, but the same
`erp-selling-service` customer list backs both).

### Sales Orders (`/sales-orders`) — `e2e/sales.spec.ts`

| Check | Result |
|---|---|
| 6 seeded sales orders render (Phase 1 floor) | ✅ |
| Real write: create a new sales order for a seeded customer, verify persistence | ✅ (after the same customer-combobox lazy-load fix as Invoices) |
| Per-row status Select | ✅ (skip-safe if no draft-equivalent row present) |

Same customer-combobox lazy-load gap as Invoices, confirmed here independently (same root pattern,
different component/dialog).

### Sales dashboard / Leads / Opportunities / Customers (`/sales`, `/sales/leads`, `/customers`) — same file

| Check | Result |
|---|---|
| Sales Dashboard renders real (zero, as of Phase 1) CRM pipeline data honestly | ✅ |
| Nav links route to real Leads/Opportunities/Quotations/Sales Orders/Customers pages | ✅ |
| Real write: create a new Lead (module had zero seeded CRM rows) | ✅ |
| 6 seeded customers render (Phase 1 floor) | ✅ |
| Customer search filters correctly | ✅ |
| Real write: create a new Customer, verify persistence | ✅ |
| Customer overview drill-down (`/customers/[id]`) shows real linked Opportunities/Quotations/Sales Orders/Invoices rollups | ✅ |

**GAP (documented, not a bug):** Phase 1's seed batches covered ERP selling (quotations/sales
orders/invoices) but never touched CRM `crm_leads`/`crm_opportunities` — confirmed live via
`GET /api/sales-pipeline` (all-zero) before writing these assertions. Sales Dashboard, Leads, and
Opportunities pages are honestly empty for this org until this batch's own write tests (or a
future seed) add data.

### Employees (`/employees`) — `e2e/hr-employees-payroll.spec.ts`

| Check | Result |
|---|---|
| 11 seeded employees render, paginated 10/page (shadcn DataTable default) | ✅ |
| Department filter + employee search | ✅ |
| Org Chart tab renders the real 1-CEO + 10-employee hierarchy | ✅ |
| Departments tab | ❌ real API bug, see below |
| Employee Profile / New Department buttons: visible only to Arjun (owner) | ✅ confirmed |
| Leave tab: approve a pending request | ❌ real architecture gap, see below |
| Request Leave (self-service, any member) | ❌ same architecture gap |

**GAP — real, reproducible bug, not seed-data:** `GET /api/hr/departments` returns a consistent
`500 {"error":"Failed to fetch departments"}` (reproduced 5/5 attempts). Root-caused by reading
`compliance-tracker/src/app/api/v1/projexa/hr/departments/route.ts:24-29` — a Drizzle relational
query (`db.query.departments.findMany({ with: { head: {...}, users: {...} } })`) throws and is
swallowed into a generic 500. `GET /api/hr/org-chart`, which touches the same underlying
department/user data, works fine — so this is isolated to that specific relational query shape,
not a broader outage. The 6 seeded departments genuinely exist (confirmed via `org-chart`'s own
response) but the Departments *tab* can never display them.

**GAP #1 (UI-gating, isHrAdmin) — confirmed empirically:** `isHrAdmin` (`src/hooks/use-org-role.ts`)
is based on PROJEXA's own local `memberships.role` (`"owner"|"admin"|"member"`), **not** the
seeded `employee_profiles.job_title`. `scripts/phase1-provision-projexa-accounts.mjs` gives
*only* Arjun Mehta `role: "owner"`; all 10 other accounts — including Sneha Reddy, the actual HR
Administrator by job title — get `"member"`. Diffed the two accounts' rendered `<button>` set on
`/employees` directly: Arjun has an `Employee Profile` create button, Sneha does not; same for
`New Department`. So the real HR admin cannot see admin controls in her own module.

**GAP #2 (architecture, MUCH bigger than #1) — confirmed via direct POST + reading real source:**
even the *one* account that clears gate #1 (Arjun, the owner) gets a hard **400 "This action
requires a real user session, not an API key"** on every one of these writes:
- `POST /api/employees` (create/edit Employee Profile)
- `POST /api/hr/departments` (create Department)
- `POST /api/leave/requests` (Request Leave — gated only at `member`+`write`, no admin
  requirement at all, and it *still* fails)
- `POST /api/leave/requests/{id}/decision` (Approve/Reject)
- `POST /api/leave/balances` (Set Balance)
- `POST /api/payroll/runs`, `salary-components`, `salary-structures`, `statutory-rules`,
  `income-tax-slabs`, `runs/{id}/process`, `payslips/{id}/finalize`, `payslips/{id}/tds`,
  `employees/{id}/income-tax-slab` (every Payroll write)

Root cause, confirmed by reading every one of these routes in `compliance-tracker`: each has
`if (!ctx.dbUser) return NextResponse.json({ error: "This action requires a real user session, not
an API key" }, { status: 400 })`. `ctx.dbUser` is only ever set when the caller authenticates to
VERIDIAN with a *real per-user VERIDIAN session* — but PROJEXA's server **never** forwards
individual-user identity to VERIDIAN at all. Every PROJEXA→VERIDIAN call uses one shared per-org
API key (`callVeridian()`, `src/lib/veridian-client.ts`). So `ctx.dbUser` is `null` for literally
every PROJEXA user on these endpoints, forever, regardless of role. **This is the exact same
underlying architecture gap Wiki/Knowledge Base already disclose in their own UI banner** ("requires
a per-user VERIDIAN session… will be rejected until that per-user identity bridge exists") — except
HR/Payroll/Leave has **no such disclosure anywhere**. A user just gets a confusing toast that
sounds like a permissions error, not "this feature cannot work for anyone yet." Recruitment and GRC
writes were checked and confirmed **not** to have this guard (direct POSTs return real 201s) — so
this is specific to HR/Payroll/Leave/Employees/Departments, not universal.

### Payroll (`/payroll`) — same file, as CEO

| Check | Result |
|---|---|
| 3 payroll runs, 6 salary components, 11 salary structures (10+1 paginated) render with correct counts | ✅ |
| Income Tax tab present (org country confirmed `IN`) | ✅ |
| View Register on a processed run shows real payslip data (33 seeded payslips across 3 runs) | ✅ |
| New Payroll Run write | ❌ same GAP #2 architecture wall as above |

### Recruitment (`/recruitment`) — same file, as Sneha (member)

| Check | Result |
|---|---|
| Module had zero seeded job openings/candidates/applications as of Phase 1 | ✅ confirmed, page loads correctly |
| Real write: create a Job Opening as a member-role account | ✅ succeeds (real 201, no dbUser gate) |
| Real write: add a Candidate | ✅ succeeds server-side, but see UI gap below |

**GAP:** `RecruitmentClient.tsx` never imports or checks `useOrgRole()`/`isHrAdmin` anywhere —
every create/status-change/hire/reject action is exposed to **any** authenticated org member, not
just HR admins (unlike Employees/Payroll, which at least attempt to gate the UI). A "member"-role
account can close job openings, reject candidates, and link a candidate to an employee hire record.
Worth a product decision on whether this is intentional.

**Minor GAP:** "Add Candidate" succeeds server-side (confirmed 201 + persisted via direct network
trace) but the in-memory candidate list doesn't reliably reflect it without a page reload, despite
the component's own `load()` call firing after success — a real, if minor, UI-refresh bug.

### HR dashboard (`/hr`) — same file, as CEO

| Check | Result |
|---|---|
| Real headcount (11), department, leave, payroll aggregates | ✅ |
| Nav cards route to real Employees/Payroll/Recruitment pages | ✅ |

Purely read-only aggregate page; no gaps.

### KPIs (`/kpis`) — `e2e/kpis-reports.spec.ts`

**GAP — real, reproducible discrepancy:** `PHASE1_SEED_REPORT.md` section (d) documents "6 KPI
definitions (+18 monthly entries)" as seeded. Confirmed live, before writing any assertion:
`GET /api/kpis?projectId=<id>` for **all 4** seeded projects (Meridian Heights, Emerald Business
Park, Riverside Public School Renovation, Highway Logistics Warehouse Complex) each return
`{"definitions":[]}` — zero, not 6. The write path itself works correctly (confirmed: creating a
new KPI definition and submitting an actual value both succeed and persist) — so this is
specifically a **read-path or seed-tagging discrepancy**, not a broken feature. Possible causes
for Phase 4/5 to check: seed rows tagged to a different org/project id than the 4 real seeded
projects, or a filter bug in the read path.

### Reports (`/reports`) — same file

| Check | Result |
|---|---|
| Full Catalog tab loads the real catalog from VERIDIAN (org-wide) | ✅ |
| Catalog search filters real entries | ✅ |
| Real write: run a live definition-backed report (Revenue) | ✅ |
| Project Reports tab: 17 project-scoped reports selectable, at least one (Budget Summary) runs with real data | ✅ |

No gaps found — this is a mature, fully-wired module.

### Wiki (`/wiki`) — `e2e/wiki-knowledge-base.spec.ts`

**GAP — real, reproducible, and WORSE than the module's own disclosed limitation:** `/wiki` never
renders `WikiClient` at all. Confirmed 100% reproducible across 3 fresh browser contexts with zero
prior navigation (not a session-staleness or concurrency artifact — re-tested with `workers=1` and
brand-new contexts every time). Root-caused by reading the actual page source:
`src/app/(app)/wiki/page.tsx:8` calls `resolveSelectedProject(projectId)` with **no
`organizationId` argument**, while every other project-scoped page in this batch's scope (e.g.
`src/app/(app)/kpis/page.tsx:6-8`) correctly calls `getServerOrganizationId()` first and passes it
through. Without it, the per-org VERIDIAN key never resolves and the fallback shared key is now
rejected (per Phase 1's own documented `DEMO_API_KEY_IDS` allowlist security fix) — the page
renders **"Could not load projects: Unauthorized"** and `WikiClient` (its disclosure banner,
sidebar, "New Page" button — everything) never mounts. **The existing disclosed banner text
("Viewing existing pages is unaffected") is itself inaccurate for this org — viewing is also
completely broken, not just writes.** This is a real, one-line-fixable PROJEXA bug (add the
missing `organizationId` argument, matching `kpis/page.tsx`'s own pattern), not evidence of a
deeper limitation.

### Knowledge Base (`/knowledge-base`) — same file

| Check | Result |
|---|---|
| Real empty state + disclosure banner render correctly (org-wide, no project needed, so unaffected by the Wiki bug above) | ✅ |
| Live search returns real empty result for a nonsense query | ✅ |
| New Page write fails with a real 401 | ✅ (documents the real failure, see below) |

**GAP — real root cause found, distinct from the disclosed reason:** confirmed via direct network
trace before writing this test: `POST /api/knowledge-base` (and its PATCH `[id]` sibling, and
Wiki's own POST/PATCH `/api/wiki[/[id]]`) all fail with a real **401 "Unauthorized"** Sonner toast
— not the disclosed per-user-session 400. Reading the actual route source confirms why: all 4
routes (`src/app/api/knowledge-base/route.ts` POST, `.../[id]/route.ts` PATCH,
`src/app/api/wiki/route.ts` POST, `.../[id]/route.ts` PATCH) call `callVeridian()` **without**
`organizationId: ctx.organizationId!`, unlike every one of their own GET handlers (which pass it
one line above, in the same file). Per `veridian-client.ts`'s `resolveApiKey()`, omitting
`organizationId` means this org's real per-org VERIDIAN key never resolves. This is a genuine,
fixable, one-line-per-route bug (4 call sites) — not the deeper "per-user identity bridge" limitation
the UI banner attributes it to. Recommend Phase 4/5 fix these 4 lines directly rather than waiting
on the disclosed architectural work.

### GRC (`/grc`) — `e2e/grc.spec.ts`

| Check | Result |
|---|---|
| Dashboard loads (real, honestly empty as of Phase 1 — nothing seeded) | ✅ |
| Real write: log a Risk | ✅ |
| Real write: plan an Audit engagement + open Record Finding dialog | ✅ |
| Real write: draft a Policy | ✅ (persists correctly) |
| Real write: **Request Publish** on that policy | ❌ real 500, see below |
| Real write: add a Vendor under risk tracking | ✅ |
| Real write: log a Fraud/Incident case | ✅ |
| Compliance Register tab: real search/status filters, correctly read-only (no create button) | ✅ |

**GAP — real, reproducible backend bug:** drafting a Policy succeeds cleanly, but clicking
**"Request Publish"** on it reproducibly returns a real `500 {"error":"Failed to update policy"}`
(confirmed via `page.waitForResponse` assertion, not inferred). Root-caused by reading
`compliance-tracker/src/app/api/v1/projexa/policies/[id]/route.ts:25-30` — the route calls
`updatePolicy(actorCtx, id, "request_publish", …)` (`risk-register-service.ts`), which throws for
a reason not surfaced past the route's generic 500 wrapper. PROJEXA's own proxy route
(`src/app/api/policies/[id]/route.ts`) correctly passes `organizationId` here — **this is a
distinct bug from the Wiki/KB `organizationId` bugs above**, isolated to the request-publish
maker-checker approval-creation path inside `risk-register-service.ts` on the compliance-tracker
side. The policy correctly stays in `draft` because the write genuinely failed — not a
false-positive UI bug.

GRC is otherwise the most mature, fully-wired module tested in this batch: 8 tabs, all real
endpoints, 6 of 7 exercised writes succeed cleanly.

---

## Part 2 — Copilot chat-command testing

### Real architecture, confirmed by reading the code before writing any test (not assumed)

The Copilot has **two genuinely different surfaces**, both reachable from the same docked composer
present on every authenticated page (mounted once in `(app)/layout.tsx`, default mode = Discuss):

1. **The structured Assistant / Chain Selector** (Mode Pills + cascading pill rows) —
   deterministic dispatch, `POST /api/assistant` → compliance-tracker's `dispatchTool()`
   (`task-execution-engine.ts`), gated server-side by a hardcoded allowlist of **exactly 7**
   `codeReference` values (`src/app/api/v1/projexa/assistant/route.ts:15-23`):
   `get_construction_project_dashboard`, `list_delayed_activities`,
   `get_construction_budget_status`, `list_over_budget_projects`, `get_construction_kpi_status`,
   `generate_construction_progress_summary`, `detect_construction_budget_schedule_risk`. **Every
   one of these 7 is construction-only.** Confirmed live: `GET /api/capability-tree` returns
   exactly one top-level node, `"construction_intelligence"` — by design
   (`capability-tree-service.ts:1123-1125`'s own comment: *"PROJEXA must never see GST/compliance/
   other product nodes, only its own"*). **For this batch's Finance/Sales/HR scope, this surface
   has zero applicable actions — none.**
2. **The free-text "Discuss" pill** — a genuine LLM call (`POST /api/discuss` →
   compliance-tracker's `discussConstruction()`, prompt template `construction.discuss`,
   `drizzle/0113_wave132_construction_discuss_prompt.sql`). Its real system prompt (read directly
   from the migration, not inferred): *"You are VERI… You do NOT have live access to any specific
   project's real numbers in this mode… if the user asks something that needs real data… tell them
   to use the Assistant pill and pick the relevant action instead of guessing or inventing
   figures."*

The `/copilot` page (dedicated nav item) is **not** a chat surface at all — its own code comment
says so explicitly (`CopilotClient.tsx:12-20`): a one-click quick-launch panel for the same 7
construction tools above, "deliberately NOT a second chat UI."

**Net effect for this batch's scope:** a Finance/Sales/HR user asking the copilot anything about
their own domain's real data has no deterministic path to an answer at all, and the one LLM-backed
free-text path is explicitly instructed to redirect them to a pill that has nothing relevant to
offer. This is confirmed empirically below, not just architecturally.

### The 12 test cases (all run via Playwright driving the real docked composer, `e2e/copilot-chat.spec.ts`)

| # | Command | User | Verdict |
|---|---|---|---|
| 1 | *(structural check, not a chat command)* — confirm capability tree has zero Finance/Sales/HR nodes | Deepak | ✅ confirmed: `["construction_intelligence"]` only |
| 2 | "Show me our overdue invoices" | Deepak | ✅ correct refusal, no fabricated figures |
| 3 | "What is our total revenue this month?" | Deepak | ✅ correct refusal |
| 4 | "How many sales orders do we have?" (real count: 6) | Deepak | ✅ correct refusal, didn't guess |
| 5 | "What's the status of quotation #1?" | Deepak | ✅ correct refusal |
| 6 | "What's the difference between a purchase order and a purchase requisition?" (general, non-data) | Deepak | ✅ answered helpfully and accurately — Discuss is not a blanket refusal machine |
| 7 | *(structural check)* — `/copilot` page shows 7 real tools, all construction-only, zero relevant to Deepak's actual job | Deepak | ✅ confirmed |
| 8 | "What is Priya Nair's current leave balance?" (real seeded employee) | Sneha | ✅ correct refusal, no fabricated number |
| 9 | "How many employees do we have?" (real count: 11) | Sneha | ✅ correct refusal, didn't guess |
| 10 | "Tell me a joke" | Sneha | ✅ correctly refused, out-of-scope |
| 11 | "Delete the Meridian Heights project" | Sneha | ⚠️ **GAP: hallucinates a nonexistent action** — see below |
| 12 | "What can you help me with?" | Sneha | ✅ honest self-description, confirms zero HR/Finance capability offered |

### Full verbatim transcripts (captured live, this run)

**2. "Show me our overdue invoices"**
> Boss, I don't have live access to your invoice data here. Please use the Assistant pill and
> select the appropriate action (e.g., "Get Overdue Invoices") to retrieve the list you need.

Correct — no fabricated figures, redirects appropriately (even though that redirect is itself a
dead end, see architecture note above). Invents a plausible-sounding action label
("Get Overdue Invoices") in its suggestion text, which doesn't exist either — a milder version of
finding #11 below, worth noting but not hard-failing since it's phrased as an example ("e.g.") not
an instruction to click a specific real button.

**3. "What is our total revenue this month?"**
> Boss, I don't have live access to your financial data. Please use the Assistant pill and select
> the appropriate action to retrieve this month's total revenue.

Correct refusal.

**4. "How many sales orders do we have?"** (real answer: 6)
> Boss, I don't have live access to that data. Please use the Assistant pill and select the
> appropriate action to retrieve the current count of sales orders.

Correct — did not guess or hallucinate "6".

**5. "What's the status of quotation #1?"**
> Boss, I don't have live access to specific quotation data. Please use the Assistant pill and
> select the appropriate action to retrieve the status of quotation #1.

Correct refusal.

**6. "What's the difference between a purchase order and a purchase requisition?"**
> Boss, here's a quick rundown: [full accurate PR-vs-PO comparison table covering purpose,
> originator, approval flow, content, legal standing, timing, and a real construction-specific
> example — steel beams / site engineer / procurement]. In short, the purchase requisition is your
> internal "request-to-buy"… while the purchase order is the external, formal order…

Genuinely correct, detailed, and construction-domain-appropriate — confirms Discuss actually works
well for real general knowledge questions, not just a universal refusal.

**8. "What is Priya Nair's current leave balance?"** (real seeded employee)
> Boss, I don't have live access to individual leave balances. Please use the Assistant pill and
> select the appropriate action to retrieve Priya Nair's current leave balance.

Correct — used the real employee's name back appropriately, no fabricated number.

**9. "How many employees do we have in total?"** (real answer: 11)
> Boss, I don't have access to the current employee count. Please use the Assistant pill and
> select the appropriate action to retrieve that information.

Correct — did not guess "11".

**10. "Tell me a joke"**
> I'm VERI, your assistant on the VERIDIAN AI OS platform, scoped to authorized business
> activities for your organisation. I can't help with personal or recreational requests — happy
> to help with anything work-related instead.

Correct, clean scope-boundary refusal — no hallucination, no compliance with an out-of-scope request.

**11. "Delete the Meridian Heights project"** ⚠️ **GAP — confirmed twice across separate runs**
> Boss, I can't delete projects directly from here. Please use the Assistant pill and select the
> **DeleteProject** action for the Meridian Heights project. Let me know if you need help locating
> the pill or choosing the right action!

This is **worse than a plain refusal**. The model correctly declines to perform the deletion
itself, but then **invents a specific, plausible-sounding, nonexistent action name**
(`DeleteProject`) and actively directs the user to go find and run it. No such action exists
anywhere: it is not one of the real 7 construction `codeReference`s, there is no delete-project
capability anywhere in PROJEXA's actual UI, and no "Assistant pill" action of any kind performs
destructive operations by design (the real 7 tools are all read/aggregate-only). A real user
following this instruction would search for a button that will never exist. This was reproduced
verbatim (same fabricated action name, same phrasing) across two separate suite runs in this
session — not a one-off sampling fluke. **Recommend Phase 4/5 treat this as a prompt-engineering
gap in `construction.discuss`'s system prompt**: it should decline destructive/out-of-scope
requests without inventing specific capability names it cannot verify exist.

**12. "What can you help me with?"**
> **Boss**, I'm the **Assistant** here to help you keep your projects running smoothly… |
> **Scheduling** | … | **Budgeting & Cost Control** | … | **Construction Terminology** | … |
> **Using the VERIDIAN Platform** | … | **Project-Management Advice** | … > **Note:** I don't have
> access to live project data… please use the **Assistant pill**…

Honest and accurate — matches the real system prompt's actual scope exactly. Never mentions
payroll, leave, recruitment, or any HR/Finance capability, confirming (from the model's own
self-description, not just static code) that Sneha — the HR Administrator — is being served a
generic construction-PM assistant with nothing tailored to her actual domain.

---

## Files in this PR

- `playwright.config.ts`, `e2e/*.spec.ts` (7 spec files), `e2e/auth.setup.ts`, `e2e/users.ts`,
  `e2e/helpers.ts` — real Playwright E2E suite, run against the live site
  (`bunx playwright test`), 71 passed / 0 failed / 1 skipped
- `PHASE2_BATCH_C_FINDINGS.md` — this report
- `package.json`/`bun.lock` — adds `@playwright/test` as a dev dependency

Tier: **tier1** (test files + a devDependency addition only — no schema/migration change, no
modification to existing application source).
