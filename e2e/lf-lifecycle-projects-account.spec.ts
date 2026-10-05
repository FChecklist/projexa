import { test, expect, chromium, type BrowserContext, type Page } from "@playwright/test"
import { APP_ORIGIN, stubAppApis as stubLifecycleApis } from "./support/boq-local"
import { P1, P2, createWorld } from "./support/lf-overview-stub"
import { deviceMeta, personMeta, prepareLaptop as prepareOverviewLaptop, switcherNames } from "./support/lf-overview-harness"
import { fixtureOf, makePerson, newWorld, signIn, stubSyncService as stubLifecycleSync } from "./support/lf-lifecycle-stub"

// AUDIT-100 B2, B3, B9, B10, B11: the laptop shell's project dropdown (and a project made from it), its account menu, and the one-time
// install screen, in real Chromium.
// Production build, local Auth stand-in, sync service and /api answered inside the browser (e2e/support/lf-overview-stub.ts and
// lf-lifecycle-stub.ts). Nothing reaches Vercel, Supabase or any real network; every identity is a placeholder (lf-b1-*@example.invalid).
//
//     bunx playwright test -c playwright.local-first.config.ts lf-lifecycle-projects-account
//
//   B9  '+ New project' in the shell's project dropdown opens the new-project page (/projects/new), from the laptop shell (/local).
//   B10 a project made there persists: the page sends exactly the typed values to /api/projects (answered by the stub, which then lists the
//       project like the server does), the laptop's own copy (IndexedDB sync:manifest) learns it by itself, and after a reload the dropdown
//       offers it BY NAME (it said "Project <id>" for up to a day before the fix in replica.ts/context.ts), chosen and kept across a reload.
//       The page's product list is read on the SERVER, so e2e/support/fake-veridian-server.mjs answers that one read.
//   B11 the signed-in email is at the top right of the shell header with a menu: on a desktop and on a 375 px phone the menu opens inside
//       the screen; Sign out ends the session (the login cookie and the laptop's identity are gone, the shell no longer opens, a server
//       page sends the person to sign in) and keeps this laptop's copy (the default).
//   B2  'Preparing your PROJEXA workspace' shows ONCE, on the first install: a watcher in the page counts every time the screen is drawn,
//       across loads, so even a flash the assertions would miss is counted.
//   B3  a refresh never shows it again: three refreshes, other pages, and a RESTART of the browser on the same profile
//       (launchPersistentContext on one user-data folder: the same laptop, the browser closed and opened again).

const PREPARE_COUNTER = "__e2e_prepare_drawn"

/** Counts, in localStorage (it survives reloads and a browser restart on the same profile), every time the prepare screen appears. */
const COUNT_PREPARE_SCREEN = (key: string) => {
  let present = false
  const look = () => {
    const now = document.querySelector('[data-testid="workspace-prepare"]') !== null
    if (now && !present) {
      try { localStorage.setItem(key, String(Number(localStorage.getItem(key) ?? 0) + 1)) } catch { /* storage blocked */ }
    }
    present = now
  }
  new MutationObserver(look).observe(document, { childList: true, subtree: true })
}

const timesDrawn = (page: Page) => page.evaluate((k) => Number(localStorage.getItem(k) ?? 0), PREPARE_COUNTER)

async function openShell(page: Page, path = `/local?projectId=${P1.id}`) {
  await page.goto(path)
  await expect(page.getByTestId("local-shell")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId("local-shell-project")).toBeVisible()
}

/** The element's box is inside the viewport on both sides (1 px of rounding allowed). */
async function expectInside(page: Page, label: string, selector: string) {
  const vw = page.viewportSize()!.width
  const box = await page.locator(selector).first().boundingBox()
  expect(box, `${label} is not drawn`).not.toBeNull()
  expect(box!.x, `${label} sticks out on the left (x=${box!.x})`).toBeGreaterThanOrEqual(-1)
  expect(box!.x + box!.width, `${label} sticks out on the right (right edge ${Math.round(box!.x + box!.width)} of ${vw})`).toBeLessThanOrEqual(vw + 1)
  expect(box!.y, `${label} starts above the screen`).toBeGreaterThanOrEqual(-1)
}

// ─── B11 ────────────────────────────────────────────────────────────────────────────────────────

