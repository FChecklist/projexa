import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { stubAppApis, STUB_PORT } from "./support/boq-local"
import { fixtureOf, makePerson, newWorld, personMeta, releaseCaches, stubSyncService, type Person, type SyncWorld } from "./support/lf-lifecycle-stub"
import { isMailSend } from "./support/lf-vercel-budget"

// AUDIT-100 A22: a returning person gets in with the 6-digit passcode and NO EMAIL is involved: not at the first sign-in, not at the next ones, not after
// a sign-out. Email is for the one-off forgotten-passcode reset only.
//
//     bunx playwright test -c playwright.local-first.fast.config.ts lf-lifecycle-signin-no-email
//
// Real Chromium, production build, the REAL login form and Auth client (only the Auth service is the local stand-in, its password grant answered with a
// session minted for the person). EVERY request of the browser context, the pages' and the service worker's, is read from the browser and tested with
// isMailSend (e2e/support/lf-vercel-budget.ts): the Auth service's recover / OTP / magic-link / resend / signup / email-change calls, any mail route of
// /api or an Edge Function, a mail provider's host, a one-time-code grant. The expected number is ZERO.
// The detector is proved able to fail in the last test: the real "forgot passcode" page makes the Auth recover call, and the detector names it.

const PASSCODE = "493817" // a made-up six digits

type Mailbox = { method: string; url: string }[]

async function arrange(page: Page, context: BrowserContext, tag: string) {
  const person: Person = makePerson(tag, "lf-org-1", "Sign In Tower", "Sign In - Structure")
  person.email = `${tag}@example.invalid`
  const world: SyncWorld = newWorld()
  await stubSyncService(context, world)
  const made = (await (await fetch(`http://localhost:${STUB_PORT}/__session?email=${encodeURIComponent(person.email)}`)).json()) as { userId: string; cookieValue: string; accessToken: string; cookieName: string; email: string }
  const authSession = JSON.parse(Buffer.from(made.cookieValue.replace(/^base64-/, ""), "base64url").toString("utf8")) as unknown
  world.persons.set(made.userId, person)
  await stubAppApis(page, fixtureOf(person), made)
  const grants: string[] = []
  await context.route("**/auth/v1/token*", async (route) => {
    grants.push(`${route.request().url()} ${route.request().postData() ?? ""}`)
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(authSession) })
  })
  // every request, read from the browser itself
  const mail: Mailbox = []
  let total = 0
  let bundles = 0
  context.on("request", (r) => {
    total += 1
    if (/\/_release\/px-[^/]+\.tar\.gz$/.test(r.url())) bundles += 1
    if (isMailSend(r.method(), r.url(), r.postData())) mail.push({ method: r.method(), url: r.url() })
  })
  return { person, world, made, grants, mail, total: () => total, bundleDownloads: () => bundles }
}

async function signIn(page: Page, email: string) {
  await page.goto("/login")
  await page.locator("#email").fill(email)
  await page.locator("#password").fill(PASSCODE)
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 })
}

async function signOut(page: Page) {
  // the shell's own account menu (the laptop's copy is kept)
  await page.goto("/local")
  await expect(page.getByTestId("local-shell")).toBeVisible({ timeout: 60_000 })
  await page.getByTestId("local-shell-account").locator("summary").click()
  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
  // AUDIT-100 A3 (step 1b): the release stays on the laptop, marked signed out: online the worker serves no shell from it while nobody is signed in
  const sw = await page.evaluate(
    () =>
      new Promise<Record<string, unknown> | null>((resolve) => {
        const c = navigator.serviceWorker.controller
        if (!c) return resolve(null)
        const ch = new MessageChannel()
        ch.port1.onmessage = (e) => resolve(e.data as Record<string, unknown>)
        c.postMessage({ type: "STATUS" }, [ch.port2])
        setTimeout(() => resolve(null), 5_000)
      })
  )
  expect(sw, "the worker's record after the sign-out").toMatchObject({ version: null, signedOut: true })
}

