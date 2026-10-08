/// <reference types="bun-types" />
// P3a: the BOQ list read weight. Run: bun test --isolate src/lib/scope-list-reads.test.ts
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { readCurrentBoqLines, readScopeHeaders, scopeHeadersUrl } from "./scope-list-reads"
import { primaryListUrl } from "./module-prefetch"

function fakeFetcher(responses: Record<string, unknown>) {
  const calls: string[] = []
  const fetcher = async <T,>(url: string): Promise<T> => {
    calls.push(url)
    if (!(url in responses)) throw new Error(`unexpected ${url}`)
    return responses[url] as T
  }
  return { calls, fetcher }
}

describe("scope list reads", () => {
  test("headers URL asks for include=headers", () => {
    expect(scopeHeadersUrl("p 1")).toBe("/api/scope?projectId=p%201&include=headers")
  })

  test("readScopeHeaders sends include=headers", async () => {
    const { calls, fetcher } = fakeFetcher({ [scopeHeadersUrl("p1")]: { boqs: [] } })
    await readScopeHeaders("p1", fetcher)
    expect(calls).toEqual(["/api/scope?projectId=p1&include=headers"])
  })

  test("current-BOQ lines: headers first, then ONLY the picked BOQ (approved beats a higher draft)", async () => {
    const { calls, fetcher } = fakeFetcher({
      [scopeHeadersUrl("p1")]: { boqs: [
        { id: "b1", version: 1, status: "approved" },
        { id: "b2", version: 2, status: "draft" },
      ] },
      "/api/scope/b1": { lineItems: [{ id: "l1" }, { id: "l2" }] },
    })
    const lines = await readCurrentBoqLines<{ id: string }>("p1", fetcher)
    expect(lines.map((l) => l.id)).toEqual(["l1", "l2"])
    expect(calls).toEqual(["/api/scope?projectId=p1&include=headers", "/api/scope/b1"])
  })

  test("a project with no BOQ costs one request and yields no lines", async () => {
    const { calls, fetcher } = fakeFetcher({ [scopeHeadersUrl("p1")]: { boqs: [] } })
    expect(await readCurrentBoqLines("p1", fetcher)).toEqual([])
    expect(calls.length).toBe(1)
  })

  test("the module prefetch asks for exactly what the Scope screen asks for", () => {
    expect(primaryListUrl("/scope", "p1")).toBe("/api/scope?projectId=p1&include=variation,headers")
  })
})

// Caller guards: each screen must reach the list through the headers-only helpers, never a bare /api/scope?projectId= read.
const root = join(import.meta.dir, "..")
const read = (p: string) => readFileSync(join(root, p), "utf8")
const callers: Array<[string, RegExp]> = [
  ["components/MaterialIssueCreateClient.tsx", /readCurrentBoqLines</],
  ["components/ScheduleTaskCreateClient.tsx", /readCurrentBoqLines</],
  ["components/ScopeCompareClient.tsx", /readScopeHeaders</],
  ["components/ScopeImportClient.tsx", /readScopeHeaders</],
  ["components/WorkProgressFormClient.tsx", /readScopeHeaders</],
  ["lib/boq-read-source.ts", /scopeHeadersUrl\(projectId\)/],
]
describe("callers stay on the light read", () => {
  for (const [file, uses] of callers) {
    test(file, () => {
      const src = read(file)
      expect(src).toMatch(uses)
      expect(src).not.toMatch(/`\/api\/scope\?projectId=\$\{[^}]*\}`/)
    })
  }
})
