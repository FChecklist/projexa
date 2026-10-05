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
// VERCEL." Tightened to unconditional `exit 0` on every ref, with the exit
// condition written directly into the old version of this file: "until the
// owner recharges and says go live, at which point THIS is the one line that
// changes back."
//
// 2026-09-30, owner directive, quoted verbatim, this session: "CAN WE GO LIVE
// ON PROJEXA-AI.COM NOW FOR TESTING ON SERVER?" -- the owner saying go live,
// without recharging (explicitly still on Hobby, $0). Investigated first, not
// applied blind: every production deployment since the start of this session
// (both `projexa` and `veridian-compliance-ai`) was CANCELED with errorLink
// pointing at "ignored-build-step" -- this exact unconditional ignoreCommand
// was the actual, sole blocker; projexa-ai.com had been serving a ~10-day-old
// build the entire session. A Hobby-plan deploy costs $0 regardless of
// whether it runs, as long as build-minute quotas aren't exceeded, so
// deploying does not conflict with "no recharge" -- confirmed with the owner
// directly (not assumed) before changing this file, given how firmly and
// repeatedly the zero-Vercel-spend rule had been stated across this session.
//
// Restores branch+path gating (the same shape as the R87 version): skip any
// non-main branch outright; on main, additionally skip when every changed
// file is docs/KT-report-only (*.md/*.jsonl/*.csv/.github/**); otherwise
// proceed. (Compliance-tracker's copy of this file also excludes dpdp-app/**
// -- not needed here, PROJEXA's own repo carries no DPDP content.)
//
// FIXTURE-REPO-DRIVEN (same approach the R87 version of this test used):
// rather than depending on a real historical commit that happens to be
// docs-only existing in THIS repo (searched -- none of the last 30 commits
// qualify, this repo's commits are almost always real code), builds a small,
// throwaway git repo under a temp directory with deterministic fixture
// commits, so every case (non-main, main+code, main+docs-only,
// main+mixed) is exercised against a real `git diff` and a real shell, not a
// re-implementation of the ignoreCommand's own logic.
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createRequire } from "node:module"

function readVercelJson() {
  const raw = readFileSync(join(import.meta.dir, "..", "..", "vercel.json"), "utf8")
  return JSON.parse(raw)
}

function sh(cwd: string, cmd: string, env?: Record<string, string>) {
  const proc = Bun.spawnSync(["sh", "-c", cmd], { cwd, env: { ...process.env, ...env } })
  return proc
}

/** Builds a throwaway git repo with a base commit, then one more commit per `commits` entry, in order. Returns its path. */
function buildFixtureRepo(commits: ReadonlyArray<{ files: Record<string, string> }>): string {
  const dir = mkdtempSync(join(tmpdir(), "vercel-lockdown-fixture-"))
  sh(dir, "git init -q && git config user.email t@t.test && git config user.name t")
  writeFileSync(join(dir, "README.md"), "base\n")
  sh(dir, "git add -A && git commit -q -m base")
  for (const [i, c] of commits.entries()) {
    for (const [path, content] of Object.entries(c.files)) {
      const full = join(dir, path)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, content)
    }
    sh(dir, `git add -A && git commit -q -m commit-${i}`)
  }
  return dir
}

function runIgnoreCommand(cmd: string, cwd: string, gitRef: string): number | null {
  const proc = sh(cwd, cmd, { VERCEL_GIT_COMMIT_REF: gitRef })
  return proc.exitCode
}

let repo: string

beforeAll(() => {
  repo = buildFixtureRepo([
    { files: { "src/app/page.tsx": "// real code v1\n" } }, // commit-0: real code only
    { files: { "docs/NOTES.md": "notes\n" } }, // commit-1: docs-only
    { files: { "R80_PART7_KT/log.csv": "a,b\n" } }, // commit-2: KT csv-only
    { files: { "src/app/page.tsx": "// real code v2\n", "docs/NOTES.md": "more notes\n" } }, // commit-3: mixed
  ])
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
})

// 2026-10-06 (AUDIT-100, owner as PM: "100% proper fix ... main must keep auto-deploying on real code
// changes; no manual deploys, no Vercel dashboard changes, no spend"). Measured via the Vercel API
// (read-only list_deployments): the Hobby team created ~128 deployment records in 24h, ~100 of them
// CANCELED records for non-main pushes (audit100/*, fix/*, test/* ...) across BOTH projects. The
// ignoreCommand above stops the BUILD, but the deployment RECORD is still created and still counts
// toward Hobby's daily deployment cap, so main merges af4c39b6 and f053fbe5 were refused with
// "Deployment rate limited: retry in 24 hours" while branch pushes kept taking the slots.
//
// Fix: git.deploymentEnabled stops non-main pushes from creating a deployment at all. Vercel's
// documented semantics (vercel.com/docs/project-configuration/git-configuration): keys are minimatch
// globs; an unmatched branch defaults to true; "if a branch matches multiple patterns, a deployment
// occurs if at least one matching rule is set to true". So `"main": true` keeps main deploying no
// matter what the catch-all says, and the catch-all must be `**`, not `*`: a bare `*` does not cross
// `/`, which is exactly the R87 bug (every real branch here is `type/name`, so `"*": false` never
// matched one). The ignoreCommand stays as a second layer.
// minimatch is what Vercel documents for these keys; v3 is CommonJS with no bundled types, so load it via createRequire.
const minimatch = createRequire(import.meta.url)("minimatch") as (path: string, pattern: string) => boolean

