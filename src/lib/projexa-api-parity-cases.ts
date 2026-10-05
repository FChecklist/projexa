// AUDIT-100 A2: the golden request set of the PARITY CONTRACT between PROJEXA's Next pipeline (src/middleware.ts + src/app/api/**/route.ts)
// and the Supabase Edge Function `projexa-api` (compliance-tracker supabase/functions/projexa-api). Every route the function answers, every
// method, every role tier, signed out, no organisation, another organisation, a failed membership read, an organisation with no VERIDIAN key,
// and the upstream's failure shapes. src/lib/projexa-api-parity.test.ts runs these through the REAL Next pipeline and records what it answered
// (ai-os/audit37/projexa-api/parity.golden.json); compliance-tracker's projexa-api-edge-parity.test.ts replays the same file through the edge
// handler and must get the same status, body, Retry-After and upstream calls.

export const ROLES = ["owner", "admin", "pm", "site_engineer", "member", "client_viewer"] as const;
export type Who = (typeof ROLES)[number] | "signed_out" | "no_org" | "wrong_org" | "membership_error" | "no_key";

export const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const ORG_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

export type Identity = { sub: string; email: string | null; membership: { organization_id: string; role: string } | null | "error" };
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
};
export const ORG_KEYS: Record<string, string> = { [ORG_A]: "key-org-a", [ORG_B]: "key-org-b" };

export type Upstream =
  | { kind: "json"; status: number; body: unknown }
  | { kind: "text"; status: number; status_text: string; text: string }
  /** the connection is refused (no response at all) */
  | { kind: "refused" };

export type ParityCase = { name: string; method: string; path: string; body?: unknown; who: Who; upstream: Upstream };
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
  { route: "/api/wiki/:id", method: "PATCH", path: "/api/wiki/x-1", body: {"name": "Batch 4", "amount": "12.50", "actorEmail": "someone@else.test"} },
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
  return cases;
}
