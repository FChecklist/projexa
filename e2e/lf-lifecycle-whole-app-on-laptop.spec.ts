import { test, expect, type Page } from "@playwright/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { goOffline, goOnline, openLocal, prepareLaptop } from "./support/lf-documents-prepare"
import { dumpDb, personDb } from "./support/lf-lifecycle-stub"
import { trackTraffic } from "./support/lf-vercel-budget"

// AUDIT-100 A6 (the whole app is downloaded into the laptop in the background; FILES only if pinned or recently opened, with caps) in a real Chromium on a
// production build:
//
//     bunx playwright test -c playwright.local-first.fast.config.ts lf-lifecycle-whole-app-on-laptop
//
// THE POLICY (owner decision, src/lib/local-first/shell/modules/documents-file-cache.ts header): the app code, the screens and the database are copied to
// the laptop at the install; FILES are never downloaded in the background (that would cost Storage egress for files nobody opens). A file is kept only when
// the person opens it online (a "recent" file) or presses "Keep on this laptop" (a "pinned" file). Caps: 60 MB per file, 500 MB pinned, 150 MB recent, the
// least recently opened recent file goes first, a pinned file never goes. This spec proves each part in the browser and then reads the result from the
// laptop's own databases; the cap numbers themselves are asserted against the source, and by unit tests (documents-file-cache.test.ts).

const FILE_HOST = "https://files.example.invalid/a6"
const MB = 1024 * 1024

type Kept = { docId: string; size: number; pinned: boolean; openedAt: number }

function keptFiles(page: Page, userId: string): Promise<Kept[]> {
  return page.evaluate(
    (db) =>
      new Promise<Kept[]>((resolve) => {
        const open = indexedDB.open(db)
        open.onerror = () => resolve([])
        open.onsuccess = () => {
          const d = open.result
          if (!d.objectStoreNames.contains("files")) { d.close(); resolve([]); return }
          const r = d.transaction("files", "readonly").objectStore("files").getAll()
          r.onsuccess = () => { d.close(); resolve((r.result as Kept[]).map((f) => ({ docId: f.docId, size: f.size, pinned: f.pinned, openedAt: f.openedAt })).sort((a, b) => (a.docId < b.docId ? -1 : 1))) }
          r.onerror = () => { d.close(); resolve([]) }
        }
      }),
    `projexa-files:${userId}`
  )
}

test("A6: after the install the app code, the screens and the database are on the laptop; no file was downloaded in the background; a file is kept only when opened or pinned", async ({ page, context }) => {
  test.setTimeout(420_000)
  const traffic = trackTraffic(context)
  const installWin = traffic.mark()
  const p = await prepareLaptop(page, context, "owner", "lf-a6-install@example.invalid")
  await page.waitForTimeout(2_000)
  const install = installWin()

  await test.step("the app code: every file of the release manifest is in the laptop's release cache", async () => {
    const result = await page.evaluate(async () => {
      const manifest = (await (await fetch("/_release/release.json", { cache: "no-store" })).json()) as { release_version: string; files: { path: string }[] }
      const cache = await caches.open(`px-release-${manifest.release_version}`)
      const keys = (await cache.keys()).map((r) => new URL(r.url).pathname)
      const missing = manifest.files.map((f) => `/${f.path}`).filter((path) => !keys.includes(path) && path !== "/_shell/local.html")
      return { version: manifest.release_version, files: manifest.files.length, cached: keys.length, missing: missing.slice(0, 10), missingCount: missing.length, shell: keys.includes("/local") }
    })
    console.log(`A6 release ${result.version}: ${result.files} files in the manifest, ${result.cached} in the cache, ${result.missingCount} missing, shell page cached: ${result.shell}`)
    expect(result.files, "an empty manifest").toBeGreaterThan(50)
    expect(result.missing, "files of the release that are not on the laptop").toEqual([])
    expect(result.shell, "the /local shell page is not on the laptop").toBe(true)
  })

  await test.step("the database: every kind of the project is copied, and the rows are in the laptop's own database", async () => {
    const dump = await dumpDb(page, personDb(p.session.userId))
    expect(dump).toContain("Site safety plan")
    expect(dump).toContain("Building permit - podium")
    expect(dump).toContain("A-101 Ground floor plan")
  })

  await test.step("files: NOTHING was downloaded in the background (no signing call, no file request, no kept file)", async () => {
    const asked = install.filter((s) => /\/api\/(documents|permits|drawings)\/|files\.example\.invalid/.test(s.url))
    expect(asked.map((s) => `${s.method} ${s.url}`), "the install asked for a file").toEqual([])
    expect(await keptFiles(page, p.session.userId), "a file was kept before anyone asked").toEqual([])
  })

  await test.step("the screens: offline, a document's screen opens from the laptop and says plainly that its file was not kept (no spinner, no error)", async () => {
    await goOffline(context, p)
    await openLocal(page, "/documents/lf-doc-safety")
    await expect(page.getByTestId("doc-file-absent")).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId("doc-file")).toContainText("The file is not kept on this laptop")
    await goOnline(context, p)
  })

  await test.step("the cap numbers in the source are the documented ones", async () => {
    const src = readFileSync(join(process.cwd(), "src", "lib", "local-first", "shell", "modules", "documents-file-cache.ts"), "utf8")
    expect(src).toMatch(/PINNED_CAP_BYTES = 500 \* 1024 \* 1024/)
    expect(src).toMatch(/RECENT_CAP_BYTES = 150 \* 1024 \* 1024/)
    expect(src).toMatch(/MAX_FILE_BYTES = 60 \* 1024 \* 1024/)
  })
  traffic.stop()
})

