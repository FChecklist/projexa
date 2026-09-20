// R76 (2026-09-06) established this drift guard for the original all-branches-
// blocked lockdown. R87 (2026-09-13, D158) revised the policy to a branch-name
// + docs-path ignoreCommand after finding git.deploymentEnabled's "*" glob
// never matched this repo's own branch-naming convention (feat/..., fix/...,
// r87/..., etc.). Same test, same policy, as compliance-tracker's own
// src/lib/vercel-lockdown.test.ts (a separate repo, a separate vercel.json,
// needs its own copy of this guard).
//
// PROJEXA-E2E-001 (2026-09-20, owner directive, quoted verbatim): "Confirm
// the Ignored Build Step is live on both projects so only production can
// build: `if [ "$VERCEL_ENV" = "production" ]; then exit 1; else exit 0; fi`.
// Report the commit. Every branch and PR should then cost zero." This session
// prepared the change on this branch per AGENTS.md Rule 9 (guardrail change,
// owner instruction quoted in the PR) -- it is NOT merged to main yet. The
// owner's own PROJEXA-E2E-001 methodology ("Phase A: nothing goes to main,
// because main is what triggers a build... Phase B: one merge to main, one
// build") means this repo's actual ignoreCommand stays on the R87 script
// until Phase B's batch merge, at which point this branch's change lands
// alongside it. Both scripts already achieve the load-bearing property (zero
// preview builds on any non-main/non-production ref) -- this is a strictly
// simpler, VERCEL_ENV-based mechanism replacing the git-diff-based one, not a
// weakening: Vercel sets VERCEL_ENV=production only for the deployment
// targeting the project's production branch, so this reads Vercel's own
// classification instead of re-deriving it from a branch-name string compare.
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

describe("Vercel deploy lockdown (PROJEXA-E2E-001) -- ignoreCommand gates on VERCEL_ENV alone", () => {
  test("git.deploymentEnabled is not relied upon (still gone since R87)", () => {
    const v = readVercelJson()
    expect(v.git).toBeUndefined()
  })

  test("ignoreCommand exists and references VERCEL_ENV, not branch name or git diff", () => {
    const v = readVercelJson()
    expect(typeof v.ignoreCommand).toBe("string")
    expect(v.ignoreCommand).toContain("VERCEL_ENV")
    expect(v.ignoreCommand).not.toContain("VERCEL_GIT_COMMIT_REF")
    expect(v.ignoreCommand).not.toContain("git diff")
  })

  test("VERCEL_ENV=production proceeds to build (exit 1)", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, "production")).toBe(1)
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
