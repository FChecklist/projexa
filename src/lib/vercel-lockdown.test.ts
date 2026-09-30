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

describe("Vercel deploy gate (2026-09-30, owner-directed go-live) -- branch + path", () => {
  test("git.deploymentEnabled is not relied upon (still gone since R87)", () => {
    const v = readVercelJson()
    expect(v.git).toBeUndefined()
  })

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
