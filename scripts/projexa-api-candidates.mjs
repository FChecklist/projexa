// AUDIT-100 A2 (batch 2+): which of the remaining `veridian-proxy` routes are PLAIN proxies the Supabase Edge Function `projexa-api` can
// answer with the spec keys it has, and the spec each one needs, DERIVED FROM THE HANDLER'S OWN SOURCE (src/app/api/<route>/route.ts).
//
//   bun scripts/projexa-api-candidates.mjs                 table: route, callers in the browser code, plain or why not
//   bun scripts/projexa-api-candidates.mjs --spec a,b,c    the projexa-api-routes.json entries for those routes (to paste, then record parity)
//
// A handler method is PLAIN when, after comments are removed, it is made ONLY of these statements (anything else -> not plain, stays on Vercel):
//   requireAuth() + its early return; `const { id } = await params`; `const body = await request.json()`; `const qs = request.nextUrl.search`;
//   `const x = request.nextUrl.searchParams.get("x")` + `if (!x) return NextResponse.json({ error: "..." }, { status: 400 })`;
//   ONE `callVeridian(<path>, { organizationId: ctx.organizationId![, method: "M"][, body][, actingUserId/actingUserEmail from ctx.user] })`;
//   `return NextResponse.json(data[, { status: 201 }])`; `catch (err) { return veridianErrorResponse(err, "<fallback>") }`.
// This script only PROPOSES: the parity contract (src/lib/projexa-api-parity.test.ts records the REAL Next answers, compliance-tracker replays
// them through the edge handler) is what proves a derived spec is right.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const inv = JSON.parse(readFileSync(join(ROOT, "ai-os", "audit37", "vercel-route-inventory.json"), "utf8"));

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const squash = (s) => s.replace(/\s+/g, " ").trim();

