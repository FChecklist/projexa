import { test, expect } from "@playwright/test"
import { STUB_CODE, stubAuthOtp } from "./support/sign-in"
import { stubAppApis, STUB_PORT } from "./support/boq-local"
import { dumpDb, fixtureOf, makePerson, newWorld, personDb, personMeta, releaseCaches, stubSyncService } from "./support/lf-lifecycle-stub"
import { countByDest, leftTheLaptop, trackTraffic } from "./support/lf-vercel-budget"

// AUDIT-100 A19 (works for the user first) + A23 (minimal set-up steps for a new user): the CORE JOURNEY of a brand-new person, scripted as a real user
// would do it and timed, in a real Chromium on a production build (the fast rig, see scripts/lf-fast-rig.sh):
//
//     bunx playwright test -c playwright.local-first.fast.config.ts lf-lifecycle-first-use
//
//   open the sign-in page -> type the email -> press Send me a code -> type the 6-digit code (it submits itself)   (the real login form, the real Auth client; only the Auth
//   service is the local stand-in)  -> PROJEXA installs itself with NO further action  -> the person opens PROJEXA again (reload) and it comes from
//   the laptop  -> Scope (BOQ) -> the BOQ  (the first useful screen: the lines on screen)  -> the network is cut, the person edits a line (it waits on the
//   laptop)  -> the network is back and the edit reaches the server exactly once.
//
// Every user action is counted by `act()`; waiting for the install is NOT an action. The numbers below are budgets with room; the measured values are
// printed on every run (A23 journey ...) and attached to the test report as first-use-timeline.json.
//
//   MEASURED 2026-10-05 (rig, local Auth stand-in and stubbed sync service, so network time is ~0; the real-network install time is the live-install
//   lane s number): sign-in press -> installed and ready (data copied, flag set) 7.1 s; opening the page -> BOQ lines on screen 9.8 s; user actions after
//   pressing Sign in until the install is done: 0; user actions from opening the page to the BOQ lines on screen: 7 (open the page, type email, type
//   passcode, press Sign in, open PROJEXA again, click Scope, open the BOQ). First session on the legacy pages before that reload: 4 /api calls and
//   20 app pages from Vercel.
//
// FIXED (AUDIT-100 A3, VERCEL_ROUTE_PLAN.md step 1): the first session used to stay on the legacy server-rendered pages (/dashboard) until the person
// reloaded; now the page hands over to the shell on the laptop by itself once the install and the first copy are done (no action of the person).

const SIGN_IN_TO_READY_BUDGET_MS = 90_000
const ACTIONS_TO_FIRST_USEFUL_SCREEN_BUDGET = 6 // measured 6 since A3 step 1 (was 7: the person had to open PROJEXA again)
const SETUP_ACTIONS_AFTER_SIGN_IN_BUDGET = 2 // target of the audit: under 2 clicks of set-up; measured 0

type Step = { name: string; user: boolean; startedMs: number; ms: number }

