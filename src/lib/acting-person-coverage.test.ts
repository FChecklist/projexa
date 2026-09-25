/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-20b -- COVERAGE PROOF FOR THE ACTING-PERSON HEADERS.
//
// compliance-tracker now refuses an API-key write that names nobody (400
// ACTING_USER_REQUIRED). PROJEXA names the person centrally: withTiming() opens
// a per-request scope, requireAuth() records the verified session user in it,
// and veridian-client turns it into X-Acting-User / X-Acting-User-Email (see
// acting-person-context.ts). That only works for a route that (1) wears
// withTiming() on every exported handler and (2) resolves its session through
// requireAuth() or a helper built on it. This file proves both, by reading the
// source, for every route that can reach VERIDIAN -- and fails the moment a
// new route reaches VERIDIAN without them, unless it is allowlisted below with
// a reason (a route that genuinely acts without a signed-in person).
//
// It then checks the other direction, from compliance-tracker's side: every
// path in ACTOR_SWEEP_INVENTORY.md section 6 (the writes that now refuse a
// nameless API key, plus the alias URLs and the three reads that section
// recommends) is traced to every PROJEXA call site that can hit it, and each
// such call site must either name its person explicitly or be reachable ONLY
// from covered routes.
//
// HOW FILES ARE FOUND. Node's fs, walked by hand -- never a shell glob. On this
// repo a bracketed segment such as [id] or [reportName] silently matches
// nothing under some globbing, which is exactly how a route goes missing from
// a count. Reachability is the real import graph (static and dynamic imports,
// `import type` excluded), not a filename convention.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const SRC = path.resolve(import.meta.dir, "..");
const API_ROOT = path.join(SRC, "app", "api");
const VERIDIAN_CLIENT = path.join(SRC, "lib", "veridian-client.ts");
const relOf = (file: string) => path.relative(SRC, file).split(path.sep).join("/");

// ---------------------------------------------------------------------------
// The allowlist: routes that reach VERIDIAN WITHOUT a signed-in person, by
// design. Each has no session to take a person from, so no acting headers are
// sent from the session; where one of them writes on someone's behalf it names
// that person explicitly at the call site (checked below for every inventory
// path).
// ---------------------------------------------------------------------------
const NO_SESSION_ROUTES: Record<string, string> = {
  "app/api/ai/[token]/route.ts":
    "Public AI-link snapshot: authorised by an unguessable token, not a session. Read-only (GET /tasks, the read-only /assistant codeReference dispatch), so there is no person to name and nothing it sends is refused for lacking one.",
  "app/api/org/provision/route.ts":
    "Org provisioning at signup: its one VERIDIAN call is provisionVeridianOrg(), which uses the platform application key and deliberately never carries a person (the person does not exist in the new org yet).",
  "app/api/integrations/google-sheets/webhook/route.ts":
    "Google Apps Script webhook, authorised by an org id + shared secret, not a session. The sheet rows name their own author, and pull.ts passes that member explicitly (actingUserEmail) on every write.",
  "app/api/email/inbound/route.ts":
    "Inbound email (digest reply). No session: the sender is resolved from the delivery to a real membership, and digest-item-dispatcher passes that person explicitly (actingUserId + actingUserEmail) on every write.",
};

// Helpers a route may call instead of requireAuth() itself. Each is asserted
// below to really call requireAuth(), so the list cannot quietly go stale.
const SESSION_HELPERS: Record<string, string> = {
  requireAuth: "lib/supabase/auth-guard.ts",
  requireCompanyScope: "lib/company-scope.ts",
};

