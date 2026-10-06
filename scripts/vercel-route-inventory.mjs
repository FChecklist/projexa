// AUDIT-100 A2 / A3: the inventory of every PROJEXA route that still runs on Vercel (src/app/api/**/route.ts), so the number cannot grow silently.
//
//   node scripts/vercel-route-inventory.mjs            check: the committed inventory (ai-os/audit37/vercel-route-inventory.json) matches the code
//   node scripts/vercel-route-inventory.mjs --write    rewrite the inventory from the code (keeps every hand-written `why` / `plan` already in it)
//
// The unit test src/lib/vercel-route-inventory.test.ts runs the same check on every `bun test`, so a new /api route (or one removed) fails CI until it
// is named in the inventory with a reason. The inventory also lists the /api calls the on-laptop shell code can make (`shell_api_references`): the real
// e2e (e2e/lf-lifecycle-vercel-budget.spec.ts) measures that a daily walk of the shell stays inside that list.

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
export const INVENTORY_PATH = join(ROOT, "ai-os", "audit37", "vercel-route-inventory.json");
/** AUDIT-100 A2: the routes the Supabase Edge Function projexa-api answers on the production origins (src/lib/px-api.ts). */
export const EDGE_ROUTES_PATH = join(ROOT, "ai-os", "audit37", "projexa-api-routes.json");
export const EDGE_SERVED = "edge:projexa-api";
const EDGE_PLAN = "MOVED (AUDIT-100 A2): on the production origins the browser calls the Supabase Edge Function projexa-api (src/lib/px-api.ts), which answers with the same contract (src/lib/projexa-api-parity.test.ts); this Next handler stays as the same-origin fallback (preview, rig, kill switch NEXT_PUBLIC_PX_API_BASE=\"\") and is deleted once no fallback is wanted";
/** AUDIT-100 G-09: routes the function answers that are NOT proxies of projexa-api-routes.json (new-organisation provisioning and its repair run inside the
 *  function, supabase/functions/projexa-api/org-provision.ts). Held equal to PX_EDGE_EXTRA_ROUTES (src/lib/px-api.ts) by src/lib/px-api.test.ts. */
export const EDGE_EXTRA_ROUTES = ["/api/org/provision", "/api/org/repair"];
function edgeRoutes() {
  const proxies = existsSync(EDGE_ROUTES_PATH) ? JSON.parse(readFileSync(EDGE_ROUTES_PATH, "utf8")).routes.map((r) => r.route) : [];
  return [...proxies, ...EDGE_EXTRA_ROUTES];
}
const API_DIR = join(ROOT, "src", "app", "api");
const SHELL_DIRS = [join(ROOT, "src", "lib", "local-first"), join(ROOT, "src", "app", "local")];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** "src/app/api/scope/line-items/[id]/route.ts" -> "/api/scope/line-items/:id" */
export function patternOf(file) {
  const rel = relative(API_DIR, file).split(sep).slice(0, -1).join("/");
  return ("/api/" + rel).replace(/\[\.\.\.(\w+)\]/g, ":$1*").replace(/\[(\w+)\]/g, ":$1").replace(/\/$/, "");
}

export function methodsOf(source) {
  const found = new Set();
  for (const m of source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) found.add(m[1]);
  for (const m of source.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) found.add(m[1]);
  return [...found].sort();
}

/** What the route does when it runs: proxies VERIDIAN's backend, talks to Supabase itself, or neither. */
export function backendOf(source) {
  if (/veridian-client|callVeridian|veridianFetch|VERIDIAN_API/.test(source)) return "veridian-proxy";
  if (/supabase/i.test(source) && /createClient|createServerClient|auth\./.test(source)) return "supabase";
  return "own-logic";
}

const AREA_WHY = {
  "local-first": "a small data-free beacon from the laptop (errors, usage numbers, install progress): it must reach us while online and costs one tiny invocation",
  shell: "the legacy online page's one bootstrap read; the on-laptop shell does not call it (it is used only by the server-rendered pages during the first install)",
  email: "email delivery / inbound mail needs a server (secret keys, public webhook address)",
  contact: "public contact form: needs a server to send mail",
  integrations: "third-party connection (Google Sheets) with secrets and webhooks: server only",
  ai: "the AI assistant and its tools: the user's own AI is reached through the AI Work Link edge function; these routes are the legacy in-app chat",
  assistant: "legacy in-app assistant: server only",
  cache: "AUDIT-100 A2 batch 7: the one small route that clears the page-side list caches (unstable_cache tags) after a write that the edge function answered; a function on Supabase cannot reach Vercel's data cache",
};

function areaOf(pattern) {
  return pattern.split("/")[2] ?? "";
}

