#!/usr/bin/env node
// Pull open + reopened errors from the PROJEXA error log and write a ready
// work queue to ERROR_QUEUE/<YYYY-MM-DD>.md (git-ignored). Zero dependencies.
//
//   node scripts/error-triage/pull-errors.mjs [--limit 20] [--project <id>] [--out <file>]
//
// Env: VERIDIAN_API_KEY (owner key), VERIDIAN_BASE_URL (optional),
//      VERIDIAN_REPO_PATH (optional: local compliance-tracker folder, used to
//      confirm the backend file named in "Where to look").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TriageError, api, config, parseArgs, requireKey, unwrap } from "./common.mjs";

const SEV = { critical: 0, high: 1, error: 1, medium: 2, warning: 2, low: 3, info: 4 };
const sevRank = (s) => SEV[String(s ?? "").toLowerCase()] ?? 5;

function walk(dir, hit, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, hit, out);
    else if (hit(e.name)) out.push(p);
  }
  return out;
}

// Turn files under `appDir` into [{file, segs}] with route groups "(x)" dropped.
function indexRoutes(appDir, fileName) {
  return walk(appDir, (n) => n === fileName).map((f) => {
    const rel = path.relative(appDir, path.dirname(f)).split(path.sep).filter((s) => s && !/^\(.*\)$/.test(s));
    return { file: f, segs: rel };
  });
}