// ACTOR_SWEEP_INVENTORY.md section 6 (compliance-tracker, branch
// feat/build-001-u20b-actor-required), copied verbatim: 136 routes, 143
// handlers. Then the alias URLs and the three recommended reads it names.
const INVENTORY: string[] = [
  "POST /api/compliance",
  "DELETE,PATCH /api/compliance/[id]",
  "POST /api/notices",
  "DELETE,PATCH /api/notices/[id]",
  "POST /api/pms/schedule/baselines",
  "PATCH /api/tasks/[id]",
  "POST /api/v1/compliance",
  "DELETE,PATCH /api/v1/compliance/[id]",
  "POST /api/v1/construction/boq",
  "POST /api/v1/construction/boq/[id]/approve",
  "POST /api/v1/construction/boq/[id]/excel/apply",
  "POST /api/v1/construction/boq/[id]/revisions",
  "PATCH /api/v1/construction/cost-visibility",
  "POST /api/v1/construction/kpi-entries",
  "POST /api/v1/construction/kpi-entries/[id]/approve",
  "POST /api/v1/construction/materials/issues",
  "POST /api/v1/construction/materials/receipts",
  "PATCH /api/v1/construction/materials/receipts/[id]",
  "POST /api/v1/construction/site-diary",
  "POST /api/v1/construction/site-instructions",
  "POST /api/v1/documents",
  "POST /api/v1/erp/budgets",
  "POST /api/v1/notices",
  "DELETE,PATCH /api/v1/notices/[id]",
  "POST /api/v1/projexa/access-review",
  "PATCH /api/v1/projexa/access-review/certifications/[id]",
  "POST /api/v1/projexa/audit-engagements",
  "POST /api/v1/projexa/audit-findings",
  "PATCH /api/v1/projexa/audit-findings/[id]",
  "POST /api/v1/projexa/billing-claims",
  "PATCH /api/v1/projexa/billing-claims/[id]",
  "PATCH /api/v1/projexa/board",
  "POST /api/v1/projexa/boq-scenarios",
  "DELETE,POST /api/v1/projexa/boq-scenarios/[id]/adjustments",
  "POST /api/v1/projexa/change-orders",
  "POST /api/v1/projexa/companies",
  "POST /api/v1/projexa/compliance-register",
  "POST /api/v1/projexa/credit-notes",
  "POST /api/v1/projexa/credit-notes/[id]/submit",
  "PUT /api/v1/projexa/currencies/base",
  "POST /api/v1/projexa/discuss",
  "PATCH /api/v1/projexa/documents/[id]",
  "POST /api/v1/projexa/documents/[id]/dispose",
  "POST /api/v1/projexa/documents/[id]/versions",
  "POST /api/v1/projexa/drawings",
  "PATCH /api/v1/projexa/drawings/[id]",
  "POST /api/v1/projexa/dunning-list/[invoiceId]/record",
  "POST /api/v1/projexa/expenses",
  "POST /api/v1/projexa/ffe",
  "POST /api/v1/projexa/floor-plans",
  "POST /api/v1/projexa/fraud-cases",
  "PATCH /api/v1/projexa/fraud-cases/[id]",
  "POST /api/v1/projexa/inventory/items",
  "POST /api/v1/projexa/inventory/stock-entries",
  "POST /api/v1/projexa/inventory/warehouses",
  "POST /api/v1/projexa/journal-entries",
  "POST /api/v1/projexa/knowledge-base",
  "PATCH /api/v1/projexa/knowledge-base/[id]",
  "POST /api/v1/projexa/leads",
  "PATCH /api/v1/projexa/leads/[id]",
  "POST /api/v1/projexa/leads/auto-distribute",
  "POST /api/v1/projexa/leads/bulk-reassign",
  "POST /api/v1/projexa/meetings",
  "POST /api/v1/projexa/milestones",
  "PATCH /api/v1/projexa/milestones/[id]",
  "POST /api/v1/projexa/mood-boards",
  "POST /api/v1/projexa/opportunities",
  "PATCH /api/v1/projexa/opportunities/[id]",
  "POST /api/v1/projexa/opportunities/auto-distribute",
  "POST /api/v1/projexa/opportunities/bulk-reassign",
  "POST /api/v1/projexa/permits",
  "PATCH /api/v1/projexa/permits/[id]",
  "POST /api/v1/projexa/pill-usage",
  "POST /api/v1/projexa/policies",
  "PATCH /api/v1/projexa/policies/[id]",
  "POST /api/v1/projexa/procurement/goods-receipts",
  "POST /api/v1/projexa/procurement/goods-receipts/[id]/submit",
  "POST /api/v1/projexa/procurement/purchase-orders",
  "DELETE,PATCH /api/v1/projexa/procurement/purchase-orders/[id]",
  "POST /api/v1/projexa/procurement/purchase-orders/[id]/submit",
  "POST /api/v1/projexa/procurement/quotations",
  "POST /api/v1/projexa/procurement/requisitions",
  "POST /api/v1/projexa/procurement/rfqs",
  "POST /api/v1/projexa/procurement/rfqs/[id]/send",
  "POST /api/v1/projexa/project-budgets",
  "POST /api/v1/projexa/project-budgets/[id]/submit",
  "POST /api/v1/projexa/projects",
  "POST /api/v1/projexa/punch-list",
  "PATCH /api/v1/projexa/punch-list/[id]",
  "POST /api/v1/projexa/purchase-orders",
  "POST /api/v1/projexa/quotations",
  "PATCH /api/v1/projexa/quotations/[id]",
  "POST /api/v1/projexa/quotations/[id]/convert",
  "POST /api/v1/projexa/quotations/[id]/revisions",
  "POST /api/v1/projexa/recruitment/applications",
  "POST /api/v1/projexa/recruitment/applications/[id]/hire",
  "POST /api/v1/projexa/recruitment/applications/[id]/interviews",
  "POST /api/v1/projexa/recruitment/applications/[id]/stage",
  "POST /api/v1/projexa/recruitment/candidates",
  "POST /api/v1/projexa/recruitment/interviews/[id]/feedback",
  "POST /api/v1/projexa/recruitment/job-openings",
  "POST /api/v1/projexa/recruitment/job-openings/[id]/status",
  "POST /api/v1/projexa/reports/share",
  "POST /api/v1/projexa/rfis",
  "PATCH /api/v1/projexa/rfis/[id]",
  "POST /api/v1/projexa/risks",
  "PATCH /api/v1/projexa/risks/[id]",
  "POST /api/v1/projexa/sales-invoices",
  "POST /api/v1/projexa/sales-invoices/[id]/cancel",
  "POST /api/v1/projexa/sales-invoices/[id]/payments",
  "POST /api/v1/projexa/sales-invoices/[id]/submit",
  "POST /api/v1/projexa/sales-orders",
  "PATCH /api/v1/projexa/sales-orders/[id]",
  "POST /api/v1/projexa/sales-orders/bulk-status",
  "POST /api/v1/projexa/schedule",
  "PATCH /api/v1/projexa/schedule/[id]",
  "PATCH /api/v1/projexa/schedule/[id]/completion",
  "POST /api/v1/projexa/schedule/baselines",
  "POST /api/v1/projexa/schedule/import",
  "POST /api/v1/projexa/scope/import",
  "POST /api/v1/projexa/subcontractor-retention-summary/[invoiceId]/release",
  "POST /api/v1/projexa/submittals",
  "PATCH /api/v1/projexa/submittals/[id]",
  "POST /api/v1/projexa/vendor-risk",
  "POST /api/v1/projexa/vendors/[id]/bank-accounts",
  "POST /api/v1/projexa/vendors/[id]/portal-links",
  "POST /api/v1/projexa/vendors/[id]/qualification",
  "POST /api/v1/projexa/vendors/[id]/sanction-checks",
  "POST /api/v1/projexa/veri-meetings",
  "DELETE,PATCH /api/v1/projexa/veri-meetings/[id]",
  "POST /api/v1/projexa/veri-meetings/[id]/action-items",
  "POST /api/v1/projexa/veri-meetings/[id]/generate-intelligence",
  "POST /api/v1/projexa/veri-meetings/[id]/share-links",
  "DELETE /api/v1/projexa/veri-meetings/share-links/[linkId]",
  "POST /api/v1/projexa/wiki",
  "PATCH /api/v1/tasks/[id]",
];
const INVENTORY_ALIASES: string[] = [
  "POST /api/v1/projexa/scope",
  "POST /api/v1/projexa/scope/[id]/approve",
  "POST /api/v1/projexa/scope/[id]/revisions",
  "POST /api/v1/projexa/site-diary",
  "POST /api/v1/projexa/site-instructions",
];
const INVENTORY_RECOMMENDED_READS: string[] = [
  "GET /api/v1/projexa/documents/[id]",
  "GET /api/v1/projexa/pill-usage",
  "GET /api/v1/projexa/module-chain",
];

