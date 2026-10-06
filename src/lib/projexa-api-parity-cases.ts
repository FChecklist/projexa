// AUDIT-100 A2: the golden request set of the PARITY CONTRACT between PROJEXA's Next pipeline (src/middleware.ts + src/app/api/**/route.ts)
// and the Supabase Edge Function `projexa-api` (compliance-tracker supabase/functions/projexa-api). Every route the function answers, every
// method, every role tier, signed out, no organisation, another organisation, a failed membership read, an organisation with no VERIDIAN key,
// and the upstream's failure shapes. src/lib/projexa-api-parity.test.ts runs these through the REAL Next pipeline and records what it answered
// (ai-os/audit37/projexa-api/parity.golden.json); compliance-tracker's projexa-api-edge-parity.test.ts replays the same file through the edge
// handler and must get the same status, body, Retry-After and upstream calls.

export const ROLES = ["owner", "admin", "pm", "site_engineer", "member", "client_viewer"] as const;
/** null_role (batch 5): a membership whose role is empty. The write gate lets it through (role == null), a handler's own requireRole() does
 *  not: the one case that tells the own-role check apart from the gate (every own role set equals its route's write tier today). */
export type Who = (typeof ROLES)[number] | "signed_out" | "no_org" | "wrong_org" | "membership_error" | "no_key" | "null_role";

export const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const ORG_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export type Identity = { sub: string; email: string | null; membership: { organization_id: string; role: string | null } | null | "error" };
const sub = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const IDENTITIES: Record<Exclude<Who, "signed_out">, Identity> = {
  owner: { sub: sub(1), email: "owner@a.test", membership: { organization_id: ORG_A, role: "owner" } },
  admin: { sub: sub(2), email: "admin@a.test", membership: { organization_id: ORG_A, role: "admin" } },
  pm: { sub: sub(3), email: "pm@a.test", membership: { organization_id: ORG_A, role: "pm" } },
  site_engineer: { sub: sub(4), email: "site@a.test", membership: { organization_id: ORG_A, role: "site_engineer" } },
  member: { sub: sub(5), email: "member@a.test", membership: { organization_id: ORG_A, role: "member" } },
  client_viewer: { sub: sub(6), email: null, membership: { organization_id: ORG_A, role: "client_viewer" } },
  no_org: { sub: sub(7), email: "nobody@a.test", membership: null },
  wrong_org: { sub: sub(8), email: "pm@b.test", membership: { organization_id: ORG_B, role: "pm" } },
  membership_error: { sub: sub(9), email: "flaky@a.test", membership: "error" },
  no_key: { sub: sub(10), email: "owner@c.test", membership: { organization_id: ORG_C, role: "owner" } },
  null_role: { sub: sub(11), email: "norole@a.test", membership: { organization_id: ORG_A, role: null } },
};
export const ORG_KEYS: Record<string, string> = { [ORG_A]: "key-org-a", [ORG_B]: "key-org-b" };

export type Upstream =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "text"; status: number; status_text: string; text: string }
  /** the connection is refused (no response at all) */
  | { kind: "refused" };

/** raw_body (batch 5): the request body sent AS TEXT, for the empty / invalid / null bodies a lenient or defaulted body read must handle. */
export type ParityCase = { name: string; method: string; path: string; body?: unknown; raw_body?: string; who: Who; upstream: Upstream };
export type UpstreamCall = { method: string; path: string; authorization: string | null; acting_user: string | null; acting_email: string | null; content_type: string | null; body: unknown };
/** cache_control: present only when the answer sets a Cache-Control other than "no-store" (both sides normalise the same way). */
export type Outcome = { status: number; body: unknown; retry_after: string | null; upstream_calls: UpstreamCall[]; cache_control?: string };

const OK: Upstream = { kind: "json", status: 200, body: { ok: true, figures: { contractValue: "1000.00", percentByValue: 42 }, rows: [{ id: "r1" }] } };

