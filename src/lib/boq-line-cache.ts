// PROJEXA-BUILD-001 U-33 (E-09). The device copy of a project's BOQ lines, in IndexedDB (idb-keyval, already a dependency), so the BOQ
// screen can show them with the network off after one online load. Only used when BUILD001_BOQ_BROWSER_FIRST is on.
//
// WHAT IS KEPT. Exactly what the gateway returned: the line items without any project-side cost field (the gateway never sends those,
// see boq-gateway-client.ts), plus the small BOQ header the screen needs. A cost figure the person is not cleared to see never reaches
// this store, which is the reason the money grid (BoqDualViewGrid) is not cached here.
//
// WHO CAN READ IT. One store per signed-in user id, the same rule src/lib/offline/work-progress-queue.ts adopted after its audit: on a
// shared device a second user opens a different, empty store and never sees the first user's copy. There is no unscoped store.
//
// HOW A SAVE STAYS WHOLE. Lines are written in chunks under a fresh generation id, and only when every chunk is in does the small
// `project:<id>` record flip to the new generation. A download that stops halfway therefore leaves the previous complete copy readable
// and the half-written chunks unreachable, never a mixed list. Reading checks that every chunk the record names is present and that the
// line count matches before it calls the copy complete.
//
// TWO WRITERS FOR ONE PROJECT (two tabs, or two loads of one screen). Each commit swaps the record in one IndexedDB transaction that also
// tells it which copy it replaced, and removes exactly that copy's chunks. It never removes another generation's chunks just because
// they are not its own: those may belong to a download that is still running, and taking them would let that download commit a record
// whose chunks are gone. Chunks left by a download that stopped (a closed tab) carry the time their writer started in their generation
// id and are removed by a later commit once they are older than BOQ_CACHE_ORPHAN_AFTER_MS.

import { clear, createStore, del, get, keys, set, update, type UseStore } from "idb-keyval"
import type { Boq } from "./boq-helpers"
import type { GatewayBoqLine } from "./boq-gateway-client"

/** Rows per stored chunk. A chunk is one structured clone, so this bounds the work of a single read or write. */
export const BOQ_CACHE_CHUNK_ROWS = 500

/** Chunks whose writer started longer ago than this, and that no record names, were left by a download that stopped. */
export const BOQ_CACHE_ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000

const storesByScope = new Map<string, UseStore>()

function storeFor(scope: string): UseStore {
  if (!scope) throw new Error("The BOQ device copy needs the signed-in user id as its scope")
  let store = storesByScope.get(scope)
  if (!store) {
    store = createStore(`projexa-boq-cache::${scope}`, "cache")
    storesByScope.set(scope, store)
  }
  return store
}

type ProjectRecord = { generation: string; chunks: number; total: number; savedAt: string }
type HeaderRecord = { header: Boq; savedAt: string }

const headerKey = (boqId: string) => `boq:${boqId}`
const projectKey = (projectId: string) => `project:${projectId}`
const chunkKey = (projectId: string, generation: string, n: number) => `lines:${projectId}:${generation}:${n}`
const chunkPrefix = (projectId: string) => `lines:${projectId}:`

/** "<start time in ms>-<random>". The start time is what lets a later save tell a stopped download's chunks from a running one's. */
const newGeneration = (now: () => Date) => `${now().getTime()}-${Math.random().toString(36).slice(2, 8)}`

/** When the writer of this generation started, or null for an id that does not carry a time (those are never removed by age). */
function generationStartedAt(generation: string): number | null {
  const m = /^(\d{10,})-/.exec(generation)
  return m ? Number(m[1]) : null
}

/** The generation part of one of this project's chunk keys, or null for any other key. */
function generationOfChunkKey(projectId: string, key: string): string | null {
  const prefix = chunkPrefix(projectId)
  if (!key.startsWith(prefix)) return null
  const rest = key.slice(prefix.length)
  const cut = rest.lastIndexOf(":")
  return cut > 0 ? rest.slice(0, cut) : null
}

function isProjectRecord(v: unknown): v is ProjectRecord {
  const r = v as ProjectRecord | null
  return !!r && typeof r.generation === "string" && Number.isInteger(r.chunks) && r.chunks >= 0 && Number.isInteger(r.total) && r.total >= 0 && typeof r.savedAt === "string"
}

function isHeaderRecord(v: unknown): v is HeaderRecord {
  const r = v as HeaderRecord | null
  const h = r?.header
  return !!h && typeof r!.savedAt === "string" && typeof h.id === "string" && typeof h.projectId === "string" && typeof h.title === "string" && typeof h.status === "string" && typeof h.version === "number"
}

export async function saveBoqHeader(scope: string, header: Boq, now: () => Date = () => new Date()): Promise<void> {
  const record: HeaderRecord = {
    header: {
      id: header.id, projectId: header.projectId, version: header.version, title: header.title,
      status: header.status, parentBoqId: header.parentBoqId ?? null, createdAt: header.createdAt,
    },
    savedAt: now().toISOString(),
  }
  await set(headerKey(header.id), record, storeFor(scope))
}

export async function readBoqHeader(scope: string, boqId: string): Promise<{ header: Boq; savedAt: string } | null> {
  const record = await get<unknown>(headerKey(boqId), storeFor(scope))
  return isHeaderRecord(record) ? record : null
}

