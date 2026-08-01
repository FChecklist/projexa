#!/usr/bin/env node
// VERIDIAN Review Framework -- AI Cost Governance & FinOps (2026-07-18),
// finding 4: "Cross-repo (compliance-tracker + projexa) AI spend is visible
// as one combined figure" -- the documentation half lives in
// compliance-tracker/docs/AI_COST_GOVERNANCE_FINOPS.md §2. THIS script is
// the guardrail-presence-style CI check that keeps the architectural fact
// behind that doc TRUE: projexa makes zero direct model-provider calls today,
// so all projexa AI spend flows through callVeridian() into
// compliance-tracker's Token Usage Ledger (one combined figure). If a future
// PR introduces a provider-API-key env name or a direct chat/completions
// endpoint into projexa/src/, that PR is now a VISIBLE, REVIEWED diff rather
// than a silent fragmentation of AI spend across two repos.
//
// Honest limitation, stated up front (same class as compliance-tracker's
// check-guardrail-presence.mjs -- read that script's own header for the
// honest framing): this is a deterministic text-presence scan, not a
// runtime-unbypassable lock. It cannot stop a FULL_ACCESS agent from editing
// this allowlist to exempt a new key. What it guarantees is that introducing a
// provider key becomes a visible, reviewed change a human can catch -- the
// same class of guarantee every other "no agent may X" rule in this
// ecosystem relies on (branch protection + PR review), not a stronger one.
//
// To legitimately add a provider key (rare, would mean projexa stops routing
// AI through compliance-tracker): add the key name to ALLOWED_KEY_ENV below
// AND update docs/AI_COST_GOVERNANCE_FINOPS.md §2 to explain why -- the same
// "manifest update + justification" discipline compliance-tracker's
// Operating Rule 9 requires for guardrail changes.

import { readdirSync, readFileSync, statSync } from "node:fs"
import path from "node:path"

const REPO_ROOT = process.cwd()
const SRC_DIR = path.resolve(REPO_ROOT, "src")

// Model-provider API-key env names that, if present in projexa/src/, would
// mean projexa is making its own direct provider calls -- fragmenting AI
// spend out of compliance-tracker's unified ledger. None of these should
// appear in projexa/src/ today (verified 2026-07-18).
const FORBIDDEN_KEY_ENV = [
  "OPENROUTER_API_KEY",
  "GROQ_API_KEY",
  "CEREBRAS_API_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "ZAI_API_KEY",
]

// Direct chat/completions endpoint hosts for each wired provider. A fetch()
// to one of these from projexa/src/ would mean projexa is calling a model
// provider directly instead of going through callVeridian() ->
// compliance-tracker.
const FORBIDDEN_ENDPOINTS = [
  "api.openrouter.ai",
  "api.groq.com",
  "api.cerebras.ai",
  "api.anthropic.com",
  "api.openai.com",
  "generativelanguage.googleapis.com",
]

// The ONLY sanctioned remote-AI path: projexa routes back into
// compliance-tracker via VERIDIAN_API_KEY / VERIDIAN_API_BASE_URL (see
// src/lib/veridian-client.ts) -- not a model provider. These env names are
// exempt from the check on purpose.
const ALLOWED_KEY_ENV = new Set(["VERIDIAN_API_KEY", "VERIDIAN_API_BASE_URL"])

const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js", ".json", ".env", ".yml", ".yaml"])

let failed = false
const findings = []

function walk(dir) {
  let out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out = out.concat(walk(full))
    } else {
      const ext = path.extname(entry.name)
      if (SCAN_EXTENSIONS.has(ext) || entry.name.startsWith(".env")) out.push(full)
    }
  }
  return out
}

let scanned = 0
try {
  statSync(SRC_DIR)
} catch {
  console.error(`check-no-provider-api-keys: src/ not found at ${SRC_DIR}`)
  process.exit(1)
}

for (const file of walk(SRC_DIR)) {
  let content
  try {
    content = readFileSync(file, "utf8")
  } catch {
    continue
  }
  scanned++

  for (const key of FORBIDDEN_KEY_ENV) {
    // Match the env name as a token (word boundary), so e.g. OPENAI_API_KEY
    // doesn't match a substring of something else. process.env.X and "X"
    // both surface here.
    const re = new RegExp(`\\b${key}\\b`)
    if (re.test(content)) {
      failed = true
      const rel = path.relative(REPO_ROOT, file)
      findings.push(`${rel}: references forbidden provider API-key env '${key}'`)
    }
  }

  for (const endpoint of FORBIDDEN_ENDPOINTS) {
    if (content.includes(endpoint)) {
      failed = true
      const rel = path.relative(REPO_ROOT, file)
      findings.push(`${rel}: references direct provider endpoint '${endpoint}'`)
    }
  }
}

// Sanity: assert the sanctioned veridian-client.ts still exists (if it were
// deleted, the whole "projexa routes through compliance-tracker" premise
// would silently stop being true -- same protected-FILE discipline as
// compliance-tracker's guardrail-presence manifest).
const veridianClientPath = path.resolve(SRC_DIR, "lib", "veridian-client.ts")
try {
  const vc = readFileSync(veridianClientPath, "utf8")
  if (!vc.includes("callVeridian") || !vc.includes("VERIDIAN_API_BASE")) {
    failed = true
    findings.push(`src/lib/veridian-client.ts: expected 'callVeridian' + 'VERIDIAN_API_BASE' markers missing -- the sanctioned cross-repo AI path appears weakened`)
  }
} catch {
  failed = true
  findings.push(`src/lib/veridian-client.ts: FILE DELETED -- projexa's sanctioned path back into compliance-tracker is gone`)
}

if (failed) {
  console.error("=== No Provider API Keys Check FAILED ===")
  console.error("projexa must not make direct model-provider calls -- all AI spend routes")
  console.error("through callVeridian() -> compliance-tracker's Token Usage Ledger so it stays")
  console.error("one combined, reconcilable figure (docs/AI_COST_GOVERNANCE_FINOPS.md §2).\n")
  for (const line of findings) console.error(`  - ${line}`)
  console.error("\nIf a provider key is genuinely needed, add it to ALLOWED_KEY_ENV in")
  console.error("scripts/check-no-provider-api-keys.mjs AND update")
  console.error("compliance-tracker/docs/AI_COST_GOVERNANCE_FINOPS.md §2 explaining why.")
  process.exit(1)
}

console.log(`No Provider API Keys Check passed -- scanned ${scanned} files under src/, zero direct provider keys/endpoints found; sanctioned callVeridian() path intact.`)