for (const screen of [
  { name: "desktop", size: { width: 1280, height: 800 } },
  { name: "phone 375 px", size: { width: 375, height: 812 } },
]) {
  test(`B11 (${screen.name}): the email is at the top right with a menu that opens inside the screen; Sign out ends the session`, async ({ page, context }) => {
    const email = `lf-b1-account-${screen.name.startsWith("phone") ? "phone" : "desk"}@example.invalid`
    const world = createWorld({ role: "owner" })
    const p = await prepareOverviewLaptop(page, context, world, email)
    await page.setViewportSize(screen.size)
    await openShell(page)

    const account = page.getByTestId("local-shell-account")
    const summary = account.locator("summary")
    const menu = account.locator("> div")

    await test.step("the signed-in email is shown, in the header's top row, on the right", async () => {
      await expect(page.getByTestId("local-shell-person")).toHaveText(email)
      await expect(summary).toHaveAttribute("aria-label", `Account: ${email}`)
      const header = (await page.locator('[data-testid="local-shell"] > header').boundingBox())!
      const brand = (await page.locator('[data-testid="local-shell"] > header a[href="/"]').boundingBox())!
      const box = (await summary.boundingBox())!
      expect(box.y + box.height, "the account control is not inside the header").toBeLessThanOrEqual(header.y + header.height)
      if (!screen.name.startsWith("phone")) {
        // desktop: on the brand's own top row, at the right
        expect(box.x + box.width / 2, "the account control is not on the right half of the screen").toBeGreaterThan(screen.size.width / 2)
        expect(box.y, "the account control is not on the header's top row").toBeLessThan(brand.y + brand.height)
      }
      // (a 375 px phone stacks the header: the account control wraps onto its own line under the AI buttons, still above the modules)
      // above the module links (row 2), never pushed under them
      const nav = (await page.getByRole("navigation", { name: "Modules" }).boundingBox())!
      expect(box.y + box.height, "the account control fell under the module links").toBeLessThanOrEqual(nav.y + 1)
      await expectInside(page, "the account control", '[data-testid="local-shell-account"] summary')
      await expect(menu, "the menu is open before it is asked for").toBeHidden()
    })

    await test.step("the menu opens inside the screen, names the person and offers Sign out", async () => {
      await summary.click()
      await expect(menu).toBeVisible()
      await expectInside(page, "the account menu", '[data-testid="local-shell-account"] > div')
      const box = (await menu.boundingBox())!
      expect(box.y + box.height, "the menu runs off the bottom of the screen").toBeLessThanOrEqual(screen.size.height + 1)
      await expect(menu).toContainText(email)
      await expect(menu).toContainText("Owner")
      await expect(menu).toContainText("2 projects are saved on this laptop.")
      await expect(menu.getByRole("button", { name: "Sign out", exact: true })).toBeVisible()
      await expect(menu.getByRole("button", { name: "Sign out and delete this laptop's copy" })).toBeVisible()
      const widths = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, inner: window.innerWidth }))
      expect(widths.doc, "opening the menu made the page scroll sideways").toBeLessThanOrEqual(widths.inner + 1)
    })

    await test.step("Sign out ends the session: cookie and laptop identity gone, the shell and server pages ask for a sign-in", async () => {
      const personDb = `projexa-local:${p.session.userId}`
      expect((await context.cookies(APP_ORIGIN)).map((c) => c.name), "no login cookie before signing out").toContain(p.session.cookieName)
      await menu.getByRole("button", { name: "Sign out", exact: true }).click()
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
      // re-read, not a message: the cookie is gone from the browser and the durable identity is gone from the laptop
      await expect.poll(async () => (await context.cookies(APP_ORIGIN)).some((c) => c.name.startsWith(p.session.cookieName.replace(/\.\d+$/, ""))), { message: "the login cookie survived the sign-out" }).toBe(false)
      // the durable identity (src/lib/local-first/identity.ts): localStorage px-identity-v1 AND the device meta "identity" record
      expect(await page.evaluate(() => localStorage.getItem("px-identity-v1")), "localStorage still holds the signed-out person's identity").toBeNull()
      expect(await deviceMeta(page, "identity"), "the device database still holds the signed-out person's identity").toBeFalsy()
      // the shell no longer opens for that person
      await page.goto(`/local?projectId=${P1.id}`)
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
      await expect(page.getByTestId("local-shell-account")).toHaveCount(0)
      // a server page sends the person to sign in
      await page.goto("/dashboard")
      await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
      // the default sign-out KEEPS this laptop's copy
      expect(await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name)), "the default Sign out deleted the laptop's copy").toContain(personDb)
    })
  })
}

// ─── B9 ─────────────────────────────────────────────────────────────────────────────────────────