// ---------------------------------------------------------------------------
// Source reading
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "__tests__") continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Comments blanked out (line structure kept), strings and template literals
 * kept -- the paths this file needs live in them, and a URL's `//` inside a
 * string must not be mistaken for a comment.
 */
function stripComments(src: string): string {
  let out = "";
  let i = 0;
  let mode: "code" | "sq" | "dq" | "tpl" = "code";
  let braceDepth = 0;
  const templateBraceStack: number[] = [];
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (mode === "code") {
      if (c === "/" && d === "/") {
        while (i < src.length && src[i] !== "\n") i++;
        continue;
      }
      if (c === "/" && d === "*") {
        const end = src.indexOf("*/", i + 2);
        const stop = end < 0 ? src.length : end + 2;
        out += src.slice(i, stop).replace(/[^\n]/g, " ");
        i = stop;
        continue;
      }
      if (c === "'") mode = "sq";
      else if (c === '"') mode = "dq";
      else if (c === "`") mode = "tpl";
      else if (c === "{") braceDepth++;
      else if (c === "}") {
        if (templateBraceStack.length && templateBraceStack[templateBraceStack.length - 1] === braceDepth) {
          templateBraceStack.pop();
          mode = "tpl";
        } else {
          braceDepth--;
        }
      }
      out += c;
      i++;
      continue;
    }
    if (mode === "sq" || mode === "dq") {
      if (c === "\\") {
        out += c + (d ?? "");
        i += 2;
        continue;
      }
      if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"') || c === "\n") mode = "code";
      out += c;
      i++;
      continue;
    }
    if (c === "\\") {
      out += c + (d ?? "");
      i += 2;
      continue;
    }
    if (c === "`") mode = "code";
    else if (c === "$" && d === "{") {
      templateBraceStack.push(braceDepth);
      mode = "code";
      out += "${";
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const files = walk(SRC);
const fileSet = new Set(files);
const stripped = new Map<string, string>(files.map((f) => [f, stripComments(readFileSync(f, "utf8"))]));

function resolveImport(fromFile: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

/** Runtime imports only: `import type` / `export type` carry nothing at run time. */
function runtimeImports(file: string): string[] {
  const src = stripped.get(file)!;
  const out: string[] = [];
  const staticRe = /(?:^|[;\n])\s*(import|export)\s+(type\s+)?(?:[^;'"`]*?\s+from\s+)?["']([^"']+)["']/g;
  for (const m of src.matchAll(staticRe)) {
    if (m[2]) continue;
    const resolved = resolveImport(file, m[3]);
    if (resolved) out.push(resolved);
  }
  for (const m of src.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) {
    const resolved = resolveImport(file, m[1]);
    if (resolved) out.push(resolved);
  }
  return out;
}

const importersOf = new Map<string, Set<string>>();
for (const file of files) {
  for (const dep of runtimeImports(file)) {
    if (!importersOf.has(dep)) importersOf.set(dep, new Set());
    importersOf.get(dep)!.add(file);
  }
}

// ---------------------------------------------------------------------------
// Where VERIDIAN is called
// ---------------------------------------------------------------------------

const CALL_RE =
  /\b(callVeridianRaw|callVeridianResult|callVeridianBinary|callVeridianUpload|callVeridian|createCachedVeridianGet|provisionVeridianOrg)\s*(?:<[^()]*?>)?\s*\(/g;

type CallSite = {
  file: string;
  line: number;
  fn: string;
  /** Normalised path with `[*]` for every interpolation, or null when it is not a literal/template. */
  path: string | null;
  method: string | null;
  root: boolean | null;
  explicitIdentity: boolean;
};

/** The top-level argument texts of the call whose `(` is at `open`. */
function callArgs(src: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let current = "";
  let mode: "code" | "sq" | "dq" | "tpl" = "code";
  const tplDepths: number[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (mode === "sq" || mode === "dq") {
      current += c;
      if (c === "\\") { current += src[++i] ?? ""; continue; }
      if ((mode === "sq" && c === "'") || (mode === "dq" && c === '"')) mode = "code";
      continue;
    }
    if (mode === "tpl") {
      current += c;
      if (c === "\\") { current += src[++i] ?? ""; continue; }
      if (c === "`") mode = "code";
      else if (c === "$" && src[i + 1] === "{") { current += "{"; i++; tplDepths.push(depth); depth++; mode = "code"; }
      continue;
    }
    if (c === "'" ) { mode = "sq"; current += c; continue; }
    if (c === '"') { mode = "dq"; current += c; continue; }
    if (c === "`") { mode = "tpl"; current += c; continue; }
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      if (depth === 1) continue;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (tplDepths.length && tplDepths[tplDepths.length - 1] === depth && c === "}") {
        tplDepths.pop();
        current += c;
        mode = "tpl";
        continue;
      }
      if (depth === 0) { if (current.trim()) args.push(current.trim()); return args; }
    } else if (c === "," && depth === 1) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += c;
  }
  return args;
}

/** "/leads/${id}/submit?x=1" -> "/leads/[*]/submit"; null for anything not a literal/template. */
function normalisePathArg(arg: string | undefined): string | null {
  if (!arg) return null;
  let text: string;
  if (/^(["']).*\1$/s.test(arg)) text = arg.slice(1, -1);
  else if (arg.startsWith("`") && arg.endsWith("`")) {
    text = "";
    const body = arg.slice(1, -1);
    for (let i = 0; i < body.length; i++) {
      if (body[i] === "$" && body[i + 1] === "{") {
        let depth = 1;
        i += 2;
        while (i < body.length && depth > 0) {
          if (body[i] === "{") depth++;
          else if (body[i] === "}") depth--;
          if (depth > 0) i++;
        }
        text += "[*]";
      } else {
        text += body[i];
      }
    }
  } else return null;
  const q = text.indexOf("?");
  if (q >= 0) text = text.slice(0, q);
  return text.replace(/\/+$/, "") || "/";
}

function callSitesIn(file: string): CallSite[] {
  if (file === VERIDIAN_CLIENT) return [];
  const src = stripped.get(file)!;
  const sites: CallSite[] = [];
  for (const m of src.matchAll(CALL_RE)) {
    if (/function\s+$/.test(src.slice(Math.max(0, m.index! - 20), m.index!))) continue;
    const open = m.index! + m[0].length - 1;
    const args = callArgs(src, open);
    const fn = m[1];
    const pathArg = fn === "createCachedVeridianGet" ? args[1] : args[0];
    const optionsArg = fn === "callVeridianUpload" ? args[2] : fn === "createCachedVeridianGet" ? undefined : args[1];
    const opts = optionsArg && optionsArg.startsWith("{") ? optionsArg : null;
    const methodMatch = opts?.match(/\bmethod\s*:\s*["'](\w+)["']/);
    const method =
      fn === "callVeridianUpload" || fn === "provisionVeridianOrg"
        ? "POST"
        : fn === "callVeridianBinary" || fn === "createCachedVeridianGet"
          ? "GET"
          : methodMatch
            ? methodMatch[1].toUpperCase()
            : opts && !/\bmethod\b/.test(opts)
              ? "GET"
              : null;
    sites.push({
      file,
      line: src.slice(0, m.index!).split("\n").length,
      fn,
      path: fn === "provisionVeridianOrg" ? "/platform/provision-org" : normalisePathArg(pathArg),
      method,
      root: fn === "provisionVeridianOrg" ? true : opts ? /\broot\s*:\s*true\b/.test(opts) : fn === "createCachedVeridianGet" ? false : null,
      explicitIdentity: !!opts && /\bactingUser(Id|Email)\b/.test(opts),
    });
  }
  return sites;
}

const callSites = files.flatMap(callSitesIn);
const directCallers = new Set(callSites.map((s) => s.file));

/** Every file that can reach `start` through runtime imports, `start` included. */
function importClosure(start: string): Set<string> {
  const seen = new Set<string>([start]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const importer of importersOf.get(cur) ?? []) {
      if (!seen.has(importer)) {
        seen.add(importer);
        queue.push(importer);
      }
    }
  }
  return seen;
}

const reachesVeridian = new Set<string>();
for (const caller of directCallers) for (const f of importClosure(caller)) reachesVeridian.add(f);

// ---------------------------------------------------------------------------
// Route analysis
// ---------------------------------------------------------------------------

const routeFiles = files.filter((f) => f.startsWith(API_ROOT + path.sep) && /[\\/]route\.tsx?$/.test(f));
const isRoute = (f: string) => routeFiles.includes(f);

type RouteVerdict = { file: string; handlers: { method: string; wrapped: boolean }[]; session: boolean; covered: boolean };

const HANDLER_RE = /^export\s+(?:const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*([\w.]+)\s*\(?|(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b|\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b[^}]*\})/gm;
const SESSION_RE = new RegExp(`\\b(${Object.keys(SESSION_HELPERS).join("|")})\\s*\\(`);

function analyseRoute(file: string): RouteVerdict {
  const src = stripped.get(file)!;
  const handlers: { method: string; wrapped: boolean }[] = [];
  for (const m of src.matchAll(HANDLER_RE)) {
    if (m[1]) handlers.push({ method: m[1], wrapped: m[2] === "withTiming" });
    else if (m[3]) handlers.push({ method: m[3], wrapped: false });
    else if (m[4]) handlers.push({ method: m[4], wrapped: false }); // `export { GET } ...`: not provably wrapped
  }
  const session = SESSION_RE.test(src);
  return { file, handlers, session, covered: handlers.length > 0 && handlers.every((h) => h.wrapped) && session };
}

const veridianRoutes = routeFiles.filter((f) => reachesVeridian.has(f));
const verdicts = new Map(veridianRoutes.map((f) => [f, analyseRoute(f)]));

// ---------------------------------------------------------------------------
// Inventory matching
// ---------------------------------------------------------------------------

type InventoryEntry = { methods: string[]; path: string; source: string };
const inventoryEntries: InventoryEntry[] = [...INVENTORY, ...INVENTORY_ALIASES, ...INVENTORY_RECOMMENDED_READS].map((line) => {
  const [methods, p] = line.split(" ");
  return { methods: methods.split(","), path: p, source: line };
});

function fullPathsOf(site: CallSite): string[] {
  if (site.path === null) return [];
  const bases = site.root === true ? ["/api/v1"] : site.root === false ? ["/api/v1/projexa"] : ["/api/v1", "/api/v1/projexa"];
  return bases.map((b) => `${b}${site.path === "/" ? "" : site.path}`);
}

function segmentMatches(callSeg: string, invSeg: string): boolean {
  if (/^\[\w+\]$/.test(invSeg)) return callSeg.length > 0;
  if (!callSeg.includes("[*]")) return callSeg === invSeg;
  if (callSeg === "[*]") return invSeg.length > 0;
  // An interpolation INSIDE a segment may be empty: `/scope/import${dryRun ? "?dryRun=1" : ""}`.
  const re = new RegExp(`^${callSeg.split("[*]").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(invSeg);
}

function hits(site: CallSite, entry: InventoryEntry): boolean {
  if (site.method && !entry.methods.includes(site.method)) return false;
  const inv = entry.path.split("/");
  return fullPathsOf(site).some((p) => {
    const segs = p.split("/");
    return segs.length === inv.length && segs.every((s, i) => segmentMatches(s, inv[i]));
  });
}

/** The routes a call site's code can run under, and any non-route entry point (a page) that also reaches it. */
function entryPointsOf(file: string): { routes: string[]; nonRoutes: string[] } {
  if (isRoute(file)) return { routes: [file], nonRoutes: [] };
  const closure = importClosure(file);
  const routes = [...closure].filter(isRoute);
  const nonRoutes = [...closure].filter((f) => !isRoute(f) && /[\\/](page|layout|template|default)\.tsx?$/.test(f));
  return { routes, nonRoutes };
}

type InventoryFinding = { entry: string; site: string; problem: string };

function inventoryFindings(): { findings: InventoryFinding[]; covered: Map<string, string[]>; notCalled: string[] } {
  const findings: InventoryFinding[] = [];
  const covered = new Map<string, string[]>();
  const notCalled: string[] = [];
  for (const entry of inventoryEntries) {
    const sites = callSites.filter((s) => hits(s, entry));
    if (!sites.length) {
      notCalled.push(entry.source);
      continue;
    }
    for (const site of sites) {
      const where = `${relOf(site.file)}:${site.line}`;
      if (site.explicitIdentity) {
        covered.set(entry.source, [...(covered.get(entry.source) ?? []), `${where} (explicit identity)`]);
        continue;
      }
      const { routes, nonRoutes } = entryPointsOf(site.file);
      if (!routes.length && !nonRoutes.length) {
        findings.push({ entry: entry.source, site: where, problem: "no route or page reaches this call site" });
        continue;
      }
      for (const page of nonRoutes) {
        findings.push({ entry: entry.source, site: where, problem: `reachable from ${relOf(page)}, which runs outside any route scope (no acting person)` });
      }
      for (const route of routes) {
        const verdict = verdicts.get(route) ?? analyseRoute(route);
        if (!verdict.covered) {
          const why = NO_SESSION_ROUTES[relOf(route)]
            ? "an allowlisted no-session route reaches it, and the call names nobody explicitly"
            : `route ${relOf(route)} does not ${verdict.session ? "wear withTiming() on every handler" : "resolve its session through requireAuth()"}`;
          findings.push({ entry: entry.source, site: where, problem: why });
        }
      }
      if (routes.length) covered.set(entry.source, [...(covered.get(entry.source) ?? []), `${where} via ${routes.map(relOf).join(", ")}`]);
    }
  }
  return { findings, covered, notCalled };
}

// ---------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------

describe("acting-person coverage: every route that reaches VERIDIAN carries the session person", () => {
  test("the walk is real: it sees bracketed route segments and a realistic number of VERIDIAN routes", () => {
    // Guard the guard. A walk that silently skipped [id] folders, or a regex
    // that stopped recognising the call, would make every assertion below
    // vacuously true.
    expect(routeFiles.some((f) => f.includes(`${path.sep}[id]${path.sep}`))).toBe(true);
    expect(routeFiles.some((f) => f.includes(`${path.sep}[reportName]${path.sep}`))).toBe(true);
    expect(veridianRoutes.length).toBeGreaterThan(200);
    expect(callSites.length).toBeGreaterThan(300);
    expect(verdicts.get(path.join(API_ROOT, "scope", "categories", "route.ts"))?.handlers.map((h) => h.method).sort()).toEqual(["GET", "POST"]);
  });

  test("every session helper really resolves the session through requireAuth()", () => {
    for (const [name, rel] of Object.entries(SESSION_HELPERS)) {
      const src = stripped.get(path.join(SRC, ...rel.split("/")));
      expect(src, `${rel} not found -- re-point SESSION_HELPERS`).toBeDefined();
      if (name === "requireAuth") {
        expect(src!).toMatch(/export async function requireAuth\b/);
        expect(src!, "requireAuth() must record the verified session user as the acting person").toMatch(/recordVerifiedActingPerson\(user\)/);
      } else {
        expect(src!).toMatch(new RegExp(`export async function ${name}\\b`));
        expect(src!, `${name} must go through requireAuth()`).toMatch(/\brequireAuth\s*\(/);
      }
    }
  });

  test("withTiming() opens the acting-person scope around the whole handler", () => {
    const src = stripped.get(path.join(SRC, "lib", "with-timing.ts"))!;
    expect(src).toMatch(/runWithActingPersonScope\(\s*\(\)\s*=>\s*handler\(\.\.\.args\)\s*\)/);
  });

  test("every route that reaches VERIDIAN wears withTiming() on every handler and resolves its session through requireAuth(), or is allowlisted", () => {
    const uncovered = [...verdicts.values()]
      .filter((v) => !v.covered && !NO_SESSION_ROUTES[relOf(v.file)])
      .map((v) => {
        const unwrapped = v.handlers.filter((h) => !h.wrapped).map((h) => h.method);
        const reasons = [
          ...(v.handlers.length === 0 ? ["no recognisable exported handler"] : []),
          ...(unwrapped.length ? [`not wrapped in withTiming(): ${unwrapped.join(", ")}`] : []),
          ...(v.session ? [] : ["never calls requireAuth() or a helper built on it"]),
        ];
        return `${relOf(v.file)} -- ${reasons.join("; ")}`;
      });
    expect(
      uncovered,
      "These routes reach VERIDIAN but their calls would carry no X-Acting-User: wrap every handler in withTiming() and resolve the session with requireAuth(), or add the route to NO_SESSION_ROUTES with the reason it acts without a person.",
    ).toEqual([]);
  });

  test("inside every handler, the session is resolved BEFORE the first VERIDIAN call (an earlier call would go out with no person)", () => {
    const early: string[] = [];
    for (const v of verdicts.values()) {
      if (!v.covered) continue;
      const src = stripped.get(v.file)!;
      const starts = [...src.matchAll(/^export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*withTiming\(/gm)].map((m) => ({ method: m[1], at: m.index! }));
      starts.forEach((s, k) => {
        // From this handler's export to the next one: its body, plus any
        // module-level helper declared after it (which cannot run before the
        // handler's own first statements, so it cannot cause a false alarm).
        const body = src.slice(s.at, k + 1 < starts.length ? starts[k + 1].at : src.length);
        const session = body.search(SESSION_RE);
        const call = body.search(/\b(callVeridianRaw|callVeridianResult|callVeridianBinary|callVeridianUpload|callVeridian)\s*(?:<[^()]*?>)?\s*\(|\bPromise\.all\s*\(/);
        if (session < 0) early.push(`${relOf(v.file)} ${s.method}: never resolves the session itself`);
        else if (call >= 0 && call < session) early.push(`${relOf(v.file)} ${s.method}: calls VERIDIAN (or fans out with Promise.all) before resolving the session`);
      });
    }
    expect(early).toEqual([]);
  });

  test("the allowlist is honest: every entry exists, reaches VERIDIAN, and really has no session", () => {
    for (const [rel, reason] of Object.entries(NO_SESSION_ROUTES)) {
      const file = path.join(SRC, ...rel.split("/"));
      expect(fileSet.has(file), `${rel} no longer exists -- drop it from NO_SESSION_ROUTES`).toBe(true);
      expect(reachesVeridian.has(file), `${rel} no longer reaches VERIDIAN -- drop it from NO_SESSION_ROUTES`).toBe(true);
      expect(verdicts.get(file)?.session, `${rel} now calls requireAuth() -- it is covered, drop it from NO_SESSION_ROUTES`).toBe(false);
      expect(reason.length).toBeGreaterThan(40);
    }
  });

  test("no module caches VERIDIAN data with a raw unstable_cache (the fill would carry whoever triggered it)", () => {
    const offenders = files
      .filter((f) => relOf(f) !== "lib/person-free-cache.ts")
      .filter((f) => /import\s*\{[^}]*\bunstable_cache\b[^}]*\}\s*from\s*["']next\/cache["']/.test(stripped.get(f)!))
      .map(relOf);
    expect(offenders, "use personFreeCache() from @/lib/person-free-cache instead").toEqual([]);
  });

  test("nothing reads an inbound acting-user header: the identity only ever comes from the verified session", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const src = stripped.get(f)!;
      if (/headers\s*(?:\(\s*\))?\s*\.get\(\s*["']x-acting-user(?:-email)?["']/i.test(src)) offenders.push(relOf(f));
      if (/\.get\(\s*ACTING_USER(?:_EMAIL)?_HEADER\s*\)/.test(src)) offenders.push(relOf(f));
    }
    expect(offenders).toEqual([]);
  });
});

describe("acting-person coverage: ACTOR_SWEEP_INVENTORY section 6, traced from compliance-tracker back to PROJEXA", () => {
  const { findings, covered } = inventoryFindings();

  test("the inventory is the full section 6 list (136 routes, 143 handlers)", () => {
    expect(INVENTORY.length).toBe(136);
    expect(INVENTORY.reduce((n, line) => n + line.split(" ")[0].split(",").length, 0)).toBe(143);
  });

  test("the matcher is real: known PROJEXA writes are traced to their inventory paths", () => {
    // If path normalisation or method detection broke, `covered` would shrink
    // to nothing and the finding list below would be vacuously empty.
    expect(covered.has("POST /api/v1/projexa/leads")).toBe(true);
    expect(covered.has("PATCH /api/v1/projexa/rfis/[id]")).toBe(true);
    expect(covered.size).toBeGreaterThan(60);
  });

  test("every PROJEXA call site for an inventory path names its person, or runs only under covered routes", () => {
    expect(
      findings.map((f) => `${f.entry} <- ${f.site}: ${f.problem}`),
      "These calls would reach a compliance-tracker route that refuses (or, for a read, cannot attribute) an API-key call naming nobody.",
    ).toEqual([]);
  });
});
