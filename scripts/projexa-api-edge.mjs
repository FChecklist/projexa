// AUDIT-100 A2: generates the table of the Supabase Edge Function `projexa-api` (compliance-tracker supabase/functions/projexa-api) from THIS
// repo's own sources, so the role policy and the route list the function enforces cannot drift from what Vercel enforces today.
//
//   bun scripts/projexa-api-edge.mjs                     check: ai-os/audit37/projexa-api/policy.generated.ts equals what the sources give
//   bun scripts/projexa-api-edge.mjs --write             rewrite it
//   bun scripts/projexa-api-edge.mjs --write --ct <dir>  also write the copy the function deploys from (<dir>/supabase/functions/projexa-api/)
//   bun scripts/projexa-api-edge.mjs --check-ct <dir>    the compliance-tracker copy is byte-identical to this repo's (run before every deploy)
//
// Sources (nothing is hand-copied):
//   src/lib/authz/api-write-policy.ts   API_WRITE_POLICY, DEFAULT_WRITE_TIER, MUTATING_METHODS (the table src/middleware.ts enforces)
//   src/lib/authz/roles.ts              ROLE_GROUPS
//   ai-os/audit37/projexa-api-routes.json        the routes the function answers (DENY BY DEFAULT: nothing else), each one's upstream call
//   ai-os/audit37/vercel-route-inventory.json    every listed route must be a real `veridian-proxy` route with those methods
// The decision functions in the output are a port of api-write-policy.ts's resolveWriteTier/checkApiWriteAccess; src/lib/projexa-api-edge.test.ts
// proves they decide exactly as the originals for every pattern of the table, every method and every role.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { API_WRITE_POLICY, DEFAULT_WRITE_TIER, MUTATING_METHODS } from "../src/lib/authz/api-write-policy.ts";
import { ROLE_GROUPS } from "../src/lib/authz/roles.ts";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const ROUTES_PATH = join(ROOT, "ai-os", "audit37", "projexa-api-routes.json");
export const INVENTORY_PATH = join(ROOT, "ai-os", "audit37", "vercel-route-inventory.json");
export const GENERATED_PATH = join(ROOT, "ai-os", "audit37", "projexa-api", "policy.generated.ts");
export const CT_RELATIVE = join("supabase", "functions", "projexa-api", "policy.generated.ts");
/** The parity contract recorded by src/lib/projexa-api-parity.test.ts; compliance-tracker replays its copy. */
export const GOLDEN_PATH = join(ROOT, "ai-os", "audit37", "projexa-api", "parity.golden.json");
export const CT_GOLDEN_RELATIVE = join("supabase", "functions", "projexa-api", "parity.golden.json");
/** AUDIT-100 A2 batch 8: the pure category-distribution builder the two category-distribution routes combine their two reads with; copied byte for byte
 *  (the function must build the chart's rows exactly as the Next handler does, so there is one source). */
export const BUILDER_SOURCE = join(ROOT, "src", "lib", "category-distribution.ts");
export const CT_BUILDER_RELATIVE = join("supabase", "functions", "projexa-api", "category-distribution.ts");

const KNOWN_KEYS = new Set(["upstream", "acting_user", "fallback", "required_query", "timeout_ms", "search_params", "body", "body_actor_email", "error_style", "forward_search", "success_status", "cache_control", "root", "roles", "body_defaults",
  // AUDIT-100 A2 batch 6: body validation / reshaping, query rebuilding, response reshaping (each one a port of a handler statement)
  "body_required", "body_pick", "body_object_error", "invalid_body_error", "body_in_try", "body_reject_if", "body_const", "upstream_method",
  "optional_query", "query_flags", "search_params_omit_empty", "forward_query_normalized", "required_query_any", "roles_also", "response_pick",
  "response_wrap",
  // AUDIT-100 A2 batch 7: per-instance TTL cache of a person-free read, a multipart upload, derived / allow-listed query parts, an answer redacted by
  // role, the BOQ create verification, and the page-side cache entries the browser clears after a write (client-only, the edge never reads it)
  "cache_ttl", "search_param_defaults", "include_allow", "response_redact", "boq_create_verify", "revalidate",
  // AUDIT-100 A2 batch 8: the company a person names in the path (a second membership check, the company's own key), the id-only acting person
  // of the company dashboard, and the two-read category distribution
  "company_scope", "category_distribution"]);
