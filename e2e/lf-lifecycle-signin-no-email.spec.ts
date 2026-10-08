import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { stubAppApis, STUB_PORT } from "./support/boq-local"
import { fixtureOf, makePerson, newWorld, personMeta, releaseCaches, stubSyncService, type Person, type SyncWorld } from "./support/lf-lifecycle-stub"
import { signInByCode, stubAuthOtp } from "./support/sign-in"
import { isMailSend } from "./support/lf-vercel-budget"

// P1 (was AUDIT-100 A22, "a returning person signs in with the passcode and NO e-mail"): there is no passcode now. Every sign-in is the e-mailed
// 6-digit code, so each one makes exactly ONE mail-sending request -- the page's "send the code" call (POST /auth/v1/otp) -- and nothing else
// that sends mail (no recover, resend, magic link, invite, change of e-mail, mail provider, or /api route about mail). Opening the app again on a
// machine that is still signed in (a kept session) makes none.
//
//     bunx playwright test -c playwright.local-first.fast.config.ts lf-lifecycle-signin-no-email
//
// Real Chromium, production build, the REAL login form and Auth client (only the Auth service is the local stand-in; its code calls are answered with a
// session minted for the person). EVERY request of the browser context, the pages' and the service worker's, is read from the browser and tested with
// isMailSend (e2e/support/lf-vercel-budget.ts). The detector is proved able to fail in the last test.

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
  const auth = await stubAuthOtp(context, authSession)
  // every request, read from the browser itself
  const mail: Mailbox = []
  let total = 0
  let bundles = 0
  context.on("request", (r) => {
    total += 1
    if (/\/_release\/px-[^/]+\.tar\.gz$/.test(r.url())) bundles += 1
    if (isMailSend(r.method(), r.url(), r.postData())) mail.push({ method: r.method(), url: r.url() })
  })
  return { person, world, made, auth, mail, total: () => total, bundleDownloads: () => bundles }
}

async function signIn(page: Page, email: string) {
  await signInByCode(page, email)
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

test("P1: first sign-in, sign-out, and two more sign-ins with the e-mailed code: exactly one 'send the code' request each and no other mail", async ({ page, context }) => {
  test.setTimeout(420_000)
  const a = await arrange(page, context, "noemail1")

  await test.step("first sign-in: one code request, one code check, and the laptop installs", async () => {
    await signIn(page, a.person.email)
    expect(a.auth.otpRequests.length).toBe(1)
    expect(JSON.parse(a.auth.otpRequests[0]!)).toMatchObject({ email: a.person.email })
    expect(a.auth.verifies.length).toBeGreaterThan(0)
    await expect.poll(() => releaseCaches(page), { timeout: 240_000 }).toHaveLength(1)
    await expect.poll(() => personMeta(page, a.made.userId, `sync:done:${a.person.projectId}:boq_lines`), { timeout: 240_000 }).toBeTruthy()
    // the public bundle starts downloading when the e-mail is sent (release/prewarm.ts) and is used by the install: still ONE download
    await expect.poll(() => a.bundleDownloads(), { message: "the first sign-in did not download the release bundle exactly once" }).toBe(1)
  })
  const installedCaches = await releaseCaches(page)

  for (const n of [2, 3]) {
    await test.step(`sign out and sign in again (#${n}): a new code, the same local copy`, async () => {
      await signOut(page)
      await signIn(page, a.person.email)
      await expect(page).toHaveURL(/\/(dashboard|local)/)
      // AUDIT-100 A3 (step 1b): the sign-out KEPT the public release cache, so this sign-in uses it again instead of downloading the 8.9 MB bundle
      await expect.poll(() => releaseCaches(page), { timeout: 120_000, message: "the app is not on the laptop after the sign-in" }).toEqual(installedCaches)
      expect(await personMeta(page, a.made.userId, `sync:done:${a.person.projectId}:boq_lines`), "the person's data was not kept").toBeTruthy()
    })
  }

  expect(a.auth.otpRequests.length, "each of the three sign-ins asked for exactly one code").toBe(3)
  console.log(`P1 release bundle downloads over three sign-ins: ${a.bundleDownloads()}`)
  expect(a.bundleDownloads(), "three sign-ins of the same person downloaded the release bundle more than twice").toBeLessThanOrEqual(2)
  console.log(`P1 requests seen: ${a.total()}; mail-sending requests: ${a.mail.length}`)
  expect(a.total(), "the detector saw nothing: it is not reading the browser").toBeGreaterThan(100)
  expect(a.mail.length, "one mail-sending request per sign-in, no more").toBe(3)
  for (const m of a.mail) expect(m.url, "a request other than 'send the code' sent mail").toContain("/auth/v1/otp")
})

test("the detector can fail: 'send the code' counts as mail and is named; a refresh and a session read are not mail; the old forgot-password page now sends nothing", async ({ page, context }) => {
  const a = await arrange(page, context, "noemail2")
  expect(isMailSend("GET", "http://localhost:54399/auth/v1/user")).toBe(false)
  expect(isMailSend("POST", "http://localhost:54399/auth/v1/token?grant_type=refresh_token", `{"refresh_token":"x"}`)).toBe(false)
  expect(isMailSend("POST", "http://localhost:54399/auth/v1/otp")).toBe(true)
  expect(isMailSend("POST", "http://localhost:54399/auth/v1/recover")).toBe(true)
  expect(isMailSend("POST", "http://localhost:54399/auth/v1/token?grant_type=pkce", "{}")).toBe(true)
  expect(isMailSend("POST", "https://api.resend.com/emails")).toBe(true)

  // the page that used to send the recover call is a redirect to /login now: no mail
  await page.goto("/forgot-password")
  await expect(page).toHaveURL(/\/login/)
  expect(a.mail, "the forgot-password page still sends mail").toEqual([])
  // and the real sign-in form is what the detector catches
  await page.locator("#email").fill(a.person.email)
  await page.locator('button[type="submit"]').click()
  await expect.poll(() => a.mail.length, { timeout: 30_000, message: "the sign-in form sent nothing the detector could see" }).toBeGreaterThan(0)
  expect(a.mail[0]!.url).toContain("/auth/v1/otp")
})
