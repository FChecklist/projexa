// PROJEXA-BUILD-001 U-33. Shared set-up for the two local browser-first BOQ specs (boq-offline.spec.ts, boq-worker-filter.spec.ts). They run
// against a local PROJEXA server started by playwright.boq-local.config.ts, with:
//   * a synthetic signed-in browser (a session cookie signed by the local Auth stand-in, e2e/support/fake-supabase-server.mjs): no real
//     session is minted and no real Supabase project is contacted;
//   * the Edge gateway and every /api call of the page answered by this file through page.route, from synthetic fixture data;
//   * "offline" meaning both the browser's own switch (context.setOffline) and this file refusing every stubbed request.
// Nothing here reaches Vercel or any real network.
import type { BrowserContext, Page, Request as PwRequest, Route } from "@playwright/test"
import type { ProjectFixture } from "./boq-fixture"

// Written out in full on purpose. The specs must fail if src/lib/boq-gateway-client.ts names a different address, so this is not imported.
export const GATEWAY_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-read"

export const APP_PORT = Number(process.env.BOQ_LOCAL_PORT ?? 3117)
export const STUB_PORT = Number(process.env.BOQ_LOCAL_SUPABASE_PORT ?? 54399)
export const APP_ORIGIN = `http://localhost:${APP_PORT}`

export type LocalSession = { userId: string; email: string; accessToken: string; cookieName: string; cookieValue: string }

/** Asks the local Auth stand-in for a made-up signed-in person and puts that person's session cookie in the browser context. */
export async function signInLocally(context: BrowserContext, email = "boq-spec@example.invalid"): Promise<LocalSession> {
  const res = await fetch(`http://localhost:${STUB_PORT}/__session?email=${encodeURIComponent(email)}`)
  if (!res.ok) throw new Error(`the local Auth stand-in answered HTTP ${res.status}`)
  const session = (await res.json()) as LocalSession
  await context.addCookies([{ name: session.cookieName, value: session.cookieValue, url: APP_ORIGIN }])
  return session
}

export type GatewayStub = {
  /** Requests the stub answered with a page, in order. */
  served: Array<{ after: string | null; limit: number; projectId: string | null; authorization: string | undefined; cookie: string | undefined; keys: string[] }>
  /** Requests that arrived while the stub was offline. */
  refusedWhileOffline: number
  setOffline: (offline: boolean) => void
}

const CORS = (origin: string | undefined) => ({
  "access-control-allow-origin": origin ?? "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, OPTIONS",
  vary: "Authorization, Origin",
})

/** Answers the Edge gateway exactly as its README says: the project's lines in id order, `limit` at a time, nextAfter until null. */
export async function stubGateway(page: Page, fixture: ProjectFixture, expectedToken: string): Promise<GatewayStub> {
  const state = { offline: false }
  const stub: GatewayStub = { served: [], refusedWhileOffline: 0, setOffline: (offline) => { state.offline = offline } }
  await page.route(`${GATEWAY_URL}**`, async (route: Route, request: PwRequest) => {
    const origin = request.headers()["origin"]
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: CORS(origin) })
      return
    }
    if (state.offline) {
      stub.refusedWhileOffline += 1
      await route.abort("internetdisconnected")
      return
    }
    const url = new URL(request.url())
    const headers = request.headers()
    if (headers["authorization"] !== `Bearer ${expectedToken}`) {
      await route.fulfill({ status: 401, headers: { ...CORS(origin), "content-type": "application/json" }, body: JSON.stringify({ error: "Unauthorized" }) })
      return
    }
    const after = url.searchParams.get("after")
    const limit = Number(url.searchParams.get("limit"))
    stub.served.push({ after, limit, projectId: url.searchParams.get("projectId"), authorization: headers["authorization"], cookie: headers["cookie"], keys: [...url.searchParams.keys()].sort() })
    if (url.searchParams.get("fn") !== "boq_lines" || url.searchParams.get("projectId") !== fixture.projectId || !(limit >= 1 && limit <= 500)) {
      await route.fulfill({ status: 400, headers: { ...CORS(origin), "content-type": "application/json" }, body: JSON.stringify({ error: "bad request" }) })
      return
    }
    const start = after === null ? 0 : fixture.lines.findIndex((l) => l.id === after) + 1
    const rows = fixture.lines.slice(start, start + limit)
    const nextAfter = start + limit < fixture.lines.length ? rows[rows.length - 1].id : null
    await route.fulfill({
      status: 200,
      headers: { ...CORS(origin), "content-type": "application/json", "cache-control": "private, no-store" },
      body: JSON.stringify({ fn: "boq_lines", projectId: fixture.projectId, rows, nextAfter }),
    })
  })
  return stub
}