/** Route-level keys of projexa-api-routes.json the function does not read (they steer the browser switch and the inventory, not the edge). */
const ROUTE_KEYS = new Set(["route", "methods", "batch"]);

/** Problems with the route list: [] when every route is a real proxy route of the inventory with a complete upstream description. */
export function validateRoutes(spec, inventory) {
  const problems = [];
  const inv = new Map((inventory.routes ?? []).map((r) => [r.route, r]));
  const seen = new Set();
  for (const entry of spec.routes ?? []) {
    if (seen.has(entry.route)) problems.push(`${entry.route}: listed twice`);
    seen.add(entry.route);
    const real = inv.get(entry.route);
    if (!real) {
      problems.push(`${entry.route}: not a route of the inventory`);
      continue;
    }
    if (real.backend !== "veridian-proxy") problems.push(`${entry.route}: is ${real.backend}, only veridian-proxy routes may be answered by the edge proxy`);
    for (const [method, m] of Object.entries(entry.methods ?? {})) {
      if (!real.methods.includes(method)) problems.push(`${entry.route}: ${method} is not a method of its Next handler`);
      for (const k of Object.keys(m)) if (!KNOWN_KEYS.has(k)) problems.push(`${entry.route} ${method}: unknown key ${k}`);
      if (typeof m.upstream !== "string" || !m.upstream.startsWith("/")) problems.push(`${entry.route} ${method}: no upstream path`);
      if (typeof m.fallback !== "string" || m.fallback.length < 5) problems.push(`${entry.route} ${method}: no fallback message`);
      for (const p of (m.upstream ?? "").matchAll(/\{(?!query:)(\w+)\}/g)) if (!entry.route.includes(`:${p[1]}`)) problems.push(`${entry.route} ${method}: upstream names {${p[1]}} which is not a path parameter`);
      if (m.success_status !== undefined && ![200, 201].includes(m.success_status)) problems.push(`${entry.route} ${method}: success_status must be 200 or 201`);
      if (m.cache_control !== undefined && !/^private, max-age=\d+$/.test(m.cache_control)) problems.push(`${entry.route} ${method}: cache_control must be "private, max-age=<n>" (never a shared cache: the rows are the org's own)`);
      if (m.forward_search && m.search_params) problems.push(`${entry.route} ${method}: forward_search and search_params are exclusive`);
      // AUDIT-100 A2 batch 5: the handler's own role set, the VERIDIAN root (/api/v1 instead of /api/v1/projexa), and the body forms
      if (m.roles !== undefined && !Object.prototype.hasOwnProperty.call(ROLE_GROUPS, m.roles)) problems.push(`${entry.route} ${method}: roles must name a ROLE_GROUPS group (src/lib/authz/roles.ts)`);
      if (m.root !== undefined && m.root !== true) problems.push(`${entry.route} ${method}: root is true or absent`);
      if (m.body !== undefined && !["json", "json_lenient", "empty", "multipart"].includes(m.body)) problems.push(`${entry.route} ${method}: body must be json, json_lenient, empty or multipart`);
      if (m.acting_user !== undefined && !["explicit", "session", "none", "id_only"].includes(m.acting_user)) problems.push(`${entry.route} ${method}: acting_user is explicit, session, none or id_only`);
      if (m.body_defaults !== undefined && (!["json", "json_lenient"].includes(m.body) || typeof m.body_defaults !== "object" || Object.values(m.body_defaults).some((v) => typeof v !== "string"))) problems.push(`${entry.route} ${method}: body_defaults is an object of strings, only on a forwarded body`);
      if (m.body_actor_email !== undefined && (m.body_actor_email !== "always" || m.body === undefined)) problems.push(`${entry.route} ${method}: body_actor_email "always" needs a body`);
      // AUDIT-100 A2 batch 6
      const isStrArr = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && /^\w+$/.test(x));
      const readsBody = ["json", "json_lenient"].includes(m.body);
      if (m.body_required !== undefined && (!readsBody || !Array.isArray(m.body_required) || !m.body_required.every((c) => isStrArr(c.fields) && typeof c.error === "string" && Object.keys(c).length === 2))) problems.push(`${entry.route} ${method}: body_required is [{ fields, error }] on a read body`);
      if (m.body_pick !== undefined && (!readsBody || !isStrArr(m.body_pick))) problems.push(`${entry.route} ${method}: body_pick is a list of field names on a read body`);
      if (m.body_object_error !== undefined && (m.body !== "json_lenient" || typeof m.body_object_error !== "string")) problems.push(`${entry.route} ${method}: body_object_error is a message on a json_lenient body (request.json().catch(() => null))`);
      if (m.invalid_body_error !== undefined && (m.body !== "json" || typeof m.invalid_body_error !== "string" || m.body_in_try)) problems.push(`${entry.route} ${method}: invalid_body_error is a message on a strict json body`);
      if (m.body_in_try !== undefined && (m.body_in_try !== true || m.body !== "json")) problems.push(`${entry.route} ${method}: body_in_try is true on a strict json body`);
      if (m.body_reject_if !== undefined && (!readsBody || !Array.isArray(m.body_reject_if) || !m.body_reject_if.every((r) => r && typeof r.error === "string" && r.match && typeof r.match === "object" && Object.keys(r.match).length > 0 && Object.values(r.match).every((v) => v === null || ["string", "number", "boolean"].includes(typeof v))))) problems.push(`${entry.route} ${method}: body_reject_if is [{ match: { field: primitive }, error }] on a read body`);
      if (m.body_const !== undefined && (m.body !== undefined || typeof m.body_const !== "object" || m.body_const === null || Array.isArray(m.body_const))) problems.push(`${entry.route} ${method}: body_const is a constant object, without body`);
      if (m.upstream_method !== undefined && !["GET", "POST", "PUT", "PATCH", "DELETE"].includes(m.upstream_method)) problems.push(`${entry.route} ${method}: upstream_method is an HTTP method`);
      if (m.optional_query !== undefined && !isStrArr(m.optional_query)) problems.push(`${entry.route} ${method}: optional_query is a list of query names`);
      if (m.query_flags !== undefined && (typeof m.query_flags !== "object" || !Object.values(m.query_flags).every((v) => typeof v === "string" && v.length > 0))) problems.push(`${entry.route} ${method}: query_flags is { name: value }`);
      if (m.search_params_omit_empty !== undefined && (m.search_params_omit_empty !== true || !m.search_params)) problems.push(`${entry.route} ${method}: search_params_omit_empty is true with search_params`);
      if (m.forward_query_normalized !== undefined && (m.forward_query_normalized !== true || m.forward_search || m.search_params)) problems.push(`${entry.route} ${method}: forward_query_normalized is true, without forward_search / search_params`);
      if (m.required_query_any !== undefined && (!isStrArr(m.required_query_any?.params) || typeof m.required_query_any.error !== "string")) problems.push(`${entry.route} ${method}: required_query_any is { params, error }`);
      if (m.roles_also !== undefined && (m.roles === undefined || !isStrArr(m.roles_also))) problems.push(`${entry.route} ${method}: roles_also adds roles to a roles set`);
      if (m.response_pick !== undefined && (typeof m.response_pick !== "object" || m.response_pick === null || !Object.keys(m.response_pick).length)) problems.push(`${entry.route} ${method}: response_pick is { field: default }`);
      if (m.response_wrap !== undefined && (typeof m.response_wrap?.into !== "string" || typeof m.response_wrap.with !== "object" || !Array.isArray(m.response_wrap.params) || m.response_wrap.params.some((p) => !entry.route.includes(`:${p}`)))) problems.push(`${entry.route} ${method}: response_wrap is { with, params (path parameters), into }`);
      if (m.response_pick !== undefined && m.response_wrap !== undefined) problems.push(`${entry.route} ${method}: response_pick and response_wrap are exclusive`);
      // AUDIT-100 A2 batch 7
      if (m.cache_ttl !== undefined && (method !== "GET" || !Number.isInteger(m.cache_ttl) || m.cache_ttl < 1 || m.cache_ttl > 3600 || m.acting_user !== "none" || m.body !== undefined)) problems.push(`${entry.route} ${method}: cache_ttl is whole seconds (1..3600) on a GET without a body that runs without an acting person (acting_user "none": the cached answer is the organisation's, never one person's)`);
      if (m.acting_user === "none" && m.cache_ttl === undefined) problems.push(`${entry.route} ${method}: acting_user "none" is only for a cached person-free read (cache_ttl)`);
      if (m.body === "multipart" && (method !== "POST" || m.body_required !== undefined || m.body_pick !== undefined || m.body_defaults !== undefined || m.body_actor_email !== undefined || m.body_reject_if !== undefined || m.body_object_error !== undefined || m.invalid_body_error !== undefined || m.body_in_try !== undefined)) problems.push(`${entry.route} ${method}: multipart is a POST whose form is relayed as it is (no JSON body keys)`);
      if (m.search_param_defaults !== undefined && (!m.search_params || typeof m.search_param_defaults !== "object" || Object.entries(m.search_param_defaults).some(([k, v]) => !m.search_params.includes(k) || typeof v?.default !== "string" || !m.search_params.includes(v?.when) || Object.keys(v).length !== 2))) problems.push(`${entry.route} ${method}: search_param_defaults is { param: { default, when } } over search_params (set only when the "when" param is, to the request's value or the default)`);
      if (m.include_allow !== undefined && (!isStrArr(m.include_allow) || !m.upstream.includes("?"))) problems.push(`${entry.route} ${method}: include_allow is a list of values, on an upstream that already has a query`);
      if (m.response_redact !== undefined && (!isStrArr(m.response_redact.roles) || typeof m.response_redact.list !== "string" || typeof m.response_redact.set !== "object" || m.response_redact.set === null || Object.keys(m.response_redact).length !== 3)) problems.push(`${entry.route} ${method}: response_redact is { roles, list, set }`);
      if (m.boq_create_verify !== undefined && (m.boq_create_verify !== true || method !== "POST" || m.body !== "json")) problems.push(`${entry.route} ${method}: boq_create_verify is true on a JSON POST`);
      // AUDIT-100 A2 batch 8
      if (m.company_scope !== undefined && (m.company_scope !== true || method !== "GET" || !entry.route.includes(":companyId"))) problems.push(`${entry.route} ${method}: company_scope is true on a GET whose route names :companyId`);
      if (m.acting_user === "id_only" && m.company_scope !== true) problems.push(`${entry.route} ${method}: acting_user "id_only" is the company dashboard's (requireCompanyScope exposes the user id only)`);
      if (m.category_distribution !== undefined) {
        const c = m.category_distribution;
        if (method !== "GET" || !c || typeof c.progress !== "string" || !c.progress.startsWith("/") || (c.boq_id !== undefined && c.boq_id !== true) || Object.keys(c).some((k) => !["progress", "boq_id"].includes(k)) || m.body !== undefined) problems.push(`${entry.route} ${method}: category_distribution is { progress: <path>, boq_id?: true } on a GET (upstream is the amounts read)`);
        for (const p of (c?.progress ?? "").matchAll(/\{(\w+)\}/g)) if (!entry.route.includes(`:${p[1]}`)) problems.push(`${entry.route} ${method}: category_distribution.progress names {${p[1]}} which is not a path parameter`);
      }
      if (m.revalidate !== undefined) {
        const r = m.revalidate;
        const okList = (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && /^[\w:\/-]+$/.test(x));
        if (method === "GET" || !r || !okList(r.tags) || (r.paths !== undefined && !okList(r.paths)) || !(r.tags.length || r.paths?.length) || (r.when !== undefined && !["success", "always"].includes(r.when)) || Object.keys(r).some((k) => !["tags", "paths", "when"].includes(k))) problems.push(`${entry.route} ${method}: revalidate is { tags, paths?, when? } on a write (the page-side cache entries the Next handler clears; the browser asks Vercel to clear them after the edge answered)`);
      }
    }
    for (const k of Object.keys(entry)) if (!ROUTE_KEYS.has(k)) problems.push(`${entry.route}: unknown route key ${k}`);
    if (entry.batch !== undefined && !(Number.isInteger(entry.batch) && entry.batch >= 1)) problems.push(`${entry.route}: batch must be a positive integer`);
    if (!Object.keys(entry.methods ?? {}).length) problems.push(`${entry.route}: no methods`);
  }
  return problems;
}