export type ProjectLineWriter = {
  /** Buffers a page and writes every full chunk. */
  addPage: (rows: readonly GatewayBoqLine[]) => Promise<void>
  /** Writes the last partial chunk, then makes this copy the readable one and removes the chunks of the copy it replaced. */
  commit: () => Promise<{ total: number; savedAt: string }>
  /** Removes what this writer has written so far. The previous complete copy is untouched. */
  abort: () => Promise<void>
}

export function openProjectLineWriter(
  scope: string,
  projectId: string,
  options: { chunkRows?: number; now?: () => Date; generation?: string } = {}
): ProjectLineWriter {
  const store = storeFor(scope)
  const chunkRows = options.chunkRows ?? BOQ_CACHE_CHUNK_ROWS
  const now = options.now ?? (() => new Date())
  const generation = options.generation ?? newGeneration(now)
  let buffer: GatewayBoqLine[] = []
  let chunks = 0
  let total = 0
  let finished = false

  async function flush() {
    if (buffer.length === 0) return
    const rows = buffer
    buffer = []
    await set(chunkKey(projectId, generation, chunks), rows, store)
    chunks += 1
  }

  async function removeOwnChunks() {
    for (let n = 0; n < chunks; n++) await del(chunkKey(projectId, generation, n), store)
  }

  return {
    async addPage(rows) {
      if (finished) throw new Error("This writer is already finished")
      for (const row of rows) {
        buffer.push(row)
        total += 1
        if (buffer.length >= chunkRows) await flush()
      }
    },
    async commit() {
      if (finished) throw new Error("This writer is already finished")
      await flush()
      finished = true
      const savedAt = now().toISOString()
      // One transaction swaps the record and reports which copy it replaced (an object, so the assignment inside the callback is seen).
      const swap: { replaced: ProjectRecord | null } = { replaced: null }
      await update<unknown>(
        projectKey(projectId),
        (old) => {
          swap.replaced = isProjectRecord(old) ? old : null
          return { generation, chunks, total, savedAt } satisfies ProjectRecord
        },
        store
      )
      // The replaced copy is unreachable now, and so are chunks a stopped download left behind. Removing them is tidying, so a failure
      // here must not fail the save; it is left for the next one.
      try {
        const replaced = swap.replaced
        if (replaced && replaced.generation !== generation) {
          for (let n = 0; n < replaced.chunks; n++) await del(chunkKey(projectId, replaced.generation, n), store)
        }
        const cutoff = now().getTime() - BOQ_CACHE_ORPHAN_AFTER_MS
        const orphans = (await keys(store)).filter((k): k is string => {
          if (typeof k !== "string") return false
          const other = generationOfChunkKey(projectId, k)
          if (other === null || other === generation) return false
          const startedAt = generationStartedAt(other)
          return startedAt !== null && startedAt < cutoff
        })
        for (const k of orphans) await del(k, store)
      } catch {
        // left for the next successful save
      }
      return { total, savedAt }
    },
    async abort() {
      finished = true
      buffer = []
      await removeOwnChunks()
    },
  }
}

/**
 * Streams the saved copy of a project's lines, one stored chunk at a time, into `onChunk`. Resolves with the copy's size and save time,
 * or null when there is no complete copy. A copy with a missing chunk is reported as absent before anything is streamed, and a copy
 * whose lines do not add up to the recorded total throws, so a caller never mistakes a partial list for the whole one.
 */
export async function readProjectLines(
  scope: string,
  projectId: string,
  onChunk: (rows: GatewayBoqLine[]) => void | Promise<void>
): Promise<{ total: number; savedAt: string } | null> {
  const store = storeFor(scope)
  const record = await get<unknown>(projectKey(projectId), store)
  if (!isProjectRecord(record)) return null

  const present = new Set((await keys(store)).filter((k): k is string => typeof k === "string"))
  for (let n = 0; n < record.chunks; n++) {
    if (!present.has(chunkKey(projectId, record.generation, n))) return null
  }

  let seen = 0
  for (let n = 0; n < record.chunks; n++) {
    const rows = await get<unknown>(chunkKey(projectId, record.generation, n), store)
    if (!Array.isArray(rows)) throw new Error("The BOQ copy on this device is damaged")
    seen += rows.length
    await onChunk(rows as GatewayBoqLine[])
  }
  if (seen !== record.total) throw new Error("The BOQ copy on this device is incomplete")
  return { total: record.total, savedAt: record.savedAt }
}

/** Removes everything this user's device copy holds. */
export async function clearBoqDeviceCopy(scope: string): Promise<void> {
  await clear(storeFor(scope))
}

const STORE_NAME_PREFIX = "projexa-boq-cache::"

/**
 * Empties the device copy of EVERY user this browser holds one for. Sign-out calls it: the copy is a project's whole BOQ, and it must
 * not stay on a shared device once the session is gone. It goes by the store names the browser lists, not by the signed-in user id,
 * so it also works on the sign-out another tab did (the event then carries no session). It never throws: signing out must not depend
 * on it, and a browser that cannot list its databases has no copy this code could have found either.
 */
export async function clearBoqDeviceCopiesOnSignOut(): Promise<void> {
  try {
    if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return
    for (const db of await indexedDB.databases()) {
      if (db.name?.startsWith(STORE_NAME_PREFIX)) await clear(createStore(db.name, "cache"))
    }
  } catch (err) {
    console.warn("The BOQ copy on this device could not be cleared at sign-out", err)
  }
}
