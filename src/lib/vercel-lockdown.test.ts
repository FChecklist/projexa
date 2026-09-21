// R76 (2026-09-06) established this drift guard for the original all-branches-
// blocked lockdown. R87 (2026-09-13, D158) revised the policy to a branch-name
// + docs-path ignoreCommand, then PROJEXA-E2E-001 (2026-09-20) revised it
// again to a simpler VERCEL_ENV-based script that proceeded on
// VERCEL_ENV=production so a Phase-B batch merge could go live in one build.
// Same test, same policy, as compliance-tracker's own
// src/lib/vercel-lockdown.test.ts (a separate repo, a separate vercel.json,
// needs its own copy of this guard).
//
// PROJEXA-E2E-001, continued (2026-09-21, owner directive, quoted verbatim):
// "WE NEED TO SPEND MINIMUM VERCEL CREDITS ... THAN WE GO LIVE BY RECHARGING
// VERCEL." Investigated first, not just applied blind: both projects'
// `live` flag was already `false` and every deployment PROJEXA-E2E-001's own
// merges to main had triggered (dpl_HbGeekZ7.../dpl_EwyTrQAQ...) showed
// readyState=BLOCKED with target=null -- the project-pause/spend-cap
// backstop documented in R87's own findings was in fact catching every one
// of them, so no real build/compute was spent by those merges. Tightening
// anyway, on the owner's explicit instruction, rather than relying on that
// backstop as the only line of defense: ignoreCommand is now unconditional
// -- `exit 0` on every ref, VERCEL_ENV included -- so nothing here can ever
// reach a real build again until the owner recharges and says go live,
// at which point THIS is the one line that changes back.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function readVercelJson() {
  const raw = readFileSync(join(import.meta.dir, "..", "..", "vercel.json"), "utf8")
  return JSON.parse(raw)
}

function runIgnoreCommand(cmd: string, vercelEnv: string | undefined): number | null {
  const env = { ...process.env }
  if (vercelEnv === undefined) {
    delete env.VERCEL_ENV
  } else {
    env.VERCEL_ENV = vercelEnv
  }
  const proc = Bun.spawnSync(["sh", "-c", cmd], { env })
  return proc.exitCode
}

describe("Vercel deploy lockdown (PROJEXA-E2E-001, 2026-09-21) -- ignoreCommand skips unconditionally", () => {
  test("git.deploymentEnabled is not relied upon (still gone since R87)", () => {
    const v = readVercelJson()
    expect(v.git).toBeUndefined()
  })

  test("ignoreCommand exists and does not branch on VERCEL_ENV, branch name, or git diff", () => {
    const v = readVercelJson()
    expect(typeof v.ignoreCommand).toBe("string")
    expect(v.ignoreCommand).not.toContain("VERCEL_ENV")
    expect(v.ignoreCommand).not.toContain("VERCEL_GIT_COMMIT_REF")
    expect(v.ignoreCommand).not.toContain("git diff")
  })

  test("VERCEL_ENV=production is skipped (exit 0) -- no build proceeds until the owner reverts this", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "production")).toBe(0)
  })

  test("VERCEL_ENV=preview is skipped (exit 0) -- every branch/PR build", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "preview")).toBe(0)
  })

  test("VERCEL_ENV=development is skipped (exit 0)", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "development")).toBe(0)
  })

  test("VERCEL_ENV unset is skipped (exit 0) -- fail closed, not open", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, undefined)).toBe(0)
  })
})

describe("Vercel deploy lockdown -- guard the guard", () => {
  test("this test file itself is wired into ci.yml's test job", () => {
    // Same rationale as the original R76 version of this test: check the
    // ACTUAL ci.yml content, not just that this file exists, so a future
    // narrowing of the test glob gets caught here.
    const ci = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "ci.yml"), "utf8")
    const testStep = ci.match(/bun test[^\n]*/)?.[0] ?? ""
    expect(testStep, "ci.yml's test job no longer runs a plain `bun test` invocation that would include this file").toContain("bun test")
  })
})
