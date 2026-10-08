// P3 (2026-10-08): the BOQ list read weight, in one place.
//
// GET /api/scope?projectId= without `include=headers` ships every line item of every revision (measured ~12 MB on the
// largest live project and past PROJEXA's 8 s upstream budget). Screens that only need BOQ headers (id, title, version,
// status, parent) send `include=headers`; screens that need lines for ONE BOQ read the headers, pick that BOQ, and then
// ask for it alone with GET /api/scope/{id}. Nothing here reads all lines of all revisions.
import { fetchJson } from "@/lib/fetch-json"
import { pickCurrentBoq } from "@/lib/work-progress-reads"

export type ScopeFetcher = <T>(url: string) => Promise<T>

/** The list URL for screens that need headers only. */
export function scopeHeadersUrl(projectId: string): string {
  return `/api/scope?projectId=${encodeURIComponent(projectId)}&include=headers`
}

/** Headers of every BOQ of the project (no line items). */
export function readScopeHeaders<B = { id: string; version: number; status: string }>(
  projectId: string,
  fetcher: ScopeFetcher = (url) => fetchJson(url),
): Promise<{ boqs?: B[] }> {
  return fetcher<{ boqs?: B[] }>(scopeHeadersUrl(projectId))
}

/**
 * Line items of the project's CURRENT BOQ only (approved, else submitted, else highest version: the same rule the work-progress
 * form uses). Two small requests: headers, then that one BOQ.
 */
export async function readCurrentBoqLines<L>(
  projectId: string,
  fetcher: ScopeFetcher = (url) => fetchJson(url),
): Promise<L[]> {
  const { boqs } = await readScopeHeaders<{ id: string; version: number; status: string }>(projectId, fetcher)
  const current = pickCurrentBoq(boqs ?? [])
  if (!current) return []
  const boq = await fetcher<{ lineItems?: L[] }>(`/api/scope/${encodeURIComponent(current.id)}`)
  return boq.lineItems ?? []
}
