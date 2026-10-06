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
/** AUDIT-100 A2 batch 7: a multipart form (a document / drawing / permit upload): text fields and files, sent as the browser sends a FormData
 *  (the content type with its boundary is made by the HTTP stack, never written by hand). */
export type Multipart = { fields: [string, string][]; files?: { field: string; name: string; type: string; content: string }[] };
/** content_type (batch 7): only with raw_body, for a body that is not JSON (a urlencoded form sent to an upload route). */
export type ParityCase = { name: string; method: string; path: string; body?: unknown; raw_body?: string; content_type?: string; multipart?: Multipart; who: Who; upstream: Upstream };
export type UpstreamCall = { method: string; path: string; authorization: string | null; acting_user: string | null; acting_email: string | null; content_type: string | null; body: unknown };
/** cache_control: present only when the answer sets a Cache-Control other than "no-store" (both sides normalise the same way). */
/** revalidated (batch 7): the page-side cache entries the real Next handler cleared (revalidateTag / revalidatePath); the edge cannot clear them, the
 *  browser asks Vercel to (projexa-api-routes.json `revalidate`, proven equal to this record by projexa-api-edge.test.ts). Absent when none. */
export type Outcome = { status: number; body: unknown; retry_after: string | null; upstream_calls: UpstreamCall[]; cache_control?: string; revalidated?: { tags: string[]; paths: string[] } };
/** The form as the contract records it (what the upstream received): [name, text] or [name, { file: { name, type, size, text } }], in order. */
export type RecordedForm = { multipart: [string, string | { file: { name: string; type: string; size: number; text: string } }][] };
/** AUDIT-100 A2 batch 7: a SEQUENCE is several requests in a row against one cache that starts empty (the per-instance TTL cache of the three
 *  person-free reads), the clock moving by advance_ms before each step. Recorded from the real Next pipeline with a model of unstable_cache. */
export type SequenceStep = { method: string; path: string; who: Who; upstream: Upstream; advance_ms?: number };
export type Sequence = { name: string; steps: SequenceStep[] };

const OK: Upstream = { kind: "json", status: 200, body: { ok: true, figures: { contractValue: "1000.00", percentByValue: 42 }, rows: [{ id: "r1" }] } };

/** The form a Documents / Drawings / Permits upload sends (a file and its fields). */
const UPLOAD_FORM: Multipart = {
  fields: [["name", "Site permit"], ["category", "insurance"], ["linkedEntityType", "permit"], ["linkedEntityId", "pm-1"], ["projectId", "p-1"]],
  files: [{ field: "file", name: "permit.pdf", type: "application/pdf", content: "%PDF-1.4 a small test file" }],
};