test("B9: '+ New project' in the shell's project dropdown opens the new-project page", async ({ page, context }) => {
  const world = createWorld({ role: "owner" })
  await prepareOverviewLaptop(page, context, world, "lf-b1-newproject@example.invalid")
  await openShell(page)

  await test.step("the dropdown lists the laptop's projects, then '+ New project' last", async () => {
    expect(await switcherNames(page)).toEqual([P1.name, P2.name])
    const options = await page.getByTestId("local-shell-project").locator("option").allTextContents()
    expect(options.at(-1)).toBe("+ New project")
    await expect(page.getByTestId("local-shell-project")).toHaveValue(P1.id)
  })

  await test.step("choosing it opens /projects/new (not a project called '+ New project')", async () => {
    await page.getByTestId("local-shell-project").selectOption({ label: "+ New project" })
    await expect(page).toHaveURL(/\/projects\/new(\?|$)/, { timeout: 30_000 })
    await expect(page.getByText("Dashboard / New Project")).toBeVisible({ timeout: 60_000 })
    await expect(page.getByLabel("Project Name")).toBeVisible()
    // the action item was not remembered as the chosen project
    const remembered = await page.evaluate(() => Object.entries(localStorage).filter(([k]) => k.includes("project")).map(([, v]) => v))
    expect(remembered, "'+ New project' was stored as the selected project").not.toContain("__new_project__")
  })

  await test.step("back on the shell, the dropdown still shows the project that was open", async () => {
    await openShell(page)
    await expect(page.getByTestId("local-shell-project")).toHaveValue(P1.id)
  })
})

// ─── B10 ────────────────────────────────────────────────────────────────────────────────────────

const PRODUCT = { id: "lf-product-fitout", name: "Interior Fit-out (local stand-in)" } // e2e/support/fake-veridian-server.mjs

test("B10: a project made from '+ New project' is saved by the server and reaches the laptop's own copy and dropdown (re-read after reloads)", async ({ page, context }) => {
  const world = createWorld({ role: "owner" })
  const p = await prepareOverviewLaptop(page, context, world, "lf-b1-create@example.invalid")
  const NAME = "Riverside Annex B1"
  await openShell(page)

  await test.step("the new-project page, opened from the shell, has its products (read on the server)", async () => {
    await page.getByTestId("local-shell-project").selectOption({ label: "+ New project" })
    await expect(page).toHaveURL(/\/projects\/new(\?|$)/, { timeout: 30_000 })
    await expect(page.getByText(/Couldn.t load products/), "the server could not read the products").toHaveCount(0)
    await page.locator("#productId").click()
    await page.getByRole("option", { name: PRODUCT.name }).click()
  })

  await test.step("the form sends exactly what the person typed to /api/projects, and the server keeps it", async () => {
    await page.getByLabel("Project Name").fill(`  ${NAME}  `)
    await page.getByLabel("Description (optional)").fill("Ground floor retail fit-out")
    await page.getByLabel("Start Date (optional)").fill("2026-11-02")
    await page.getByLabel("Target Date (optional)").fill("2027-03-31")
    const save = page.getByRole("button", { name: "Save", exact: true })
    await expect(save).toBeEnabled()
    const sent = page.waitForRequest((r) => r.method() === "POST" && new URL(r.url()).pathname === "/api/projects")
    await save.click()
    expect((await sent).postDataJSON()).toEqual({ productId: PRODUCT.id, name: NAME, description: "Ground floor retail fit-out", startDate: "2026-11-02", targetDate: "2027-03-31" })
    // the person lands on the project the server made
    await expect(page).toHaveURL(/\/dashboard\/project\?projectId=ov-new-1/, { timeout: 30_000 })
    expect(world.created).toHaveLength(1)
    expect(world.projects.map((x) => x.name), "the server does not hold the project").toEqual([P1.name, P2.name, NAME])
  })

  await test.step("the laptop's own copy learns the new project by itself (re-read from IndexedDB)", async () => {
    await openShell(page)
    await expect
      .poll(async () => ((await personMeta(page, p.session.userId, "sync:manifest")) as { projectIds?: string[] } | undefined)?.projectIds ?? [], {
        timeout: 120_000, message: "the new project never reached the laptop's copy (replica sync:manifest)",
      })
      .toContain("ov-new-1")
  })

  await test.step("after a reload the dropdown offers it BY NAME; chosen, it stays chosen across another reload", async () => {
    await page.reload()
    await expect(page.getByTestId("local-shell-project")).toBeVisible({ timeout: 60_000 })
    await expect.poll(() => switcherNames(page), { timeout: 30_000 }).toEqual([P1.name, P2.name, NAME])
    await page.getByTestId("local-shell-project").selectOption({ label: NAME })
    await page.reload()
    await expect(page.getByTestId("local-shell-project")).toHaveValue("ov-new-1", { timeout: 60_000 })
    expect(await switcherNames(page)).toEqual([P1.name, P2.name, NAME])
  })
})

