import { test, expect } from "@playwright/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prepareLaptop, noCrashText } from "./support/lf-overview-harness"
import { P1, createWorld } from "./support/lf-overview-stub"
import { apiRoutes, countByDest, leftTheLaptop, routeKey, trackTraffic, type Seen } from "./support/lf-vercel-budget"

// AUDIT-100 A2 + A3 (server functions moved off Vercel; Vercel used as little as possible), MEASURED in a real Chromium on a production build.
//
//     bunx playwright test -c playwright.local-first.fast.config.ts lf-lifecycle-vercel-budget      (fast rig, see scripts/lf-fast-rig.sh)
//
// What is counted is what the BROWSER sent, per destination (e2e/support/lf-vercel-budget.ts): the app origin /api/** (a Vercel function in
// production), the app origin pages, static files, and the Supabase Edge Function. A page request the service worker answered from the laptop's own copy
// never left the laptop. The documented list is ai-os/audit37/vercel-route-inventory.json (every route, why it is still on Vercel, and the short
// allow-lists below); the unit test src/lib/vercel-route-inventory.test.ts keeps that file equal to the code.
//
// MEASURED 2026-10-05 (rig, manager role, 2 projects, 25 module entries): first install = 5 /api calls (the legacy page's top bar x3, usage beacon x2);
// a daily walk of every shell module (click + deep link) = 0 app pages, 0 static files and 0 /api calls except one dashboard snapshot per Dashboard
// open and the data-free usage beacon; the rest goes to the Supabase Edge Function (about 3 requests per page load).

type Inventory = {
  routes: { route: string; served_by?: string }[]
  install_phase_api_allowlist: string[]
  daily_use_api_allowlist: string[]
  daily_use_api_allowlist_production: string[]
}
const inventory: Inventory = JSON.parse(readFileSync(join(process.cwd(), "ai-os", "audit37", "vercel-route-inventory.json"), "utf8"))

const norm = (s: string) => s.replace(/:[A-Za-z*]+/g, ":p")
const inInventory = (key: string) => inventory.routes.some((r) => norm(r.route) === norm(key.split(" ")[1]!))

/** The /api calls of a window that are not in the allow-list (an empty list is the pass). */
function apiViolations(seen: Seen[], allowed: string[]): string[] {
  return Object.keys(apiRoutes(leftTheLaptop(seen))).filter((k) => !allowed.map(norm).includes(norm(k)))
}

const BEACON = "POST /api/local-first/client-error"

// AUDIT-100 A2: on the production origins (projexa-ai.com) src/lib/px-api.ts sends the edge-served routes to the Supabase Edge Function projexa-api;
// this rig runs on localhost, where the switch keeps them same-origin, so the rig still SEES them as /api calls. What production sends to Vercel is
// therefore the rig's /api calls minus the edge-served routes, and that must stay inside daily_use_api_allowlist_production (the beacon only).
const EDGE_SERVED = inventory.routes.filter((r) => r.served_by === "edge:projexa-api").map((r) => norm(r.route))
function productionVercelViolations(seen: Seen[]): string[] {
  const onVercel = Object.keys(apiRoutes(leftTheLaptop(seen))).filter((k) => !EDGE_SERVED.includes(norm(k.split(" ")[1]!)))
  return onVercel.filter((k) => !inventory.daily_use_api_allowlist_production.map(norm).includes(norm(k)))
}

test.use({ timezoneId: "UTC" })