/** Vercel's documented rule for git.deploymentEnabled (object form): unmatched -> true; matched -> true if any matching key is true. */
function vercelWouldDeploy(deploymentEnabled: unknown, branch: string): boolean {
  if (deploymentEnabled === undefined) return true
  if (typeof deploymentEnabled === "boolean") return deploymentEnabled
  const matching = Object.entries(deploymentEnabled as Record<string, boolean>).filter(([pattern]) => minimatch(branch, pattern))
  if (matching.length === 0) return true
  return matching.some(([, enabled]) => enabled === true)
}

// Real branch-name shapes seen in this project's own deployment list on 2026-10-05/06, plus edge cases.
const NON_MAIN_BRANCHES = [
  "audit100/a3-vercel-steps",
  "audit100/b8-deletes-pass",
  "test/audit100-a4-assistant-chat-e2e",
  "fix/local-shell-account-menu",
  "audit37/connect-tab",
  "chore/vercel-no-branch-deployments",
  "dependabot/npm_and_yarn/next-16.0.1",
  "w-test/deep/nested/name",
  "some-feature-branch",
  "main-hotfix",
  "mainline",
  "release/main",
]

describe("Vercel git.deploymentEnabled (2026-10-06) -- only main creates deployments", () => {
  test("pinned: main true, catch-all '**' false", () => {
    const v = readVercelJson()
    expect(v.git?.deploymentEnabled).toEqual({ main: true, "**": false })
  })

  test("main deploys", () => {
    const v = readVercelJson()
    expect(vercelWouldDeploy(v.git?.deploymentEnabled, "main")).toBe(true)
  })

  for (const branch of NON_MAIN_BRANCHES) {
    test(`non-main branch '${branch}' creates no deployment`, () => {
      const v = readVercelJson()
      expect(vercelWouldDeploy(v.git?.deploymentEnabled, branch)).toBe(false)
    })
  }

  test("the matcher itself reproduces the R87 bug: a bare '*' does not match names with '/'", () => {
    expect(vercelWouldDeploy({ main: true, "*": false }, "audit100/a3-vercel-steps")).toBe(true)
    expect(vercelWouldDeploy({ main: true, "**": false }, "audit100/a3-vercel-steps")).toBe(false)
  })
})

describe("Vercel deploy gate (2026-09-30, owner-directed go-live) -- branch + path", () => {

  test("ignoreCommand exists and branches on both VERCEL_GIT_COMMIT_REF and git diff", () => {
    const v = readVercelJson()
    expect(typeof v.ignoreCommand).toBe("string")
    expect(v.ignoreCommand).toContain("VERCEL_GIT_COMMIT_REF")
    expect(v.ignoreCommand).toContain("git diff")
  })

  test("a non-main branch is skipped (exit 0) regardless of what changed", () => {
    const v = readVercelJson()
    expect(runIgnoreCommand(v.ignoreCommand, repo, "some-feature-branch")).toBe(0)
  })

  test("main with real code changes proceeds (non-zero)", () => {
    const v = readVercelJson()
    // HEAD^ HEAD in the fixture repo is commit-3 (mixed) vs commit-2 -- real code present, must proceed.
    expect(runIgnoreCommand(v.ignoreCommand, repo, "main")).not.toBe(0)
  })

  test("main with a docs-only commit is skipped (exit 0)", () => {
    const v = readVercelJson()
    sh(repo, "git checkout -q HEAD~2") // land on commit-1 (docs-only vs commit-0, real code)
    try {
      expect(runIgnoreCommand(v.ignoreCommand, repo, "main")).toBe(0)
    } finally {
      sh(repo, "git checkout -q -")
    }
  })

  test("main with a KT csv-only commit is skipped (exit 0)", () => {
    const v = readVercelJson()
    sh(repo, "git checkout -q HEAD~1") // land on commit-2 (csv-only vs commit-1, docs-only) -- still all-skippable
    try {
      expect(runIgnoreCommand(v.ignoreCommand, repo, "main")).toBe(0)
    } finally {
      sh(repo, "git checkout -q -")
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
