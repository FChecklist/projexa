/// <reference types="bun-types" />
// Sumeet R-96: "Scope of work in a project must be a real, usable concept in
// PROJEXA." Product design: one record, one screen -- the BOQ IS the Scope of
// Work. This pins the user-visible half: every state of /scope names itself
// "Scope of Work (BOQ)", and /scope is reachable from the nav. A static check
// of the page source (no browser), so it is the unit-level guard; the
// real-browser reach is covered by e2e/*scope*.
import { describe, test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { MODULE_CATALOGUE } from "@/lib/module-catalogue"

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8")

describe("R-96 Scope of Work is a named, reachable screen", () => {
  const page = read("src/app/(app)/scope/page.tsx")

  test("every heading on /scope calls itself Scope of Work (BOQ)", () => {
    const headings = page.match(/<PageHeading title="[^"]*"/g) ?? []
    expect(headings.length).toBeGreaterThanOrEqual(4)
    for (const h of headings) expect(h).toContain("Scope of Work (BOQ)")
  })

  test("the list offers a Scope of Work tab", () => {
    expect(page).toContain('"Scope of Work"')
  })

  test("/scope is registered as an app route", () => {
    expect(MODULE_CATALOGUE.some((m) => m.id === "scope")).toBe(true)
  })
})
