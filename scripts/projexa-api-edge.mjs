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

const KNOWN_KEYS = new Set(["upstream", "acting_user", "fallback", "required_query", "timeout_ms", "search_params", "body", "body_actor_email", "error_style"]);

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
    }
    if (!Object.keys(entry.methods ?? {}).length) problems.push(`${entry.route}: no methods`);
  }
  return problems;
}

function edgeRoutes(spec) {
  return (spec.routes ?? []).map((r) => ({ route: r.route, methods: r.methods }));
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
  lines.push("  upstream: string; acting_user?: \"explicit\" | \"session\"; fallback: string; required_query?: Record<string, string>; timeout_ms?: number;");
  lines.push("  search_params?: string[]; body?: \"json\"; body_actor_email?: \"always\"; error_style?: \"veridian\" | \"plain\"");
  lines.push("}");
  lines.push("/** DENY BY DEFAULT: the only routes the function answers. Generated from ai-os/audit37/projexa-api-routes.json. */");
  lines.push("export const EDGE_ROUTES: ReadonlyArray<{ route: string; methods: Readonly<Record<string, EdgeMethodSpec>> }> = [");
  for (const r of data.edgeRoutes) lines.push(`  ${j(r)},`);
  lines.push("]");
  lines.push("");
  lines.push("/** The data SOURCE_SHA256 is computed over (both repos' tests recompute the hash from this). */");
  lines.push("export function sourceData() {");
  lines.push("  return { roleGroups: ROLE_GROUPS, policy: API_WRITE_POLICY, defaultTier: DEFAULT_WRITE_TIER, mutatingMethods: [...MUTATING_METHODS], edgeRoutes: EDGE_ROUTES }");
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
    }
  } else if (checkCt >= 0) {
    const out = join(args[checkCt + 1], CT_RELATIVE);
    const golden = join(args[checkCt + 1], CT_GOLDEN_RELATIVE);
    const same =
      existsSync(out) && lf(readFileSync(out, "utf8")) === text && existsSync(golden) && lf(readFileSync(golden, "utf8")) === lf(readFileSync(GOLDEN_PATH, "utf8"));
    console.log(same ? `ok: ${out} and the parity contract are identical to this repo's` : `FAIL: ${out} or ${golden} differs from this repo's: regenerate with --write --ct`);
    process.exit(same ? 0 : 1);
  } else {
    const same = existsSync(GENERATED_PATH) && lf(readFileSync(GENERATED_PATH, "utf8")) === text;
    console.log(same ? "ok: policy.generated.ts matches the sources" : "FAIL: policy.generated.ts is stale: bun scripts/projexa-api-edge.mjs --write");
    process.exit(same ? 0 : 1);
  }
}
