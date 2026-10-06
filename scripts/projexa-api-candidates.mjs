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
    rest = squash(rest.replace(re, " "));
    fn?.(m);
    return true;
  };
  if (!take(/const ctx = await requireAuth\(\);\s*if \(ctx\.response\) return ctx\.response;/)) return { why: "no requireAuth() preamble" };
  // the handler's own role set (requireRole, auth-guard.ts), only as the FIRST statement after requireAuth (the edge checks it at that point)
  let roles = null;
  if (rest.startsWith("const roleError = requireRole(")) {
    if (!take(/^const roleError = requireRole\(ctx, ROLE_GROUPS\.(\w+)\);\s*if \(roleError\) return roleError;/, (m) => (roles = m[1]))) return { why: "requireRole() in a form not understood" };
  }
  const queryVars = {};
  // required query params, in order
  while (
    take(/const (\w+) = (?:_?request)\.nextUrl\.searchParams\.get\("(\w+)"\);\s*if \(!\1\) return NextResponse\.json\(\{ error: ("[^"]+") \}, \{ status: 400 \}\);/, (m) => {
      queryVars[m[1]] = m[2];
      (spec.required_query ??= {})[m[2]] = JSON.parse(m[3]);
    })
  );
  take(/const \{ ([\w, ]+) \} = await params;/, (m) => m[1].split(",").map((s) => s.trim()).forEach((p) => { if (!params.has(p)) spec.__bad = `param ${p}`; }));
  // body reads: strict (`request.json()`, a bad body throws) or lenient (`request.json().catch(() => ({}))`, a bad or empty body is {})
  const BODY_READ = /const body = await (?:_?request)\.json\(\)(\.catch\(\(\) => \(\{\}\)\))?;/;
  let bodyRead = null; // null | "json" | "json_lenient"
  take(BODY_READ, (m) => (bodyRead = m[1] ? "json_lenient" : "json"));
  let forwardSearch = false;
  take(/const qs = (?:_?request)\.nextUrl\.search;/, () => (forwardSearch = true));
  // the try block: params / body may be read inside it too; the callVeridian options are parsed key by key (any order) below
  const tryRe = /try \{ (?:const \{ ([\w, ]+) \} = await params; )?(?:const body = await (?:_?request)\.json\(\)(\.catch\(\(\) => \(\{\}\)\))?; )?(?:const \{ ([\w, ]+) \} = await params; )?const data = await callVeridian(?:<[^()]*?>)?\(((?:"[^"]*")|(?:`[^`]*`)), (\{(?:[^{}]|\{[^{}]*\})*\})\);\s*return NextResponse\.json\(data(?:, \{ status: (\d+) \})?(?:, \{ headers: \{ "Cache-Control": ("[^"]+") \} \})?\);\s*\} catch \(err\) \{ (?:return veridianErrorResponse\(err, ("[^"]+")\);|return NextResponse\.json\( ?\{ error: err instanceof VeridianApiError \? err\.message : ("[^"]+") \}, \{ status: err instanceof VeridianApiError \? err\.status : 502 \},? ?\);)\s*\}/;
  const t = rest.match(tryRe);
  if (!t) return { why: "not the plain try { callVeridian } catch { veridianErrorResponse } shape" };
  for (const g of [t[1], t[3]]) if (g) g.split(",").map((x) => x.trim()).forEach((p) => { if (!params.has(p)) spec.__bad = `param ${p}`; });
  if (/const body = await (?:_?request)\.json\(\)/.test(t[0])) {
    if (bodyRead) return { why: "reads the body twice" };
    bodyRead = t[2] ? "json_lenient" : "json";
  }
  rest = rest.replace(tryRe, " ");
  if (rest.replace(/[\s;]/g, "") !== "") return { why: `extra statements: ${rest.trim().slice(0, 80)}` };
  if (spec.__bad) return { why: spec.__bad };
  const opts = parseOptions(t[5]);
  if (opts.why) return { why: opts.why };
  const callMethod = opts.method ?? "GET";
  if (callMethod !== method) return { why: `calls upstream with ${callMethod}` };
  if (opts.body === "forward" && !bodyRead) return { why: "forwards a body it does not read from the request" };
  if (bodyRead && opts.body !== "forward") return { why: "reads a body it does not forward" };
  // the upstream path
  let raw = t[4];
  let path;
  if (raw.startsWith('"')) path = JSON.parse(raw);
  else {
    path = raw.slice(1, -1).replace(/\$\{(?:encodeURIComponent\((\w+)\)|(\w+)|(_?request\.nextUrl\.search))\}/g, (_m, enc, plain, inline) => {
      if (inline) {
        forwardSearch = true;
        return "{search}";
      }
      const v = enc ?? plain;
      if (plain === "qs" && forwardSearch) return "{search}";
      // a path or query value goes into the upstream path ENCODED (the edge always encodes): a raw `${id}` would let "..%2F" in an id walk
      // the upstream path (AUDIT-100 A2 batch 5 found 35 such sites and encoded them); refuse it rather than propose a spec that differs
      if (plain) return `{??raw ${v}}`;
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
  if (opts.root) out.root = true;
  if (roles) out.roles = roles;
  if (opts.acting) out.acting_user = "explicit";
  if (spec.required_query) out.required_query = spec.required_query;
  if (spec.forward_search) out.forward_search = true;
  if (opts.body === "forward") out.body = bodyRead;
  if (opts.body === "empty") out.body = "empty";
  if (opts.defaults) out.body_defaults = opts.defaults;
  if (opts.actorAlways) out.body_actor_email = "always";
  if (t[6]) out.success_status = Number(t[6]);
  if (t[7]) out.cache_control = JSON.parse(t[7]);
  if (t[9]) out.error_style = "plain";
  out.fallback = JSON.parse(t[8] ?? t[9]);
  return { spec: out };
}

/** splits "a, b: { c, d }, e" at the top-level commas */
function topLevel(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "{" || ch === "(" || ch === "[") depth++;
    if (ch === "}" || ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out.filter(Boolean);
}

/** The callVeridian options object, key by key (any order). Only these forms are understood; anything else -> not plain. */
export function parseOptions(objText) {
  const o = {};
  let actingId = false;
  let actingEmail = false;
  for (const item of topLevel(objText.trim().slice(1, -1))) {
    let m;
    if (item === "organizationId: ctx.organizationId!") o.org = true;
    else if ((m = item.match(/^method: "(GET|POST|PUT|PATCH|DELETE)"$/))) o.method = m[1];
    else if (item === "body" || item === "body: body") o.body = "forward";
    else if (item === "body: {}") o.body = "empty";
    else if (item === "root: true") o.root = true;
    else if (item === "actingUserId: ctx.user?.id") actingId = true;
    else if (item === "actingUserEmail: ctx.user?.email ?? undefined") actingEmail = true;
    else if ((m = item.match(/^body: \{ (.*) \}$/))) {
      // { ...body, actorEmail: ctx.user?.email ?? null }, { actorEmail: ctx.user?.email ?? null }, { k: "literal", ...body }
      const parts = topLevel(m[1]);
      const defaults = {};
      let spread = false;
      let actor = false;
      for (const [i, p] of parts.entries()) {
        let q;
        if (p === "...body") {
          if (actor) return { why: "body spread after actorEmail" };
          spread = true;
        } else if (p === "actorEmail: ctx.user?.email ?? null" && i === parts.length - 1) actor = true;
        else if ((q = p.match(/^(\w+): ("[^"]*")$/)) && !spread) defaults[q[1]] = JSON.parse(q[2]);
        else return { why: `body expression not understood: ${p}` };
      }
      if (!spread && Object.keys(defaults).length) return { why: "a constant body other than {}" };
      o.body = spread ? "forward" : "empty";
      if (actor) o.actorAlways = true;
      if (Object.keys(defaults).length) o.defaults = defaults;
    } else return { why: `option not understood: ${item}` };
  }
  if (!o.org) return { why: "no organizationId option" };
  if (actingId !== actingEmail) return { why: "names the acting person by only one of id / email" };
  if (actingId) o.acting = true;
  return o;
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