function edgeRoutes(spec) {
  return (spec.routes ?? []).map((r) => ({ route: r.route, methods: r.methods }));
}

const literalRank = (route) => route.split("/").filter(Boolean).map((p) => (p.startsWith(":") ? "0" : "1")).join("");
/** AUDIT-100 A2 batch 5: the Next routes NOT on the edge that win over an edge route for some concrete path (the App Router prefers a literal
 *  segment: GET /api/drawings/export is that route, not /api/drawings/:id with id "export"). The function answers 404 for such a path and the
 *  browser switch keeps it same-origin, so a literal sibling that stays on Vercel is never answered as the dynamic edge route. */
export function shadowRoutes(spec, inventory) {
  const edge = new Set((spec.routes ?? []).map((r) => r.route));
  const out = new Set();
  for (const s of inventory.routes ?? []) {
    if (edge.has(s.route)) continue;
    const sp = s.route.split("/").filter(Boolean);
    for (const e of edge) {
      const ep = e.split("/").filter(Boolean);
      if (ep.length !== sp.length) continue;
      if (ep.every((p, i) => p.startsWith(":") || sp[i].startsWith(":") || p === sp[i]) && literalRank(s.route) > literalRank(e)) out.add(s.route);
    }
  }
  return [...out].sort();
}