/** One request per route+method the function answers (the edge's whole allowlist: a route added to projexa-api-routes.json must appear here). */
export const REQUESTS: { route: string; method: string; path: string; body?: unknown; multipart?: Multipart }[] = [
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
  // AUDIT-100 A2 batch 7: the routes with a cross-request cache, or whose writes clear a page-side cache, or that upload a file, or that verify
  // their own create (hand-described in projexa-api-routes.json; these requests record what the REAL handlers answer)
  { route: "/api/cost-centers", method: "GET", path: "/api/cost-centers" },
  { route: "/api/currencies", method: "GET", path: "/api/currencies" },
  { route: "/api/fiscal-years", method: "GET", path: "/api/fiscal-years" },
  { route: "/api/documents", method: "GET", path: "/api/documents?projectScopeId=p%201&category=insurance&ignored=1" },
  { route: "/api/documents", method: "POST", path: "/api/documents", multipart: UPLOAD_FORM },
  { route: "/api/drawings", method: "GET", path: "/api/drawings?projectId=p%201&kind=plan&discipline=civil&status=issued&ignored=1" },
  { route: "/api/drawings", method: "POST", path: "/api/drawings", multipart: UPLOAD_FORM },
  { route: "/api/permits", method: "GET", path: "/api/permits?withinDays=30&projectId=p%201&all=true&ignored=1" },
  { route: "/api/permits", method: "POST", path: "/api/permits", multipart: UPLOAD_FORM },
  { route: "/api/labour-roster", method: "GET", path: "/api/labour-roster?projectId=p%201" },
  { route: "/api/labour-roster", method: "POST", path: "/api/labour-roster", body: {"name": "Batch 7", "trade": "mason", "actorEmail": "someone@else.test"} },
  { route: "/api/materials/master", method: "GET", path: "/api/materials/master?projectId=p%201" },
  { route: "/api/materials/master", method: "POST", path: "/api/materials/master", body: {"name": "Batch 7", "unitCost": "12.50", "actorEmail": "someone@else.test"} },
  { route: "/api/meetings", method: "GET", path: "/api/meetings?projectId=p%201" },
  { route: "/api/meetings", method: "POST", path: "/api/meetings", body: {"name": "Batch 7", "actorEmail": "someone@else.test"} },
  { route: "/api/moms", method: "GET", path: "/api/moms?projectId=p%201" },
  { route: "/api/moms", method: "POST", path: "/api/moms", body: {"name": "Batch 7", "actorEmail": "someone@else.test"} },
  { route: "/api/mood-boards", method: "GET", path: "/api/mood-boards?projectId=p%201" },
  { route: "/api/mood-boards", method: "POST", path: "/api/mood-boards", body: {"name": "Batch 7", "actorEmail": "someone@else.test"} },
  { route: "/api/knowledge-base", method: "GET", path: "/api/knowledge-base" },
  { route: "/api/knowledge-base", method: "POST", path: "/api/knowledge-base", body: {"title": "Batch 7", "body": "text", "actorEmail": "someone@else.test"} },
  { route: "/api/knowledge-base/:id", method: "GET", path: "/api/knowledge-base/kb%201" },
  { route: "/api/knowledge-base/:id", method: "PATCH", path: "/api/knowledge-base/kb%201", body: {"title": "Batch 7", "actorEmail": "someone@else.test"} },
  { route: "/api/projects", method: "GET", path: "/api/projects" },
  { route: "/api/projects", method: "POST", path: "/api/projects", body: {"name": "Batch 7", "actorEmail": "someone@else.test"} },
  { route: "/api/scope", method: "GET", path: "/api/scope?projectId=p%201&include=variation,compare" },
  { route: "/api/scope", method: "POST", path: "/api/scope", body: {"title": "Batch 7", "projectId": "p-1", "lineItems": [{"description": "a"}, {"description": "b"}], "actorEmail": "someone@else.test"} },
];

