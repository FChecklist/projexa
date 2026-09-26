// PROJEXA-BUILD-002 WP-10. The files this device sent to be read, so the "Proposals and questions" screen can show the ones that still wait
// for a person. VERIDIAN has no list of extraction jobs (a job is read by the hash of its file), so the browser keeps the list.
//
// WHAT IS KEPT: the hash of the file, its name, and when it was sent. Never the file, never a question, never a figure. The state of each
// job is read fresh from the server every time the list is shown. A convenience of this browser only: it can be empty (a private window,
// cleared site data, a second device) and every use of it works without it.
const KEY = "projexa.documentJobs.v1"
export const MAX_REMEMBERED_JOBS = 20

export type RememberedJob = { sha256: string; fileName: string; sentAt: string }

type StorageLike = Pick<Storage, "getItem" | "setItem">

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage
  } catch {
    return null
  }
}

const SHA = /^[0-9a-f]{64}$/

function readAll(storage: StorageLike | null): RememberedJob[] {
  if (!storage) return []
  try {
    const parsed: unknown = JSON.parse(storage.getItem(KEY) ?? "[]")
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (j): j is RememberedJob =>
        !!j && typeof j === "object" && typeof (j as RememberedJob).sha256 === "string" && SHA.test((j as RememberedJob).sha256) && typeof (j as RememberedJob).fileName === "string",
    )
  } catch {
    return []
  }
}

function writeAll(storage: StorageLike | null, jobs: RememberedJob[]): void {
  if (!storage) return
  try {
    storage.setItem(KEY, JSON.stringify(jobs.slice(0, MAX_REMEMBERED_JOBS)))
  } catch {
    // storage full or blocked: the list is a convenience, so nothing else changes
  }
}

/** The remembered jobs, newest first. */
export function listRememberedJobs(storage: StorageLike | null = defaultStorage()): RememberedJob[] {
  return readAll(storage)
}

/** Adds a job (or moves the same file to the front). The name is cut to 200 characters. */
export function rememberJob(job: { sha256: string; fileName: string }, storage: StorageLike | null = defaultStorage(), now: () => Date = () => new Date()): void {
  if (!SHA.test(job.sha256)) return
  const rest = readAll(storage).filter((j) => j.sha256 !== job.sha256)
  writeAll(storage, [{ sha256: job.sha256, fileName: job.fileName.slice(0, 200), sentAt: now().toISOString() }, ...rest])
}

/** Drops a job once it is finished (created or refused) so the list holds only what still waits. */
export function forgetJob(sha256: string, storage: StorageLike | null = defaultStorage()): void {
  const all = readAll(storage)
  const rest = all.filter((j) => j.sha256 !== sha256)
  if (rest.length !== all.length) writeAll(storage, rest)
}