export function sourceData() {
  const spec = JSON.parse(readFileSync(ROUTES_PATH, "utf8"));
  const inventory = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
  const problems = validateRoutes(spec, inventory);
  if (problems.length) throw new Error("projexa-api-routes.json:\n  " + problems.join("\n  "));
  return {
    roleGroups: Object.fromEntries(Object.entries(ROLE_GROUPS).map(([k, v]) => [k, [...v]])),
    policy: Object.entries(API_WRITE_POLICY), // ORDER MATTERS: resolveWriteTier returns the first match
    defaultTier: DEFAULT_WRITE_TIER,
    mutatingMethods: [...MUTATING_METHODS].sort(),
    edgeRoutes: edgeRoutes(spec),
    shadowRoutes: shadowRoutes(spec, inventory),
  };
}

const j = (v) => JSON.stringify(v);
/** A Windows checkout (core.autocrlf) has CRLF; the content is compared as LF. */
export const lf = (s) => s.replace(/\r\n/g, "\n");

export function render(data = sourceData()) {
  const sha = createHash("sha256").update(j(data)).digest("hex");
  const lines = [];
  lines.push("// GENERATED by FChecklist/projexa scripts/projexa-api-edge.mjs -- DO NOT EDIT BY HAND. Edit the sources in the projexa repo and regenerate:");
  lines.push("//   src/lib/authz/api-write-policy.ts, src/lib/authz/roles.ts, ai-os/audit37/projexa-api-routes.json, ai-os/audit37/vercel-route-inventory.json");
  lines.push("// The SAME bytes live in projexa ai-os/audit37/projexa-api/policy.generated.ts and compliance-tracker supabase/functions/projexa-api/.");
  lines.push("// SOURCE_SHA256 is the hash of the data below; both repos' tests recompute it, so a hand edit of either copy fails CI.");
  lines.push(`export const SOURCE_SHA256 = ${j(sha)}`);
  lines.push("");
  lines.push(`export const ROLE_GROUPS: Readonly<Record<string, readonly string[]>> = ${j(data.roleGroups)}`);
  lines.push("");
  lines.push("/** [pattern, tier] in the ORDER of src/lib/authz/api-write-policy.ts (the first match wins, so order is part of the policy). */");
  lines.push("export const API_WRITE_POLICY: ReadonlyArray<readonly [string, string]> = [");
  for (const [p, t] of data.policy) lines.push(`  [${j(p)}, ${j(t)}],`);
  lines.push("]");
  lines.push(`export const DEFAULT_WRITE_TIER = ${j(data.defaultTier)}`);
  lines.push(`export const MUTATING_METHODS: ReadonlySet<string> = new Set(${j(data.mutatingMethods)})`);
  lines.push("");
  lines.push("export type EdgeMethodSpec = {");
  lines.push("  upstream: string; acting_user?: \"explicit\" | \"session\" | \"none\" | \"id_only\"; fallback: string; required_query?: Record<string, string>; timeout_ms?: number;");
  lines.push("  search_params?: string[]; body?: \"json\" | \"json_lenient\" | \"empty\" | \"multipart\"; body_actor_email?: \"always\"; error_style?: \"veridian\" | \"plain\"");
  lines.push("  forward_search?: boolean; success_status?: 200 | 201; cache_control?: string");
  lines.push("  root?: true; roles?: string; body_defaults?: Record<string, string>");
  lines.push("  body_required?: { fields: string[]; error: string }[]; body_pick?: string[]; body_object_error?: string; invalid_body_error?: string; body_in_try?: true");
  lines.push("  body_reject_if?: { match: Record<string, string | number | boolean | null>; error: string }[]; body_const?: Record<string, unknown>; upstream_method?: string");
  lines.push("  optional_query?: string[]; query_flags?: Record<string, string>; search_params_omit_empty?: true; forward_query_normalized?: true");
  lines.push("  required_query_any?: { params: string[]; error: string }; roles_also?: string[]; response_pick?: Record<string, unknown>");
  lines.push("  response_wrap?: { with: Record<string, unknown>; params: string[]; into: string }");
  lines.push("  cache_ttl?: number; search_param_defaults?: Record<string, { default: string; when: string }>; include_allow?: string[]");
  lines.push("  response_redact?: { roles: string[]; list: string; set: Record<string, unknown> }; boq_create_verify?: true");
  lines.push("  revalidate?: { tags: string[]; paths?: string[]; when?: \"success\" | \"always\" }");
  lines.push("  company_scope?: true; category_distribution?: { progress: string; boq_id?: true }");
  lines.push("}");
  lines.push("/** DENY BY DEFAULT: the only routes the function answers. Generated from ai-os/audit37/projexa-api-routes.json. */");
  lines.push("export const EDGE_ROUTES: ReadonlyArray<{ route: string; methods: Readonly<Record<string, EdgeMethodSpec>> }> = [");
  for (const r of data.edgeRoutes) lines.push(`  ${j(r)},`);
  lines.push("]");
  lines.push("/** Next routes that stay on Vercel but win over an edge route for some path (a literal sibling of a dynamic edge route): 404 here. */");
  lines.push(`export const SHADOW_ROUTES: ReadonlyArray<string> = ${j(data.shadowRoutes)}`);
  lines.push("");
  lines.push("/** The data SOURCE_SHA256 is computed over (both repos' tests recompute the hash from this). */");
  lines.push("export function sourceData() {");
  lines.push("  return { roleGroups: ROLE_GROUPS, policy: API_WRITE_POLICY, defaultTier: DEFAULT_WRITE_TIER, mutatingMethods: [...MUTATING_METHODS], edgeRoutes: EDGE_ROUTES, shadowRoutes: SHADOW_ROUTES }");
  lines.push("}");
  lines.push("");
  lines.push(PORTED_DECISION);
  return lines.join("\n") + "\n";
}