test("A19/A23: a new person signs in with the e-mailed 6-digit code, PROJEXA installs itself with no set-up step, the BOQ opens from the laptop, an offline edit is sent once", async ({ page, context }) => {
  test.setTimeout(420_000)
  const person = makePerson("fu", "lf-org-1", "First Use Tower", "First Use - Structure")
  person.email = "first-use@example.invalid"
  const world = newWorld()
  await stubSyncService(context, world)

  // the Auth stand-in mints the person's session; the real login form's code check (verifyOtp) is answered with it (the stand-in's own /token would
  // mint a different random person on every call, which the sync stub could not know)
  const made = (await (await fetch(`http://localhost:${STUB_PORT}/__session?email=${encodeURIComponent(person.email)}`)).json()) as { userId: string; cookieValue: string; accessToken: string; cookieName: string; email: string }
  const authSession = JSON.parse(Buffer.from(made.cookieValue.replace(/^base64-/, ""), "base64url").toString("utf8")) as unknown
  world.persons.set(made.userId, person)
  const app = await stubAppApis(page, fixtureOf(person), made)
  const patchBodies: string[] = []
  page.on("request", (r) => { if (r.method() === "PATCH" && /\/api\/scope\/line-items\//.test(r.url())) patchBodies.push(r.postData() ?? "") })
  const auth = await stubAuthOtp(context, authSession)
  const traffic = trackTraffic(context)

  const steps: Step[] = []
  const t0 = Date.now()
  const act = async <T>(name: string, fn: () => Promise<T>, user = true): Promise<T> => {
    const started = Date.now()
    try { return await fn() } finally { steps.push({ name, user, startedMs: started - t0, ms: Date.now() - started }) }
  }
  const userActions = () => steps.filter((s) => s.user).length

  await act("open the sign-in page", () => page.goto("/login"))
  await act("type the email", () => page.locator("#email").fill(person.email))
  await act("press Send me a code", () => page.locator('button[type="submit"]').click())
  await expect(page.locator("#code")).toBeVisible({ timeout: 30_000 })
  expect(auth.otpRequests.length, "the real form never asked the Auth service for a code").toBe(1)
  expect(JSON.parse(auth.otpRequests[0]!), "the code is asked for this e-mail address").toMatchObject({ email: person.email })
  const pressed = Date.now()
  const actionsBeforeInstall = userActions() + 1
  // the sixth digit submits by itself: typing the code is the last action
  await act("type the 6-digit code from the e-mail", () => page.locator("#code").fill(STUB_CODE))
  await expect.poll(() => auth.verifies.length, { timeout: 30_000, message: "the real form never checked the code with the Auth service" }).toBeGreaterThan(0)
  expect(JSON.parse(auth.verifies[0]!), "the code is checked for this e-mail").toMatchObject({ email: person.email, token: STUB_CODE })

  await test.step("PROJEXA installs itself: no click, no choice, no extra screen to confirm (waiting is not an action)", async () => {
    await act("wait: PROJEXA is installed on this laptop", async () => {
      await expect.poll(() => releaseCaches(page), { timeout: 240_000, message: "the release was never installed" }).toHaveLength(1)
    }, false)
    await act("wait: the person's data is copied and the ready flag is set", async () => {
      await expect
        .poll(() => personMeta(page, made.userId, `sync:done:${person.projectId}:boq_lines`), { timeout: 240_000, message: "the BOQ lines never reached the laptop" })
        .toBeTruthy()
      await expect
        .poll(() => page.evaluate((id) => localStorage.getItem(`px-workspace-ready-v1:${id}`), made.userId), { timeout: 240_000, message: "the ready flag never appeared" })
        .not.toBeNull()
    }, false)
  })
  const readyMs = Date.now() - pressed
  expect(userActions() - actionsBeforeInstall, "a set-up step was needed after pressing Sign in").toBeLessThanOrEqual(SETUP_ACTIONS_AFTER_SIGN_IN_BUDGET)
  expect(readyMs, "sign-in -> ready is over the budget").toBeLessThanOrEqual(SIGN_IN_TO_READY_BUDGET_MS)

  // what the first session cost on Vercel before the shell takes over (a finding, recorded)
  const firstSession = leftTheLaptop(traffic.all)
  console.log(`A23 first-session Vercel requests (sign-in page to ready): ${JSON.stringify(countByDest(firstSession))}`)

  const afterReady = traffic.mark()
  // AUDIT-100 A3 (step 1): the person no longer has to open PROJEXA again -- right after the install the page hands over to the shell on the laptop
  // by itself (it used to be a user action, "open PROJEXA again (a full page load)": 7 actions to the BOQ, now 6).
  await act("wait: the page hands over to PROJEXA on the laptop by itself", async () => {
    await expect(page.getByTestId("local-shell")).toBeVisible({ timeout: 120_000 })
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), "no service worker controls the page").toBe(true)
  }, false)
  const nav = page.getByRole("navigation", { name: "Modules" })
  await act("click Scope (BOQ)", () => nav.getByRole("link", { name: "Scope (BOQ)", exact: true }).click())
  await expect(page.getByTestId("scope-list")).toHaveAttribute("data-state", "local", { timeout: 30_000 })
  await act("open the BOQ", () => page.getByTestId("scope-list-row").first().getByRole("link").first().click())
  await expect(page.getByTestId("scope-object")).toHaveAttribute("data-state", "local", { timeout: 30_000 })
  await expect(page.getByTestId("boq-local-line")).toHaveCount(3)
  const firstUseful = userActions()
  const firstUsefulMs = Date.now() - t0
  const sinceReady = leftTheLaptop(afterReady())
  expect(countByDest(sinceReady)["vercel-page"] + countByDest(sinceReady)["vercel-api"], "opening the BOQ from the laptop still called Vercel").toBeLessThanOrEqual(1)

  await test.step("the network is cut: the person edits a line; it waits on the laptop (re-read from the laptop's own database)", async () => {
    world.net = "offline"
    app.setOffline(true)
    await context.setOffline(true)
    const line = page.getByTestId("boq-local-line").first()
    await act("type a category on a line", () => line.getByTestId("boq-line-category-input").fill("Concrete-A23"))
    await act("press Save", () => line.getByTestId("boq-line-save").click())
    await expect(line.getByTestId("boq-line-waiting")).toBeVisible({ timeout: 30_000 })
    expect(patchBodies, "an edit made offline was sent while offline").toHaveLength(0)
    expect(await dumpDb(page, personDb(made.userId)), "the edit is not in the laptop's own database").toContain("Concrete-A23")
  })

  await test.step("the network is back: the edit reaches the server exactly once and the 'waiting' note goes", async () => {
    world.net = "up"
    app.setOffline(false)
    await context.setOffline(false)
    await page.evaluate(() => window.dispatchEvent(new Event("online")))
    await expect.poll(() => patchBodies.length, { timeout: 120_000, message: "the edit never reached the server" }).toBe(1)
    await expect(page.getByTestId("boq-line-waiting")).toHaveCount(0, { timeout: 60_000 })
    await page.waitForTimeout(3_000)
    expect(patchBodies, "the edit was sent more than once").toHaveLength(1)
    expect(patchBodies[0]).toContain("Concrete-A23")
  })

  const timeline = { signInToInstalledAndReadyMs: readyMs, openToFirstUsefulScreenMs: firstUsefulMs, userActionsToFirstUsefulScreen: firstUseful, setupActionsAfterSignIn: userActions() - actionsBeforeInstall, steps }
  console.log(`A23 journey ${JSON.stringify(timeline)}`)
  await test.info().attach("first-use-timeline.json", { body: JSON.stringify(timeline, null, 2), contentType: "application/json" })
  expect(firstUseful, "too many user actions from the sign-in page to the first useful screen").toBeLessThanOrEqual(ACTIONS_TO_FIRST_USEFUL_SCREEN_BUDGET)
  traffic.stop()
})

