import { test, expect, type BrowserContext, type Page } from "@playwright/test"
import { stubAppApis, STUB_PORT } from "./support/boq-local"
import { fixtureOf, makePerson, newWorld, personMeta, releaseCaches, stubSyncService, type Person, type SyncWorld } from "./support/lf-lifecycle-stub"
import { countByDest, leftTheLaptop, trackTraffic } from "./support/lf-vercel-budget"

// AUDIT-100 B20 (offline passcode sign-in), on the fast rig: the same journey as e2e/audit37-real-b17-b20-offline.spec.ts (real backend), with the local
// Auth stand-in. A person signs in ONLINE through the real login form (which keeps a salted hash of the passcode on the laptop, offline-pin.ts), signs
// out, and the network is cut. /login must still open -- from the laptop's own kept copy of the app (A3 step 1b keeps the public release across a
// sign-out; with no network the worker opens the shell, whose signed-out screen is the passcode form) -- refuse a wrong passcode, accept the right
// one, and open the person's own local copy. Nothing goes to the network meanwhile (the Auth service included).
//
//     bunx playwright test -c playwright.local-first.fast.config.ts lf-lifecycle-offline-passcode
//
// MEASURED 2026-10-05 before the fix: offline /login answered the worker's "PROJEXA is not saved on this laptop yet" page (no form): the sign-out
// had deleted the release caches.

const PASSCODE = "582914" // a made-up six digits

async function arrange(page: Page, context: BrowserContext, tag: string) {
  const person: Person = makePerson(tag, "lf-org-1", "Offline Sign In Tower", "Offline Sign In - Structure")
  person.email = `${tag}@example.invalid`
  const world: SyncWorld = newWorld()
  await stubSyncService(context, world)
  const made = (await (await fetch(`http://localhost:${STUB_PORT}/__session?email=${encodeURIComponent(person.email)}`)).json()) as { userId: string; cookieValue: string; accessToken: string; cookieName: string; email: string }
  const authSession = JSON.parse(Buffer.from(made.cookieValue.replace(/^base64-/, ""), "base64url").toString("utf8")) as unknown
  world.persons.set(made.userId, person)
  const app = await stubAppApis(page, fixtureOf(person), made)
  await context.route("**/auth/v1/token*", (route) =>
    route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*", "content-type": "application/json" }, body: JSON.stringify(authSession) })
  )
  return { person, world, made, app }
}

test("B20: sign out, cut the network: /login opens from the laptop, a wrong passcode is refused, the right one opens this laptop's own copy; nothing is sent", async ({ page, context }) => {
  test.setTimeout(420_000)
  const a = await arrange(page, context, "offline-pin1")
  const traffic = trackTraffic(context)

  await test.step("online: the real sign-in form; the laptop installs, copies the data and keeps a salted hash of the passcode (never the passcode)", async () => {
    await page.goto("/login")
    await page.locator("#email").fill(a.person.email)
    await page.locator("#password").fill(PASSCODE)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 })
    await expect.poll(() => releaseCaches(page), { timeout: 240_000 }).toHaveLength(1)
    await expect.poll(() => personMeta(page, a.made.userId, `sync:done:${a.person.projectId}:boq_lines`), { timeout: 240_000 }).toBeTruthy()
    const stored = await page.evaluate(() => localStorage.getItem("px-offline-pin-v1"))
    expect(stored, "no offline passcode record after the online sign-in").toBeTruthy()
    expect(stored).not.toContain(PASSCODE)
    expect(Object.keys(JSON.parse(stored!))).toContain(a.person.email.toLowerCase())
  })
  const dbBefore = (await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:")))).sort()

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

  await test.step("offline: /login opens from the laptop with the passcode form; a wrong passcode is refused in plain words", async () => {
    await page.goto("/login")
    expect(await page.evaluate(() => navigator.onLine)).toBe(false)
    await expect(page.getByTestId("local-shell-offline-signin"), "no sign-in form offline").toBeVisible({ timeout: 60_000 })
    await page.locator("#email").fill(a.person.email)
    await page.locator("#password").fill("000000")
    await page.locator('button[type="submit"]').click()
    await expect(page.getByTestId("local-shell-offline-signin")).toContainText("does not match", { timeout: 30_000 })
    expect(new URL(page.url()).pathname).toBe("/login")
    expect(await page.evaluate(() => localStorage.getItem("px-identity-v1")), "a wrong passcode signed someone in").toBeNull()
  })

  await test.step("the right passcode signs in on the laptop and opens the person's own copy (the same database as before)", async () => {
    await page.locator("#password").fill(PASSCODE)
    await page.locator('button[type="submit"]').click()
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 })
    await page.goto("/local")
    await expect(page.getByTestId("local-shell-person")).toHaveText(a.person.email, { timeout: 60_000 })
    await page.goto(`/local/scope/${a.person.boqId}?projectId=${a.person.projectId}`)
    await expect(page.getByTestId("boq-local-line")).toHaveCount(3, { timeout: 60_000 })
    const dbAfter = (await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name ?? "").filter((n) => n.startsWith("projexa-local:")))).sort()
    expect(dbAfter).toEqual(dbBefore)
  })

  await test.step("nothing was sent to the network while offline: no Auth call, no app page, no /api", async () => {
    const left = leftTheLaptop(offline())
    const c = countByDest(left)
    console.log(`B20 offline window: ${JSON.stringify(c)}`)
    expect(c["supabase-auth"], "the offline sign-in called the Auth service").toBe(0)
    expect(c["vercel-page"], "an app page was asked of the server").toBe(0)
    expect(c["vercel-api"], "an /api call was made").toBe(0)
  })
  await context.setOffline(false)
})
