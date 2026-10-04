import { test, expect, type Page } from "@playwright/test"
import { goOffline, goOnline, noCrashText, prepareLaptop, watchConsole } from "./support/lf-overview-harness"
import { P1, P2, createWorld } from "./support/lf-overview-stub"

// LOCAL-FIRST overview (package lf-e10c): the on-laptop SHELL itself, offline, in real Chromium -- every entry of its module list opens a
// screen or (for a screen not on the laptop yet) says so calmly; every analysis hub entry does the same; deep links survive a reload with
// no network; the browser's Back and Forward work inside the shell; an unknown address never crashes, and while online it is handed to
// the server's own page. Production build; everything answered in the browser (e2e/support/lf-overview-stub.ts).

test.use({ timezoneId: "UTC" })

/** What is drawn in <main> once the screen settled: a screen's root test id and its data-state, or the calm fallback. */
async function settled(page: Page): Promise<{ testId: string | null; state: string | null }> {
  const first = () =>
    page.evaluate(() => {
      const el = document.querySelector("main [data-testid]")
      return el ? { testId: el.getAttribute("data-testid"), state: el.getAttribute("data-state") } : { testId: null, state: null }
    })
  // the shell draws a skeleton (no <main>), then "LoadingÃ¢â‚¬Â¦" inside <main>, then the screen
  await expect.poll(async () => (await first()).testId, { timeout: 30_000, message: "the screen never finished loading" }).not.toMatch(/^(local-shell-loading)?$/)
  // a screen that reads more than one thing can settle in steps: take it once it stopped changing
  let last = await first()
  for (let i = 0; i < 10; i += 1) {
    await page.waitForTimeout(150)
    const now = await first()
    if (now.testId === last.testId && now.state === last.state) break
    last = now
  }
  return last
}

test("offline: every module of the shell's list and every analysis entry opens (or says calmly it is not on this laptop); deep links, Back/Forward and unknown addresses never crash", async ({ page, context }) => {
  const consoleWatch = watchConsole(page)
  const world = createWorld({ role: "manager" })
  const prepared = await prepareLaptop(page, context, world)
  await goOffline(context, prepared)

  await page.goto(`/local?projectId=${P1.id}`)
  await expect(page.getByTestId("local-shell-home")).toContainText("2 projects are saved on this laptop.")
  const nav = page.getByRole("navigation", { name: "Modules" })
  const entries = await nav.getByRole("link").evaluateAll((links) => links.map((a) => ({ label: (a.textContent ?? "").trim(), href: a.getAttribute("href") ?? "" })))
  // the list is the route table's, Dashboard first (nav order 0); every overview entry is in it
  expect(entries[0]).toEqual({ label: "Dashboard", href: "/dashboard" })
  for (const label of ["Reports", "Analysis", "Scope (BOQ)"]) expect(entries.map((e) => e.label)).toContain(label)

  const seen: Array<{ label: string; href: string; testId: string | null; state: string | null }> = []
  await test.step("each module entry, clicked in the shell (no page load), opens without an error", async () => {
    for (const entry of entries) {
      await nav.getByRole("link", { name: entry.label, exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`/local${entry.href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\?|$)`))
      const drawn = await settled(page)
      seen.push({ ...entry, ...drawn })
      expect(drawn.testId, `${entry.label} drew nothing recognisable`).not.toBeNull()
      expect(drawn.testId, `${entry.label} could not be read from the laptop`).not.toBe("local-shell-error")
      await noCrashText(page)
    }
    console.log(`shell modules offline: ${JSON.stringify(seen.map((s) => `${s.label} -> ${s.testId}${s.state ? `[${s.state}]` : ""}`))}`)
  })

  await test.step("each module's address, opened directly with a reload (a deep link), opens the same screen offline", async () => {
    for (const s of seen) {
      await page.goto(`${s.href}?projectId=${P1.id}`)
      const drawn = await settled(page)
      expect(drawn.testId, `deep link ${s.href}`).toBe(s.testId)
      await noCrashText(page)
    }
  })

  await test.step("each analysis hub entry opens a screen of the shell or the calm 'not on this laptop yet'", async () => {
    await page.goto(`/analysis?projectId=${P1.id}`)
    await expect(page.getByTestId("overview-analysis")).toContainText(`Every screen below is scoped to ${P1.name}.`)
    const hub = page.getByTestId("overview-analysis-entry").getByRole("link")
    const links = await hub.evaluateAll((as) => as.map((a) => ({ label: (a.textContent ?? "").trim(), href: a.getAttribute("href") ?? "" })))
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      // the selected project travels with every entry
      expect(link.href, `${link.label} lost the project`).toContain(`projectId=${P1.id}`)
      await page.goto(`/analysis?projectId=${P1.id}`)
      await page.getByTestId("overview-analysis-entry").getByRole("link", { name: link.label, exact: true }).click()
      const drawn = await settled(page)
      expect(drawn.testId, `${link.label} (${link.href})`).not.toBe("local-shell-error")
      if (drawn.testId === "local-shell-not-here") {
        await expect(page.getByTestId("local-shell-not-here")).toHaveAttribute("data-online", "0")
        await expect(page.getByTestId("local-shell-not-here")).toContainText("This screen is not saved on this laptop yet. It will open when you are connected.")
      }
      await noCrashText(page)
    }
  })

  await test.step("Back and Forward move between shell screens offline, each drawn with its own figures", async () => {
    await page.goto(`/local/dashboard?projectId=${P2.id}`)
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Dashboard / ${P2.name}`)
    await nav.getByRole("link", { name: "Reports", exact: true }).click()
    await expect(page.getByTestId("overview-reports")).toBeVisible()
    await nav.getByRole("link", { name: "Analysis", exact: true }).click()
    await expect(page.getByTestId("overview-analysis")).toBeVisible()
    await page.goBack()
    await expect(page.getByTestId("overview-reports")).toBeVisible()
    await page.goBack()
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Dashboard / ${P2.name}`)
    await expect(page.getByTestId("overview-fact-tasks")).toContainText(`Not finished: ${world.current(P2.id, "tasks").length}`)
    await page.goForward()
    await expect(page.getByTestId("overview-reports")).toBeVisible()
    await page.goForward()
    await expect(page.getByTestId("overview-analysis")).toBeVisible()
    await noCrashText(page)
  })

  await test.step("an unknown address offline: the calm fallback, with a way back, never a crash", async () => {
    await page.goto("/no-such-module/abc?projectId=x")
    await expect(page.getByTestId("local-shell-not-here")).toHaveAttribute("data-online", "0")
    await expect(page.getByRole("link", { name: "Back to PROJEXA on this laptop" })).toBeVisible()
    await noCrashText(page)
    await page.getByRole("link", { name: "Back to PROJEXA on this laptop" }).click()
    await expect(page.getByTestId("local-shell-home")).toBeVisible()
  })

  await test.step("a real page the shell does not carry (Payroll: deliberately not synced to the laptop): calm offline; online, handed to the server's own page", async () => {
    await page.goto(`/local/payroll?projectId=${P1.id}`)
    await expect(page.getByTestId("local-shell-not-here")).toHaveAttribute("data-online", "0")
    // the calm page that is still open opens the server's own page by itself as soon as the laptop is back online (no click, no reload)
    await goOnline(context, prepared)
    await expect(page).toHaveURL(new RegExp(`/payroll\\?projectId=${P1.id}&px-server=1$`), { timeout: 30_000 })
  })

  consoleWatch.check("while navigating the shell")
})