test("A22: first sign-in, sign-out, and two more sign-ins with the 6-digit passcode: not one request that sends an email", async ({ page, context }) => {
  test.setTimeout(420_000)
  const a = await arrange(page, context, "noemail1")

  await test.step("first sign-in: the passcode is the password of a plain password grant, and the laptop installs", async () => {
    await signIn(page, a.person.email)
    expect(a.grants.length).toBeGreaterThan(0)
    expect(a.grants[0]).toContain("grant_type=password")
    expect(JSON.parse(a.grants[0]!.slice(a.grants[0]!.indexOf("{")))).toMatchObject({ email: a.person.email, password: PASSCODE })
    await expect.poll(() => releaseCaches(page), { timeout: 240_000 }).toHaveLength(1)
    await expect.poll(() => personMeta(page, a.made.userId, `sync:done:${a.person.projectId}:boq_lines`), { timeout: 240_000 }).toBeTruthy()
    await expect.poll(() => a.bundleDownloads(), { message: "the first sign-in did not download the release bundle" }).toBe(1)
  })
  const installedCaches = await releaseCaches(page)

  for (const n of [2, 3]) {
    await test.step(`sign out and sign in again (#${n}): back in with the passcode alone, the same local copy`, async () => {
      await signOut(page)
      await signIn(page, a.person.email)
      await expect(page).toHaveURL(/\/(dashboard|local)/)
      // the person is signed in again. AUDIT-100 A3 (step 1b): the sign-out KEPT the public release cache (no shell served online while signed out), so this
      // sign-in uses it again instead of downloading the 8.9 MB bundle; the person's DATA is kept too. Both are read from the laptop.
      await expect.poll(() => releaseCaches(page), { timeout: 120_000, message: "the app is not on the laptop after the sign-in" }).toEqual(installedCaches)
      expect(a.bundleDownloads(), "the sign-in downloaded the release bundle again (A3 step 1b: the same person's release is kept)").toBe(1)
      expect(await personMeta(page, a.made.userId, `sync:done:${a.person.projectId}:boq_lines`), "the person's data was not kept").toBeTruthy()
    })
  }

  expect(a.grants.length, "every sign-in used a password grant").toBeGreaterThanOrEqual(3)
  for (const g of a.grants) expect(g, "a sign-in used something other than the password").toContain("grant_type=password")
  console.log(`A22/A3 release bundle downloads over three sign-ins: ${a.bundleDownloads()} (A3 step 1b: was 3 before the release was kept)`)
  expect(a.bundleDownloads(), "three sign-ins of the same person downloaded the release bundle more than once").toBe(1)
  console.log(`A22 requests seen: ${a.total()}; mail-sending requests: ${a.mail.length}`)
  expect(a.total(), "the detector saw nothing: it is not reading the browser").toBeGreaterThan(100)
  expect(a.mail, "an email was sent during a daily sign-in").toEqual([])
})

test("the detector can fail: the real 'forgot passcode' page sends the Auth recover call and the detector names it; a plain password grant is not mail", async ({ page, context }) => {
  const a = await arrange(page, context, "noemail2")
  expect(isMailSend("POST", "http://localhost:54399/auth/v1/token?grant_type=password", `{"email":"x","password":"123456"}`)).toBe(false)
  expect(isMailSend("GET", "http://localhost:54399/auth/v1/user")).toBe(false)
  expect(isMailSend("POST", "http://localhost:54399/auth/v1/token?grant_type=refresh_token", `{"refresh_token":"x"}`)).toBe(false)
  expect(isMailSend("POST", "http://localhost:54399/auth/v1/otp")).toBe(true)
  expect(isMailSend("POST", "http://localhost:54399/auth/v1/token?grant_type=pkce", "{}")).toBe(true)
  expect(isMailSend("POST", "https://api.resend.com/emails")).toBe(true)

  await page.goto("/forgot-password")
  await page.locator('input[type="email"]').fill(a.person.email)
  await page.locator('button[type="submit"]').click()
  await expect.poll(() => a.mail.length, { timeout: 30_000, message: "the forgot-passcode page sent nothing the detector could see" }).toBeGreaterThan(0)
  expect(a.mail[0]!.url).toContain("/auth/v1/recover")
})
