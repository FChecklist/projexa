import { test, expect, type Page } from "@playwright/test"
import { signInLocally } from "./support/boq-local"
import { P1, createWorld, stubAppApis, stubSyncService, type Net } from "./support/lf-overview-stub"
import { deviceMeta } from "./support/lf-overview-harness"

// AUDIT-100 B61 + B63 (UX), real Chromium, production build:
//   B61 bright, lively colours: the install ("Preparing your PROJEXA workspace") screen and the shell header, account menu and AI buttons are
//        drawn in LIGHT surfaces and VIVID accents. Read as computed styles (what the browser really painted, after Tailwind), so a change
//        that brings back the dark header fails here. The check itself is proven able to fail: a dark header is injected and must be caught.
//   B63 phone: at 375 x 812 the page does not scroll sideways, and the project switcher, the account control, the two AI buttons and the
//        Connectors panel are all inside the screen.
//
//     bunx playwright test -c playwright.local-first.config.ts lf-lifecycle-ux
//
// Same rig as the other lf-* specs: local Auth stand-in, sync service and /api answered in the browser. Nothing reaches a real network.

type Rgb = { r: number; g: number; b: number }

/** Every colour in a CSS value (a plain colour or a gradient), resolved to sRGB by the browser itself, whatever colour space Tailwind wrote. */
async function coloursOf(page: Page, selector: string, property: "backgroundColor" | "backgroundImage" | "color" | "borderTopColor" | "borderBottomColor"): Promise<Rgb[]> {
  return page.evaluate(
    ({ selector, property }) => {
      const el = document.querySelector(selector)
      if (!el) throw new Error(`no element for ${selector}`)
      const value = (getComputedStyle(el) as unknown as Record<string, string>)[property]
      const tokens = value.match(/(rgba?|oklch|oklab|lab|lch|hsla?|color)\([^)]*\)|#[0-9a-fA-F]{3,8}\b/g) ?? []
      const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true })!
      return tokens
        .map((t) => {
          ctx.clearRect(0, 0, 1, 1)
          ctx.fillStyle = "#000000"
          ctx.fillStyle = t
          ctx.fillRect(0, 0, 1, 1)
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
          return { r, g, b, a }
        })
        .filter((c) => c.a > 0)
        .map(({ r, g, b }) => ({ r, g, b }))
    },
    { selector, property }
  )
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
const luminance = ({ r, g, b }: Rgb) => {
  const f = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}
/** HSL saturation, 0 (grey) to 1 (pure colour). */
const saturation = ({ r, g, b }: Rgb) => {
  const mx = Math.max(r, g, b) / 255
  const mn = Math.min(r, g, b) / 255
  const l = (mx + mn) / 2
  return mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1))
}
const show = (c: Rgb[]) => c.map((x) => `rgb(${x.r},${x.g},${x.b})`).join(" ")

const LIGHT = 0.75 // a surface at least this light reads as bright (the header's softest stop is 0.87, its darkest 0.89)
const VIVID = 0.5 // an accent at least this saturated reads as lively, not grey

function expectLight(label: string, colours: Rgb[]) {
  expect(colours.length, `${label}: no colour found`).toBeGreaterThan(0)
  for (const c of colours) expect(luminance(c), `${label} is too dark: ${show(colours)}`).toBeGreaterThanOrEqual(LIGHT)
}
function expectVivid(label: string, colours: Rgb[]) {
  expect(colours.length, `${label}: no colour found`).toBeGreaterThan(0)
  for (const c of colours) expect(saturation(c), `${label} is dull: ${show(colours)}`).toBeGreaterThanOrEqual(VIVID)
}

async function readHeaderColours(page: Page) {
  return {
    headerSurface: await coloursOf(page, '[data-testid="local-shell"] > header', "backgroundImage"),
    headerEdge: await coloursOf(page, '[data-testid="local-shell"] > header', "borderBottomColor"),
    brand: await coloursOf(page, '[data-testid="local-shell"] > header a[href="/"]', "color"),
    projectBorder: await coloursOf(page, '[data-testid="local-shell-project"]', "borderTopColor"),
    accountSurface: await coloursOf(page, '[data-testid="local-shell-account"] summary', "backgroundColor"),
    accountText: await coloursOf(page, '[data-testid="local-shell-account"] summary', "color"),
    connectors: await coloursOf(page, '[data-testid="local-shell-connectors"]', "backgroundColor"),
  }
}

