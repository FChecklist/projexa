// LOCAL-FIRST overview e2e (package lf-e10c): getting a laptop into the "prepared" state the way a person does, switching the network,
// reading what is really stored on the laptop, and the console-hygiene guard every overview spec uses. The sync service and the page's
// /api calls are answered by lf-overview-stub.ts; the session comes from the local Auth stand-in (fake-supabase-server.mjs) through
// boq-local.ts's signInLocally. Nothing reaches a real network.

import { expect, test, type BrowserContext, type ConsoleMessage, type Page } from "@playwright/test"
import { signInLocally, type LocalSession } from "./boq-local"
import { OVERVIEW_KINDS, P1, P2, stubAppApis, stubSyncService, type AppStub, type Net, type World } from "./lf-overview-stub"
import { evalSettled } from "./lf-lifecycle-stub"

export type Prepared = { session: LocalSession; app: AppStub; net: Net }

function readMeta(page: Page, dbName: string, key: string): Promise<unknown> {
  return evalSettled(page, 
    ({ dbName, key }) =>
      new Promise<unknown>((resolve) => {
        const open = indexedDB.open(dbName)
        open.onerror = () => resolve(undefined)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("meta")) { db.close(); resolve(undefined); return }
          const get = db.transaction("meta", "readonly").objectStore("meta").get(key)
          get.onerror = () => { db.close(); resolve(undefined) }
          get.onsuccess = () => { db.close(); resolve((get.result as { value?: unknown } | undefined)?.value) }
        }
      }),
    { dbName, key }
  )
}

export const deviceMeta = (page: Page, key: string) => readMeta(page, "projexa-local", key)
export const personMeta = (page: Page, userId: string, key: string) => readMeta(page, `projexa-local:${userId}`, key)

/** Online: sign in, let the first-run screen copy the workspace, wait until every (readable project, kind) is on the laptop. */
export async function prepareLaptop(page: Page, context: BrowserContext, world: World, email = "overview-spec@example.invalid"): Promise<Prepared> {
  const net: Net = { mode: "up" }
  const session = await signInLocally(context, email)
  await stubSyncService(page, world, session, net)
  const app = await stubAppApis(page, world, session)

  await test.step("online: the first-run screen prepares the workspace and finishes", async () => {
    await page.goto("/scope")
    await expect(page.getByTestId("workspace-prepare"), "the 'Preparing your PROJEXA workspace' screen never finished and opened PROJEXA").toHaveCount(0, { timeout: 240_000 });
  })

  await test.step("every readable (project, kind) is on the laptop, and the project names are cached", async () => {
    for (const p of world.projects) {
      for (const kind of OVERVIEW_KINDS) {
        await expect.poll(() => personMeta(page, session.userId, `sync:done:${p.id}:${kind}`), { timeout: 120_000, message: `${p.name} / ${kind} was never copied to the laptop` }).toBeTruthy()
      }
    }
    await expect
      .poll(() => deviceMeta(page, `shell:manifest:${session.userId}`), { timeout: 60_000, message: "the project names were never cached" })
      .toMatchObject({ projects: [{ id: P1.id, name: P1.name }, { id: P2.id, name: P2.name }] })
    await expect.poll(() => deviceMeta(page, "app:release"), { timeout: 240_000, message: "the release was never installed (meta app:release)" }).toBeTruthy()
  })

  await test.step("the page is controlled by the service worker (reload once, online)", async () => {
    await page.reload()
    await expect.poll(() => evalSettled(page, () => Boolean(navigator.serviceWorker.controller)), { message: "the service worker does not control the page" }).toBe(true)
  })
  return { session, app, net }
}

export async function goOffline(context: BrowserContext, p: Prepared) {
  p.net.mode = "offline"
  p.app.setOffline(true)
  await context.setOffline(true)
}

export async function goOnline(context: BrowserContext, p: Prepared) {
  p.net.mode = "up"
  p.app.setOffline(false)
  await context.setOffline(false)
}

/** Our server down, the browser online: the sync service and every /api call refused. */
export function serverDown(p: Prepared) {
  p.net.mode = "down"
  p.app.setOffline(true)
}

// Next.js mounts ONE empty role="alert" element on every App Router page, its route announcer; it is not an error (see
// e2e/offline-local-first.spec.ts). Any other alert or dialog fails.
export async function noCrashText(page: Page) {
  await expect(page.locator('[role="dialog"], [role="alertdialog"], [role="alert"]:not(#__next-route-announcer__)'), "an error or dialog appeared").toHaveCount(0)
  await expect(page.getByTestId("local-shell-error"), "the shell could not read a screen").toHaveCount(0)
}

/**
 * Console hygiene: every uncaught page error and every console.error is collected; `check()` fails on anything outside the allow-list:
 *   * the /favicon.ico 404;
 *   * a resource the browser could not load because the network is deliberately off or our server deliberately down (Chromium logs
 *     "Failed to load resource: net::ERR_INTERNET_DISCONNECTED" / "net::ERR_CONNECTION_REFUSED" / "net::ERR_FAILED" for those).
 */
export function watchConsole(page: Page) {
  const errors: string[] = []
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`))
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() !== "error") return
    const text = msg.text()
    const where = msg.location()?.url ?? ""
    if (/favicon\.ico/.test(text) || /favicon\.ico/.test(where)) return
    // an unsigned release (every test build) has no release.sig.json: the installer asks once and accepts the 404
    if (/release\.sig\.json/.test(text) || /release\.sig\.json/.test(where)) return
    if (/^Failed to load resource: net::ERR_(INTERNET_DISCONNECTED|CONNECTION_REFUSED|FAILED)/.test(text)) return
    errors.push(`console.error: ${text}${where ? ` (${where})` : ""}`)
  })
  return {
    errors,
    check(label: string) {
      expect(errors, `console errors ${label}`).toEqual([])
    },
  }
}

/** The project names the shell's switcher offers, in order (the "+ New project" action is not a project). */
export async function switcherNames(page: Page): Promise<string[]> {
  const all = await page.getByTestId("local-shell-project").locator("option").allTextContents()
  return all.filter((t) => t !== "+ New project")
}

/** The figures card of the dashboard as {label: value}. */
export async function dashboardFigures(page: Page): Promise<Record<string, string>> {
  return page.getByTestId("overview-dashboard-figures").evaluate((card) => {
    const out: Record<string, string> = {}
    const dts = [...card.querySelectorAll("dt")]
    for (const dt of dts) out[(dt.textContent ?? "").trim()] = ((dt.nextElementSibling as HTMLElement | null)?.textContent ?? "").trim()
    return out
  })
}

/** The lines of one fact card's list ("Not finished: 5", "open: 3"), in order. */
export async function factLines(page: Page, testId: string): Promise<string[]> {
  return (await page.getByTestId(testId).locator("li").allTextContents()).map((t) => t.replace(/\s+/g, " ").trim())
}