// ─── B2 + B3 ────────────────────────────────────────────────────────────────────────────────────

test("B2 + B3: the install screen shows once, on the first install; three refreshes, other pages and a browser restart never show it again", async ({ browserName }, testInfo) => {
  test.skip(browserName !== "chromium", "a persistent Chromium profile")
  const A = makePerson("lf-b1-once", "lf-org-b1", "Once Only Tower", "Once Only - Structure")
  const world = newWorld()
  const profile = testInfo.outputPath("profile")
  const baseURL = testInfo.project.use.baseURL!
  const launch = async () => {
    const ctx = await chromium.launchPersistentContext(profile, { baseURL, serviceWorkers: "allow", viewport: { width: 1280, height: 800 } })
    await ctx.addInitScript(COUNT_PREPARE_SCREEN, PREPARE_COUNTER)
    await stubLifecycleSync(ctx, world)
    return ctx
  }
  const settle = async (page: Page) => {
    await page.waitForLoadState("load")
    // the screen decides from storage right after the session is read; give it the time a real first install takes to appear (it appears in
    // well under a second when it is going to), then look again
    await page.waitForTimeout(4_000)
    await expect(page.getByTestId("workspace-prepare")).toHaveCount(0)
  }

  let ctx: BrowserContext = await launch()
  let page = ctx.pages()[0] ?? (await ctx.newPage())
  const { session } = await signIn(page, ctx, world, A)

  await test.step("first sign-in: the install screen appears once and closes when PROJEXA is installed", async () => {
    await page.goto(`/scope/${A.boqId}`)
    await expect(page.getByTestId("workspace-prepare")).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId("workspace-prepare")).toHaveCount(0, { timeout: 240_000 })
    expect(await timesDrawn(page)).toBe(1)
    await expect.poll(() => page.evaluate((id) => localStorage.getItem(`px-workspace-ready-v1:${id}`), session.userId)).not.toBeNull()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 60_000 }).toBe(true)
  })

  await test.step("three refreshes: never again", async () => {
    for (let i = 1; i <= 3; i += 1) {
      await page.reload()
      await settle(page)
      expect(await timesDrawn(page), `refresh ${i} drew the install screen again`).toBe(1)
    }
  })

  await test.step("other pages, and the shell: never again", async () => {
    for (const path of ["/scope", `/local/scope/${A.boqId}?projectId=${A.projectId}`, `/scope/${A.boqId}`]) {
      await page.goto(path)
      await settle(page)
      expect(await timesDrawn(page), `${path} drew the install screen again`).toBe(1)
    }
  })

  await test.step("the browser is closed and opened again on the same profile: never again", async () => {
    await ctx.close()
    ctx = await launch()
    page = ctx.pages()[0] ?? (await ctx.newPage())
    // A real Supabase login cookie is persistent (it has an expiry); the stand-in's is a session cookie, which a browser restart drops, so the
    // same login is put back: this step is about the install screen, not about how long a login lasts.
    if (!(await ctx.cookies(APP_ORIGIN)).some((c) => c.name === session.cookieName)) {
      await ctx.addCookies([{ name: session.cookieName, value: session.cookieValue, url: APP_ORIGIN }])
    }
    await stubLifecycleApis(page, fixtureOf(A), session)
    expect(await (async () => { await page.goto("/login"); return timesDrawn(page) })(), "the profile was not kept across the restart").toBe(1)
    for (let i = 1; i <= 3; i += 1) {
      await page.goto(i === 2 ? `/local/scope/${A.boqId}?projectId=${A.projectId}` : `/scope/${A.boqId}`)
      await settle(page)
      expect(await timesDrawn(page), `load ${i} after the restart drew the install screen again`).toBe(1)
    }
    // still the same signed-in, installed laptop (so "no screen" is not "nothing happened")
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { timeout: 60_000 }).toBe(true)
    await page.goto(`/local/scope/${A.boqId}?projectId=${A.projectId}`)
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3, { timeout: 60_000 })
  })
  await ctx.close()
})