test("bright, lively colours: the install screen, the header, the account control and the AI buttons (and the check can fail)", async ({ page, context }) => {
  const world = createWorld({ role: "manager" })
  const net: Net = { mode: "up" }
  const session = await signInLocally(context, "ux-colours@example.invalid")
  await stubSyncService(page, world, session, net)
  await stubAppApis(page, world, session)
  // AUDIT-100 A9: what the browser really sends to /api/local-first/client-error (the data-free "usage" line is one of them)
  const sentReports: Array<{ kind: string; message: string }> = []
  page.on("request", (r) => {
    if (r.method() !== "POST" || !r.url().includes("/api/local-first/client-error")) return
    try { sentReports.push(...(JSON.parse(r.postData() ?? "{}").reports ?? [])) } catch { /* not ours */ }
  })

  await test.step("the 'Preparing your PROJEXA workspace' screen is light with vivid accents", async () => {
    await page.goto("/scope")
    const prepare = page.getByTestId("workspace-prepare")
    await expect(prepare).toBeVisible({ timeout: 60_000 })
    expectLight("prepare screen background", await coloursOf(page, '[data-testid="workspace-prepare"]', "backgroundImage"))
    expectLight("prepare card", await coloursOf(page, '[data-testid="workspace-prepare"] > div', "backgroundColor"))
    expectVivid("prepare percentage", await coloursOf(page, '[data-testid="prepare-percent"]', "color"))
    expectVivid("prepare progress bar", await coloursOf(page, '[data-testid="workspace-prepare"] [role="progressbar"] > div', "backgroundImage"))
    await expect(prepare, "the screen never closed").toHaveCount(0, { timeout: 240_000 })
  })

  await test.step("the project names reach the laptop, then the shell opens", async () => {
    await expect
      .poll(() => deviceMeta(page, `shell:manifest:${session.userId}`), { timeout: 120_000, message: "the project names were never cached" })
      .toMatchObject({ projects: expect.any(Array) })
    await expect.poll(() => deviceMeta(page, "app:release"), { timeout: 240_000, message: "the release was never installed" }).toBeTruthy()
    await page.goto(`/local?projectId=${P1.id}`)
    await expect(page.getByTestId("local-shell-home")).toBeVisible({ timeout: 60_000 })
  })

  await test.step("usage numbers come from this browser: memory, storage and local-vs-network counts, no content", async () => {
    await expect
      .poll(() => sentReports.find((r) => r.kind === "usage")?.message ?? null, { timeout: 90_000, message: "no 'usage' report was ever sent by the browser" })
      .not.toBeNull()
    const usage = JSON.parse(sentReports.find((r) => r.kind === "usage")!.message) as Record<string, unknown>
    expect(Object.keys(usage).sort(), "the usage line must hold counts and sizes only").toEqual(
      ["deviceMemoryGb", "jsHeapMb", "localServed", "localServedKb", "networkKb", "networkRequests", "storageQuotaMb", "storageUsedMb", "syncRuns"]
    )
    expect(typeof usage.storageQuotaMb === "number" && (usage.storageQuotaMb as number) > 0, `storage quota not measured: ${JSON.stringify(usage)}`).toBe(true)
    for (const k of ["syncRuns", "networkRequests", "networkKb", "localServed", "localServedKb"]) expect(typeof usage[k], `${k} is not a number`).toBe("number")
    for (const k of ["jsHeapMb", "deviceMemoryGb", "storageUsedMb"]) expect(["number", "object"], `${k} is neither a number nor null`).toContain(typeof usage[k])
    expect(JSON.stringify(usage), "the usage line must carry no address or text").not.toMatch(/https?:|@|\/api\//)
  })

  await test.step("header: light gradient, vivid brand, project switcher, account control and both AI buttons", async () => {
    const c = await readHeaderColours(page)
    expectLight("header background", c.headerSurface)
    expectVivid("header edge", c.headerEdge)
    expectVivid("PROJEXA brand text", c.brand)
    expectVivid("project switcher border", c.projectBorder)
    expectLight("account control background", c.accountSurface)
    expectVivid("account control text", c.accountText)
    expectVivid("Connectors button", c.connectors)
    await expect(page.getByTestId("local-shell-ai-bar")).toHaveAttribute("data-online", "1")
    expectVivid("Copy AI prompt button", await coloursOf(page, '[data-testid="local-shell-ai-bar"] button', "backgroundColor"))
  })

  await test.step("the account menu, when opened, is light too", async () => {
    await page.getByTestId("local-shell-account").locator("summary").click()
    expectLight("account menu", await coloursOf(page, '[data-testid="local-shell-account"] > div', "backgroundColor"))
    await page.keyboard.press("Escape")
  })

  await test.step("the check can fail: with the header painted dark, the same reading is caught", async () => {
    await page.addStyleTag({ content: '[data-testid="local-shell"] > header { background-image: none !important; background-color: #0b1220 !important; }' })
    const bg = await coloursOf(page, '[data-testid="local-shell"] > header', "backgroundColor")
    expect(bg.length, "the injected dark colour was not read back").toBeGreaterThan(0)
    expect(() => expectLight("dark header", bg)).toThrow(/too dark/)
  })
})

test("phone screen (375 x 812): no sideways page scroll; switcher, account, AI buttons and the Connectors panel all fit", async ({ page, context }) => {
  const world = createWorld({ role: "manager" })
  const net: Net = { mode: "up" }
  const session = await signInLocally(context, "ux-phone@example.invalid")
  await stubSyncService(page, world, session, net)
  await stubAppApis(page, world, session)
  await page.goto("/scope")
  await expect(page.getByTestId("workspace-prepare")).toHaveCount(0, { timeout: 240_000 })
  await expect
    .poll(() => deviceMeta(page, `shell:manifest:${session.userId}`), { timeout: 120_000, message: "the project names were never cached" })
    .toMatchObject({ projects: expect.any(Array) })
  await expect.poll(() => deviceMeta(page, "app:release"), { timeout: 240_000 }).toBeTruthy()

  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto(`/local?projectId=${P1.id}`)
  await expect(page.getByTestId("local-shell-home")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId("local-shell-ai-bar")).toHaveAttribute("data-online", "1")

  const inside = async (testId: string, selector = `[data-testid="${testId}"]`) => {
    const box = await page.locator(selector).first().boundingBox()
    expect(box, `${testId} is not drawn`).not.toBeNull()
    expect(box!.x, `${testId} sticks out on the left (x=${box!.x})`).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width, `${testId} sticks out on the right (right edge ${Math.round(box!.x + box!.width)} of 375)`).toBeLessThanOrEqual(376)
  }

  await test.step("the page itself does not scroll sideways", async () => {
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }))
    expect(widths.doc, `the page is ${widths.doc}px wide on a ${widths.inner}px screen`).toBeLessThanOrEqual(widths.inner + 1)
  })

  await test.step("the header controls are all on the screen", async () => {
    await inside("local-shell-project")
    await inside("local-shell-account", '[data-testid="local-shell-account"] summary')
    await inside("local-shell-connectors")
    await inside("local-shell-ai-bar")
    await expect(page.getByRole("button", { name: "Copy AI prompt" })).toBeVisible()
    const prompt = await page.getByRole("button", { name: "Copy AI prompt" }).boundingBox()
    expect(prompt!.x + prompt!.width).toBeLessThanOrEqual(376)
  })

  await test.step("the Connectors panel opens inside the screen", async () => {
    await page.getByTestId("local-shell-connectors").click()
    await expect(page.getByTestId("local-shell-connectors-panel")).toBeVisible()
    await inside("local-shell-connectors-panel")
    const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }))
    expect(widths.doc, "opening the panel made the page scroll sideways").toBeLessThanOrEqual(widths.inner + 1)
  })

  await test.step("the account menu opens inside the screen", async () => {
    await page.getByTestId("local-shell-account").locator("summary").click()
    await inside("account menu", '[data-testid="local-shell-account"] > div')
  })
})
