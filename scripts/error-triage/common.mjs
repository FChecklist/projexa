// Shared helpers for the error-triage scripts (zero dependencies, Node 22 fetch).
// Plain-words failures: every problem is thrown as TriageError with a sentence
// a non-technical owner can read.
import fs from "node:fs";
import path from "node:path";

export class TriageError extends Error {}

export function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2");
  }
}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    const val = next === undefined || next.startsWith("--") ? true : (i++, next);
    if (out[key] === undefined) out[key] = val;
    else out[key] = [].concat(out[key], val);
  }
  return out;
}

export function config() {
  const root = process.cwd();
  loadEnvFile(path.join(root, ".env.local"));
  loadEnvFile(path.join(root, ".env"));
  const key = (process.env.VERIDIAN_API_KEY ?? "").trim();
  const base = (process.env.VERIDIAN_BASE_URL ?? "https://veridian-compliance-ai.vercel.app").trim().replace(/\/+$/, "");
  return { key, base, root };
}

export function requireKey(cfg) {
  if (!cfg.key) {
    throw new TriageError(
      "The owner API key is missing. Add a line VERIDIAN_API_KEY=<your key> to the file .env.local in the PROJEXA folder (see FIX_ERRORS.md, step 1), then try again.",
    );
  }
}

export async function api(cfg, method, urlPath, body) {
  const url = `${cfg.base}/api/v1/projexa/client-logs/${urlPath}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${cfg.key}`, "Content-Type": "application/json", Accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new TriageError(`Could not reach the error log at ${cfg.base}. Check the internet connection (and VERIDIAN_BASE_URL if you changed it), then try again.`);
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
  if (res.status === 401 || res.status === 403) {
    throw new TriageError("The error log refused the API key (it is wrong, expired, or not an owner/admin key). Put a valid owner key in VERIDIAN_API_KEY in .env.local and try again.");
  }
  if (res.status === 404) throw new TriageError("That error was not found in the log. Check the issue number.");
  if (res.status === 400 && json?.field) {
    throw new TriageError(`The error log rejected this because "${json.field}" is missing or not valid${json.error?.message || typeof json.error==="string" ? ` (${json.error?.message ?? json.error})` : ""}. Fix that and run the command again.`);
  }
  if (!res.ok) {
    const detail = (json && (json.error?.message ?? json.error ?? json.message)) || text.slice(0, 200);
    throw new TriageError(`The error log answered with a problem (HTTP ${res.status}): ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
  return json;
}

export const unwrap = (j) => (j && typeof j === "object" && "data" in j && j.data !== undefined ? j.data : j);
