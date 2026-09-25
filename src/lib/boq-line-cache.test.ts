/// <reference types="bun-types" />
// PROJEXA-BUILD-001 U-33 (E-09). The device copy of a project's BOQ lines, against a real IndexedDB implementation (fake-indexeddb,
// the same one src/lib/offline/work-progress-queue.test.ts uses).
import "fake-indexeddb/auto"
import { afterEach, describe, expect, test } from "bun:test"
import { createStore, del, keys, set } from "idb-keyval"
import {
  BOQ_CACHE_CHUNK_ROWS,
  clearBoqDeviceCopy,
  openProjectLineWriter,
  readBoqHeader,
  readProjectLines,
  saveBoqHeader,
} from "./boq-line-cache"
import type { GatewayBoqLine } from "./boq-gateway-client"

const USER_A = "user-a-1111"
const USER_B = "user-b-2222"

function line(n: number, boqId = "boq-1"): GatewayBoqLine {
  return {
    id: `line-${String(n).padStart(6, "0")}`, boqId, boqTitle: "Villa 21", boqVersion: 1, boqStatus: "approved", parentLineItemId: null,
    activityId: null, itemCode: `IC-${n}`, category: "Civil", description: `Concrete work ${n}`, unit: "m3", quantity: "10", rate: "5", amount: "50",
  }
}

async function save(scope: string, projectId: string, count: number, opts: { chunkRows?: number; generation?: string; now?: () => Date } = {}) {
  const writer = openProjectLineWriter(scope, projectId, opts)
  const rows = Array.from({ length: count }, (_, i) => line(i + 1))
  for (let i = 0; i < rows.length; i += 500) await writer.addPage(rows.slice(i, i + 500))
  return writer.commit()
}

async function load(scope: string, projectId: string) {
  const got: GatewayBoqLine[] = []
  const info = await readProjectLines(scope, projectId, (rows) => {
    got.push(...rows)
  })
  return { info, got }
}

afterEach(async () => {
  await clearBoqDeviceCopy(USER_A)
  await clearBoqDeviceCopy(USER_B)
})