function bestMatch(index, pathname) {
  const want = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  let best = null;
  for (const r of index) {
    const segs = r.segs;
    const catchAll = segs.length && /^\[\.\.\..*\]$|^\[\[\.\.\..*\]\]$/.test(segs[segs.length - 1]);
    if (!catchAll && segs.length !== want.length) continue;
    let score = 0, ok = true;
    for (let i = 0; i < segs.length && ok; i++) {
      const s = segs[i];
      if (/^\[\[?\.\.\./.test(s)) { score += 0; break; }
      if (i >= want.length) { ok = false; break; }
      if (s === want[i]) score += 2;
      else if (/^\[.*\]$/.test(s)) score += 1;
      else ok = false;
    }
    if (ok && (!best || score > best.score)) best = { ...r, score };
  }
  return best?.file ?? null;
}

export function whereToLook(sample, ctx) {
  const hints = [];
  const rel = (root, f) => path.relative(root, f).split(path.sep).join("/");
  const route = sample.route;
  if (route && ctx.pages) {
    const f = bestMatch(ctx.pages, route);
    if (f) hints.push(`Screen: \`${rel(ctx.root, f)}\` (route ${route})`);
    else hints.push(`Screen: no page file found for route ${route} - search \`src/app\` for its folder name`);
  }
  let api = sample.api_path;
  if (api) {
    api = String(api).split("?")[0];
    const m = api.match(/^\/api\/v1\/(.+)$/);
    if (m) {
      const tail = `src/app/api/v1/${m[1]}/route.ts`;
      let line = `Backend (compliance-tracker): \`${tail}\``;
      if (ctx.vroutes) {
        const f = bestMatch(ctx.vroutes, "/" + m[1]);
        if (f) line = `Backend (compliance-tracker): \`${rel(ctx.veridian, f)}\` (found in ${ctx.veridian})`;
        else line += " (not found locally - the closest folder may differ)";
      } else line += " (set VERIDIAN_REPO_PATH to the compliance-tracker folder to confirm the exact file)";
      hints.push(line);
      const proxy = ctx.apis && bestMatch(ctx.apis, api.replace(/^\/api\/v1\/projexa/, ""));
      if (proxy) hints.push(`PROJEXA proxy: \`${rel(ctx.root, proxy)}\``);
    } else if (ctx.apis) {
      const f = bestMatch(ctx.apis, api.replace(/^\/api/, ""));
      hints.push(f ? `API route in PROJEXA: \`${rel(ctx.root, f)}\`` : `API route: no matching \`route.ts\` under \`src/app/api\` for ${api}`);
    }
  }
  return hints;
}

function fmtBreadcrumb(b) {
  if (typeof b === "string") return b;
  const when = b.ts ?? b.time ?? b.at ?? b.timestamp ?? "";
  const kind = b.type ?? b.kind ?? b.category ?? "";
  const what = b.message ?? b.label ?? b.text ?? b.action ?? b.target ?? b.url ?? "";
  const extra = b.route ?? b.api_path ?? "";
  return [when, kind && `[${kind}]`, what, extra].filter(Boolean).join(" ") || JSON.stringify(b);
}

function deviceLine(sample) {
  const c = sample.context ?? {};
  const bits = [c.device, c.browser, c.os, c.user_agent ?? c.userAgent, c.viewport && `screen ${c.viewport}`, c.online === false && "was offline", c.app_version && `app ${c.app_version}`]
    .filter(Boolean);
  return bits.join(" | ") || "not recorded";
}

export function renderQueue(issues, ctx, dateStr) {
  const out = [`# Error work queue - ${dateStr}`, "", `${issues.length} open or reopened error(s), most serious first. Fix them in this order.`, ""];
  issues.forEach((it, i) => {
    const s = it.sample ?? {};
    out.push(`## ${i + 1}. ${it.title || s.message || "Untitled error"}`, "");
    out.push(`- Issue id: \`${it.id}\`   Status: ${it.status}${it.reopened_count ? ` (came back ${it.reopened_count} time(s) after being marked fixed)` : ""}`);
    out.push(`- Seriousness: ${it.severity ?? "unknown"}   Happened ${it.occurrences ?? "?"} time(s)   First: ${it.first_seen_at ?? "?"}   Last: ${it.last_seen_at ?? "?"}`);
    out.push(`- Projects: ${(it.project_ids ?? []).join(", ") || "n/a"}`);
    out.push(`- Route: ${s.route ?? (it.routes ?? []).join(", ") ?? "n/a"}`);
    if (s.api_path || s.http_status) out.push(`- API call: ${s.http_method ?? ""} ${s.api_path ?? ""} -> status ${s.http_status ?? "?"}   Request id: ${s.request_id ?? "n/a"}`);
    out.push(`- Device: ${deviceLine(s)}`);
    if (s.message) out.push(`- Message: ${s.message}`);
    out.push("", "**Steps the person took**", "");
    const bc = s.breadcrumbs ?? [];
    if (bc.length) bc.forEach((b, n) => out.push(`${n + 1}. ${fmtBreadcrumb(b)}`));
    else out.push("(none recorded)");
    out.push("", "**Stack**", "", "```", (s.stack ?? "(no stack recorded)").trim(), "```", "");
    out.push("**Where to look**", "");
    const hints = whereToLook(s, ctx);
    if (hints.length) hints.forEach((h) => out.push(`- ${h}`)); else out.push("- No route or API path recorded; search for the message text.");
    if (it.fix_summary) out.push("", `Earlier fix that did not hold: ${it.fix_summary}${it.fix_commit ? ` (commit ${it.fix_commit})` : ""}`);
    out.push("", "When fixed: `node scripts/error-triage/record-fix.mjs --issue " + it.id + ' --summary "..." --file <path> --change "..." --commit <sha>`', "", "---", "");
  });
  return out.join("\n");
}

export async function fetchIssues(cfg, { limit, project }) {
  const all = [];
  for (const status of ["open", "reopened"]) {
    const q = new URLSearchParams({ status, limit: String(limit) });
    if (project) q.set("projectId", project);
    const j = unwrap(await api(cfg, "GET", `issues?${q}`));
    const list = Array.isArray(j) ? j : j?.issues ?? j?.items ?? [];
    all.push(...list);
  }
  const seen = new Set();
  const uniq = all.filter((x) => (seen.has(x.id) ? false : seen.add(x.id)));
  uniq.sort((a, b) => sevRank(a.severity) - sevRank(b.severity) || (b.occurrences ?? 0) - (a.occurrences ?? 0));
  const top = uniq.slice(0, limit);
  // Make sure each issue has a full sample (steps, stack) - the list may be slim.
  for (const it of top) {
    if (it.sample?.breadcrumbs && it.sample?.stack !== undefined) continue;
    const d = unwrap(await api(cfg, "GET", `issues/${encodeURIComponent(it.id)}`));
    const full = d?.issue ?? d;
    const ev = (d?.events ?? [])[0];
    it.sample = { ...(ev ?? {}), ...(full?.sample ?? it.sample ?? {}) };
    if (!it.sample.breadcrumbs && ev?.breadcrumbs) it.sample.breadcrumbs = ev.breadcrumbs;
    for (const k of ["fix_summary", "fix_commit", "reopened_count"]) if (full?.[k] !== undefined) it[k] = full[k];
  }
  return top;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cfg = config();
  requireKey(cfg);
  const limit = Math.max(1, parseInt(args.limit ?? "20", 10) || 20);
  const issues = await fetchIssues(cfg, { limit, project: typeof args.project === "string" ? args.project : undefined });
  const veridian = process.env.VERIDIAN_REPO_PATH?.trim();
  const ctx = {
    root: cfg.root,
    pages: indexRoutes(path.join(cfg.root, "src", "app"), "page.tsx"),
    apis: indexRoutes(path.join(cfg.root, "src", "app", "api"), "route.ts"),
    veridian,
    vroutes: veridian && fs.existsSync(path.join(veridian, "src/app/api/v1"))
      ? indexRoutes(path.join(veridian, "src/app/api/v1"), "route.ts") : null,
  };
  const dateStr = new Date().toISOString().slice(0, 10);
  const md = renderQueue(issues, ctx, dateStr);
  const outFile = typeof args.out === "string" ? args.out : path.join(cfg.root, "ERROR_QUEUE", `${dateStr}.md`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, md);
  console.log(issues.length ? `Wrote ${issues.length} error(s) to ${outFile}` : `No open errors. Wrote an empty queue to ${outFile}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e instanceof TriageError ? e.message : `Unexpected problem: ${e?.message ?? e}`);
    process.exit(1);
  });
}