/** The body of each `export const M = withTiming("M", async function M(...) { ... });` */
export function methodBodies(source) {
  const src = stripComments(source);
  const out = {};
  const re = /export const (GET|POST|PUT|PATCH|DELETE) = withTiming\("\1", async function \1\(([^)]*(?:\([^)]*\)[^)]*)*)\)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1;
    let i = re.lastIndex;
    for (; i < src.length && depth; i++) depth += src[i] === "{" ? 1 : src[i] === "}" ? -1 : 0;
    out[m[1]] = squash(src.slice(re.lastIndex, i - 1));
  }
  // any other exported method (not wrapped the same way) makes the whole file non-plain
  const all = [...src.matchAll(/export\s+(?:const|async function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map((x) => x[1]);
  return { bodies: out, exported: all, preamble: squash(src.replace(/export const (GET|POST|PUT|PATCH|DELETE)[\s\S]*$/m, "")) };
}

const ALLOWED_IMPORTS = /^(next\/server|@\/lib\/supabase\/auth-guard|@\/lib\/veridian-client|@\/lib\/veridian-response|@\/lib\/with-timing)$/;

/** The spec of one plain method body, or { why } when it is not plain. */
export function deriveMethod(method, body, routePattern) {
  const params = new Set([...routePattern.matchAll(/:(\w+)/g)].map((x) => x[1]));
  let rest = body;
  const spec = {};
  const take = (re, fn) => {
    const m = rest.match(re);
    if (!m) return false;
    rest = rest.replace(re, " ");
    fn?.(m);
    return true;
  };
  if (!take(/const ctx = await requireAuth\(\);\s*if \(ctx\.response\) return ctx\.response;/)) return { why: "no requireAuth() preamble" };
  const queryVars = {};
  // required query params, in order
  while (
    take(/const (\w+) = (?:_?request)\.nextUrl\.searchParams\.get\("(\w+)"\);\s*if \(!\1\) return NextResponse\.json\(\{ error: ("[^"]+") \}, \{ status: 400 \}\);/, (m) => {
      queryVars[m[1]] = m[2];
      (spec.required_query ??= {})[m[2]] = JSON.parse(m[3]);
    })
  );
  take(/const \{ ([\w, ]+) \} = await params;/, (m) => m[1].split(",").map((s) => s.trim()).forEach((p) => { if (!params.has(p)) spec.__bad = `param ${p}`; }));
  let hasBody = false;
  take(/const body = await (?:_?request)\.json\(\);/, () => (hasBody = true));
  let forwardSearch = false;
  take(/const qs = (?:_?request)\.nextUrl\.search;/, () => (forwardSearch = true));
  // the try block
  const tryRe = /try \{ (?:const \{ ([\w, ]+) \} = await params; )?(?:const body = await (?:_?request)\.json\(\); )?const data = await callVeridian\(((?:"[^"]*")|(?:`[^`]*`)), \{ ?organizationId: ctx\.organizationId!(?:, method: "(\w+)")?(?:, body)?(?:, actingUserId: ctx\.user\?\.id, actingUserEmail: ctx\.user\?\.email \?\? undefined)?,? ?\}\);\s*return NextResponse\.json\(data(?:, \{ status: (\d+) \})?(?:, \{ headers: \{ "Cache-Control": ("[^"]+") \} \})?\);\s*\} catch \(err\) \{ (?:return veridianErrorResponse\(err, ("[^"]+")\);|return NextResponse\.json\( ?\{ error: err instanceof VeridianApiError \? err\.message : ("[^"]+") \}, \{ status: err instanceof VeridianApiError \? err\.status : 502 \},? ?\);)\s*\}/;
  const t = rest.match(tryRe);
  if (!t) return { why: "not the plain try { callVeridian } catch { veridianErrorResponse } shape" };
  const tryText = t[0];
  if (/const body = await (?:_?request)\.json\(\);/.test(tryText)) hasBody = true;
  rest = rest.replace(tryRe, " ");
  if (rest.replace(/[\s;]/g, "") !== "") return { why: `extra statements: ${rest.trim().slice(0, 80)}` };
  if (spec.__bad) return { why: spec.__bad };
  const callMethod = t[3] ?? "GET";
  if (callMethod !== method) return { why: `calls upstream with ${callMethod}` };
  const usesBody = /, body(?:,| ?\})/.test(tryText);
  if (usesBody && !hasBody) return { why: "forwards a body it does not read from the request" };
  if (hasBody && !usesBody) return { why: "reads a body it does not forward" };
  // the upstream path
  let raw = t[2];
  let path;
  if (raw.startsWith('"')) path = JSON.parse(raw);
  else {
    path = raw.slice(1, -1).replace(/\$\{(?:encodeURIComponent\((\w+)\)|(\w+)|(_?request\.nextUrl\.search))\}/g, (_m, enc, plain, inline) => {
      if (inline) {
        forwardSearch = true;
        return "{search}";
      }
      const v = enc ?? plain;
      if (v === "qs" && forwardSearch) return "{search}";
      if (params.has(v)) return `{${v}}`;
      if (queryVars[v]) return `{query:${queryVars[v]}}`;
      return `{??${v}}`;
    });
    if (/\$\{|\{\?\?/.test(path)) return { why: `path expression not understood: ${raw}` };
  }
  if (forwardSearch) {
    if (!path.endsWith("{search}")) return { why: "reads the query string but does not forward it at the end" };
    path = path.slice(0, -"{search}".length);
    spec.forward_search = true;
  } else if (path.includes("{search}")) return { why: "search in an odd place" };
  const out = { upstream: path };
  if (/actingUserId/.test(tryText)) out.acting_user = "explicit";
  if (spec.required_query) out.required_query = spec.required_query;
  if (spec.forward_search) out.forward_search = true;
  if (usesBody) out.body = "json";
  if (t[4]) out.success_status = Number(t[4]);
  if (t[5]) out.cache_control = JSON.parse(t[5]);
  if (t[7]) out.error_style = "plain";
  out.fallback = JSON.parse(t[6] ?? t[7]);
  return { spec: out };
}

export function deriveRoute(entry) {
  const src = readFileSync(join(ROOT, entry.file), "utf8");
  const imports = [...src.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
  const badImport = imports.find((i) => !ALLOWED_IMPORTS.test(i));
  if (badImport) return { why: `imports ${badImport}` };
  const { bodies, exported, preamble } = methodBodies(src);
  if (/\bconst\b|\bfunction\b|\blet\b/.test(preamble.replace(/^.*?;\s*/, "").replace(/type RouteContext = [^;]+;/g, ""))) return { why: "module-level code" };
  const methods = {};
  for (const m of exported) {
    if (!bodies[m]) return { why: `${m} is not wrapped in withTiming the plain way` };
    const d = deriveMethod(m, bodies[m], entry.route);
    if (d.why) return { why: `${m}: ${d.why}` };
    methods[m] = d.spec;
  }
  return { spec: { route: entry.route, methods } };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const specAt = args.indexOf("--spec");
  const rows = inv.routes.filter((r) => r.backend === "veridian-proxy" && r.served_by !== "edge:projexa-api");
  if (specAt >= 0) {
    const want = args[specAt + 1].split(",");
    const out = [];
    for (const w of want) {
      const r = rows.find((x) => x.route === w);
      if (!r) throw new Error(`${w}: not a remaining proxy route`);
      const d = deriveRoute(r);
      if (d.why) throw new Error(`${w}: ${d.why}`);
      out.push(d.spec);
    }
    console.log(JSON.stringify(out, null, 2));
  } else {
    let plain = 0;
    for (const r of rows) {
      const d = deriveRoute(r);
      if (!d.why) plain++;
      console.log(`${d.why ? "STAY " : "PLAIN"}\t${r.route}\t${r.methods.join(",")}\t${d.why ?? ""}`);
    }
    console.log(`${plain} plain of ${rows.length} remaining proxy routes`);
  }
}
