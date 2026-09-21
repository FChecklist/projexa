// R48_API_WRITES_WITHOUT_ROLE_CHECK_01 -- the server-side role gate for every
// mutating /api route.
//
// THE DEFECT THIS CLOSES, measured on this tree at the time this file was
// written (see api-write-policy.test.ts, which recomputes all of these from
// the filesystem on every run and is the live source of truth -- these
// counts drift as routes are added, don't trust the numbers below without
// re-running it):
//   [R66 code-quality fix, 2026-09-01: re-measured at 254 route.ts files as
//   of this note, up from the 216 below -- confirms the drift this comment
//   now warns about.]
//   216 route.ts files under src/app/api
//   209 call requireAuth(); 4 more use requireCompanyScope() (which calls
//       requireAuth() AND verifies a real membership row); 3 are public by
//       design (contact, org/invites/preview, org/provision)
//   159 export at least one of POST/PUT/PATCH/DELETE
//    13 of those 159 called requireRole()
//  => 146 mutating routes had NO role check at all: any authenticated member of
//     the tenant, including the read-only `client_viewer`, could run payroll,
//     create employees, raise purchase orders or rewrite the BOQ.
//
// WHY THIS IS ONE TABLE AND ONE CHOKE POINT RATHER THAN 146 COPIES OF
// requireRole(): a hand-maintained per-file guard is exactly the mechanism that
// already drifted on the page-authentication side (middleware.ts's
// PROTECTED_PREFIXES, which lost /copilot to a stale "/ai-copilot" entry). A
// route added tomorrow with no requireRole() call is invisible; a route added
// tomorrow with no entry in this table fails api-write-policy.test.ts. The
// table is checked in because middleware cannot read the filesystem at runtime
// -- but it is not maintained on trust.
//
// THE UPSTREAM CANNOT DO THIS FOR US: callVeridianRaw() authenticates to
// VERIDIAN with an ORG-scoped Bearer key resolved by resolveApiKey({organizationId})
// (src/lib/veridian-client.ts). No user id and no role crosses that boundary, so
// VERIDIAN is structurally incapable of a per-user role refusal on these calls.
// This side is the only place the gate can exist.
//
// THIS IS A SERVER-SIDE GATE, NOT A UI ONE. UAT criterion C17 fails a control
// that is "blocked only in the UI while the API allows it"; hiding a button is a
// UX affordance and never the boundary.

import { ROLE_GROUPS, type OrgRole, type RoleGroupName } from "./roles";

// "PUBLIC" means deliberately ungated at the role layer -- the three routes
// that are public by design and carry no requireAuth() either.
export type WriteTier = RoleGroupName | "PUBLIC";