export type AppStub = {
  /** Every /api request the page made, as "METHOD path". */
  requests: string[]
  setOffline: (offline: boolean) => void
}

/**
 * Answers every /api call of the page. The BOQ proxy read carries one line ("REST proxy line") that must never appear on a screen that
 * reads through the gateway. Anything not listed gets an empty JSON object, which the shell reads as "nothing to show".
 */
export async function stubAppApis(page: Page, fixture: ProjectFixture, who: { userId: string; email: string }): Promise<AppStub> {
  const state = { offline: false }
  const app: AppStub = { requests: [], setOffline: (offline) => { state.offline = offline } }
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) })

  await page.route("**/api/**", async (route, request) => {
    const url = new URL(request.url())
    if (url.origin !== APP_ORIGIN) return route.fallback()
    app.requests.push(`${request.method()} ${url.pathname}${url.search}`)
    if (state.offline) return route.abort("internetdisconnected")
    if (request.method() !== "GET") return json(route, {})
    if (url.pathname === `/api/scope/${fixture.boqId}`) {
      return json(route, {
        ...fixture.header,
        lineItems: [{ id: "rest-proxy-line", itemCode: null, description: "REST proxy line", unit: "m2", quantity: "1", rate: "1", amount: "1", activityId: null }],
      })
    }
    if (url.pathname === "/api/shell") {
      // The shell's one bootstrap read (src/app/api/shell/route.ts ShellBootstrapPayload), with every list present and empty.
      return json(route, {
        organization: { id: "fixture-org", name: "Fixture Builders", slug: "fixture-builders", country: "AE" },
        role: "owner", email: who.email, userId: who.userId,
        projects: [{ id: fixture.projectId, name: "Fixture Tower" }],
        notifications: [], unreadCount: 0, pillUsage: [], recentChains: [], history: [], isNewUser: false, capabilityTree: [],
        currencies: [{ code: "AED", isBaseCurrency: true }], vendors: [], fetchedAt: Date.now(), errors: {},
      })
    }
    if (url.pathname === "/api/scope/categories") return json(route, { categories: [] })
    if (url.pathname === "/api/scope") return json(route, { boqs: [fixture.header] })
    if (url.pathname === "/api/vendors") return json(route, { vendors: [] })
    if (url.pathname === "/api/currencies") return json(route, { currencies: [{ code: "AED", isBaseCurrency: true }] })
    return json(route, {})
  })
  return app
}

/** Reads what the device copy holds, straight from IndexedDB, so the spec checks what was stored and not what the screen says. */
export async function readDeviceCopyMeta(page: Page, userId: string, projectId: string): Promise<{ total: number; chunks: number } | null> {
  return page.evaluate(
    ({ userId, projectId }) =>
      new Promise<{ total: number; chunks: number } | null>((resolve, reject) => {
        const open = indexedDB.open(`projexa-boq-cache::${userId}`)
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const db = open.result
          if (!db.objectStoreNames.contains("cache")) {
            db.close()
            resolve(null)
            return
          }
          const get = db.transaction("cache", "readonly").objectStore("cache").get(`project:${projectId}`)
          get.onerror = () => reject(get.error)
          get.onsuccess = () => {
            db.close()
            const record = get.result as { total?: number; chunks?: number } | undefined
            resolve(record && typeof record.total === "number" && typeof record.chunks === "number" ? { total: record.total, chunks: record.chunks } : null)
          }
        }
      }),
    { userId, projectId }
  )
}