/** One request per route+method the function answers (the edge's whole allowlist: a route added to projexa-api-routes.json must appear here). */
export const REQUESTS: { route: string; method: string; path: string; body?: unknown }[] = [
  { route: "/api/dashboard/project/:projectId", method: "GET", path: "/api/dashboard/project/p-1" },
  { route: "/api/exceptions", method: "GET", path: "/api/exceptions?projectId=p%201" },
  { route: "/api/reports/boq-analysis", method: "GET", path: "/api/reports/boq-analysis?projectId=p-1&sortBy=margin&ignored=1" },
  { route: "/api/scope/line-items/:id", method: "PATCH", path: "/api/scope/line-items/li-1", body: { qtyProject: "3", actorEmail: "someone@else.test" } },
  { route: "/api/documents/:id", method: "GET", path: "/api/documents/d-1" },
  { route: "/api/documents/:id", method: "PATCH", path: "/api/documents/d%2F1", body: { name: "Permit scan.pdf", actorEmail: "evil@x.test" } },
  { route: "/api/drawings/:id/document-url", method: "GET", path: "/api/drawings/dr-1/document-url" },
  { route: "/api/permits/:id", method: "GET", path: "/api/permits/pm-1" },
  { route: "/api/permits/:id", method: "PATCH", path: "/api/permits/pm-1", body: { status: "approved" } },
  { route: "/api/permits/:id", method: "DELETE", path: "/api/permits/pm-1" },
  // AUDIT-100 A2 batch 2: the 40 most-used plain proxies of the online screens (scripts/projexa-api-candidates.mjs derived each spec from the
  // handler's source; these requests record what the REAL handler answers). A list read forwards its whole query string, a create answers 201.
  { route: "/api/vendors", method: "GET", path: "/api/vendors" },
  { route: "/api/vendors", method: "POST", path: "/api/vendors", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/companies", method: "GET", path: "/api/companies" },
  { route: "/api/companies", method: "POST", path: "/api/companies", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/customers", method: "GET", path: "/api/customers?status=open&q=a%20b" },
  { route: "/api/customers", method: "POST", path: "/api/customers", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/employees", method: "GET", path: "/api/employees?status=open&q=a%20b" },
  { route: "/api/employees", method: "POST", path: "/api/employees", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/hr/departments", method: "GET", path: "/api/hr/departments" },
  { route: "/api/hr/departments", method: "POST", path: "/api/hr/departments", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/inventory/items", method: "GET", path: "/api/inventory/items" },
  { route: "/api/inventory/items", method: "POST", path: "/api/inventory/items", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/accounts", method: "GET", path: "/api/accounts" },
  { route: "/api/inventory/warehouses", method: "GET", path: "/api/inventory/warehouses" },
  { route: "/api/inventory/warehouses", method: "POST", path: "/api/inventory/warehouses", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/recruitment/candidates", method: "GET", path: "/api/recruitment/candidates" },
  { route: "/api/recruitment/candidates", method: "POST", path: "/api/recruitment/candidates", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/recruitment/job-openings", method: "GET", path: "/api/recruitment/job-openings" },
  { route: "/api/recruitment/job-openings", method: "POST", path: "/api/recruitment/job-openings", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/access-review", method: "GET", path: "/api/access-review?status=open&q=a%20b" },
  { route: "/api/access-review", method: "POST", path: "/api/access-review", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/audit-engagements", method: "GET", path: "/api/audit-engagements" },
  { route: "/api/audit-engagements", method: "POST", path: "/api/audit-engagements", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/board", method: "GET", path: "/api/board?projectId=p%201&ignored=1" },
  { route: "/api/board", method: "PATCH", path: "/api/board", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/ffe", method: "GET", path: "/api/ffe?projectId=p%201&ignored=1" },
  { route: "/api/ffe", method: "POST", path: "/api/ffe", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/leave/requests", method: "GET", path: "/api/leave/requests?status=open&q=a%20b" },
  { route: "/api/leave/requests", method: "POST", path: "/api/leave/requests", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/payroll/runs", method: "GET", path: "/api/payroll/runs" },
  { route: "/api/payroll/runs", method: "POST", path: "/api/payroll/runs", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/payroll/salary-components", method: "GET", path: "/api/payroll/salary-components" },
  { route: "/api/payroll/salary-components", method: "POST", path: "/api/payroll/salary-components", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/requisitions", method: "GET", path: "/api/procurement/requisitions" },
  { route: "/api/procurement/requisitions", method: "POST", path: "/api/procurement/requisitions", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/rfqs", method: "GET", path: "/api/procurement/rfqs" },
  { route: "/api/procurement/rfqs", method: "POST", path: "/api/procurement/rfqs", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/projects/:id", method: "PATCH", path: "/api/projects/x-1", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/sales-invoices", method: "GET", path: "/api/sales-invoices?status=open&q=a%20b" },
  { route: "/api/sales-invoices", method: "POST", path: "/api/sales-invoices", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/schedule/gantt", method: "GET", path: "/api/schedule/gantt?projectId=p%201&ignored=1" },
  { route: "/api/change-orders/:id/signature-status", method: "GET", path: "/api/change-orders/x-1/signature-status" },
  { route: "/api/credit-notes", method: "GET", path: "/api/credit-notes" },
  { route: "/api/credit-notes", method: "POST", path: "/api/credit-notes", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/expenses", method: "GET", path: "/api/expenses?projectId=p%201&ignored=1" },
  { route: "/api/expenses", method: "POST", path: "/api/expenses", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/floor-plans/:id/rooms/:roomId", method: "PATCH", path: "/api/floor-plans/x-1/rooms/rm-1", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/floor-plans/:id/rooms/:roomId", method: "DELETE", path: "/api/floor-plans/x-1/rooms/rm-1" },
  { route: "/api/fraud-cases", method: "GET", path: "/api/fraud-cases" },
  { route: "/api/fraud-cases", method: "POST", path: "/api/fraud-cases", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/fraud-cases/:id", method: "GET", path: "/api/fraud-cases/x-1" },
  { route: "/api/fraud-cases/:id", method: "PATCH", path: "/api/fraud-cases/x-1", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/grc-dashboard", method: "GET", path: "/api/grc-dashboard" },
  { route: "/api/journal-entries", method: "GET", path: "/api/journal-entries?status=open&q=a%20b" },
  { route: "/api/journal-entries", method: "POST", path: "/api/journal-entries", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/kpis", method: "GET", path: "/api/kpis?projectId=p%201&ignored=1" },
  { route: "/api/kpis", method: "POST", path: "/api/kpis", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/leads", method: "GET", path: "/api/leads?status=open&q=a%20b" },
  { route: "/api/leads", method: "POST", path: "/api/leads", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/leave/balances", method: "GET", path: "/api/leave/balances" },
  { route: "/api/leave/balances", method: "POST", path: "/api/leave/balances", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/opportunities", method: "GET", path: "/api/opportunities?status=open&q=a%20b" },
  { route: "/api/opportunities", method: "POST", path: "/api/opportunities", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/payroll/income-tax-slabs", method: "GET", path: "/api/payroll/income-tax-slabs" },
  { route: "/api/payroll/income-tax-slabs", method: "POST", path: "/api/payroll/income-tax-slabs", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/payroll/salary-structures", method: "GET", path: "/api/payroll/salary-structures" },
  { route: "/api/payroll/salary-structures", method: "POST", path: "/api/payroll/salary-structures", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/payroll/statutory-rules", method: "GET", path: "/api/payroll/statutory-rules" },
  { route: "/api/payroll/statutory-rules", method: "POST", path: "/api/payroll/statutory-rules", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/policies", method: "GET", path: "/api/policies" },
  { route: "/api/policies", method: "POST", path: "/api/policies", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/policies/:id", method: "GET", path: "/api/policies/x-1" },
  { route: "/api/policies/:id", method: "PATCH", path: "/api/policies/x-1", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/goods-receipts", method: "GET", path: "/api/procurement/goods-receipts" },
  { route: "/api/procurement/goods-receipts", method: "POST", path: "/api/procurement/goods-receipts", body: {"name": "Batch two", "amount": "12.50", "actorEmail": "someone@else.test"} },
  // AUDIT-100 A2 batch 3: the next plain proxies by browser callers (scripts/projexa-api-candidates.mjs derived each spec)
  { route: "/api/procurement/purchase-orders", method: "GET", path: "/api/procurement/purchase-orders" },
  { route: "/api/procurement/purchase-orders", method: "POST", path: "/api/procurement/purchase-orders", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/quotations", method: "GET", path: "/api/procurement/quotations?status=open&q=a%20b" },
  { route: "/api/procurement/quotations", method: "POST", path: "/api/procurement/quotations", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/quotations", method: "GET", path: "/api/quotations?status=open&q=a%20b" },
  { route: "/api/quotations", method: "POST", path: "/api/quotations", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/recruitment/applications", method: "GET", path: "/api/recruitment/applications" },
  { route: "/api/recruitment/applications", method: "POST", path: "/api/recruitment/applications", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/risks", method: "GET", path: "/api/risks" },
  { route: "/api/risks", method: "POST", path: "/api/risks", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/risks/:id", method: "GET", path: "/api/risks/x-1" },
  { route: "/api/risks/:id", method: "PATCH", path: "/api/risks/x-1", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/sales-orders", method: "GET", path: "/api/sales-orders?status=open&q=a%20b" },
  { route: "/api/sales-orders", method: "POST", path: "/api/sales-orders", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/schedule/tasks/:id", method: "GET", path: "/api/schedule/tasks/x-1" },
  { route: "/api/schedule/tasks/:id", method: "PATCH", path: "/api/schedule/tasks/x-1", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/submittals", method: "GET", path: "/api/submittals?projectId=p%201&ignored=1" },
  { route: "/api/submittals", method: "POST", path: "/api/submittals", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/vendor-risk", method: "GET", path: "/api/vendor-risk" },
  { route: "/api/vendor-risk", method: "POST", path: "/api/vendor-risk", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/access-review/certifications/:id", method: "PATCH", path: "/api/access-review/certifications/x-1", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/ar-aging", method: "GET", path: "/api/ar-aging?status=open&q=a%20b" },
  { route: "/api/attendance/bulk", method: "POST", path: "/api/attendance/bulk", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/audit-findings", method: "POST", path: "/api/audit-findings", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/audit-findings/:id", method: "PATCH", path: "/api/audit-findings/x-1", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/balance-sheet", method: "GET", path: "/api/balance-sheet?status=open&q=a%20b" },
  { route: "/api/bank-reconciliation", method: "GET", path: "/api/bank-reconciliation?status=open&q=a%20b" },
  { route: "/api/compliance-register", method: "GET", path: "/api/compliance-register?status=open&q=a%20b" },
  { route: "/api/compliance-register", method: "POST", path: "/api/compliance-register", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/credit-notes/:id/submit", method: "POST", path: "/api/credit-notes/x-1/submit", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/customers/:id/overview", method: "GET", path: "/api/customers/x-1/overview" },
  { route: "/api/ffe/margin-summary", method: "GET", path: "/api/ffe/margin-summary?projectId=p%201&ignored=1" },
  { route: "/api/finance-dashboard", method: "GET", path: "/api/finance-dashboard" },
  { route: "/api/floor-plans", method: "GET", path: "/api/floor-plans?projectId=p%201&ignored=1" },
  { route: "/api/floor-plans", method: "POST", path: "/api/floor-plans", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/floor-plans/:id/placements", method: "POST", path: "/api/floor-plans/x-1/placements", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/floor-plans/:id/placements/:placementId", method: "PATCH", path: "/api/floor-plans/x-1/placements/pl-1", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/floor-plans/:id/placements/:placementId", method: "DELETE", path: "/api/floor-plans/x-1/placements/pl-1" },
  { route: "/api/floor-plans/:id/rooms", method: "POST", path: "/api/floor-plans/x-1/rooms", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/floor-plans/:id/scene", method: "GET", path: "/api/floor-plans/x-1/scene" },
  { route: "/api/hr/org-chart", method: "GET", path: "/api/hr/org-chart" },
  { route: "/api/inventory/items/:id", method: "GET", path: "/api/inventory/items/x-1" },
  { route: "/api/inventory/stock-balance", method: "GET", path: "/api/inventory/stock-balance?status=open&q=a%20b" },
  { route: "/api/inventory/stock-entries", method: "GET", path: "/api/inventory/stock-entries?status=open&q=a%20b" },
  { route: "/api/inventory/stock-entries", method: "POST", path: "/api/inventory/stock-entries", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/journal-entries/:id", method: "GET", path: "/api/journal-entries/x-1" },
  { route: "/api/journal-entries/:id/submit", method: "POST", path: "/api/journal-entries/x-1/submit", body: {"name": "Batch 3", "amount": "12.50", "actorEmail": "someone@else.test"} },
  // AUDIT-100 A2 batch 4: the next plain proxies by browser callers (scripts/projexa-api-candidates.mjs derived each spec)
  { route: "/api/labour-roster/trades", method: "GET", path: "/api/labour-roster/trades" },
  { route: "/api/leads/:id/history", method: "GET", path: "/api/leads/x-1/history" },
  { route: "/api/leads/bulk-reassign", method: "POST", path: "/api/leads/bulk-reassign", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/meetings/:id", method: "GET", path: "/api/meetings/x-1" },
  { route: "/api/meetings/:id", method: "PATCH", path: "/api/meetings/x-1", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/meetings/:id/outcomes", method: "POST", path: "/api/meetings/x-1/outcomes", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/moms/share-links/:linkId", method: "DELETE", path: "/api/moms/share-links/v-1" },
  { route: "/api/mood-boards/:id/items/:itemId", method: "DELETE", path: "/api/mood-boards/x-1/items/v-1" },
  { route: "/api/opportunities/:id/history", method: "GET", path: "/api/opportunities/x-1/history" },
  { route: "/api/opportunities/bulk-reassign", method: "POST", path: "/api/opportunities/bulk-reassign", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/requisitions/:id", method: "GET", path: "/api/procurement/requisitions/x-1" },
  { route: "/api/procurement/rfqs/:id/comparison", method: "GET", path: "/api/procurement/rfqs/x-1/comparison" },
  { route: "/api/profit-and-loss", method: "GET", path: "/api/profit-and-loss?status=open&q=a%20b" },
  { route: "/api/profit-and-loss-by-project", method: "GET", path: "/api/profit-and-loss-by-project?status=open&q=a%20b" },
  { route: "/api/project-budgets/:id", method: "GET", path: "/api/project-budgets/x-1" },
  { route: "/api/project-budgets/:id", method: "PATCH", path: "/api/project-budgets/x-1", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/project-budgets/:id/cancel", method: "POST", path: "/api/project-budgets/x-1/cancel", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/project-budgets/:id/submit", method: "POST", path: "/api/project-budgets/x-1/submit", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/quotations/:id/convert", method: "POST", path: "/api/quotations/x-1/convert", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/reports/catalog", method: "GET", path: "/api/reports/catalog" },
  { route: "/api/sales-invoices/:id/cancel", method: "POST", path: "/api/sales-invoices/x-1/cancel", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/sales-invoices/:id/payments", method: "POST", path: "/api/sales-invoices/x-1/payments", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/sales-invoices/:id/submit", method: "POST", path: "/api/sales-invoices/x-1/submit", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/sales-orders/bulk-status", method: "POST", path: "/api/sales-orders/bulk-status", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/sales-pipeline", method: "GET", path: "/api/sales-pipeline" },
  { route: "/api/schedule/baselines/:id", method: "GET", path: "/api/schedule/baselines/x-1" },
  { route: "/api/schedule/sprints/:id", method: "PATCH", path: "/api/schedule/sprints/x-1", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/schedule/tasks/:id/completion", method: "GET", path: "/api/schedule/tasks/x-1/completion" },
  { route: "/api/schedule/tasks/:id/completion", method: "PATCH", path: "/api/schedule/tasks/x-1/completion", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/schedule/types", method: "GET", path: "/api/schedule/types" },
  { route: "/api/scope/:id/approve", method: "POST", path: "/api/scope/x-1/approve", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/scope/:id/submit", method: "POST", path: "/api/scope/x-1/submit", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/site-instructions/:id", method: "GET", path: "/api/site-instructions/x-1" },
  { route: "/api/tax-templates", method: "GET", path: "/api/tax-templates" },
  { route: "/api/trial-balance", method: "GET", path: "/api/trial-balance?status=open&q=a%20b" },
  { route: "/api/wiki/:id", method: "GET", path: "/api/wiki/x-1" },
  { route: "/api/wiki/:id", method: "PATCH", path: "/api/wiki/x-1", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },  // AUDIT-100 A2 batch 5: the proxies that were plain in all but form (scripts/projexa-api-candidates.mjs now reads the callVeridian options key by
  // key): their own requireRole() set, the VERIDIAN root (/api/v1/construction/...), an empty / lenient / defaulted body
  { route: "/api/change-orders", method: "GET", path: "/api/change-orders?projectId=p%201" },
  { route: "/api/change-orders", method: "POST", path: "/api/change-orders", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/change-orders/:id", method: "GET", path: "/api/change-orders/x-1" },
  { route: "/api/change-orders/:id", method: "PATCH", path: "/api/change-orders/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/construction-budget/lines", method: "POST", path: "/api/construction-budget/lines", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/credit-notes/:id", method: "GET", path: "/api/credit-notes/x-1" },
  { route: "/api/documents/:id/dispose", method: "POST", path: "/api/documents/x-1/dispose", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/drawings/:id", method: "GET", path: "/api/drawings/x-1" },
  { route: "/api/drawings/:id", method: "PATCH", path: "/api/drawings/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/drawings/:id", method: "DELETE", path: "/api/drawings/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/employees/:id", method: "GET", path: "/api/employees/x-1" },
  { route: "/api/employees/:id", method: "PATCH", path: "/api/employees/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/ffe/:id", method: "GET", path: "/api/ffe/x-1" },
  { route: "/api/ffe/:id", method: "PATCH", path: "/api/ffe/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/floor-plans/:id", method: "GET", path: "/api/floor-plans/x-1" },
  { route: "/api/floor-plans/:id", method: "PATCH", path: "/api/floor-plans/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/kpi-entries", method: "GET", path: "/api/kpi-entries?kpiDefinitionId=p%201" },
  { route: "/api/kpi-entries", method: "POST", path: "/api/kpi-entries", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/kpi-entries/:id/approve", method: "POST", path: "/api/kpi-entries/x-1/approve", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/kpis/:id", method: "GET", path: "/api/kpis/x-1" },
  { route: "/api/labour-roster/:id", method: "GET", path: "/api/labour-roster/x-1" },
  { route: "/api/labour-roster/:id", method: "PATCH", path: "/api/labour-roster/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/leads/:id", method: "GET", path: "/api/leads/x-1" },
  { route: "/api/leads/:id", method: "PATCH", path: "/api/leads/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/leave/requests/:id/decision", method: "POST", path: "/api/leave/requests/x-1/decision", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/materials", method: "GET", path: "/api/materials?projectId=p%201" },
  { route: "/api/materials", method: "POST", path: "/api/materials", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/materials/:id", method: "GET", path: "/api/materials/x-1" },
  { route: "/api/materials/:id", method: "PATCH", path: "/api/materials/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/materials/issues", method: "GET", path: "/api/materials/issues?projectId=p%201" },
  { route: "/api/materials/issues", method: "POST", path: "/api/materials/issues", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/materials/master/:id", method: "GET", path: "/api/materials/master/x-1" },
  { route: "/api/materials/master/:id", method: "PATCH", path: "/api/materials/master/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/milestones", method: "GET", path: "/api/milestones?projectId=p%201" },
  { route: "/api/milestones", method: "POST", path: "/api/milestones", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/milestones/:id", method: "PATCH", path: "/api/milestones/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/module-chain", method: "GET", path: "/api/module-chain" },
  { route: "/api/moms/:id", method: "GET", path: "/api/moms/x-1" },
  { route: "/api/moms/:id", method: "PATCH", path: "/api/moms/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/moms/:id", method: "DELETE", path: "/api/moms/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/moms/:id/action-items", method: "POST", path: "/api/moms/x-1/action-items", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/moms/:id/generate-intelligence", method: "POST", path: "/api/moms/x-1/generate-intelligence", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/mood-boards/:id", method: "GET", path: "/api/mood-boards/x-1" },
  { route: "/api/mood-boards/:id", method: "PATCH", path: "/api/mood-boards/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/mood-boards/:id", method: "POST", path: "/api/mood-boards/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/opportunities/:id", method: "GET", path: "/api/opportunities/x-1" },
  { route: "/api/opportunities/:id", method: "PATCH", path: "/api/opportunities/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/payroll/employees/:id/income-tax-slab", method: "POST", path: "/api/payroll/employees/x-1/income-tax-slab", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/payroll/employees/:id/tax-exemptions", method: "GET", path: "/api/payroll/employees/x-1/tax-exemptions" },
  { route: "/api/payroll/employees/:id/tax-exemptions", method: "POST", path: "/api/payroll/employees/x-1/tax-exemptions", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/payroll/payslips/:id", method: "GET", path: "/api/payroll/payslips/x-1" },
  { route: "/api/payroll/payslips/:id/finalize", method: "POST", path: "/api/payroll/payslips/x-1/finalize", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/payroll/payslips/:id/tds", method: "POST", path: "/api/payroll/payslips/x-1/tds", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/payroll/runs/:id", method: "GET", path: "/api/payroll/runs/x-1" },
  { route: "/api/payroll/runs/:id/payslips", method: "GET", path: "/api/payroll/runs/x-1/payslips" },
  { route: "/api/payroll/runs/:id/process", method: "POST", path: "/api/payroll/runs/x-1/process", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/goods-receipts/:id", method: "GET", path: "/api/procurement/goods-receipts/x-1" },
  { route: "/api/procurement/goods-receipts/:id/submit", method: "POST", path: "/api/procurement/goods-receipts/x-1/submit", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/purchase-orders/:id", method: "GET", path: "/api/procurement/purchase-orders/x-1" },
  { route: "/api/procurement/purchase-orders/:id", method: "PATCH", path: "/api/procurement/purchase-orders/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/purchase-orders/:id", method: "DELETE", path: "/api/procurement/purchase-orders/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/purchase-orders/:id/submit", method: "POST", path: "/api/procurement/purchase-orders/x-1/submit", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/requisitions/:id/submit", method: "POST", path: "/api/procurement/requisitions/x-1/submit", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/procurement/rfqs/:id", method: "GET", path: "/api/procurement/rfqs/x-1" },
  { route: "/api/procurement/rfqs/:id/send", method: "POST", path: "/api/procurement/rfqs/x-1/send", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/project-budgets", method: "GET", path: "/api/project-budgets?status=open&q=a%20b" },
  { route: "/api/project-budgets", method: "POST", path: "/api/project-budgets", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/punch-list/:id", method: "GET", path: "/api/punch-list/x-1" },
  { route: "/api/punch-list/:id", method: "PATCH", path: "/api/punch-list/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/purchase-orders", method: "GET", path: "/api/purchase-orders?status=open&q=a%20b" },
  { route: "/api/purchase-orders", method: "POST", path: "/api/purchase-orders", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/quotations/:id", method: "GET", path: "/api/quotations/x-1" },
  { route: "/api/quotations/:id", method: "PATCH", path: "/api/quotations/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/quotations/:id/revisions", method: "POST", path: "/api/quotations/x-1/revisions", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/recruitment/applications/:id", method: "GET", path: "/api/recruitment/applications/x-1" },
  { route: "/api/recruitment/applications/:id/hire", method: "POST", path: "/api/recruitment/applications/x-1/hire", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/recruitment/applications/:id/interviews", method: "GET", path: "/api/recruitment/applications/x-1/interviews" },
  { route: "/api/recruitment/applications/:id/interviews", method: "POST", path: "/api/recruitment/applications/x-1/interviews", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/recruitment/applications/:id/stage", method: "POST", path: "/api/recruitment/applications/x-1/stage", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/recruitment/interviews/:id/feedback", method: "POST", path: "/api/recruitment/interviews/x-1/feedback", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/recruitment/job-openings/:id", method: "GET", path: "/api/recruitment/job-openings/x-1" },
  { route: "/api/recruitment/job-openings/:id/status", method: "POST", path: "/api/recruitment/job-openings/x-1/status", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/reports/definitions/:id/run", method: "POST", path: "/api/reports/definitions/x-1/run", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/rfis/:id", method: "GET", path: "/api/rfis/x-1" },
  { route: "/api/rfis/:id", method: "PATCH", path: "/api/rfis/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/sales-invoices/:id", method: "GET", path: "/api/sales-invoices/x-1" },
  { route: "/api/sales-order-document-flow/:id", method: "GET", path: "/api/sales-order-document-flow/x-1" },
  { route: "/api/sales-orders/:id", method: "GET", path: "/api/sales-orders/x-1" },
  { route: "/api/sales-orders/:id", method: "PATCH", path: "/api/sales-orders/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/schedule-tracker", method: "GET", path: "/api/schedule-tracker?projectId=p%201" },
  { route: "/api/screen-drafts/:id", method: "PATCH", path: "/api/screen-drafts/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/screen-drafts/:id", method: "DELETE", path: "/api/screen-drafts/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/site-diary", method: "GET", path: "/api/site-diary?projectId=p%201" },
  { route: "/api/site-diary", method: "POST", path: "/api/site-diary", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/site-diary/:id", method: "GET", path: "/api/site-diary/x-1" },
  { route: "/api/timesheets/:id", method: "GET", path: "/api/timesheets/x-1" },
  { route: "/api/timesheets/:id", method: "PATCH", path: "/api/timesheets/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/timesheets/:id", method: "DELETE", path: "/api/timesheets/x-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/timesheets/:id/approve", method: "POST", path: "/api/timesheets/x-1/approve", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/timesheets/:id/reject", method: "POST", path: "/api/timesheets/x-1/reject", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/timesheets/:id/submit", method: "POST", path: "/api/timesheets/x-1/submit", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/vendors/:id/bank-accounts", method: "GET", path: "/api/vendors/x-1/bank-accounts" },
  { route: "/api/vendors/:id/bank-accounts", method: "POST", path: "/api/vendors/x-1/bank-accounts", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/vendors/:id/portal-links", method: "GET", path: "/api/vendors/x-1/portal-links" },
  { route: "/api/vendors/:id/portal-links", method: "POST", path: "/api/vendors/x-1/portal-links", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/vendors/:id/portal-links/:linkId", method: "DELETE", path: "/api/vendors/x-1/portal-links/v-1", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/vendors/:id/qualification", method: "GET", path: "/api/vendors/x-1/qualification" },
  { route: "/api/vendors/:id/qualification", method: "POST", path: "/api/vendors/x-1/qualification", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/vendors/:id/sanction-checks", method: "GET", path: "/api/vendors/x-1/sanction-checks" },
  { route: "/api/vendors/:id/sanction-checks", method: "POST", path: "/api/vendors/x-1/sanction-checks", body: {"name": "Batch 5", "amount": "12.50", "actorEmail": "someone@else.test"} },  // AUDIT-100 A2 batch 6: body validation / reshaping, query rebuilding, response reshaping (each a spec key ported from the handler's own
  // statements; a body carries every field the handler requires so the role sweep below reaches the upstream)
  { route: "/api/schedule/baselines", method: "GET", path: "/api/schedule/baselines?projectId=p%201"},
  { route: "/api/schedule/baselines", method: "POST", path: "/api/schedule/baselines", body: {"name": "v-name", "amount": "12.50", "actorEmail": "someone@else.test", "projectId": "v-projectId"}},
  { route: "/api/schedule/sprints", method: "GET", path: "/api/schedule/sprints?projectId=p%201"},
  { route: "/api/schedule/sprints", method: "POST", path: "/api/schedule/sprints", body: {"name": "v-name", "amount": "12.50", "actorEmail": "someone@else.test", "projectId": "v-projectId"}},
  { route: "/api/schedule/sprints/:id/issues", method: "GET", path: "/api/schedule/sprints/x-1/issues"},
  { route: "/api/schedule/sprints/:id/issues", method: "POST", path: "/api/schedule/sprints/x-1/issues", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test", "issueId": "v-issueId"}},
  { route: "/api/schedule/sprints/:id/issues", method: "DELETE", path: "/api/schedule/sprints/x-1/issues?issueId=p%201"},
  { route: "/api/schedule/tasks", method: "GET", path: "/api/schedule/tasks?projectId=p%201"},
  { route: "/api/schedule/tasks", method: "POST", path: "/api/schedule/tasks", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test", "projectId": "v-projectId", "title": "v-title", "startDate": "v-startDate"}},
  { route: "/api/schedule/workload", method: "GET", path: "/api/schedule/workload?projectId=p%201"},
  { route: "/api/schedule/workload", method: "POST", path: "/api/schedule/workload", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test", "projectId": "v-projectId", "userId": "v-userId", "allocatedHoursPerDay": "v-allocatedHoursPerDay", "startDate": "v-startDate", "endDate": "v-endDate"}},
  { route: "/api/wiki", method: "GET", path: "/api/wiki?projectId=p%201"},
  { route: "/api/wiki", method: "POST", path: "/api/wiki", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test", "projectId": "v-projectId", "title": "v-title"}},
  { route: "/api/work-progress/activities", method: "GET", path: "/api/work-progress/activities?projectId=p%201"},
  { route: "/api/work-progress/activities", method: "POST", path: "/api/work-progress/activities", body: {"name": "v-name", "amount": "12.50", "actorEmail": "someone@else.test", "projectId": "v-projectId"}},
  { route: "/api/timesheets/submit-day", method: "POST", path: "/api/timesheets/submit-day", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test", "projectId": "v-projectId", "spentOn": "v-spentOn"}},
  { route: "/api/timesheets/review-day", method: "POST", path: "/api/timesheets/review-day", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test", "designerId": "v-designerId", "projectId": "v-projectId", "spentOn": "v-spentOn", "decision": "v-decision"}},
  { route: "/api/timesheets", method: "GET", path: "/api/timesheets?projectId=p%201&issueId=v%20issueId&mine=v%20mine&spentOn=v%20spentOn"},
  { route: "/api/timesheets", method: "POST", path: "/api/timesheets", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test", "issueId": "v-issueId", "hours": "v-hours", "spentOn": "v-spentOn"}},
  { route: "/api/work-progress/:id", method: "GET", path: "/api/work-progress/x-1"},
  { route: "/api/work-progress/:id", method: "PATCH", path: "/api/work-progress/x-1", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test"}},
  { route: "/api/work-progress/:id", method: "DELETE", path: "/api/work-progress/x-1"},
  { route: "/api/tasks", method: "GET", path: "/api/tasks?projectId=v%20projectId&status=v%20status&limit=v%20limit&cursor=v%20cursor"},
  { route: "/api/tasks", method: "POST", path: "/api/tasks", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test"}},
  { route: "/api/tasks/:id", method: "GET", path: "/api/tasks/x-1"},
  { route: "/api/attendance/summary", method: "GET", path: "/api/attendance/summary?projectId=p%201&from=v%20from&to=v%20to"},
  { route: "/api/billing-claims", method: "GET", path: "/api/billing-claims?projectId=v%20projectId&all=v%20all"},
  { route: "/api/billing-claims", method: "POST", path: "/api/billing-claims", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test"}},
  { route: "/api/construction-materials/cost-report", method: "GET", path: "/api/construction-materials/cost-report?projectId=p%201&from=v%20from&to=v%20to&groupBy=v%20groupBy"},
  { route: "/api/knowledge-base/search", method: "GET", path: "/api/knowledge-base/search?q=a%20b"},
  { route: "/api/manpower-cost-report", method: "GET", path: "/api/manpower-cost-report?projectId=p%201&trade=a%20b%26c&date=a%20b%26c"},
  { route: "/api/org-users", method: "GET", path: "/api/org-users?q=a%20b%26c"},
  { route: "/api/project-budgets/:id/variance", method: "GET", path: "/api/project-budgets/x-1/variance?asOfDate=a%20b%26c"},
  { route: "/api/reports/portfolio/budget-vs-actual", method: "GET", path: "/api/reports/portfolio/budget-vs-actual?status=open&q=a%20b"},
  { route: "/api/scope/:id/compare", method: "GET", path: "/api/scope/x-1/compare?against=a%20b%26c"},
  { route: "/api/scope/categories", method: "GET", path: "/api/scope/categories?includeInactive=1"},
  { route: "/api/scope/categories", method: "POST", path: "/api/scope/categories", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test"}},
  { route: "/api/scope/categories/:id", method: "PATCH", path: "/api/scope/categories/x-1", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test"}},
  { route: "/api/scope/categories/:id", method: "DELETE", path: "/api/scope/categories/x-1"},
  { route: "/api/scope/cost-visibility", method: "GET", path: "/api/scope/cost-visibility"},
  { route: "/api/scope/cost-visibility", method: "PATCH", path: "/api/scope/cost-visibility", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test"}},
  { route: "/api/scope/lines", method: "GET", path: "/api/scope/lines?projectId=p%201&q=v%20q&boqId=v%20boqId&limit=v%20limit"},
  { route: "/api/screen-drafts", method: "GET", path: "/api/screen-drafts?functionId=p%201&objectId=v%20objectId"},
  { route: "/api/screen-drafts", method: "POST", path: "/api/screen-drafts", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test"}},
  { route: "/api/design-materials", method: "GET", path: "/api/design-materials?category=a%20b%26c"},
  { route: "/api/design-materials", method: "POST", path: "/api/design-materials", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test"}},
  { route: "/api/products", method: "GET", path: "/api/products"},
  { route: "/api/projects/overview", method: "GET", path: "/api/projects/overview"},
  { route: "/api/vendors/:id", method: "GET", path: "/api/vendors/x-1"},
  { route: "/api/vendors/:id", method: "PATCH", path: "/api/vendors/x-1", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test"}},
  { route: "/api/vendors/:id", method: "DELETE", path: "/api/vendors/x-1", body: {"name": "ignored"}},
  { route: "/api/customers/:id", method: "GET", path: "/api/customers/x-1"},
  { route: "/api/customers/:id", method: "PATCH", path: "/api/customers/x-1", body: {"name": "Batch 6", "amount": "12.50", "actorEmail": "someone@else.test"}},
  { route: "/api/customers/:id", method: "DELETE", path: "/api/customers/x-1", body: {"name": "ignored"}},
];

export function buildCases(): ParityCase[] {
  const cases: ParityCase[] = [];
  // every request x every role, signed out and no organisation, upstream answering normally
  for (const r of REQUESTS) {
    for (const who of [...ROLES, "signed_out", "no_org"] as Who[]) cases.push({ name: `${r.method} ${r.route} as ${who}`, method: r.method, path: r.path, body: r.body, who, upstream: OK });
  }
  // the edge cases, on a read, a write and the plain-error route
  const probes = [REQUESTS[0], REQUESTS[3], REQUESTS[6], REQUESTS[8]];
  for (const r of probes) {
    const tag = `${r.method} ${r.route}`;
    cases.push({ name: `${tag}: another organisation's record`, method: r.method, path: r.path, body: r.body, who: "wrong_org", upstream: { kind: "json", status: 404, body: { error: "Not found" } } });
    cases.push({ name: `${tag}: membership read fails`, method: r.method, path: r.path, body: r.body, who: "membership_error", upstream: OK });
    cases.push({ name: `${tag}: organisation has no VERIDIAN key`, method: r.method, path: r.path, body: r.body, who: "no_key", upstream: OK });
    cases.push({ name: `${tag}: upstream 400 rule refusal`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "json", status: 400, body: { code: "BOQ_LINE_REQUIRED", missing: ["boqLineId"] } } });
    cases.push({ name: `${tag}: upstream 409 with message`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "json", status: 409, body: { error: "Changed by someone else" } } });
    cases.push({ name: `${tag}: upstream 500`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "json", status: 500, body: { error: "boom" } } });
    cases.push({ name: `${tag}: upstream storage unconfigured`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "json", status: 500, body: { error: "supabaseKey is required." } } });
    cases.push({ name: `${tag}: upstream 502 not JSON`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "text", status: 502, status_text: "Bad Gateway", text: "<html>bad gateway</html>" } });
    cases.push({ name: `${tag}: upstream 200 not JSON`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "text", status: 200, status_text: "OK", text: "not json" } });
    cases.push({ name: `${tag}: connection refused`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "refused" } });
  }
  // AUDIT-100 A2 batch 2: the new answer shapes under the upstream's failures too: a create (201 on success), a read that forwards its whole
  // query string, a read with a private browser cache, and a two-parameter route
  const batch2 = (route: string, method: string) => REQUESTS.find((r) => r.route === route && r.method === method)!;
  for (const r of [batch2("/api/vendors", "POST"), batch2("/api/customers", "GET"), batch2("/api/vendors", "GET"), batch2("/api/floor-plans/:id/rooms/:roomId", "PATCH")]) {
    const tag = `${r.method} ${r.route}`;
    cases.push({ name: `${tag}: another organisation's record`, method: r.method, path: r.path, body: r.body, who: "wrong_org", upstream: { kind: "json", status: 404, body: { error: "Not found" } } });
    cases.push({ name: `${tag}: upstream 409 with message`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "json", status: 409, body: { error: "Changed by someone else" } } });
    cases.push({ name: `${tag}: upstream 500`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "json", status: 500, body: { error: "boom" } } });
    cases.push({ name: `${tag}: upstream 502 not JSON`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "text", status: 502, status_text: "Bad Gateway", text: "<html>bad gateway</html>" } });
    cases.push({ name: `${tag}: connection refused`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "refused" } });
    cases.push({ name: `${tag}: organisation has no VERIDIAN key`, method: r.method, path: r.path, body: r.body, who: "no_key", upstream: OK });
  }
  cases.push({ name: "GET /api/customers without a query string", method: "GET", path: "/api/customers", who: "pm", upstream: OK });
  cases.push({ name: "GET /api/customers with an empty query string", method: "GET", path: "/api/customers?", who: "pm", upstream: OK });
  cases.push({ name: "GET /api/board without projectId", method: "GET", path: "/api/board", who: "pm", upstream: OK });
  cases.push({ name: "GET /api/policies/:id with an encoded id", method: "GET", path: "/api/policies/a%20b", who: "pm", upstream: OK });
  // the missing-query refusal of the exceptions route
  cases.push({ name: "GET /api/exceptions without projectId", method: "GET", path: "/api/exceptions", who: "pm", upstream: OK });
  cases.push({ name: "GET /api/reports/boq-analysis without query", method: "GET", path: "/api/reports/boq-analysis", who: "pm", upstream: OK });
  // AUDIT-100 A2 batch 5: the new forms under the upstream's failures (a root read, a root plain-error write, an own-role write, a lenient body)
  for (const r of [batch2("/api/materials", "GET"), batch2("/api/materials/issues", "POST"), batch2("/api/change-orders", "POST"), batch2("/api/timesheets/:id/reject", "POST")]) {
    const tag = `${r.method} ${r.route}`;
    cases.push({ name: `${tag}: another organisation's record`, method: r.method, path: r.path, body: r.body, who: "wrong_org", upstream: { kind: "json", status: 404, body: { error: "Not found" } } });
    cases.push({ name: `${tag}: upstream 409 with message`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "json", status: 409, body: { error: "Changed by someone else" } } });
    cases.push({ name: `${tag}: upstream 500`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "json", status: 500, body: { error: "boom" } } });
    cases.push({ name: `${tag}: upstream 502 not JSON`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "text", status: 502, status_text: "Bad Gateway", text: "<html>bad gateway</html>" } });
    cases.push({ name: `${tag}: connection refused`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "refused" } });
    cases.push({ name: `${tag}: organisation has no VERIDIAN key`, method: r.method, path: r.path, body: r.body, who: "no_key", upstream: OK });
    cases.push({ name: `${tag}: membership read fails`, method: r.method, path: r.path, body: r.body, who: "membership_error", upstream: OK });
  }
  // lenient body reads (`request.json().catch(() => ({}))`): an empty body and a broken one are {}; JSON null is sent as no body at all
  for (const [route, method, path] of [["/api/timesheets/:id", "PATCH", "/api/timesheets/x-1"], ["/api/timesheets/:id/reject", "POST", "/api/timesheets/x-1/reject"], ["/api/quotations/:id/revisions", "POST", "/api/quotations/x-1/revisions"], ["/api/vendors/:id/portal-links", "POST", "/api/vendors/x-1/portal-links"]]) {
    for (const [label, raw] of [["an empty body", ""], ["a broken body", "{not json"], ["a JSON null body", "null"]]) cases.push({ name: `${method} ${route} with ${label}`, method, path, raw_body: raw, who: "pm", upstream: OK });
  }
  // a defaulted body ({ action: "status", ...body }): the caller's own action wins, JSON null still gets the default
  cases.push({ name: "PATCH /api/ffe/:id with its own action", method: "PATCH", path: "/api/ffe/x-1", body: { action: "approve", note: "n" }, who: "pm", upstream: OK });
  cases.push({ name: "PATCH /api/floor-plans/:id with a JSON null body", method: "PATCH", path: "/api/floor-plans/x-1", raw_body: "null", who: "pm", upstream: OK });
  // an id that tries to walk the upstream path ("..%2F"): the Next handlers now ENCODE every path parameter (batch 5 fixed 35 raw `${id}`
  // sites), so "../../admin" stays one segment on both sides
  // the own role sets: null_role passes the write gate and is refused by requireRole() alone (no upstream call); a route without its own
  // role set lets the same person through to the upstream
  for (const [route, method] of [["/api/change-orders", "POST"], ["/api/change-orders/:id", "PATCH"], ["/api/milestones", "POST"], ["/api/milestones/:id", "PATCH"], ["/api/project-budgets", "POST"], ["/api/punch-list/:id", "PATCH"], ["/api/purchase-orders", "POST"], ["/api/site-diary", "POST"], ["/api/vendors", "POST"], ["/api/timesheets/:id/approve", "POST"]]) {
    const r = batch2(route, method);
    cases.push({ name: `${method} ${route} as null_role`, method, path: r.path, body: r.body, who: "null_role", upstream: OK });
  }
  cases.push({ name: "GET /api/credit-notes/:id with a path-walking id", method: "GET", path: "/api/credit-notes/..%2F..%2Fadmin", who: "pm", upstream: OK });
  cases.push({ name: "GET /api/policies/:id with a slash in the id", method: "GET", path: "/api/policies/a%2Fb%3Fc", who: "pm", upstream: OK });
  cases.push({ name: "POST /api/sales-invoices/:id/submit with a path-walking id", method: "POST", path: "/api/sales-invoices/..%2F..%2Fconstruction%2Fx/submit", body: {}, who: "owner", upstream: OK });
  cases.push({ name: "GET /api/materials/:id with a path-walking id (root route)", method: "GET", path: "/api/materials/..%2F..%2F..%2Fprojexa%2Fdashboard", who: "pm", upstream: OK });
  // AUDIT-100 A2 batch 6: the handlers' own statements as spec keys (body validation / reshaping, query rebuilding, response reshaping).
  // Every check both ways (good / missing / empty / falsy / JSON null / array / broken bodies), every query form with and without its
  // values, the reshaped answers, the constant-body DELETEs and the new forms under the upstream's failures.
  const b6 = (route: string, method: string) => batch2(route, method);
  const add = (name: string, method: string, path: string, who: Who, extra: Partial<ParityCase> = {}) => cases.push({ name, method, path, who, upstream: OK, ...extra });
  for (const [route, method] of [["/api/schedule/baselines", "POST"], ["/api/schedule/sprints/:id/issues", "DELETE"], ["/api/work-progress/:id", "PATCH"], ["/api/scope/categories", "POST"], ["/api/scope/cost-visibility", "PATCH"], ["/api/vendors/:id", "DELETE"], ["/api/products", "GET"], ["/api/timesheets", "GET"], ["/api/tasks", "POST"], ["/api/billing-claims", "POST"]]) {
    const r = b6(route, method);
    const tag = `${r.method} ${r.route}`;
    cases.push({ name: `${tag}: another organisation's record`, method: r.method, path: r.path, body: r.body, who: "wrong_org", upstream: { kind: "json", status: 404, body: { error: "Not found" } } });
    cases.push({ name: `${tag}: upstream 409 with message`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "json", status: 409, body: { error: "Changed by someone else" } } });
    cases.push({ name: `${tag}: upstream 500`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "json", status: 500, body: { error: "boom" } } });
    cases.push({ name: `${tag}: upstream 502 not JSON`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "text", status: 502, status_text: "Bad Gateway", text: "<html>bad gateway</html>" } });
    cases.push({ name: `${tag}: upstream 200 not JSON`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "text", status: 200, status_text: "OK", text: "not json" } });
    cases.push({ name: `${tag}: connection refused`, method: r.method, path: r.path, body: r.body, who: "owner", upstream: { kind: "refused" } });
    cases.push({ name: `${tag}: organisation has no VERIDIAN key`, method: r.method, path: r.path, body: r.body, who: "no_key", upstream: OK });
    cases.push({ name: `${tag}: membership read fails`, method: r.method, path: r.path, body: r.body, who: "membership_error", upstream: OK });
    cases.push({ name: `${tag} as null_role`, method: r.method, path: r.path, body: r.body, who: "null_role", upstream: OK });
  }
  // body_required: each check refuses a missing, empty, 0 and false field; a JSON-null body throws in the handler (an empty 500 on both
  // sides); an array or a number is "no field" (400); the second check of /schedule/tasks runs only after the first passes
  for (const [route, method, path, full] of [
    ["/api/schedule/baselines", "POST", "/api/schedule/baselines", { projectId: "p-1", name: "Base" }],
    ["/api/schedule/sprints", "POST", "/api/schedule/sprints", { projectId: "p-1", name: "S1" }],
    ["/api/schedule/sprints/:id/issues", "POST", "/api/schedule/sprints/x-1/issues", { issueId: "i-1" }],
    ["/api/schedule/tasks", "POST", "/api/schedule/tasks", { projectId: "p-1", title: "T", startDate: "2026-10-06" }],
    ["/api/schedule/workload", "POST", "/api/schedule/workload", { projectId: "p-1", userId: "u-1", allocatedHoursPerDay: 4, startDate: "2026-10-06", endDate: "2026-10-09" }],
    ["/api/wiki", "POST", "/api/wiki", { projectId: "p-1", title: "W" }],
    ["/api/work-progress/activities", "POST", "/api/work-progress/activities", { projectId: "p-1", name: "A" }],
    ["/api/timesheets/submit-day", "POST", "/api/timesheets/submit-day", { projectId: "p-1", spentOn: "2026-10-06" }],
    ["/api/timesheets/review-day", "POST", "/api/timesheets/review-day", { designerId: "d-1", projectId: "p-1", spentOn: "2026-10-06", decision: "approve" }],
    ["/api/timesheets", "POST", "/api/timesheets", { issueId: "i-1", hours: 2, spentOn: "2026-10-06" }],
  ] as [string, string, string, Record<string, unknown>][]) {
    const tag = `${method} ${route}`;
    add(`${tag} with every required field and extras`, method, path, "pm", { body: { ...full, extra: "kept or dropped", actorEmail: "x@y.test" } });
    const first = Object.keys(full)[0]!;
    const last = Object.keys(full)[Object.keys(full).length - 1]!;
    add(`${tag} without ${first}`, method, path, "pm", { body: { ...full, [first]: undefined } });
    add(`${tag} with ${last} empty`, method, path, "pm", { body: { ...full, [last]: "" } });
    add(`${tag} with ${last} 0`, method, path, "pm", { body: { ...full, [last]: 0 } });
    add(`${tag} with ${first} false`, method, path, "pm", { body: { ...full, [first]: false } });
    add(`${tag} with an empty object`, method, path, "pm", { body: {} });
    add(`${tag} with a JSON null body`, method, path, "pm", { raw_body: "null" });
    add(`${tag} with an array body`, method, path, "pm", { raw_body: "[1,2]" });
    add(`${tag} with a number body`, method, path, "pm", { raw_body: "5" });
    add(`${tag} as client_viewer with a bad body`, method, path, "client_viewer", { body: {} });
    add(`${tag} as no_org with a bad body`, method, path, "no_org", { body: {} });
  }
  add("POST /api/schedule/tasks with projectId and title but no startDate", "POST", "/api/schedule/tasks", "pm", { body: { projectId: "p-1", title: "T" } });
  add("POST /api/timesheets/review-day with a rejection reason", "POST", "/api/timesheets/review-day", "pm", { body: { designerId: "d-1", projectId: "p-1", spentOn: "2026-10-06", decision: "reject", rejectionReason: "late", extra: 1 } });
  // lenient reads (submit-day, review-day): an empty or broken body is {} and so "required"
  for (const path of ["/api/timesheets/submit-day", "/api/timesheets/review-day"]) {
    add(`POST ${path} with an empty body`, "POST", path, "pm", { raw_body: "" });
    add(`POST ${path} with a broken body`, "POST", path, "pm", { raw_body: "{not json" });
  }
  // body_object_error (`request.json().catch(() => null)` + `!body || typeof body !== "object"`): an array passes, the rest is 400
  for (const [route, path] of [["/api/work-progress/:id", "/api/work-progress/x-1"], ["/api/tasks", "/api/tasks"]]) {
    const method = route === "/api/tasks" ? "POST" : "PATCH";
    for (const [label, raw] of [["an empty body", ""], ["a broken body", "{not json"], ["a JSON null body", "null"], ["a number body", "5"], ["a string body", "\"text\""], ["an array body", "[1,2]"], ["an empty object", "{}"], ["false", "false"]]) {
      add(`${method} ${route} with ${label}`, method, path, "pm", { raw_body: raw });
    }
  }
  // invalid_body_error (the handler's own catch): broken / empty is its 400; JSON null is forwarded as no body
  for (const [method, path] of [["POST", "/api/scope/categories"], ["PATCH", "/api/scope/categories/x-1"]]) {
    for (const [label, raw] of [["an empty body", ""], ["a broken body", "{not json"], ["a JSON null body", "null"], ["an array body", "[\"a\"]"]]) add(`${method} ${path.replace("x-1", ":id")} with ${label}`, method, path, "pm", { raw_body: raw });
  }
  // body_reject_if: the hard floor on cost visibility, and what is NOT refused
  add("PATCH /api/scope/cost-visibility granting client_viewer cost", "PATCH", "/api/scope/cost-visibility", "owner", { body: { role: "client_viewer", canSeeCost: true } });
  add("PATCH /api/scope/cost-visibility granting client_viewer cost as the string true", "PATCH", "/api/scope/cost-visibility", "owner", { body: { role: "client_viewer", canSeeCost: "true" } });
  add("PATCH /api/scope/cost-visibility removing client_viewer cost", "PATCH", "/api/scope/cost-visibility", "owner", { body: { role: "client_viewer", canSeeCost: false, actorEmail: "x@y.test" } });
  add("PATCH /api/scope/cost-visibility granting pm cost", "PATCH", "/api/scope/cost-visibility", "owner", { body: { role: "pm", canSeeCost: true } });
  add("PATCH /api/scope/cost-visibility with a JSON null body", "PATCH", "/api/scope/cost-visibility", "owner", { raw_body: "null" });
  add("PATCH /api/scope/cost-visibility as client_viewer granting itself", "PATCH", "/api/scope/cost-visibility", "client_viewer", { body: { role: "client_viewer", canSeeCost: true } });
  // body_in_try: a broken body is caught by the handler's own catch (the fallback 502), an empty one too; JSON null spreads to {}
  for (const [label, raw] of [["a broken body", "{not json"], ["an empty body", ""], ["a JSON null body", "null"], ["an array body", "[1]"]]) add(`POST /api/screen-drafts with ${label}`, "POST", "/api/screen-drafts", "pm", { raw_body: raw });
  // the query a handler rebuilds, with and without its values (encodeURIComponent vs URLSearchParams, "?" vs "&", flags, normalising)
  for (const path of [
    "/api/schedule/sprints/x-1/issues", "/api/schedule/sprints/x-1/issues?issueId=", "/api/schedule/sprints/x-1/issues?issueId=a%20b%2Bc",
    "/api/timesheets", "/api/timesheets?issueId=i%201", "/api/timesheets?projectId=&issueId=", "/api/timesheets?projectId=p-1&issueId=i-1&mine=1&spentOn=2026-10-06&x=1",
    "/api/tasks", "/api/tasks?", "/api/tasks?status=&limit=", "/api/tasks?projectId=p%201&status=open&limit=5&cursor=c%2B1&other=1",
    "/api/attendance/summary", "/api/attendance/summary?projectId=p-1", "/api/attendance/summary?projectId=p-1&from=&to=2026-10-31",
    "/api/billing-claims", "/api/billing-claims?projectId=p-1", "/api/billing-claims?all=true&ignored=1",
    "/api/construction-materials/cost-report", "/api/construction-materials/cost-report?projectId=p-1&groupBy=supplier",
    "/api/knowledge-base/search", "/api/knowledge-base/search?q=", "/api/knowledge-base/search?q=%C3%A9%20%2B%26",
    "/api/manpower-cost-report", "/api/manpower-cost-report?projectId=p-1", "/api/manpower-cost-report?projectId=p-1&date=2026-10-06", "/api/manpower-cost-report?projectId=p%26x&trade=a%2Bb",
    "/api/org-users", "/api/org-users?q=", "/api/org-users?q=r%C3%A9%20a",
    "/api/project-budgets/x-1/variance", "/api/project-budgets/x-1/variance?asOfDate=2026-10-06",
    "/api/reports/portfolio/budget-vs-actual", "/api/reports/portfolio/budget-vs-actual?", "/api/reports/portfolio/budget-vs-actual?b=2&a=x%20y&a=z&c=%2B&d",
    "/api/scope/x-1/compare", "/api/scope/x-1/compare?against=", "/api/scope/x-1/compare?against=r%202",
    "/api/scope/categories", "/api/scope/categories?includeInactive=true", "/api/scope/categories?includeInactive=1&x=2",
    "/api/scope/lines", "/api/scope/lines?projectId=p-1", "/api/scope/lines?projectId=p-1&q=a%20b&boqId=&limit=20",
    "/api/screen-drafts", "/api/screen-drafts?functionId=f-1", "/api/screen-drafts?functionId=f%201&objectId=", "/api/screen-drafts?objectId=o-1",
    "/api/design-materials", "/api/design-materials?category=", "/api/design-materials?category=tile%20%26%20stone",
    "/api/schedule/workload", "/api/wiki?projectId=", "/api/schedule/tasks?projectId=p%2F1",
  ]) add(`GET ${path}`.replace(/^GET (\/api\/schedule\/sprints\/x-1\/issues)/, "DELETE $1"), path.startsWith("/api/schedule/sprints/x-1/issues") ? "DELETE" : "GET", path, "pm");
  // the reshaped answers: response_pick's default and its value, a JSON-null answer (the handler's catch: fallback 502); response_wrap
  for (const [path, key] of [["/api/products", "products"], ["/api/projects/overview", "projects"]]) {
    add(`GET ${path}: the upstream gives the list`, "GET", path, "client_viewer", { upstream: { kind: "json", status: 200, body: { [key]: [{ id: "a" }], other: 1 } } });
    add(`GET ${path}: the upstream gives null for the list`, "GET", path, "pm", { upstream: { kind: "json", status: 200, body: { [key]: null } } });
    add(`GET ${path}: the upstream answers JSON null`, "GET", path, "pm", { upstream: { kind: "json", status: 200, body: null } });
    add(`GET ${path}: the upstream answers a number`, "GET", path, "pm", { upstream: { kind: "json", status: 200, body: 7 } });
  }
  for (const route of ["vendors", "customers"]) {
    add(`DELETE /api/${route}/:id with an encoded id`, "DELETE", `/api/${route}/a%20b%2Fc`, "owner", { upstream: { kind: "json", status: 200, body: { id: "a b/c", isActive: false } } });
    add(`DELETE /api/${route}/:id with a body that is ignored`, "DELETE", `/api/${route}/x-1`, "owner", { raw_body: "{not json" });
    add(`PATCH /api/${route}/:id with a JSON null body`, "PATCH", `/api/${route}/x-1`, "pm", { raw_body: "null" });
  }
  // roles_also: billing milestones are PM_OR_ABOVE plus member (the handler's `if (ctx.role !== "member") requireRole(...)`)
  add("POST /api/billing-claims as member (the one role added to the set)", "POST", "/api/billing-claims", "member", { body: { projectId: "p-1", amount: "1" } });
  add("POST /api/billing-claims as site_engineer", "POST", "/api/billing-claims", "site_engineer", { body: { projectId: "p-1", amount: "1" } });
  // the own role set of baselines (PM_OR_ABOVE) runs before the body is read: a refused role never sees its 400
  add("POST /api/schedule/baselines as null_role with a bad body", "POST", "/api/schedule/baselines", "null_role", { body: {} });
  add("POST /api/schedule/baselines as null_role with a JSON null body", "POST", "/api/schedule/baselines", "null_role", { raw_body: "null" });
  return cases;
}