describe("the project line copy", () => {
  test("a saved copy of 10,907 lines reads back whole and in order, one chunk at a time", async () => {
    const saved = await save(USER_A, "proj-1", 10_907, { now: () => new Date("2026-09-25T10:00:00Z") })
    expect(saved).toEqual({ total: 10_907, savedAt: "2026-09-25T10:00:00.000Z" })
    const chunkSizes: number[] = []
    const ids: string[] = []
    const info = await readProjectLines(USER_A, "proj-1", (rows) => {
      chunkSizes.push(rows.length)
      for (const r of rows) ids.push(r.id)
    })
    expect(info).toEqual({ total: 10_907, savedAt: "2026-09-25T10:00:00.000Z" })
    expect(ids.length).toBe(10_907)
    expect(ids[0]).toBe("line-000001")
    expect(ids[10_906]).toBe("line-010907")
    expect(chunkSizes.every((n) => n <= BOQ_CACHE_CHUNK_ROWS)).toBe(true)
    expect(chunkSizes.length).toBe(Math.ceil(10_907 / BOQ_CACHE_CHUNK_ROWS))
  })

  test("nothing saved reads as no copy", async () => {
    expect((await load(USER_A, "proj-none")).info).toBeNull()
  })

  test("a copy is private to the user who saved it: another user's store is empty", async () => {
    await save(USER_A, "proj-1", 40)
    expect((await load(USER_B, "proj-1")).info).toBeNull()
    expect((await load(USER_A, "proj-1")).info?.total).toBe(40)
  })

  test("there is no unscoped store: an empty scope is refused", async () => {
    await expect(readProjectLines("", "proj-1", () => {})).rejects.toThrow("scope")
  })

  test("a download that stops halfway leaves the previous complete copy readable and writes nothing readable of its own", async () => {
    await save(USER_A, "proj-1", 700, { chunkRows: 100, generation: "old" })
    const half = openProjectLineWriter(USER_A, "proj-1", { chunkRows: 100, generation: "new" })
    await half.addPage(Array.from({ length: 300 }, (_, i) => line(5_000 + i)))
    // never committed: the connection dropped
    const { info, got } = await load(USER_A, "proj-1")
    expect(info?.total).toBe(700)
    expect(got.every((r) => Number(r.id.slice(5)) <= 700)).toBe(true)
    await half.abort()
    expect((await load(USER_A, "proj-1")).info?.total).toBe(700)
  })

  test("a new complete copy replaces the old one and the old copy's chunks are removed", async () => {
    await save(USER_A, "proj-1", 300, { chunkRows: 100, generation: "g1" })
    await save(USER_A, "proj-1", 150, { chunkRows: 100, generation: "g2" })
    expect((await load(USER_A, "proj-1")).info?.total).toBe(150)
    const store = createStore(`projexa-boq-cache::${USER_A}`, "cache")
    const chunkKeys = (await keys(store)).filter((k) => String(k).startsWith("lines:proj-1:"))
    expect(chunkKeys.every((k) => String(k).startsWith("lines:proj-1:g2:"))).toBe(true)
    expect(chunkKeys.length).toBe(2)
  })

  test("two writers for one project: a commit removes only the copy it replaced, never the chunks of a download that is still running", async () => {
    // Writer A is mid-download: two full chunks are stored, the rest is buffered, and no record names its generation yet.
    const a = openProjectLineWriter(USER_A, "proj-1", { chunkRows: 100, generation: "gen-a" })
    await a.addPage(Array.from({ length: 250 }, (_, i) => line(i + 1)))
    // Writer B (a second tab, or a second load of the screen) downloads the same project and saves first.
    const b = openProjectLineWriter(USER_A, "proj-1", { chunkRows: 100, generation: "gen-b" })
    await b.addPage(Array.from({ length: 120 }, (_, i) => line(1000 + i)))
    await b.commit()
    expect((await load(USER_A, "proj-1")).info?.total).toBe(120)
    // A finishes afterwards: its chunks must still be there, so the record it writes names a copy that can be read whole.
    await a.addPage(Array.from({ length: 50 }, (_, i) => line(300 + i)))
    expect((await a.commit()).total).toBe(300)
    const { info, got } = await load(USER_A, "proj-1")
    expect(info?.total).toBe(300)
    expect(new Set(got.map((r) => r.id)).size).toBe(300)
    // The copy A replaced was B's, and B's chunks are gone; only A's remain.
    const store = createStore(`projexa-boq-cache::${USER_A}`, "cache")
    const chunkKeys = (await keys(store)).map(String).filter((k) => k.startsWith("lines:proj-1:"))
    expect(chunkKeys.length).toBe(3)
    expect(chunkKeys.every((k) => k.startsWith("lines:proj-1:gen-a:"))).toBe(true)
  })

  test("two writers for one project, the other way round: the later commit is the readable copy and the earlier copy's chunks are removed", async () => {
    const a = openProjectLineWriter(USER_A, "proj-1", { chunkRows: 100, generation: "gen-a" })
    await a.addPage(Array.from({ length: 250 }, (_, i) => line(i + 1)))
    const b = openProjectLineWriter(USER_A, "proj-1", { chunkRows: 100, generation: "gen-b" })
    await b.addPage(Array.from({ length: 120 }, (_, i) => line(1000 + i)))
    await a.commit()
    expect((await load(USER_A, "proj-1")).info?.total).toBe(250)
    await b.commit()
    const { info, got } = await load(USER_A, "proj-1")
    expect(info?.total).toBe(120)
    expect(got.length).toBe(120)
    const store = createStore(`projexa-boq-cache::${USER_A}`, "cache")
    const chunkKeys = (await keys(store)).map(String).filter((k) => k.startsWith("lines:proj-1:"))
    expect(chunkKeys.every((k) => k.startsWith("lines:proj-1:gen-b:"))).toBe(true)
  })

  test("chunks left by a download that stopped are removed by a later save once a day old; a younger download's chunks and other projects' stay", async () => {
    const now = new Date("2026-09-25T10:00:00Z")
    const t = now.getTime()
    const day = 24 * 60 * 60 * 1000
    const store = createStore(`projexa-boq-cache::${USER_A}`, "cache")
    await set(`lines:proj-1:${t - 2 * day}-stale1:0`, [line(1)], store) // a stopped download from two days ago
    await set(`lines:proj-1:${t - 60_000}-live01:0`, [line(2)], store) // a download that started a minute ago and may still be running
    await set("lines:proj-1:hand-made:0", [line(3)], store) // an id that carries no start time is never removed by age
    await set(`lines:proj-2:${t - 2 * day}-other1:0`, [line(4)], store) // another project's chunks are not this save's business
    await save(USER_A, "proj-1", 20, { now: () => now })
    const remaining = (await keys(store)).map(String).filter((k) => k.startsWith("lines:"))
    expect(remaining.some((k) => k.includes("-stale1:"))).toBe(false)
    expect(remaining.some((k) => k.includes("-live01:"))).toBe(true)
    expect(remaining).toContain("lines:proj-1:hand-made:0")
    expect(remaining.some((k) => k.startsWith("lines:proj-2:"))).toBe(true)
    // its own copy is there, under a generation id that starts with the time the writer started
    expect(remaining.filter((k) => k.startsWith(`lines:proj-1:${t}-`)).length).toBe(1)
    expect((await load(USER_A, "proj-1")).info?.total).toBe(20)
  })

  test("a copy with a missing chunk is reported as absent before any line is streamed", async () => {
    await save(USER_A, "proj-1", 300, { chunkRows: 100, generation: "g1" })
    const store = createStore(`projexa-boq-cache::${USER_A}`, "cache")
    await del("lines:proj-1:g1:1", store)
    const streamed: number[] = []
    const info = await readProjectLines(USER_A, "proj-1", (rows) => {
      streamed.push(rows.length)
    })
    expect(info).toBeNull()
    expect(streamed).toEqual([])
  })

  test("a chunk that is shorter than the record says throws instead of showing a partial list", async () => {
    await save(USER_A, "proj-1", 300, { chunkRows: 100, generation: "g1" })
    const store = createStore(`projexa-boq-cache::${USER_A}`, "cache")
    await set("lines:proj-1:g1:2", [line(1)], store)
    await expect(readProjectLines(USER_A, "proj-1", () => {})).rejects.toThrow("incomplete")
  })

  test("a chunk that is not a list is reported as damaged", async () => {
    await save(USER_A, "proj-1", 200, { chunkRows: 100, generation: "g1" })
    const store = createStore(`projexa-boq-cache::${USER_A}`, "cache")
    await set("lines:proj-1:g1:0", "garbage", store)
    await expect(readProjectLines(USER_A, "proj-1", () => {})).rejects.toThrow("damaged")
  })

  test("two projects keep separate copies", async () => {
    await save(USER_A, "proj-1", 120, { chunkRows: 100 })
    await save(USER_A, "proj-2", 30, { chunkRows: 100 })
    expect((await load(USER_A, "proj-1")).info?.total).toBe(120)
    expect((await load(USER_A, "proj-2")).info?.total).toBe(30)
  })

  test("a writer that is finished refuses more", async () => {
    const w = openProjectLineWriter(USER_A, "proj-1")
    await w.addPage([line(1)])
    await w.commit()
    await expect(w.addPage([line(2)])).rejects.toThrow("finished")
    await expect(w.commit()).rejects.toThrow("finished")
  })

  test("an empty copy is a real copy of zero lines, not an absent one", async () => {
    const w = openProjectLineWriter(USER_A, "proj-empty")
    await w.commit()
    expect((await load(USER_A, "proj-empty")).info?.total).toBe(0)
  })

  test("clearBoqDeviceCopy removes the user's copy and header", async () => {
    await save(USER_A, "proj-1", 20)
    await saveBoqHeader(USER_A, { id: "boq-1", projectId: "proj-1", version: 1, title: "T", status: "draft", parentBoqId: null, createdAt: "2026-09-01T00:00:00Z" })
    await clearBoqDeviceCopy(USER_A)
    expect((await load(USER_A, "proj-1")).info).toBeNull()
    expect(await readBoqHeader(USER_A, "boq-1")).toBeNull()
  })
})

describe("the BOQ header copy", () => {
  const header = { id: "boq-1", projectId: "proj-1", version: 3, title: "Villa 21", status: "approved", parentBoqId: "boq-0", createdAt: "2026-08-28T00:00:00Z" }

  test("round-trips with the time it was saved", async () => {
    await saveBoqHeader(USER_A, header, () => new Date("2026-09-25T09:00:00Z"))
    expect(await readBoqHeader(USER_A, "boq-1")).toEqual({ header, savedAt: "2026-09-25T09:00:00.000Z" })
  })

  test("is private to the user who saved it", async () => {
    await saveBoqHeader(USER_A, header)
    expect(await readBoqHeader(USER_B, "boq-1")).toBeNull()
  })

  test("a record that is not a header is ignored", async () => {
    const store = createStore(`projexa-boq-cache::${USER_A}`, "cache")
    await set("boq:boq-9", { header: { id: 5 }, savedAt: "x" }, store)
    await set("boq:boq-8", "text", store)
    expect(await readBoqHeader(USER_A, "boq-9")).toBeNull()
    expect(await readBoqHeader(USER_A, "boq-8")).toBeNull()
  })
})
