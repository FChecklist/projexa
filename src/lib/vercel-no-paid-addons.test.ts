// AUDIT-100 rows A3 / B59 (cost): Vercel must stay a plain production host, never a metered add-on.
//
// Why this exists: on 2026-09-17 "Speed Insights Plus" was switched on by mistake and billed about $0.65 a day until it was switched
// off again (read-only Vercel billing, days 2026-09-19 .. 2026-09-25). The owner's rule is a $20/month ceiling and "never enable a
// Vercel add-on without a yes". The dashboard toggle cannot be seen from the repo, but the CODE side of every Vercel add-on can: each
// one needs an npm package or a config key. This test fails the moment any of them appears, so an add-on cannot be re-enabled by a
// code change (including a dependency bump bot) without somebody seeing a red build first.
//
// Run: bun test --isolate src/lib/vercel-no-paid-addons.test.ts
import { describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "..")

/** npm packages that switch on (or feed) a Vercel billed feature. */
const PAID_ADDON_PACKAGES = [
  "@vercel/speed-insights", // Speed Insights (billed per data point on Pro)
  "@vercel/analytics", // Web Analytics
  "@vercel/otel", // Observability Plus traces
  "@vercel/flags", // Flags / Edge Config reads
  "@vercel/edge-config",
  "@vercel/kv",
  "@vercel/postgres",
  "@vercel/blob",
  "@vercel/toolbar",
]

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(root, rel), "utf8"))
}

/** Lines under src/ (tracked by git, tests excluded) that mention any add-on package; one git grep is far faster than walking the tree. */
function mentions(packages: string[]): string[] {
  const args = ["git", "grep", "-n", "-F", ...packages.flatMap((p) => ["-e", p]), "--", "src", ":!*.test.ts", ":!*.test.tsx"]
  const proc = Bun.spawnSync(args, { cwd: root })
  return new TextDecoder().decode(proc.stdout).split(/\r\n|\n/).filter(Boolean)
}

describe("Vercel stays a plain host (no paid add-on can be switched on from code)", () => {
  test("package.json depends on no Vercel add-on package", () => {
    const pkg = readJson("package.json") as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const all = { ...pkg.dependencies, ...pkg.devDependencies }
    const present = PAID_ADDON_PACKAGES.filter((p) => p in all)
    expect(present, `paid Vercel add-on package(s) in package.json: ${present.join(", ")}`).toEqual([])
  })

  test("no source file mentions a Vercel add-on package", () => {
    expect(mentions(PAID_ADDON_PACKAGES)).toEqual([])
  }, 60_000)

  test("vercel.json has no cron jobs, no function-duration overrides and no analytics keys (each one bills)", () => {
    const v = readJson("vercel.json")
    for (const key of ["crons", "functions", "analytics", "speedInsights", "webAnalytics", "observability"]) {
      expect(key in v, `vercel.json has a "${key}" key`).toBe(false)
    }
  })

  test("next.config does not turn on a metered Vercel feature", () => {
    const path = existsSync(join(root, "next.config.ts")) ? "next.config.ts" : "next.config.mjs"
    const text = readFileSync(join(root, path), "utf8")
    expect(text).not.toMatch(/speedInsights|webAnalytics|@vercel\/analytics|@vercel\/speed-insights/)
  })

  test("only the main branch can build: every other branch is skipped by the ignore command", () => {
    const v = readJson("vercel.json") as { ignoreCommand?: string }
    // The behaviour of this command against real git diffs is proven in vercel-lockdown.test.ts; here we pin the cost-relevant part.
    expect(v.ignoreCommand ?? "").toContain('"$VERCEL_GIT_COMMIT_REF" != "main" ] && exit 0')
  })
})