test("A6 caps in the real browser: a file over 60 MB is refused; recent files past 150 MB drop the least recently opened; a pinned file is never dropped and does not count against the recent cap", async ({ page, context }) => {
  test.setTimeout(600_000)
  const p = await prepareLaptop(page, context, "owner", "lf-a6-caps@example.invalid")
  const sizes: Record<string, number> = {}
  const big = new Map<number, Buffer>()
  const bytesOf = (n: number) => { if (!big.has(n)) big.set(n, Buffer.alloc(n, 7)); return big.get(n)! }
  const arrange = async (kind: "documents" | "permits" | "drawings", id: string, bytes: number) => {
    sizes[id] = bytes
    const url = `${FILE_HOST}/${id}.pdf`
    const route = kind === "documents" ? `**/api/documents/${id}` : kind === "permits" ? `**/api/permits/${id}` : `**/api/drawings/${id}/document-url`
    await page.route(route, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(kind === "permits" ? { id, documentUrl: url } : { id, signedUrl: url }) }))
    await context.route(url, (r) => r.fulfill({ status: 200, headers: { "content-type": "application/pdf", "access-control-allow-origin": "*" }, body: bytesOf(sizes[id]!) }))
  }
  const openFile = async (path: string, button: "doc-file-open" | "doc-file-keep") => {
    await openLocal(page, path)
    await expect(page.getByTestId(button)).toBeVisible({ timeout: 60_000 })
    await page.getByTestId(button).click()
  }

  await test.step("a file over the 60 MB limit is refused with a plain message and nothing is kept", async () => {
    await arrange("documents", "lf-doc-safety", 61 * MB)
    await openFile("/documents/lf-doc-safety", "doc-file-keep")
    const message = page.getByTestId("doc-file-message")
    await expect(message).toBeVisible({ timeout: 120_000 })
    await expect(message).toContainText("too large to keep on this laptop")
    await expect(message).toContainText("60 MB")
    expect(await keptFiles(page, p.session.userId), "an over-limit file was kept").toEqual([])
  })

  await test.step("three recent files of 55 MB (165 MB, past the 150 MB cap): the least recently opened is dropped, the other two stay", async () => {
    await arrange("documents", "lf-doc-safety", 55 * MB)
    await arrange("documents", "lf-doc-long", 55 * MB)
    await arrange("documents", "lf-doc-unicode", 55 * MB)
    for (const id of ["lf-doc-safety", "lf-doc-long", "lf-doc-unicode"]) {
      await openFile(`/documents/${id}`, "doc-file-open")
      await expect(page.getByTestId("doc-file-kept")).toBeVisible({ timeout: 120_000 })
      await page.waitForTimeout(150) // distinct "opened at" times
    }
    const kept = await keptFiles(page, p.session.userId)
    console.log(`A6 recent after three 55 MB opens: ${JSON.stringify(kept.map((k) => ({ id: k.docId, mb: Math.round(k.size / MB), pinned: k.pinned })))}`)
    expect(kept.map((k) => k.docId), "the least recently opened recent file should have been dropped").toEqual(["lf-doc-long", "lf-doc-unicode"])
    expect(kept.every((k) => !k.pinned)).toBe(true)
    expect(kept.reduce((s, k) => s + k.size, 0), "recent files are over the 150 MB cap").toBeLessThanOrEqual(150 * MB)
  })

  await test.step("a pinned file (permit, 55 MB) is kept on top, never dropped, and does not push a recent file out", async () => {
    await arrange("permits", "lf-permit-dm", 55 * MB)
    await openFile("/permits/lf-permit-dm", "doc-file-keep")
    await expect(page.getByTestId("doc-file-kept")).toHaveAttribute("data-pinned", "1", { timeout: 120_000 })
    const kept = await keptFiles(page, p.session.userId)
    expect(kept.map((k) => `${k.docId}:${k.pinned ? "pinned" : "recent"}`)).toEqual(["lf-doc-long:recent", "lf-doc-unicode:recent", "lf-permit-dm:pinned"])
  })

  await test.step("offline: the kept files (recent and pinned) open from the laptop; the dropped one says it is not kept", async () => {
    await goOffline(context, p)
    for (const [path, id] of [["/documents/lf-doc-long", "lf-doc-long"], ["/permits/lf-permit-dm", "lf-permit-dm"]] as const) {
      await openLocal(page, path)
      await expect(page.getByTestId("doc-file-kept"), `${id} should open from the laptop`).toBeVisible({ timeout: 60_000 })
    }
    await openLocal(page, "/documents/lf-doc-safety")
    await expect(page.getByTestId("doc-file-absent")).toBeVisible({ timeout: 60_000 })
    await goOnline(context, p)
  })
})
