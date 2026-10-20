#!/usr/bin/env node
// Record the outcome of a fix on the PROJEXA error log.
//   node scripts/error-triage/record-fix.mjs --issue <id> --summary "plain words" \
//        --file src/x.ts --change "what changed" [--file ... --change ...] --commit <sha> [--dry-run]
//   node scripts/error-triage/record-fix.mjs --ignore <id> --reason "why" [--dry-run]
// "Fixed" is refused unless there is a summary and at least one file.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TriageError, api, config, parseArgs, requireKey, unwrap } from "./common.mjs";

const arr = (v) => (v === undefined || v === true ? [] : [].concat(v));
const text = (v) => (typeof v === "string" ? v.trim() : "");

export function buildRequest(args) {
  if (args.ignore !== undefined) {
    const id = text(args.ignore);
    if (!id) throw new TriageError("Say which error to ignore: --ignore <issue id>.");
    if (!text(args.reason)) throw new TriageError("Ignoring an error needs a reason: --reason \"why\".");
    return { id, body: { status: "ignored", fix_summary: text(args.reason), fixed_by: text(args["fixed-by"]) || "claude-code" } };
  }
  const id = text(args.issue);
  if (!id) throw new TriageError("Say which error was fixed: --issue <issue id>.");
  const summary = text(args.summary);
  if (!summary) throw new TriageError("Cannot mark this error fixed without a plain-English summary of the fix (--summary \"...\").");
  const files = arr(args.file).map(text).filter(Boolean);
  if (!files.length) throw new TriageError("Cannot mark this error fixed without at least one changed file (--file <path> --change \"what changed\").");
  const changes = arr(args.change).map(text);
  if (changes.length > files.length) throw new TriageError("There are more --change notes than --file paths. Give each --change right after its --file.");
  const body = {
    status: "fixed",
    fix_summary: summary,
    fix_files: files.map((p, i) => ({ path: p, change: changes[i] || "(not described)" })),
    fixed_by: text(args["fixed-by"]) || "claude-code",
  };
  if (text(args.commit)) body.fix_commit = text(args.commit);
  return { id, body };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { id, body } = buildRequest(args);
  const cfg = config();
  const target = `issues/${encodeURIComponent(id)}`;
  if (args["dry-run"]) {
    console.log(`DRY RUN - nothing sent. Would PATCH ${cfg.base}/api/v1/projexa/client-logs/${target} with:\n${JSON.stringify(body, null, 2)}`);
    return;
  }
  requireKey(cfg);
  const res = unwrap(await api(cfg, "PATCH", target, body));
  const stored = res?.issue ?? res;
  console.log(`Stored on issue ${id}:`);
  console.log(JSON.stringify(stored, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((e) => {
    console.error(e instanceof TriageError ? e.message : `Unexpected problem: ${e?.message ?? e}`);
    process.exit(1);
  });
}