// Port of resolveWriteTier / checkApiWriteAccess (src/lib/authz/api-write-policy.ts). Same rules: exact-arity match in table order, dynamic
// segments are single-segment wildcards, else the nearest ancestor pattern, else DEFAULT_WRITE_TIER, never "allow".
const PORTED_DECISION = `function matchesPattern(pattern: string, segments: readonly string[]): boolean {
  const patternSegments = pattern.split("/").filter(Boolean)
  if (patternSegments.length !== segments.length) return false
  return patternSegments.every((p, i) => (p.startsWith("[") && p.endsWith("]")) || p === segments[i])
}

export function resolveWriteTier(pathname: string): string {
  const segments = pathname.replace(/^\\/api/, "").split("/").filter(Boolean)
  if (segments.length === 0) return DEFAULT_WRITE_TIER
  for (const [pattern, tier] of API_WRITE_POLICY) if (matchesPattern(pattern, segments)) return tier
  let best: { depth: number; tier: string } | null = null
  for (const [pattern, tier] of API_WRITE_POLICY) {
    const depth = pattern.split("/").filter(Boolean).length
    if (depth >= segments.length) continue
    if (!matchesPattern(pattern, segments.slice(0, depth))) continue
    if (!best || depth > best.depth) best = { depth, tier }
  }
  return best?.tier ?? DEFAULT_WRITE_TIER
}

/** null role = authenticated with no membership: the handler's 400 decides, not a 403 (same as the original). */
export function checkApiWriteAccess(method: string, pathname: string, role: string | null): { allowed: true } | { allowed: false; tier: string } {
  if (!MUTATING_METHODS.has(method.toUpperCase())) return { allowed: true }
  const tier = resolveWriteTier(pathname)
  if (tier === "PUBLIC") return { allowed: true }
  if (role == null) return { allowed: true }
  const allowedRoles = ROLE_GROUPS[tier] ?? []
  if (allowedRoles.includes(role)) return { allowed: true }
  return { allowed: false, tier }
}`;