function shellReferences() {
  const refs = new Set();
  for (const dir of SHELL_DIRS) {
    for (const file of walk(dir)) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.(ts|tsx)$/.test(file) || file.includes("__fixtures__")) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/[`"']\/api\/([A-Za-z0-9_\-/.${}]*)/g)) {
        let p = "/api/" + m[1];
        p = p.replace(/\$\{[^}]*\}/g, ":id").replace(/\$\{.*$/, ":id").replace(/\/+$/, "");
        if (p === "/api") continue; // a prefix test (sw-core, paths.ts), not a call
        refs.add(p);
      }
    }
  }
  return [...refs].sort();
}

let scanned = null;
export function scan() {
  if (scanned) return scanned;
  const routes = walk(API_DIR)
    .filter((f) => /[\\/]route\.ts$/.test(f))
    .map((file) => {
      const src = readFileSync(file, "utf8");
      return { route: patternOf(file), file: relative(ROOT, file).split(sep).join("/"), methods: methodsOf(src), backend: backendOf(src) };
    })
    .sort((a, b) => (a.route < b.route ? -1 : a.route > b.route ? 1 : 0));
  scanned = { routes, shellApiReferences: shellReferences() };
  return scanned;
}

/** Which inventory route a shell reference ("/api/scope/line-items/:id", "/api/dashboard/project") points at. */
export function routeMatches(ref, route) {
  const norm = (s) => s.replace(/:[A-Za-z*]+/g, ":p");
  const a = norm(ref).split("/");
  const b = norm(route).split("/");
  // the code builds "/api/dashboard/project/" + id: a reference one parameter short of the route still means that route
  if (a.length > b.length || b.length - a.length > 1) return false;
  if (b.length - a.length === 1 && b[b.length - 1] !== ":p") return false;
  return a.every((seg, i) => seg === b[i]);
}

const SHELL_PLAN = "edge-candidate: the on-laptop shell asks for it while online (a snapshot or a write); move to a Supabase Edge Function (see ai-os/audit37/VERCEL_ROUTE_PLAN.md)";

function defaultWhy(r) {
  const area = areaOf(r.route);
  if (AREA_WHY[area]) return AREA_WHY[area];
  if (r.backend === "veridian-proxy") return "online-only screen: the work runs in the VERIDIAN backend (a thin proxy on Vercel); the screen is not on the laptop's copy or is only used while online";
  if (r.backend === "supabase") return "talks to Supabase with the signed-in person's session on the server";
  return "server-side logic of an online-only screen";
}

export function build(previous) {
  const { routes, shellApiReferences } = scan();
  const old = new Map((previous?.routes ?? []).map((r) => [r.route, r]));
  const entries = routes.map((r) => {
    const prev = old.get(r.route);
    const shellReachable = shellApiReferences.some((ref) => routeMatches(ref, r.route));
    const edge = edgeRoutes().includes(r.route);
    return {
      route: r.route,
      file: r.file,
      methods: r.methods,
      backend: r.backend,
      shell_reachable: shellReachable,
      served_by: edge ? EDGE_SERVED : "vercel",
      why: prev?.why ?? defaultWhy(r),
      plan: edge ? EDGE_PLAN : shellReachable ? (prev?.plan ?? SHELL_PLAN) : (prev?.plan ?? "keep on Vercel until its screen is on the laptop; a thin proxy costs one invocation per use"),
    };
  });
  return {
    _about:
      "AUDIT-100 A2/A3. Every PROJEXA route that runs on Vercel (src/app/api/**/route.ts), why it is still there, and its plan. Checked by src/lib/vercel-route-inventory.test.ts on every test run; rewrite with `node scripts/vercel-route-inventory.mjs --write` (hand-written why/plan are kept).",
    max_routes: entries.length,
    edge_functions: {
      "projexa-sync": ["manifest", "heads", "pull", "changes", "ids", "push", "attest", "release/current", "release/register", "install", "prepare", "jobs/claim", "jobs/heartbeat", "jobs/result", "jobs/enqueue", "jobs/get"],
      "ai-work-link": ["the AI Work Link guide and data tools (compliance-tracker supabase/functions/ai-work-link)"],
      "ai-work-link-exec": ["server-side execution of queued writes"],
      "projexa-read": ["BOQ read gateway"],
      "projexa-timer": ["timer rates"],
      "projexa-scheduler-bridge": ["scheduler"],
      "projexa-document-extract": ["document text extraction"],
      "projexa-api": ["the proxy-class /api routes of ai-os/audit37/projexa-api-routes.json (AUDIT-100 A2)"],
    },
    // AUDIT-100 A2: shell-reachable routes still answered by Vercel on the production origins (the beacon); the guard holds it
    shell_vercel_routes_budget: previous?.shell_vercel_routes_budget ?? 1,
    // AUDIT-100 A2 batch 2+: how many /api routes are still answered by Vercel on the production origins (served_by "vercel"); it may only
    // go DOWN: each batch moved to the edge function lowers it by the batch size (src/lib/vercel-route-inventory.test.ts)
    vercel_served_routes_budget: previous?.vercel_served_routes_budget ?? entries.filter((e) => e.served_by !== EDGE_SERVED).length,
    shell_api_references: shellApiReferences,
    // measured by e2e/lf-lifecycle-vercel-budget.spec.ts: the only /api calls a first install and a daily walk of the shell may make
    install_phase_api_allowlist: previous?.install_phase_api_allowlist ?? [],
    daily_use_api_allowlist: previous?.daily_use_api_allowlist ?? [],
    // what a daily walk sends to Vercel on the production origins: the rig list minus the edge-served routes
    daily_use_api_allowlist_production: previous?.daily_use_api_allowlist_production ?? [],
    routes: entries,
  };
}

/** Problems found comparing the committed inventory with the code; [] when they agree. */
export function check(inventory) {
  const problems = [];
  const { routes, shellApiReferences } = scan();
  const have = new Map((inventory.routes ?? []).map((r) => [r.route, r]));
  const real = new Map(routes.map((r) => [r.route, r]));
  for (const r of routes) if (!have.has(r.route)) problems.push(`NEW route not in the inventory: ${r.route} (${r.file}). Add it with a reason: node scripts/vercel-route-inventory.mjs --write, then edit its why/plan.`);
  for (const r of inventory.routes ?? []) if (!real.has(r.route)) problems.push(`inventory lists a route that no longer exists: ${r.route}`);
  for (const r of inventory.routes ?? []) {
    if (!r.why || r.why.trim().length < 20) problems.push(`${r.route}: no reason (why) written`);
    if (!r.plan || r.plan.trim().length < 10) problems.push(`${r.route}: no plan written`);
  }
  if (routes.length > inventory.max_routes) problems.push(`there are ${routes.length} /api routes, the budget is ${inventory.max_routes}: the number of routes on Vercel must not grow`);
  const listed = [...(inventory.shell_api_references ?? [])].sort();
  for (const ref of shellApiReferences) if (!listed.includes(ref)) problems.push(`the on-laptop shell code now references ${ref}, which is not in shell_api_references: a new Vercel call from the laptop`);
  for (const ref of listed) if (!shellApiReferences.includes(ref)) problems.push(`shell_api_references lists ${ref} but no shell code references it any more: remove it`);
  for (const ref of listed) if (!routes.some((r) => routeMatches(ref, r.route))) problems.push(`shell_api_references lists ${ref}, which is not a route`);
  // AUDIT-100 A2: served_by agrees with the edge function's route list, both ways; the shell's Vercel routes stay within the budget
  const edge = edgeRoutes();
  for (const r of inventory.routes ?? []) {
    const isEdge = edge.includes(r.route);
    if (isEdge && r.served_by !== EDGE_SERVED) problems.push(`${r.route} is answered by the edge function (projexa-api-routes.json) but the inventory says served_by ${r.served_by}`);
    if (!isEdge && r.served_by === EDGE_SERVED) problems.push(`${r.route} says served_by ${EDGE_SERVED} but the edge function does not answer it`);
  }
  const shellOnVercel = (inventory.routes ?? []).filter((r) => r.shell_reachable && r.served_by !== EDGE_SERVED);
  const budget = inventory.shell_vercel_routes_budget ?? 0;
  if (shellOnVercel.length > budget) problems.push(`${shellOnVercel.length} shell-reachable routes are still answered by Vercel (${shellOnVercel.map((r) => r.route).join(", ")}), the budget is ${budget}`);
  const onVercel = (inventory.routes ?? []).filter((r) => r.served_by !== EDGE_SERVED).length;
  if (inventory.vercel_served_routes_budget !== undefined && onVercel > inventory.vercel_served_routes_budget) problems.push(`${onVercel} /api routes are answered by Vercel on the production origins, the budget is ${inventory.vercel_served_routes_budget}: a route moved back to Vercel (or a new one) must lower another first`);
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const existing = existsSync(INVENTORY_PATH) ? JSON.parse(readFileSync(INVENTORY_PATH, "utf8")) : null;
  if (process.argv.includes("--write")) {
    const next = build(existing);
    writeFileSync(INVENTORY_PATH, JSON.stringify(next, null, 2) + "\n");
    console.log(`wrote ${INVENTORY_PATH}: ${next.routes.length} routes, ${next.shell_api_references.length} shell references`);
  } else {
    const problems = check(existing ?? { routes: [], shell_api_references: [], max_routes: 0 });
    for (const p of problems) console.error("FAIL " + p);
    console.log(problems.length ? `${problems.length} problem(s)` : `ok: ${existing.routes.length} routes match the inventory`);
    process.exit(problems.length ? 1 : 0);
  }
}