// The HTTP methods this policy governs. GET is deliberately absent: read-side
// role scoping is a separate, narrower concern tracked under cause key
// API_READ_WITHOUT_ROLE_CHECK, and blanket-gating reads would break the
// dashboards every role is legitimately expected to see.
export const MUTATING_METHODS: ReadonlySet<string> = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Keyed by the route's path under src/app/api, dynamic segments included
// verbatim as they appear on disk ("[id]"), so the drift test can compare this
// table against the filesystem by exact string equality in both directions.
//
// Tier rationale, in one line each:
//   ORG_ADMIN    owner/admin -- org membership, security/compliance posture,
//                HR and payroll master data, the general ledger.
//   PM_OR_ABOVE  owner/admin/pm -- money, contracts, commercial pipeline,
//                programme/schedule authority, BOQ scope, design intent.
//   FIELD        + site_engineer -- work actually recorded on site, and the
//                site-facing document/knowledge surfaces around it.
//   ANY_MEMBER   every role except the read-only client_viewer -- self-service
//                actions on one's OWN record (own leave, own time, own to-dos).
//   ANY_ROLE     every role including client_viewer -- notifications, replying
//                in a conversation, accepting an invite addressed to you.
export const API_WRITE_POLICY: Readonly<Record<string, WriteTier>> = {
  "/access-review": "ORG_ADMIN",
  "/access-review/certifications/[id]": "ORG_ADMIN",
  // WO-PROJEXA-AI-LINK-001: creating/rotating/revoking your OWN AI Link
  // token -- same self-service-on-own-record shape as /todos below.
  "/ai-link": "ANY_MEMBER",
  // Applying an AI-proposed action (the ALLOWED_VERBS allowlist) against a
  // todo in the caller's own org. Same tier as /todos/[id] itself, which
  // this route is a verb-restricted way of writing to.
  "/ai/apply": "ANY_MEMBER",
  "/assistant": "ANY_MEMBER",
  "/attendance": "FIELD",
  // R67 D-30: the whole-roster daily sheet. Same tier as the one-worker
  // write it batches -- marking a site's attendance is field work, and a
  // batch of the same act is not a more privileged one.
  "/attendance/bulk": "FIELD",
  // R67 D-31: minting a public, unauthenticated link to this project's
  // attendance and labour cost is a commercial disclosure, not a site record --
  // same tier as /work-progress/report/share, which shares the identical
  // mechanism.
  "/attendance/summary/share": "PM_OR_ABOVE",
  "/audit-engagements": "ORG_ADMIN",
  "/audit-findings": "ORG_ADMIN",
  "/audit-findings/[id]": "ORG_ADMIN",
  // Sumeet requirement #3 (2026-09-18): same tier as /change-orders below --
  // both routes' POST/PATCH call requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE).
  "/billing-claims": "PM_OR_ABOVE",
  "/billing-claims/[id]": "PM_OR_ABOVE",
  "/board": "FIELD",
  "/change-orders": "PM_OR_ABOVE",
  "/change-orders/[id]": "PM_OR_ABOVE",
  // R67 C-03/C-05: the composer's PREVIEW. It is a POST only because the
  // sentence goes in the body -- VERIDIAN's own handler gates it on READ
  // scope and returns executed:false on every response, so classifying
  // "approve VO-014" approves nothing. Same tier as /assistant and /tasks
  // for the same reason: any member may ask what would happen, and what they
  // are actually allowed to RUN is re-checked at execution.
  "/classify": "ANY_MEMBER",
  "/companies": "ORG_ADMIN",
  "/compliance-register": "ORG_ADMIN",
  "/construction-budget/lines": "PM_OR_ABOVE",
  // Real-screen conversion (2026-08-30): /construction-materials and
  // /construction-materials/inbound retired -- both routes are deleted
  // (module #31 Site Materials folded into the real Materials module,
  // #17; see MaterialsClient.tsx's own header comment). Their writes now
  // go through /api/materials, already covered by its own policy entry
  // below.
  // Public by design: the unauthenticated marketing contact form.
  "/contact": "PUBLIC",
  "/conversations": "ANY_ROLE",
  "/conversations/[id]/messages": "ANY_ROLE",
  "/credit-notes": "PM_OR_ABOVE",
  "/credit-notes/[id]/submit": "PM_OR_ABOVE",
  "/customers": "PM_OR_ABOVE",
  "/customers/[id]": "PM_OR_ABOVE",
  "/design-materials": "PM_OR_ABOVE",
  "/discuss": "ANY_MEMBER",
  "/documents": "FIELD",
  "/documents/[id]": "FIELD",
  "/documents/[id]/dispose": "FIELD",
  // R67 D-15: uploading a corrected copy of a document is the same act, by the
  // same person, as uploading the original -- a site engineer who scanned a
  // permit crooked must be able to replace it without an admin. It is also
  // strictly additive: a new version never overwrites or deletes the bytes
  // already stored, so the worst case is one extra version in the list.
  "/documents/[id]/versions": "FIELD",
  "/drawings": "FIELD",
  // R67 D-11: same tier as /drawings and /documents/[id] -- the people who
  // upload a drawing are the people who fix its name, its discipline, and the
  // upload they made by mistake. The destructive half is gated far harder than
  // by role anyway: VERIDIAN refuses a hard delete outside the 24-hour window,
  // under a legal hold, or with anything referencing the row.
  "/drawings/[id]": "FIELD",
  // WO-PROJEXA-AI-LINK-001 Part 2: manually triggering the digest email for
  // the caller's OWN membership -- self-service on one's own record, same
  // shape as /todos.
  "/email/send-digest": "ANY_MEMBER",
  // Owner directive 2026-09-19 (org email-digest schedule): Postmark's
  // inbound webhook. Public by design, same posture as
  // /internal/email-digest-cadence/run below -- it has no user session and
  // no org context at request time (a reply's org/membership are resolved
  // FROM the request body itself), so its real gate is the HTTP Basic Auth
  // check inside the route (src/app/api/email/inbound/route.ts's own
  // isAuthorized()), not a role.
  "/email/inbound": "PUBLIC",
  "/employees": "ORG_ADMIN",
  "/employees/[id]": "ORG_ADMIN",
  "/expenses": "PM_OR_ABOVE",
  "/ffe": "PM_OR_ABOVE",
  "/ffe/[id]": "PM_OR_ABOVE",
  "/floor-plans": "PM_OR_ABOVE",
  "/floor-plans/[id]": "PM_OR_ABOVE",
  "/floor-plans/[id]/placements": "PM_OR_ABOVE",
  "/floor-plans/[id]/placements/[placementId]": "PM_OR_ABOVE",
  "/floor-plans/[id]/rooms": "PM_OR_ABOVE",
  "/floor-plans/[id]/rooms/[roomId]": "PM_OR_ABOVE",
  "/fraud-cases": "ORG_ADMIN",
  "/fraud-cases/[id]": "ORG_ADMIN",
  "/hr/departments": "ORG_ADMIN",
  // Creating/recreating the org's Google Sheet, and clearing the connection
  // record -- an org-wide, privileged action (creates a file and shares it
  // with every member's email), same tier as /org/repair below, which this
  // mirrors. Both routes' handlers call requireRole(ctx, ROLE_GROUPS.ORG_ADMIN)
  // directly; this entry is what makes middleware agree before the route is
  // ever reached.
  "/integrations/google-sheets/setup": "ORG_ADMIN",
  "/integrations/google-sheets/disconnect": "ORG_ADMIN",
  // Session-authed "push to sheet now" button: re-syncs data the caller can
  // already see elsewhere in the app, so any real member may trigger it --
  // excludes the read-only client_viewer the same way /timesheets does for
  // a comparable self-service action.
  "/integrations/google-sheets/refresh": "ANY_MEMBER",
  // PUBLIC, matching /internal/email-digest-cadence/run immediately below:
  // this is Google's Apps Script calling in with NO PROJEXA session at all,
  // authenticated instead by a per-org bearer token verified inside the
  // route itself (see its own header comment) -- there is no role to check
  // at the middleware layer for a caller who was never a PROJEXA user.
  "/integrations/google-sheets/webhook": "PUBLIC",
  // Public by design, same posture as /contact and /org/provision, but for a
  // different reason: this is Vercel Cron's own entry point (see vercel.json's
  // "crons"), triggered with no user session and no org context at all -- its
  // real gate is the CRON_SECRET bearer check inside the route itself
  // (email-digest-cadence/run/route.ts's own isAuthorized()), not a role.
  "/internal/email-digest-cadence/run": "PUBLIC",
  "/inventory/items": "PM_OR_ABOVE",
  "/inventory/stock-entries": "FIELD",
  "/inventory/warehouses": "PM_OR_ABOVE",
  "/journal-entries": "ORG_ADMIN",
  "/journal-entries/[id]/submit": "ORG_ADMIN",
  "/knowledge-base": "FIELD",
  "/knowledge-base/[id]": "FIELD",
  "/kpi-entries": "FIELD",
  "/kpi-entries/[id]/approve": "FIELD",
  "/kpis": "PM_OR_ABOVE",
  // R67 lane D22 (item D-68) argued PM_OR_ABOVE for the roster import, because
  // ITS importer also created vendor master records on an opt-in -- a
  // commercial decision, at the same tier as the BOQ and programme imports.
  // That importer and its /labour/import route are gone at the integration
  // merge (D-34's is the one that survives, see
  // construction-roster-import-service.ts's header), and with them the vendor
  // creation the argument rested on. The surviving route is a plain bulk load,
  // so it keeps D-34's FIELD tier below: the same write, thirty-eight times,
  // done by the same person on site. If one-click vendor creation is ever
  // folded in, this is the entry that has to move with it.
  "/labour-roster": "FIELD",
  "/labour-roster/[id]": "FIELD",
  // R67 D-34: bulk roster load. Same tier as adding one worker -- it is the
  // same write, thirty-eight times, done by the same person on site.
  "/labour-roster/import": "FIELD",
  "/leads": "PM_OR_ABOVE",
  "/leads/[id]": "PM_OR_ABOVE",
  "/leads/bulk-reassign": "PM_OR_ABOVE",
  "/leave/balances": "ORG_ADMIN",
  // Filing your OWN leave request is self-service; DECIDING one is not.
  "/leave/requests": "ANY_MEMBER",
  "/leave/requests/[id]/decision": "PM_OR_ABOVE",
  "/materials": "FIELD",
  // R67 D-36: the receipt's soft void. Same tier as recording the receipt --
  // correcting a mis-keyed delivery is the same site work as entering it,
  // and the void keeps the row rather than destroying it.
  "/materials/[id]": "FIELD",
  // R67 D-40: issuing material to site is the storekeeper's own job, the same
  // site work as recording what arrived -- so the same tier as /materials.
  "/materials/issues": "FIELD",
  "/materials/master": "FIELD",
  "/materials/master/[id]": "FIELD",
  "/meetings": "FIELD",
  "/meetings/[id]": "FIELD",
  "/meetings/[id]/outcomes": "FIELD",
  // Sumeet requirement #2 (2026-09-18): same tier as /change-orders above --
  // both routes' POST/PATCH call requireRole(ctx, ROLE_GROUPS.PM_OR_ABOVE).
  "/milestones": "PM_OR_ABOVE",
  "/milestones/[id]": "PM_OR_ABOVE",
  "/moms": "FIELD",
  "/moms/[id]": "FIELD",
  "/moms/[id]/action-items": "FIELD",
  "/moms/[id]/generate-intelligence": "FIELD",
  // Minting a share link publishes minutes outside the tenant -- PM authority,
  // not field authority. Revoking one (the [linkId] twin, keyed by link id
  // rather than meeting id since revoke doesn't need the meeting in the URL)
  // carries the same authority requirement.
  "/moms/[id]/share-links": "PM_OR_ABOVE",
  "/moms/share-links/[linkId]": "PM_OR_ABOVE",
  "/mood-boards": "PM_OR_ABOVE",
  "/mood-boards/[id]": "PM_OR_ABOVE",
  "/mood-boards/[id]/items/[itemId]": "PM_OR_ABOVE",
  "/notifications/[id]/read": "ANY_ROLE",
  "/opportunities": "PM_OR_ABOVE",
  "/opportunities/[id]": "PM_OR_ABOVE",
  "/opportunities/bulk-reassign": "PM_OR_ABOVE",
  // Accepting an invite addressed to you is how you GET a role -- gating it on
  // one would be circular.
  "/org/invites/accept": "ANY_ROLE",
  "/org/invites": "ORG_ADMIN",
  "/org/invites/[id]": "ORG_ADMIN",
  "/org-members/[id]": "ORG_ADMIN",
  // Public by design: the pre-tenancy provisioning path, called before any
  // membership row exists.
  "/org/provision": "PUBLIC",
  "/org/repair": "ORG_ADMIN",
  // R48_NO_CURRENCY_UI_01: PUT sets the org's base currency -- matches the
  // requireRole(ctx, ROLE_GROUPS.ORG_ADMIN) gate already in the route
  // (src/app/api/organization/currency/route.ts's own comment explains why
  // the gate has to live in THIS app, not on VERIDIAN's side of the call).
  "/organization/currency": "ORG_ADMIN",
  // Owner directive 2026-09-19: the org-configurable digest schedule.
  // Matches this route's own requireRole(ctx, ROLE_GROUPS.ORG_ADMIN) gate on
  // PUT -- same tier and same reasoning as /organization/currency above
  // (GET is open to any member, only an admin may change it).
  "/organization/email-schedule": "ORG_ADMIN",
  "/payroll/employees/[id]/income-tax-slab": "ORG_ADMIN",
  "/payroll/employees/[id]/tax-exemptions": "ORG_ADMIN",
  "/payroll/income-tax-slabs": "ORG_ADMIN",
  "/payroll/payslips/[id]/finalize": "ORG_ADMIN",
  "/payroll/payslips/[id]/tds": "ORG_ADMIN",
  "/payroll/runs": "ORG_ADMIN",
  "/payroll/runs/[id]/process": "ORG_ADMIN",
  "/payroll/salary-components": "ORG_ADMIN",
  "/payroll/salary-structures": "ORG_ADMIN",
  "/payroll/statutory-rules": "ORG_ADMIN",
  "/permits": "PM_OR_ABOVE",
  "/permits/[id]": "PM_OR_ABOVE",
  // R67 A-07. POST /pill-usage records one row of the CALLER'S OWN composer
  // ranking (compliance.pill_usage is keyed per org AND per user) and touches
  // no business data at all. It is self-service on one's own record in the
  // strictest sense, and a read-only client_viewer still has a composer whose
  // strip should learn what they open -- so ANY_ROLE, not ANY_MEMBER.
  "/pill-usage": "ANY_ROLE",
  "/policies": "ORG_ADMIN",
  "/policies/[id]": "ORG_ADMIN",
  "/procurement/goods-receipts": "PM_OR_ABOVE",
  "/procurement/goods-receipts/[id]/submit": "PM_OR_ABOVE",
  "/procurement/purchase-orders": "PM_OR_ABOVE",
  // R80 GAP-6: PATCH (edit a draft PO's header) and DELETE (cancel it) were
  // added to this route, which was GET-only until then. Same tier as raising
  // the PO in the first place -- withdrawing a commitment to a supplier is
  // not a lesser act than making one.
  "/procurement/purchase-orders/[id]": "PM_OR_ABOVE",
  "/procurement/purchase-orders/[id]/submit": "PM_OR_ABOVE",
  "/procurement/quotations": "PM_OR_ABOVE",
  "/procurement/requisitions": "PM_OR_ABOVE",
  "/procurement/requisitions/[id]/submit": "PM_OR_ABOVE",
  "/procurement/rfqs": "PM_OR_ABOVE",
  "/procurement/rfqs/[id]/send": "PM_OR_ABOVE",
  "/project-budgets": "PM_OR_ABOVE",
  "/project-budgets/[id]": "PM_OR_ABOVE",
  "/project-budgets/[id]/cancel": "PM_OR_ABOVE",
  "/project-budgets/[id]/submit": "PM_OR_ABOVE",
  "/projects": "PM_OR_ABOVE",
  "/projects/[id]": "PM_OR_ABOVE",
  "/punch-list": "FIELD",
  "/punch-list/[id]": "FIELD",
  "/purchase-orders": "PM_OR_ABOVE",
  "/quotations": "PM_OR_ABOVE",
  "/quotations/[id]": "PM_OR_ABOVE",
  "/quotations/[id]/convert": "PM_OR_ABOVE",
  "/quotations/[id]/revisions": "PM_OR_ABOVE",
  "/recruitment/applications": "PM_OR_ABOVE",
  // Hiring creates an employee record and a payroll liability.
  "/recruitment/applications/[id]/hire": "ORG_ADMIN",
  "/recruitment/applications/[id]/interviews": "PM_OR_ABOVE",
  "/recruitment/applications/[id]/stage": "PM_OR_ABOVE",
  "/recruitment/candidates": "PM_OR_ABOVE",
  "/recruitment/interviews/[id]/feedback": "PM_OR_ABOVE",
  "/recruitment/job-openings": "ORG_ADMIN",
  "/recruitment/job-openings/[id]/status": "ORG_ADMIN",
  // POST only because running a saved report needs a body; it is a read.
  "/reports/definitions/[id]/run": "FIELD",
  // R67 E-12 (R-136) added this route and did not declare it here, which is
  // what this file's own test exists to catch. Minting a signed link PUBLISHES
  // a report to anyone holding the URL, so it is the same tier as its sibling
  // /work-progress/report/share above -- deliberately NOT "FIELD", because
  // handing the org's cost figures outside the org is a manager's decision.
  "/reports/[reportName]/share": "PM_OR_ABOVE",
  "/rfis": "FIELD",
  "/rfis/[id]": "FIELD",
  "/risks": "PM_OR_ABOVE",
  "/risks/[id]": "PM_OR_ABOVE",
  "/sales-invoices": "PM_OR_ABOVE",
  "/sales-invoices/[id]/cancel": "PM_OR_ABOVE",
  "/sales-invoices/[id]/payments": "PM_OR_ABOVE",
  "/sales-invoices/[id]/submit": "PM_OR_ABOVE",
  "/sales-orders": "PM_OR_ABOVE",
  "/sales-orders/[id]": "PM_OR_ABOVE",
  "/sales-orders/bulk-status": "PM_OR_ABOVE",
  // R67 lane D22 (item D-48): "/schedule-tracker/import" is gone -- it proxied
  // to a VERIDIAN path that never existed. Its real replacement is
  // "/schedule/import" below, at the same tier: importing a programme rewrites
  // the whole schedule, which is a PM decision, not a field one.
  "/schedule/baselines": "PM_OR_ABOVE",
  "/schedule/import": "PM_OR_ABOVE",
  "/schedule/sprints": "PM_OR_ABOVE",
  "/schedule/sprints/[id]": "PM_OR_ABOVE",
  "/schedule/sprints/[id]/issues": "PM_OR_ABOVE",
  "/schedule/tasks": "FIELD",
  "/schedule/tasks/[id]": "FIELD",
  // R67 lane D22 (item D-49): overruling a completion percentage derived from
  // the site's own records is a PM judgement, not a field entry -- the site
  // engineer's route into this number is /work-progress, which stays FIELD.
  "/schedule/tasks/[id]/completion": "PM_OR_ABOVE",
  "/schedule/workload": "PM_OR_ABOVE",
  "/scope": "PM_OR_ABOVE",
  "/scope/[id]/approve": "PM_OR_ABOVE",
  "/scope/[id]/revisions": "PM_OR_ABOVE",
  "/scope/[id]/submit": "PM_OR_ABOVE",
  // R67 lane I (WS-I item I-05, R-177): the org's BOQ category list. Same tier
  // as the BOQ itself -- renaming a category rewrites every BOQ line carrying
  // it, and deleting one is refused only when it is in use, so this is
  // commercial master data, not a field-level setting. The "+ Add new" flow on
  // a BOQ line row POSTs here too, which is correct: someone entering a BOQ is
  // already PM_OR_ABOVE by the "/scope" entry above.
  "/scope/categories": "PM_OR_ABOVE",
  "/scope/categories/[id]": "PM_OR_ABOVE",
  // R85 Addendum 3 v4 (R-50), Phase 2/6 (E4): WHO may see cost/variance at
  // all -- ORG_ADMIN, matching compliance-tracker's own PATCH gate on this
  // exact config ("admin" role, described there as "the single most
  // important line of defense in this phase" alongside the DB CHECK
  // constraint that hard-floors client_viewer). A materially higher bar
  // than editing a BOQ's own figures (PM_OR_ABOVE, immediately above) --
  // deciding WHO can see the money is a different, more sensitive act than
  // entering it.
  "/scope/cost-visibility": "ORG_ADMIN",
  // MUST stay listed after /scope/cost-visibility above and before /scope/
  // import below (see api-write-policy.test.ts's "wildcard route ordering"
  // regression test): resolveWriteTier() walks API_WRITE_POLICY in object
  // key order and returns the first same-arity pattern match, so this
  // single-segment wildcard would otherwise shadow /scope/cost-visibility --
  // confirmed live: a PM (not ORG_ADMIN) could POST /api/scope/cost-
  // visibility and be incorrectly allowed, because /scope/[id] used to be
  // declared first and PM_OR_ABOVE > ORG_ADMIN in reachable roles. Fixed
  // 2026-09-21 (PROJEXA-E2E-001, fix/api-write-policy-ordering-shadow).
  "/scope/[id]": "PM_OR_ABOVE",
  // The NOTE that stood here -- "zero callers anywhere in src, BOQ import
  // exists only as a direct API surface with no click-reachable UI" -- was
  // true when it was written and is no longer: R67 lane D22 (item D-52, and
  // the shared ImportScreen from D-68) gave it /scope/import, reachable from
  // the "Import" action beside "+ New BOQ" and from the list's empty state.
  // The tier is unchanged and correct: importing a BOQ rewrites the priced
  // scope of the whole project.
  "/scope/import": "PM_OR_ABOVE",
  "/scope/line-items/[id]": "PM_OR_ABOVE",
  "/screen-drafts": "FIELD",
  "/screen-drafts/[id]": "FIELD",
  "/site-diary": "FIELD",
  "/site-instructions": "PM_OR_ABOVE",
  "/submittals": "FIELD",
  "/submittals/[id]": "FIELD",
  // Logging and submitting your OWN time is self-service (the route supports
  // ?mine=true); approving or rejecting somebody else's is PM authority.
  "/timesheets": "ANY_MEMBER",
  "/timesheets/[id]/approve": "PM_OR_ABOVE",
  "/timesheets/[id]/reject": "PM_OR_ABOVE",
  "/timesheets/[id]/submit": "ANY_MEMBER",
  // R67 WS-H (item H-01): submitting a whole day is the same self-action as
  // submitting one entry -- a designer submitting their OWN hours -- so it
  // carries the same policy as /timesheets/[id]/submit, not a stricter one.
  // VERIDIAN independently refuses to move anyone else's rows.
  "/timesheets/submit-day": "ANY_MEMBER",
  // R67 WS-H (item H-03): deciding a whole day at once is the same authority as
  // deciding one entry -- PM and above -- so it matches /timesheets/[id]/approve
  // rather than the designer-side submit-day beside it.
  "/timesheets/review-day": "PM_OR_ABOVE",
  // MUST stay listed after /timesheets/submit-day and /timesheets/review-day
  // above (see api-write-policy.test.ts's "wildcard route ordering"
  // regression test): resolveWriteTier() walks API_WRITE_POLICY in object
  // key order and returns the first same-arity pattern match, so this
  // single-segment wildcard would otherwise shadow /timesheets/review-day --
  // confirmed live: any member (site_engineer included, not just PM_OR_ABOVE)
  // could POST /api/timesheets/review-day and be incorrectly allowed, because
  // /timesheets/[id] used to be declared first with the looser ANY_MEMBER
  // tier. /timesheets/submit-day shares this tier already so it was never
  // observably broken, but the same shadow applied to it too. Fixed
  // 2026-09-21 (PROJEXA-E2E-001, fix/api-write-policy-ordering-shadow).
  "/timesheets/[id]": "ANY_MEMBER",
  // R52: the composer's submit target. Same class as /discuss and /todos --
  // any member may ask the assistant to do something, and what they are
  // ALLOWED to do is re-checked server-side at execution, per R53's rule that
  // classification never authorizes. Listed explicitly because
  // DEFAULT_WRITE_TIER is FIELD: without an entry an ordinary member would
  // get a 403 submitting a task, which is a denial the design does not intend.
  "/tasks": "ANY_MEMBER",
  "/todos": "ANY_MEMBER",
  "/todos/[id]": "ANY_MEMBER",
  "/vendor-risk": "ORG_ADMIN",
  "/vendors": "PM_OR_ABOVE",
  // Real-screen conversion (2026-08-30): the Vendor Master facets
  // (banking/qualification/sanction-screening/self-service portal links) --
  // all commercially/compliance sensitive vendor data, same authority level
  // as the vendor record itself.
  "/vendors/[id]": "PM_OR_ABOVE",
  "/vendors/[id]/bank-accounts": "PM_OR_ABOVE",
  "/vendors/[id]/portal-links": "PM_OR_ABOVE",
  "/vendors/[id]/portal-links/[linkId]": "PM_OR_ABOVE",
  "/vendors/[id]/qualification": "PM_OR_ABOVE",
  "/vendors/[id]/sanction-checks": "PM_OR_ABOVE",
  "/wiki": "FIELD",
  "/wiki/[id]": "FIELD",
  "/work-progress": "FIELD",
  // R67 D-28 x R67 lane D22 (item D-77): correcting or deleting one progress
  // entry is the same act, at the same authority, as recording it -- the site
  // engineer who typed 500 instead of 50 is the person who has to be able to
  // fix it, without a PM, and VERIDIAN re-runs the create path's own validation
  // on both.
  "/work-progress/[id]": "FIELD",
  "/work-progress/activities": "FIELD",
  "/work-progress/photos": "FIELD",
  "/work-progress/report/share": "PM_OR_ABOVE",
};