/** The hash both repos' tests recompute from a loaded generated module (canonical: same JSON as render()). */
export function hashOf(data) {
  return createHash("sha256").update(j(data)).digest("hex");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const ctAt = args.indexOf("--ct");
  const checkCt = args.indexOf("--check-ct");
  const text = render();
  if (args.includes("--write")) {
    mkdirSync(dirname(GENERATED_PATH), { recursive: true });
    writeFileSync(GENERATED_PATH, text);
    console.log(`wrote ${GENERATED_PATH}`);
    if (ctAt >= 0) {
      const out = join(args[ctAt + 1], CT_RELATIVE);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, text);
      console.log(`wrote ${out}`);
      const golden = join(args[ctAt + 1], CT_GOLDEN_RELATIVE);
      writeFileSync(golden, lf(readFileSync(GOLDEN_PATH, "utf8")));
      console.log(`wrote ${golden}`);
      const builder = join(args[ctAt + 1], CT_BUILDER_RELATIVE);
      writeFileSync(builder, lf(readFileSync(BUILDER_SOURCE, "utf8")));
      console.log(`wrote ${builder}`);
    }
  } else if (checkCt >= 0) {
    const out = join(args[checkCt + 1], CT_RELATIVE);
    const golden = join(args[checkCt + 1], CT_GOLDEN_RELATIVE);
    const builder = join(args[checkCt + 1], CT_BUILDER_RELATIVE);
    const same =
      existsSync(out) && lf(readFileSync(out, "utf8")) === text && existsSync(golden) && lf(readFileSync(golden, "utf8")) === lf(readFileSync(GOLDEN_PATH, "utf8")) &&
      existsSync(builder) && lf(readFileSync(builder, "utf8")) === lf(readFileSync(BUILDER_SOURCE, "utf8"));
    console.log(same ? `ok: ${out} and the parity contract are identical to this repo's` : `FAIL: ${out} or ${golden} differs from this repo's: regenerate with --write --ct`);
    process.exit(same ? 0 : 1);
  } else {
    const same = existsSync(GENERATED_PATH) && lf(readFileSync(GENERATED_PATH, "utf8")) === text;
    console.log(same ? "ok: policy.generated.ts matches the sources" : "FAIL: policy.generated.ts is stale: bun scripts/projexa-api-edge.mjs --write");
    process.exit(same ? 0 : 1);
  }
}