export function buildCases(): ParityCase[] {
  const cases: ParityCase[] = [];
  // every request x every role, signed out and no organisation, upstream answering normally
  for (const r of REQUESTS) {
    for (const who of [...ROLES, "signed_out", "no_org"] as Who[]) cases.push({ name: `${r.method} ${r.route} as ${who}`, method: r.method, path: r.path, body: r.body, ...(r.multipart ? { multipart: r.multipart } : {}), who, upstream: OK });
  }
  // AUDIT-100 A2 batch 7: a body that is not JSON, on EVERY route that reads one. Found while recording batch 7: a handler that reads `await
  // request.json()` outside its try (almost all do, the first route of the contract included) THROWS on it, which Next answers with an empty 500; the
  // edge had answered 400 {"error":"Invalid JSON body"} for such a body since batch 1, an answer no recorded case ever compared.
  for (const r of REQUESTS) {
    if (r.body === undefined) continue;
    cases.push({ name: `${r.method} ${r.route}: a body that is not JSON`, method: r.method, path: r.path, raw_body: "{not json", who: "pm", upstream: OK });
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
  // AUDIT-100 A2 batch 7: cross-request caches, page-cache invalidation on writes (recorded as `revalidated`), file uploads, redaction by role, the
  // BOQ create verification. Every form both ways, each new shape under the upstream's failures, and the bodies a handler must survive.
  const ok = (body: unknown): Upstream => ({ kind: "json", status: 200, body });
  const failureSet = (r: { route: string; method: string; path: string; body?: unknown; multipart?: Multipart }) => {
    const tag = `${r.method} ${r.route}`;
    const base = { method: r.method, path: r.path, body: r.body, ...(r.multipart ? { multipart: r.multipart } : {}) };
    cases.push({ name: `${tag}: another organisation's record`, ...base, who: "wrong_org", upstream: { kind: "json", status: 404, body: { error: "Not found" } } });
    cases.push({ name: `${tag}: upstream 409 with message`, ...base, who: "owner", upstream: { kind: "json", status: 409, body: { error: "Changed by someone else" } } });
    cases.push({ name: `${tag}: upstream 500`, ...base, who: "owner", upstream: { kind: "json", status: 500, body: { error: "boom" } } });
    cases.push({ name: `${tag}: upstream 502 not JSON`, ...base, who: "owner", upstream: { kind: "text", status: 502, status_text: "Bad Gateway", text: "<html>bad gateway</html>" } });
    cases.push({ name: `${tag}: upstream 200 not JSON`, ...base, who: "owner", upstream: { kind: "text", status: 200, status_text: "OK", text: "not json" } });
    cases.push({ name: `${tag}: connection refused`, ...base, who: "owner", upstream: { kind: "refused" } });
    cases.push({ name: `${tag}: organisation has no VERIDIAN key`, ...base, who: "no_key", upstream: OK });
    cases.push({ name: `${tag}: membership read fails`, ...base, who: "membership_error", upstream: OK });
  };
  for (const [route, method] of [["/api/cost-centers", "GET"], ["/api/documents", "GET"], ["/api/documents", "POST"], ["/api/drawings", "POST"], ["/api/permits", "GET"], ["/api/labour-roster", "POST"], ["/api/materials/master", "GET"], ["/api/moms", "POST"], ["/api/knowledge-base", "POST"], ["/api/knowledge-base/:id", "PATCH"], ["/api/projects", "GET"], ["/api/projects", "POST"], ["/api/scope", "GET"], ["/api/scope", "POST"]]) failureSet(batch2(route, method));

  // documents: either of two query params is needed; linkedEntityType defaults to "project" and is only sent with linkedEntityId; every other
  // param is dropped when empty; the order of the forwarded query is the handler's
  for (const q of ["", "?category=x", "?linkedEntityId=", "?projectScopeId=", "?linkedEntityId=e-1", "?linkedEntityId=e-1&linkedEntityType=permit", "?linkedEntityId=e-1&linkedEntityType=", "?linkedEntityType=permit&projectScopeId=p-1", "?projectScopeId=p-1&linkedEntityId=e%201&category=a%26b&linkedEntityType=rfi", "?projectScopeId=a%20b%2Bc&category=", "?category=z&projectScopeId=p-1&junk=1&linkedEntityId=e-2"]) {
    add(`GET /api/documents${q || " without a query"}`, "GET", `/api/documents${q}`, "pm");
  }
  // drawings: projectId is needed; kind / discipline / status are forwarded in that order when set (URLSearchParams encoding)
  for (const q of ["", "?projectId=", "?projectId=p-1", "?projectId=a%20b%2Bc&kind=x%26y", "?status=s&discipline=d&kind=k&projectId=p-1", "?projectId=p-1&kind=&discipline=&status=", "?projectId=p-1&discipline=d%20e&extra=1"]) {
    add(`GET /api/drawings${q || " without a query"}`, "GET", `/api/drawings${q}`, "pm");
  }
  // permits: withinDays, projectId, then all=true only for exactly "true"
  for (const q of ["", "?", "?withinDays=30", "?projectId=p%201", "?all=true", "?all=1", "?all=TRUE", "?all=", "?all=true&withinDays=7&projectId=p-1", "?withinDays=&all=true", "?projectId=p-1&withinDays=7&all=true&all=false", "?withinDays=a%20b&junk=1"]) {
    add(`GET /api/permits${q || " without a query"}`, "GET", `/api/permits${q}`, "pm");
  }
  // scope: only variation / compare are forwarded (whitespace trimmed, any order, once), the rest is dropped
  for (const inc of ["", "&include=", "&include=variation", "&include=compare", "&include=compare,variation", "&include=%20variation%20,%20compare%20", "&include=bogus", "&include=variation,variation,bogus", "&include=VARIATION", "&include=variation%2Ccompare"]) {
    add(`GET /api/scope?projectId=p-1${inc}`, "GET", `/api/scope?projectId=p-1${inc}`, "pm");
  }
  add("GET /api/scope without projectId", "GET", "/api/scope", "pm");
  add("GET /api/scope with an empty projectId", "GET", "/api/scope?projectId=", "pm");
  add("GET /api/scope as client_viewer", "GET", "/api/scope?projectId=p-1&include=compare", "client_viewer");
  // moms: projectId is optional
  for (const q of ["", "?projectId=", "?projectId=p-1", "?projectId=a%20b%2Bc&x=1"]) add(`GET /api/moms${q || " without a query"}`, "GET", `/api/moms${q}`, "pm");
  for (const route of ["labour-roster", "materials/master", "meetings", "mood-boards"]) {
    add(`GET /api/${route} without projectId`, "GET", `/api/${route}`, "pm");
    add(`GET /api/${route} with an empty projectId`, "GET", `/api/${route}?projectId=`, "pm");
  }
  // materials master: unit costs are hidden from site_engineer and client_viewer only, in the list, whatever else the answer holds
  const materials = { materials: [{ id: "m1", name: "Cement", unitCost: "420.00" }, null, 7, "x", { id: "m2", unitCost: null }, { id: "m3" }], total: 6 };
  for (const who of ROLES) add(`GET /api/materials/master with costs as ${who}`, "GET", "/api/materials/master?projectId=p-1", who, { upstream: ok(materials) });
  for (const [label, body] of [["materials is not a list", { materials: { id: "m1", unitCost: "1" } }], ["materials is null", { materials: null }], ["no materials key", { other: [1] }], ["an empty list", { materials: [] }], ["the answer is a list", [{ unitCost: "9" }]], ["the answer is null", null], ["the answer is a number", 7], ["the answer is a string", "text"]] as [string, unknown][]) {
    add(`GET /api/materials/master redaction: ${label} (site_engineer)`, "GET", "/api/materials/master?projectId=p-1", "site_engineer", { upstream: ok(body) });
  }
  add("GET /api/materials/master redaction: the answer keeps its other fields (client_viewer)", "GET", "/api/materials/master?projectId=p-1", "client_viewer", { upstream: ok({ materials: [{ unitCost: "5", a: 1 }], units: ["bag"], nested: { unitCost: "7" } }) });
  add("GET /api/materials/master as null_role (no role: not redacted)", "GET", "/api/materials/master?projectId=p-1", "null_role", { upstream: ok(materials) });

  // the answer of projects: { projects: data.projects ?? [] }
  for (const [label, body] of [["a list", { projects: [{ id: "a", name: "A", status: "x", extra: 1 }], other: 1 }], ["null", { projects: null }], ["missing", {}], ["JSON null", null], ["a number", 7]] as [string, unknown][]) {
    add(`GET /api/projects: the upstream gives ${label}`, "GET", "/api/projects", "pm", { upstream: ok(body) });
  }

  // JSON bodies: a bad body is the handler's own answer (an empty 500, or its own 400 / 502); an empty object or array is forwarded
  const jsonBodies: [string, string][] = [["an empty body", ""], ["a broken body", "{not json"], ["a JSON null body", "null"], ["an array body", "[1,2]"], ["a number body", "5"], ["an empty object", "{}"], ["a string body", "\"text\""]];
  for (const [route, method, path] of [["/api/labour-roster", "POST", "/api/labour-roster"], ["/api/materials/master", "POST", "/api/materials/master"], ["/api/meetings", "POST", "/api/meetings"], ["/api/mood-boards", "POST", "/api/mood-boards"], ["/api/moms", "POST", "/api/moms"], ["/api/projects", "POST", "/api/projects"], ["/api/knowledge-base", "POST", "/api/knowledge-base"], ["/api/knowledge-base/:id", "PATCH", "/api/knowledge-base/kb-1"], ["/api/scope", "POST", "/api/scope"]]) {
    for (const [label, raw] of jsonBodies) add(`${method} ${route} with ${label}`, method, path, "pm", { raw_body: raw, upstream: route === "/api/scope" ? ok({ id: "b-1" }) : OK });
  }
  // knowledge-base: title is required (a falsy title is refused, a JSON null body throws in the handler)
  for (const [label, body] of [["no title", { body: "x" }], ["an empty title", { title: "" }], ["title 0", { title: 0 }], ["title false", { title: false }], ["title null", { title: null }], ["a title", { title: "T", extra: 1, actorEmail: "x@y.test" }], ["title as a number 1", { title: 1 }]] as [string, unknown][]) {
    add(`POST /api/knowledge-base with ${label}`, "POST", "/api/knowledge-base", "pm", { body });
  }
  add("PATCH /api/knowledge-base/:id with a slash in the id", "PATCH", "/api/knowledge-base/a%2Fb%3Fc", "pm", { body: { title: "x" } });
  add("GET /api/knowledge-base/:id with a path-walking id", "GET", "/api/knowledge-base/..%2F..%2Fadmin", "pm");
  // the role gate of the writes (swept above for every role); a client_viewer / member refused here never reaches the upstream or clears anything
  add("POST /api/projects as client_viewer with a good body", "POST", "/api/projects", "client_viewer", { body: { name: "n" } });
  add("POST /api/scope as site_engineer", "POST", "/api/scope", "site_engineer", { body: { lineItems: [] }, upstream: ok({ id: "b-1" }) });

  // scope create: the handler verifies what came back (an id; at least as many line items as were sent) before it answers 201
  const boq = (name: string, body: unknown, upBody: unknown, who: Who = "pm") => add(name, "POST", "/api/scope", who, { body, upstream: ok(upBody) });
  const two = { title: "T", projectId: "p-1", lineItems: [{ d: "a" }, { d: "b" }] };
  boq("POST /api/scope: saved with every line", two, { id: "b-1", lineItems: [{}, {}] });
  boq("POST /api/scope: saved with more lines than sent", two, { id: "b-1", lineItems: [{}, {}, {}] });
  boq("POST /api/scope: one line did not come back", two, { id: "b-1", lineItems: [{}] });
  boq("POST /api/scope: lines missing from the answer", two, { id: "b-1" });
  boq("POST /api/scope: lines not a list in the answer", two, { id: "b-1", lineItems: "x" });
  boq("POST /api/scope: no id in the answer", two, { lineItems: [{}, {}] });
  boq("POST /api/scope: a blank id", two, { id: "   ", lineItems: [{}, {}] });
  boq("POST /api/scope: an id with spaces around it is accepted", two, { id: "  b-1  ", lineItems: [{}, {}] });
  boq("POST /api/scope: a numeric id", two, { id: 7, lineItems: [{}, {}] });
  boq("POST /api/scope: the answer is JSON null", two, null);
  boq("POST /api/scope: the answer is an array", two, [{ id: "b-1" }]);
  boq("POST /api/scope: the answer is a number", two, 7);
  boq("POST /api/scope: no lines sent, an id back", { title: "T" }, { id: "b-1" });
  boq("POST /api/scope: lineItems is not a list, an id back", { title: "T", lineItems: "x" }, { id: "b-1" });
  boq("POST /api/scope: an empty list sent", { title: "T", lineItems: [] }, { id: "b-1", lineItems: [] });
  boq("POST /api/scope: the body is an array", [{ lineItems: [1] }], { id: "b-1" });
  boq("POST /api/scope: client_viewer is refused by the gate", two, { id: "b-1", lineItems: [{}, {}] }, "client_viewer");
  boq("POST /api/scope: an actorEmail in the body is not rewritten (the acting person is explicit)", { ...two, actorEmail: "evil@x.test" }, { id: "b-1", lineItems: [{}, {}] }, "owner");

  // uploads: the form goes to the upstream as it is; a body that is not a form is the handler's own failure; roles by the gate (swept above)
  const form = (extra: Partial<Multipart>): Multipart => ({ fields: UPLOAD_FORM.fields, files: UPLOAD_FORM.files, ...extra });
  const up = (name: string, route: string, multipart: Multipart, who: Who = "site_engineer", extra: Partial<ParityCase> = {}) => add(name, "POST", route, who, { multipart, ...extra });
  for (const route of ["/api/documents", "/api/drawings", "/api/permits"]) {
    up(`POST ${route} with two files`, route, form({ files: [{ field: "file", name: "a.pdf", type: "application/pdf", content: "AAA" }, { field: "attachment", name: "b é.png", type: "image/png", content: "BBBB" }] }));
    up(`POST ${route} with fields only`, route, form({ files: [] }));
    up(`POST ${route} with an empty file`, route, form({ files: [{ field: "file", name: "empty.txt", type: "text/plain", content: "" }] }));
    up(`POST ${route} with text that is not ASCII and a repeated field`, route, form({ fields: [["name", "Çevre izni ✓"], ["tag", "a"], ["tag", "b"]], files: [] }));
    up(`POST ${route} with a 64 kB file`, route, form({ files: [{ field: "file", name: "big.bin", type: "application/octet-stream", content: "x".repeat(65_536) }] }));
    add(`POST ${route} with a JSON body (not a form)`, "POST", route, "site_engineer", { body: { name: "x" } });
    add(`POST ${route} with an empty body`, "POST", route, "site_engineer", { raw_body: "" });
    add(`POST ${route} with a urlencoded form`, "POST", route, "site_engineer", { raw_body: "name=Site+permit&category=insurance", content_type: "application/x-www-form-urlencoded" });
  }
  return cases;
}

/** AUDIT-100 A2 batch 7: requests in a row against one cache that starts empty. A cached answer is the ORGANISATION's (the call runs with no acting
 *  person), served to any role for the TTL, per organisation; a failed read is never cached. (After the TTL the real Next serves the stale answer once
 *  and refreshes in the background, the edge refetches at once: that step is therefore NOT part of the contract, see projexa-api-cache.test.ts.) */
export function buildSequences(): Sequence[] {
  const seqs: Sequence[] = [];
  const A = (n: number): Upstream => ({ kind: "json", status: 200, body: { generation: n, rows: [{ id: `r${n}` }] } });
  for (const route of ["/api/currencies", "/api/cost-centers", "/api/fiscal-years"]) {
    seqs.push({
      name: `GET ${route}: one upstream read serves every role of the organisation for 60 s, another organisation has its own`,
      steps: [
        { method: "GET", path: route, who: "owner", upstream: A(1) },
        { method: "GET", path: route, who: "client_viewer", upstream: A(2), advance_ms: 10_000 },
        { method: "GET", path: route, who: "site_engineer", upstream: A(3), advance_ms: 49_000 },
        { method: "GET", path: route, who: "wrong_org", upstream: A(4) },
        { method: "GET", path: route, who: "wrong_org", upstream: A(5), advance_ms: 1 },
        { method: "GET", path: route, who: "pm", upstream: A(6) },
        { method: "GET", path: route, who: "signed_out", upstream: A(7) },
        { method: "GET", path: route, who: "no_org", upstream: A(8) },
      ],
    });
    seqs.push({
      name: `GET ${route}: a failed read is not cached, the next read goes upstream again and its answer is kept`,
      steps: [
        { method: "GET", path: route, who: "owner", upstream: { kind: "json", status: 500, body: { error: "boom" } } },
        { method: "GET", path: route, who: "owner", upstream: { kind: "refused" } },
        { method: "GET", path: route, who: "owner", upstream: { kind: "json", status: 404, body: { error: "Not found" } } },
        { method: "GET", path: route, who: "owner", upstream: A(1) },
        { method: "GET", path: route, who: "pm", upstream: A(2) },
      ],
    });
  }
  seqs.push({
    name: "GET /api/currencies, /api/fiscal-years and /api/cost-centers are cached apart (the path is part of the key)",
    steps: [
      { method: "GET", path: "/api/currencies", who: "owner", upstream: A(1) },
      { method: "GET", path: "/api/fiscal-years", who: "owner", upstream: A(2) },
      { method: "GET", path: "/api/currencies", who: "owner", upstream: A(3) },
      { method: "GET", path: "/api/fiscal-years", who: "owner", upstream: A(4) },
      { method: "GET", path: "/api/cost-centers", who: "owner", upstream: A(5) },
    ],
  });
  return seqs;
}
