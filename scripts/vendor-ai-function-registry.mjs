#!/usr/bin/env node
// LOCAL-FIRST browser AI: refreshes src/lib/local-first/ai/function-registry.json from the AI work link's generated
// registry in compliance-tracker (supabase/functions/ai-work-link/function-registry.generated.json).
//
// Usage: node scripts/vendor-ai-function-registry.mjs <path to compliance-tracker checkout> [git ref, default HEAD]
//
// WHY A COPY. The laptop must refuse a write the person's role may not make while it is offline (no server to ask),
// in plain words, BEFORE it waits in the outbox for hours. The copy holds only the write functions and only the fields
// that decision needs. The server remains the authority: every op is re-checked by projexa_sync_push_begin on push,
// so a stale copy can only refuse too early or let the server refuse later; it can never grant anything.

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const [repo, ref = "HEAD"] = process.argv.slice(2);
if (!repo) {
  console.error("usage: node scripts/vendor-ai-function-registry.mjs <compliance-tracker checkout> [ref]");
  process.exit(2);
}
const path = "supabase/functions/ai-work-link/function-registry.generated.json";
const sha = execFileSync("git", ["-C", repo, "rev-parse", ref], { encoding: "utf8" }).trim();
const all = JSON.parse(execFileSync("git", ["-C", repo, "show", `${sha}:${path}`], { encoding: "utf8", maxBuffer: 64 << 20 }));
const KEEP = ["function_id", "label", "module", "kind", "link_level", "min_role_rank", "money_sensitive", "excluded_reason", "declared_params", "required_params", "id_params"];
const functions = all
  .filter((f) => f.kind === "write")
  .map((f) => Object.fromEntries(KEEP.map((k) => [k, f[k] ?? null])))
  .sort((a, b) => a.function_id.localeCompare(b.function_id));
const out = {
  source: `FChecklist/compliance-tracker ${path}`,
  source_commit: sha,
  note: "Write functions only. Copied verbatim (selected fields). The server stays the authority on every push; this copy only lets the laptop refuse early in plain words. Refresh with scripts/vendor-ai-function-registry.mjs.",
  functions,
};
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "src/lib/local-first/ai/function-registry.json");
writeFileSync(target, JSON.stringify(out, null, 1));
console.log(`wrote ${functions.length} write functions from ${sha}`);