// A route added without a policy entry must NOT quietly inherit the weakest
// tier. api-write-policy.test.ts fails the build in that case, but if one ever
// reaches production anyway it lands on the same tier as on-site work rather
// than on "anyone".
export const DEFAULT_WRITE_TIER: WriteTier = "FIELD";

function matchesPattern(pattern: string, segments: readonly string[]): boolean {
  const patternSegments = pattern.split("/").filter(Boolean);
  if (patternSegments.length !== segments.length) return false;
  return patternSegments.every(
    (p, i) => (p.startsWith("[") && p.endsWith("]")) || p === segments[i]
  );
}

/**
 * Resolves the tier governing a concrete request path.
 *
 * `pathname` is the live URL path, e.g. "/api/floor-plans/abc/rooms/xyz".
 * Matching is exact-arity against the checked-in patterns, with dynamic
 * segments treated as single-segment wildcards. A path that matches nothing
 * (an unknown sub-path under a known route, which Next.js would 404 anyway)
 * falls back to the nearest ANCESTOR pattern, and finally to
 * DEFAULT_WRITE_TIER -- never to "allow".
 */
export function resolveWriteTier(pathname: string): WriteTier {
  const withoutApi = pathname.replace(/^\/api/, "");
  const segments = withoutApi.split("/").filter(Boolean);
  if (segments.length === 0) return DEFAULT_WRITE_TIER;

  const patterns = Object.keys(API_WRITE_POLICY);

  for (const pattern of patterns) {
    if (matchesPattern(pattern, segments)) return API_WRITE_POLICY[pattern];
  }

  // Nearest ancestor: longest pattern that matches a leading slice of the path.
  let best: { depth: number; tier: WriteTier } | null = null;
  for (const pattern of patterns) {
    const depth = pattern.split("/").filter(Boolean).length;
    if (depth >= segments.length) continue;
    if (!matchesPattern(pattern, segments.slice(0, depth))) continue;
    if (!best || depth > best.depth) best = { depth, tier: API_WRITE_POLICY[pattern] };
  }
  return best?.tier ?? DEFAULT_WRITE_TIER;
}

/**
 * The single decision function. Returns null when the request is permitted, or
 * a reason string when it must be refused with 403.
 *
 * `role` is the caller's `memberships.role` for the org this request is scoped
 * to. A null role means "authenticated but no resolved membership" -- that is
 * requireAuth()'s 400/503 territory, not a 403, so this returns null and lets
 * the route handler produce the accurate status.
 */
export function checkApiWriteAccess(
  method: string,
  pathname: string,
  role: OrgRole | string | null
): { allowed: true } | { allowed: false; tier: Exclude<WriteTier, "PUBLIC">; allowedRoles: readonly string[] } {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return { allowed: true };

  const tier = resolveWriteTier(pathname);
  if (tier === "PUBLIC") return { allowed: true };
  if (role == null) return { allowed: true };

  const allowedRoles = ROLE_GROUPS[tier] as readonly string[];
  if (allowedRoles.includes(role)) return { allowed: true };
  return { allowed: false, tier, allowedRoles };
}