test("A2/A3: after the one-time install, a daily walk of every shell module (online) stays off Vercel; every remaining /api call is named in the inventory", async ({ page, context }) => {
  test.setTimeout(420_000)
  const world = createWorld({ role: "manager" })
  const traffic = trackTraffic(context)

  const installWindow = traffic.mark()
  await prepareLaptop(page, context, world)
  await page.waitForTimeout(2_500)
  const install = installWindow()
  const installLeft = leftTheLaptop(install)

  await test.step("the first install: its /api calls are the legacy page's top bar and the usage beacon, all named", async () => {
    const routes = apiRoutes(installLeft)
    console.log(`A2 install: ${JSON.stringify(countByDest(installLeft))} api=${JSON.stringify(routes)}`)
    expect(apiViolations(install, inventory.install_phase_api_allowlist), "an /api call during the install that the inventory does not name").toEqual([])
    expect(countByDest(installLeft)["vercel-api"], "the install made more /api calls than the budget (8)").toBeLessThanOrEqual(8)
    for (const key of Object.keys(routes)) expect(inInventory(key), `${key} is not a route of the inventory`).toBe(true)
  })

  await page.goto(`/local?projectId=${P1.id}`)
  await expect(page.getByTestId("local-shell-home")).toBeVisible({ timeout: 30_000 })
  const nav = page.getByRole("navigation", { name: "Modules" })
  const entries = await nav.getByRole("link").evaluateAll((links) => links.map((a) => ({ label: (a.textContent ?? "").trim(), href: a.getAttribute("href") ?? "" })))
  expect(entries.length, "the module list is empty").toBeGreaterThan(20)

  const clicks: Seen[] = []
  const perEntry: Record<string, string[]> = {}
  await test.step("every module entry, clicked inside the shell: no app page, no static file, and /api only for the Dashboard's own snapshot", async () => {
    for (const e of entries) {
      const win = traffic.mark()
      await nav.getByRole("link", { name: e.label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/local${e.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?|$)`))
      await page.waitForTimeout(700)
      await noCrashText(page)
      const seen = win()
      clicks.push(...seen)
      perEntry[e.label] = Object.keys(apiRoutes(leftTheLaptop(seen))).filter((k) => k !== BEACON)
    }
    for (const [label, calls] of Object.entries(perEntry)) {
      if (label === "Dashboard") continue
      expect(calls, `${label} called Vercel`).toEqual([])
    }
    const left = leftTheLaptop(clicks)
    expect(countByDest(left)["vercel-page"], "a module click loaded an app page from the server").toBe(0)
    expect(countByDest(left)["vercel-static"], "a module click downloaded a static file the laptop should hold").toBe(0)
    expect(apiViolations(clicks, inventory.daily_use_api_allowlist)).toEqual([])
    expect(productionVercelViolations(clicks), "A2: in production these would still reach Vercel").toEqual([])
    expect(countByDest(left)["edge-sync"], "module clicks asked the sync service more than the budget (12)").toBeLessThanOrEqual(12)
    console.log(`A2 clicks x${entries.length}: ${JSON.stringify(countByDest(left))} api=${JSON.stringify(apiRoutes(left))}`)
  })

  await test.step("every module opened by its address (a fresh page load): served from the laptop, a few sync calls each, no /api beyond the list", async () => {
    const win = traffic.mark()
    for (const e of entries) {
      await page.goto(`${e.href}?projectId=${P1.id}`)
      await expect(page.locator("main").first()).toBeVisible({ timeout: 30_000 })
      await page.waitForTimeout(500)
    }
    const seen = win()
    const left = leftTheLaptop(seen)
    const c = countByDest(left)
    console.log(`A2 deep links x${entries.length}: all=${JSON.stringify(countByDest(seen))} left=${JSON.stringify(c)} api=${JSON.stringify(apiRoutes(left))}`)
    expect(c["vercel-page"], "a fresh load fetched an app page from the server").toBe(0)
    expect(c["vercel-static"], "a fresh load fetched static files from the server").toBe(0)
    expect(apiViolations(seen, inventory.daily_use_api_allowlist), "an /api call outside the documented list").toEqual([])
    expect(productionVercelViolations(seen), "A2: in production these would still reach Vercel").toEqual([])
    expect(c["vercel-api"], "more /api calls than the budget (6) for a full walk").toBeLessThanOrEqual(6)
    expect(c["edge-sync"] / entries.length, "sync requests per page load above the budget (5)").toBeLessThanOrEqual(5)
    expect(c["edge-other"] + c.other, "the laptop talked to a host nobody named").toBe(0)
    for (const key of Object.keys(apiRoutes(left))) expect(inInventory(key), `${key} is not a route of the inventory`).toBe(true)
  })

  traffic.stop()
})

test("the measuring can fail: a call to Vercel that nobody named is caught as a violation, and a page fetch of an app route is counted as leaving the laptop", async ({ page, context }) => {
  const world = createWorld({ role: "manager" })
  const traffic = trackTraffic(context)
  await prepareLaptop(page, context, world)
  await page.goto(`/local?projectId=${P1.id}`)
  await expect(page.getByTestId("local-shell-home")).toBeVisible({ timeout: 30_000 })
  const win = traffic.mark()
  // an unnamed API call and an unnamed page, as a careless change to a shell screen would add
  await page.evaluate(() => Promise.allSettled([fetch("/api/zz-budget-probe?x=1"), fetch("/zz-budget-probe-page")]))
  await page.waitForTimeout(500)
  const seen = win()
  const violations = apiViolations(seen, inventory.daily_use_api_allowlist)
  expect(violations, "the unnamed /api call was not caught").toContain("GET /api/zz-budget-probe")
  expect(seen.some((s) => s.path === "/zz-budget-probe-page" && s.dest === "vercel-page"), "the unnamed page request was not seen as an app page").toBe(true)
  expect(routeKey("/api/dashboard/project/ov-p1-harbor")).toBe("/api/dashboard/project/:id")
  expect(inInventory("GET /api/zz-budget-probe")).toBe(false)
  // A2: the dashboard snapshot is edge-served (not a production Vercel call); the unnamed probe still is one
  expect(productionVercelViolations(seen)).toContain("GET /api/zz-budget-probe")
  expect(EDGE_SERVED).toContain(norm("/api/dashboard/project/:projectId"))
  traffic.stop()
})
