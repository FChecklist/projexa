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
export type Outcome = { status: number; body: unknown; retry_after: string | null; upstream_calls: UpstreamCall[] };

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
  // the missing-query refusal of the exceptions route
  cases.push({ name: "GET /api/exceptions without projectId", method: "GET", path: "/api/exceptions", who: "pm", upstream: OK });
  cases.push({ name: "GET /api/reports/boq-analysis without query", method: "GET", path: "/api/reports/boq-analysis", who: "pm", upstream: OK });
  return cases;
}
