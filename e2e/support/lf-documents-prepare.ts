// lf-e10b. Getting a laptop into the "prepared" state the way a person does (one online visit; the first-run screen copies the
// workspace), then switching the network, for the documents and design/change specs. Same steps as e2e/offline-local-first.spec.ts.
import { expect, test, type BrowserContext, type Page } from "@playwright/test"
import { signInLocally, type LocalSession } from "./boq-local"
import { KIND_ROWS, PROJECT_ID, PROJECT_NAME, readPersonMeta, stubAppApis, stubSyncService, type AppApiStub, type Net, type SyncStub } from "./lf-documents-stub"

export type Prepared = { session: LocalSession; sync: SyncStub; app: AppApiStub; net: Net; console: ConsoleLog }

export type ConsoleLog = { errors: string[]; pageErrors: string[] }

// Errors that are the point of the test (the network is off or our server refuses), and the browser's own favicon miss.
const EXPECTED_CONSOLE = [
  /favicon\.ico/,
  /net::ERR_INTERNET_DISCONNECTED/,
  /net::ERR_CONNECTION_REFUSED/,
  /net::ERR_FAILED/,
  /Failed to load resource/,
  /Failed to fetch/,
]

function watchConsole(page: Page): ConsoleLog {
  const log: ConsoleLog = { errors: [], pageErrors: [] }
  page.on("pageerror", (err) => log.pageErrors.push(`${err.name}: ${err.message}`))
  page.on("console", (msg) => {
    if (msg.type() !== "error") return
    const text = `${msg.text()} ${msg.location().url ?? ""}`
    if (!EXPECTED_CONSOLE.some((re) => re.test(text))) log.errors.push(text)
  })
  return log
}

/** No uncaught error and no unexpected console.error happened on the page so far. */
export function expectCleanConsole(log: ConsoleLog) {
  expect(log.pageErrors, "an uncaught error was thrown in the page").toEqual([])
  expect(log.errors, "the page logged an unexpected console.error").toEqual([])
}

// Next.js mounts one empty role="alert" route announcer (#__next-route-announcer__) on every page: not an error, the only one excluded.
export async function noCrash(page: Page) {
  await expect(page.locator('[role="dialog"], [role="alertdialog"], [role="alert"]:not(#__next-route-announcer__)'), "an error or dialog appeared").toHaveCount(0)
  await expect(page.getByText(/Application error|Something went wrong|Unhandled Runtime Error/i), "a crash screen appeared").toHaveCount(0)
}

export async function prepareLaptop(page: Page, context: BrowserContext, role: string, email = "lf-documents-spec@example.invalid"): Promise<Prepared> {
  const net: Net = { mode: "up" }
  const consoleLog = watchConsole(page)
  const session = await signInLocally(context, email)
  const sync = await stubSyncService(page, session, net, role)
  const app = await stubAppApis(page, session, net, role)

  await test.step(`online as ${role}: the first-run screen prepares the workspace and finishes`, async () => {
    await page.goto(`/documents?projectId=${PROJECT_ID}`)
    await expect(page.getByTestId("prepare-percent"), "the 'Preparing your workspace' screen never reached 100%").toHaveText("100%", { timeout: 240_000 })
    await page.getByTestId("prepare-continue").click()
  })

  await test.step("every kind of this area was copied to the laptop, and the project names cached", async () => {
    for (const kind of Object.keys(KIND_ROWS)) {
      await expect
        .poll(() => readPersonMeta(page, session.userId, `sync:done:${PROJECT_ID}:${kind}`), { timeout: 120_000, message: `the ${kind} rows were never copied to the laptop` })
        .toBeTruthy()
    }
    await expect
      .poll(() => page.evaluate((k) => new Promise((resolve) => {
        const open = indexedDB.open("projexa-local")
        open.onerror = () => resolve(undefined)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("meta")) { db.close(); resolve(undefined); return }
          const get = db.transaction("meta", "readonly").objectStore("meta").get(k)
          get.onsuccess = () => { db.close(); resolve((get.result as { value?: unknown } | undefined)?.value) }
          get.onerror = () => { db.close(); resolve(undefined) }
        }
      }), `shell:manifest:${session.userId}`), { timeout: 60_000, message: "the project names were never cached" })
      .toMatchObject({ projects: [{ id: PROJECT_ID, name: PROJECT_NAME }] })
  })

  await test.step("the page is controlled by the service worker (reload once, online)", async () => {
    await page.reload()
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), { message: "the service worker does not control the page" }).toBe(true)
  })

  return { session, sync, app, net, console: consoleLog }
}

export async function goOffline(context: BrowserContext, p: Prepared) {
  p.net.mode = "offline"
  await context.setOffline(true)
}

export async function goOnline(context: BrowserContext, p: Prepared) {
  p.net.mode = "up"
  await context.setOffline(false)
}

/** Opens an app path from the on-laptop shell (the worker answers any app navigation with it while offline). */
export async function openLocal(page: Page, path: string) {
  const sep = path.includes("?") ? "&" : "?"
  await page.goto(`/local${path}${path.includes("projectId=") ? "" : `${sep}projectId=${PROJECT_ID}`}`)
}
