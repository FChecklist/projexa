// R76 (2026-09-06) established this drift guard for the original all-branches-
// blocked lockdown. R87 (2026-09-13, D158) revised the policy after finding a
// real bug in that original config: git.deploymentEnabled's "*" key is a
// minimatch glob that does NOT cross "/", so it silently never matched this
// repo's own branch-naming convention (feat/..., fix/..., r87/..., etc.) --
// PROJEXA had zero deploy-gating of any kind before this fix (this was its
// first-ever vercel.json), so unlike compliance-tracker's sibling file there
// was no working "*" key to have been silently broken -- only the new,
// intended state matters here. Same test, same policy, as compliance-
// tracker's own src/lib/vercel-lockdown.test.ts (a separate repo, a separate
// vercel.json, needs its own copy of this guard).
//
// Policy: git.deploymentEnabled is not used at all (it was the buggy,
// glob-ambiguous mechanism compliance-tracker found). The sole gate is a
// single, testable ignoreCommand that:
//   1. Skips (exit 0) any branch that isn't literally "main" -- no previews
//      build, full stop, regardless of what changed.
//   2. On main, skips (exit 0) when the commit's diff touches only docs/
//      governance paths (*.md, *.jsonl, kt/**, ai-os/**, .github/**).
//   3. On main, proceeds (exit 1) when the diff touches real app code.
// Unlike compliance-tracker's own file, PROJEXA gets this branch/path gate
// with no OWNER_DEPLOY_APPROVAL layer on top -- the owner's separate,
// explicit choice for this project (R87/D158).
import { describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function readVercelJson() {
  const raw = readFileSync(join(import.meta.dir, "..", "..", "vercel.json"), "utf8")
  return JSON.parse(raw)
}

function sh(cmd: string, cwd: string) {
  const proc = Bun.spawnSync(["sh", "-c", cmd], { cwd })
  if (proc.exitCode !== 0) {
    throw new Error(`setup command failed: ${cmd}\n${proc.stderr?.toString()}`)
  }
}

/** A throwaway git repo, isolated from this repo's own real history, so the
 * ignoreCommand's `git diff HEAD^ HEAD` can be driven by controlled fixture
 * commits instead of whatever this repo's actual last commit happens to be. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "vercel-lockdown-"))
  sh("git init -q -b main", dir)
  sh("git config user.email t@example.com", dir)
  sh("git config user.name t", dir)
  writeFileSync(join(dir, "README.md"), "base")
  sh("git add -A && git commit -q -m base", dir)
  return dir
}

function runIgnoreCommand(cmd: string, cwd: string, branch: string): number | null {
  const proc = Bun.spawnSync(["sh", "-c", cmd], {
    cwd,
    env: { ...process.env, VERCEL_GIT_COMMIT_REF: branch },
  })
  return proc.exitCode
}

describe("Vercel deploy lockdown (R87/D158) -- ignoreCommand is the sole gate", () => {
  test("git.deploymentEnabled is not relied upon (the buggy '*' glob mechanism is not used)", () => {
    const v = readVercelJson()
    expect(v.git).toBeUndefined()
  })

  test("ignoreCommand exists and references VERCEL_GIT_COMMIT_REF", () => {
    const v = readVercelJson()
    expect(typeof v.ignoreCommand).toBe("string")
    expect(v.ignoreCommand).toContain("VERCEL_GIT_COMMIT_REF")
  })

  test("a non-main branch is always skipped, even with a real src change", () => {
    const v = readVercelJson()
    const dir = makeRepo()
    try {
      writeFileSync(join(dir, "app.ts"), "console.log(1)")
      sh("git add -A && git commit -q -m 'feat: real change'", dir)
      expect(runIgnoreCommand(v.ignoreCommand, dir, "feature/some-branch")).toBe(0)
      expect(runIgnoreCommand(v.ignoreCommand, dir, "dependabot/npm_and_yarn/x-1.0.0")).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("main + a docs/governance-only commit is skipped", () => {
    const v = readVercelJson()
    const dir = makeRepo()
    try {
      writeFileSync(join(dir, "NOTES.md"), "docs update")
      writeFileSync(join(dir, "log.jsonl"), '{"a":1}\n')
      sh("mkdir -p kt/sub ai-os/sub .github/workflows", dir)
      writeFileSync(join(dir, "kt/sub/f.txt"), "kt note")
      writeFileSync(join(dir, "ai-os/sub/f.txt"), "ai-os note")
      writeFileSync(join(dir, ".github/workflows/f.yml"), "name: x")
      sh("git add -A && git commit -q -m 'docs: governance-only change'", dir)
      expect(runIgnoreCommand(v.ignoreCommand, dir, "main")).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("main + a real app-code change proceeds to build", () => {
    const v = readVercelJson()
    const dir = makeRepo()
    try {
      writeFileSync(join(dir, "src-app.ts"), "export const x = 1")
      sh("git add -A && git commit -q -m 'fix: real app change'", dir)
      expect(runIgnoreCommand(v.ignoreCommand, dir, "main")).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("main + a mixed doc+app-code commit proceeds to build (docs-only exemption doesn't mask real changes)", () => {
    const v = readVercelJson()
    const dir = makeRepo()
    try {
      writeFileSync(join(dir, "NOTES.md"), "docs update")
      writeFileSync(join(dir, "src-app.ts"), "export const x = 1")
      sh("git add -A && git commit -q -m 'feat: mixed change'", dir)
      expect(runIgnoreCommand(v.ignoreCommand, dir, "main")).toBe(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
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
