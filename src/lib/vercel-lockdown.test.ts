// R76 (2026-09-06): Layer 3 of the Vercel deploy lockdown -- the layer that
// survives forgetting. Same test, same policy, as compliance-tracker's own
// src/lib/vercel-lockdown.test.ts (a separate repo, a separate vercel.json,
// needs its own copy of this guard).
//
// See platform.crr_ruling id R76-RULING-01 (compliance-tracker DB, project
// pcrjmlpuqsbocqfwoxod) for the full policy this enforces: Vercel is a
// customer-facing production surface only; a deployment requires the owner
// to set OWNER_DEPLOY_APPROVAL to today's UTC date in the Vercel dashboard;
// no session or agent may set that variable, create a deployment, or
// weaken this file.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

function readVercelJson() {
  const raw = readFileSync(join(import.meta.dir, "..", "..", "vercel.json"), "utf8")
  return JSON.parse(raw)
}

describe("Vercel deploy lockdown (R76-RULING-01) -- Layer 1: nothing auto-deploys", () => {
  test("git.deploymentEnabled exists", () => {
    const v = readVercelJson()
    expect(v.git?.deploymentEnabled).toBeDefined()
  })

  test("the wildcard branch key is present and false", () => {
    const v = readVercelJson()
    expect(v.git.deploymentEnabled["*"]).toBe(false)
  })

  test("no branch key anywhere in deploymentEnabled is set to true", () => {
    const v = readVercelJson()
    const entries = Object.entries(v.git.deploymentEnabled as Record<string, unknown>)
    const enabledBranches = entries.filter(([, value]) => value === true).map(([key]) => key)
    expect(enabledBranches, `these branches would auto-deploy: ${enabledBranches.join(", ")} -- see R76-RULING-01`).toEqual([])
  })
})

describe("Vercel deploy lockdown (R76-RULING-01) -- Layer 2: the owner-approval gate", () => {
  test("ignoreCommand exists", () => {
    const v = readVercelJson()
    expect(typeof v.ignoreCommand).toBe("string")
    expect(v.ignoreCommand.length).toBeGreaterThan(0)
  })

  test("ignoreCommand references OWNER_DEPLOY_APPROVAL", () => {
    const v = readVercelJson()
    expect(v.ignoreCommand).toContain("OWNER_DEPLOY_APPROVAL")
  })

  test("ignoreCommand fails closed: unset/empty/wrong-date all cancel, only an exact UTC-date match proceeds", () => {
    const v = readVercelJson()
    const cmd = v.ignoreCommand as string
    const run = (env: Record<string, string> | undefined) => {
      const proc = Bun.spawnSync(["sh", "-c", cmd], { env: { ...process.env, ...env } })
      return proc.exitCode
    }
    const today = new Date().toISOString().slice(0, 10)
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

    expect(run({ OWNER_DEPLOY_APPROVAL: "" })).toBe(0) // unset/empty -> cancel
    expect(run({ OWNER_DEPLOY_APPROVAL: yesterday })).toBe(0)
    expect(run({ OWNER_DEPLOY_APPROVAL: tomorrow })).toBe(0)
    expect(run({ OWNER_DEPLOY_APPROVAL: "not-a-date" })).toBe(0)
    expect(run({ OWNER_DEPLOY_APPROVAL: today })).toBe(1) // exact match -> proceed
  })
})

describe("Vercel deploy lockdown (R76-RULING-01) -- guard the guard", () => {
  test("ci.yml has an explicit file-existence guard for this test file, not just a bare test-glob dependency", () => {
    // A bare `bun test --isolate` invocation would just silently run one
    // fewer file if this one were deleted, not fail -- ci.yml's own explicit
    // `test -f src/lib/vercel-lockdown.test.ts` step (added the same day
    // this file was) is what actually catches deletion, proven locally by
    // running that exact step against a real removed-and-restored file
    // before this was committed. This assertion checks the step is still
    // wired into ci.yml, not that the file exists (Bun would never even run
    // this assertion if the file were gone).
    const ci = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "ci.yml"), "utf8")
    expect(ci).toContain("vercel-lockdown.test.ts")
  })
})
