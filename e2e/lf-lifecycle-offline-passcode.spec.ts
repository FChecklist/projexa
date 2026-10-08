import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { stubAppApis, STUB_PORT } from "./support/boq-local"
import { fixtureOf, makePerson, newWorld, personMeta, releaseCaches, stubSyncService, type Person, type SyncWorld } from "./support/lf-lifecycle-stub"
import { signInByCode, stubAuthOtp } from "./support/sign-in"
import { countByDest, leftTheLaptop, trackTraffic } from "./support/lf-vercel-budget"

// P1 (replaces AUDIT-100 B20's offline passcode sign-in -- there is no passcode any more), on the fast rig. A person signs in ONLINE through the real
// login form (e-mail, then the e-mailed 6 digits), signs out, and the network is cut. /login must still open -- from the laptop's own kept copy of
// the app (A3 step 1b keeps the public release across a sign-out) -- and say in plain words that a connection is needed to sign in again (the code is
// sent by e-mail). There is no form to type into, no passcode record on the laptop, and nothing goes to the network meanwhile (the Auth service included).
//
//     bunx playwright test -c playwright.local-first.fast.config.ts lf-lifecycle-offline-passcode

async function arrange(page: Page, context: BrowserContext, tag: string) {
  const person: Person = makePerson(tag, "lf-org-1", "Offline Sign In Tower", "Offline Sign In - Structure")
  person.email = `${tag}@example.invalid`
  const world: SyncWorld = newWorld()
  await stubSyncService(context, world)
  const made = (await (await fetch(`http://localhost:${STUB_PORT}/__session?email=${encodeURIComponent(person.email)}`)).json()) as { userId: string; cookieValue: string; accessToken: string; cookieName: string; email: string }
  const authSession = JSON.parse(Buffer.from(made.cookieValue.replace(/^base64-/, ""), "base64url").toString("utf8")) as unknown
  world.persons.set(made.userId, person)
  const app = await stubAppApis(page, fixtureOf(person), made)
  await stubAuthOtp(context, authSession)
  return { person, world, made, app }
}

test("B20 (P1): sign out, cut the network: /login opens from the laptop and says a connection is needed; no form, no passcode kept, nothing is sent", async ({ page, context }) => {
  test.setTimeout(420_000)
  const a = await arrange(page, context, "offline-code1")
  const traffic = trackTraffic(context)

  await test.step("online: the real sign-in form with the e-mailed code; the laptop installs and copies the data, and keeps no passcode of any kind", async () => {
    await signInByCode(page, a.person.email)
    await expect.poll(() => releaseCaches(page), { timeout: 240_000 }).toHaveLength(1)
    await expect.poll(() => personMeta(page, a.made.userId, `sync:done:${a.person.projectId}:boq_lines`), { timeout: 240_000 }).toBeTruthy()
    expect(await page.evaluate(() => localStorage.getItem("px-offline-pin-v1")), "a passcode record was kept on the laptop").toBeNull()
  })

  await test.step("sign out from the shell's own account menu", async () => {
    await page.goto("/local")
    await expect(page.getByTestId("local-shell")).toBeVisible({ timeout: 60_000 })
    await page.getByTestId("local-shell-account").locator("summary").click()
    await page.getByRole("button", { name: "Sign out", exact: true }).click()
    await expect(page).toHaveURL(/\/login/, { timeout: 30_000 })
    expect(await releaseCaches(page), "the sign-out deleted the app from the laptop").toHaveLength(1)
  })

  const offline = traffic.mark()
  a.world.net = "offline"
  a.app.setOffline(true)
  await context.setOffline(true)

  await test.step("offline: /login opens from the laptop and says a connection is needed to sign in; there is nothing to type a code into", async () => {
    await page.goto("/login")
    expect(await page.evaluate(() => navigator.onLine)).toBe(false)
    await expect(page.getByTestId("local-shell-signed-out"), "the laptop's own sign-in screen never opened").toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId("local-shell-signed-out")).toContainText("You need a connection", { timeout: 30_000 })
    await expect(page.locator("#code")).toHaveCount(0)
    await expect(page.locator("#password")).toHaveCount(0)
    expect(new URL(page.url()).pathname).toBe("/login")
  })

  await test.step("nothing was sent to the network while offline: no Auth call, no app page, no /api", async () => {
    const left = leftTheLaptop(offline())
    const c = countByDest(left)
    console.log(`B20 offline window: ${JSON.stringify(c)}`)
    expect(c["supabase-auth"], "the offline screen called the Auth service").toBe(0)
    expect(c["vercel-page"], "an app page was asked of the server").toBe(0)
    expect(c["vercel-api"], "an /api call was made").toBe(0)
  })
  await context.setOffline(false)
})
