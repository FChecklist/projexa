// PROJEXA-BUILD-002 WP-10 (way 1 and way 2). The browser side of "make a project from a file": it sends the file to this app's proxy of
// VERIDIAN's POST /api/v1/projexa/projects/from-document, then reads the job by the SHA-256 of the file until it stops moving.
//
// THE JOB CONTRACT (compliance-tracker src/app/api/v1/projexa/projects/from-document/route.ts), reached through /api/projects/from-document
//   POST multipart  file, productId, name?, mode=prepare|create, acknowledgeQuestions?, acknowledgeShortfall?
//        the proxy always adds ?async=1, so the answer is quick:
//          202 {state, jobId}            the file was claimed and is read after the answer
//          200 {duplicate:true, projectId}   this exact file already made a project; nothing was inserted
//   GET  ?sha256=<hex> or ?jobId=<id>   200 the job: {jobId, state, fileName, projectId, questions[], reconciliation, stats, error, updatedAt}
//   States: received, reading (moving), needs_answers, ready, created, rejected (stopped).
//   Every refusal is {error, code, upstreamCode?, issues?}. `error` is a plain sentence and is shown as it is.
//
// WHAT THIS FILE NEVER DOES WITH THE FILE. The bytes go into one FormData for the one POST and are hashed in the browser; they are not
// written to storage, a URL, a log line or an error message. Only the hash, the name and the state ever leave this module as data.
import { MB, checkFile, type AttachPolicy } from "@/lib/attachments"

export const FROM_DOCUMENT_URL = "/api/projects/from-document"

/**
 * The server reads a file of at most 5 MB (WORKBOOK_LIMITS.maxBytes), but the file travels through this app's proxy, and a Vercel function
 * refuses a request body over about 4.5 MB. 4 MB leaves room for the form around the file; a larger number here would be a promise the
 * platform breaks after the upload.
 */
export const DOCUMENT_MAX_BYTES = 4 * MB

/** What the picker offers. The server reads .xlsx today and answers any other type with its own sentence, which the screen shows as it is. */
export const DOCUMENT_ACCEPT = [".xlsx", ".pdf", ".docx"] as const

export const DOCUMENT_POLICY: AttachPolicy = {
  label: "Attach a project file, up to 4 MB",
  accept: DOCUMENT_ACCEPT,
  acceptWords: "an Excel (.xlsx), PDF or Word (.docx) file",
  maxBytes: DOCUMENT_MAX_BYTES,
  maxFiles: 1,
}

/** The sentence for a file that cannot be sent, or null. The refusal happens here, before any byte moves. */
export function checkDocumentFile(file: { name: string; size: number }): string | null {
  if (file.size === 0) return "This file is empty"
  return checkFile(file, DOCUMENT_POLICY)
}

export const JOB_STATES = ["received", "reading", "needs_answers", "ready", "created", "rejected"] as const
export type JobState = (typeof JOB_STATES)[number]
/** The states a job stays in until a person acts, or for ever. */
export const SETTLED_STATES: ReadonlySet<JobState> = new Set<JobState>(["needs_answers", "ready", "created", "rejected"])

export type DocQuestion = { kind: string; sheet: string; row: number; text: string }

export type AreaReconciliation = { area: string; expected: number; actual: number; difference: number; status: string }

export type DocReconciliation = {
  status: "matched" | "shortfall" | "excess" | "not_checked"
  expected: number | null
  actual: number
  difference: number | null
  tolerance: number
  /** Who read the lines: the fixed rules of the deterministic reader, an AI model, or nobody (no totals to check against). */
  source: "reader" | "model" | "none"
  byArea: AreaReconciliation[]
}

export type DocStats = { sheets: number; rows: number; lines: number }

export type DocJob = {
  jobId: string
  state: JobState
  fileName: string | null
  projectId: string | null
  questions: DocQuestion[]
  reconciliation: DocReconciliation | null
  stats: DocStats | null
  /** Set when the job was refused: the code and the sentence, and the issues the server listed. */
  error: { code: string; message: string; issues: string[] } | null
  updatedAt: string
}

export type SubmitInput = {
  file: File
  productId: string
  name?: string
  mode: "prepare" | "create"
  acknowledgeQuestions?: boolean
  acknowledgeShortfall?: boolean
}

export type SubmitResult = { kind: "duplicate"; projectId: string } | { kind: "queued"; state: JobState; jobId: string }

/** An answer that is not a success. `status` is the HTTP status, or 0 when nothing was received. `code` is the server's own code when it sent one. */
export class DocumentError extends Error {
  readonly status: number
  readonly code: string | null
  readonly issues: string[]

  constructor(message: string, status: number, code: string | null = null, issues: string[] = []) {
    super(message)
    this.name = "DocumentError"
    this.status = status
    this.code = code
    this.issues = issues
  }
}

export type FromDocumentClient = {
  /** The SHA-256 of the file bytes, lower-case hex: the key the job is read by. */
  fingerprint: (file: File) => Promise<string>
  submit: (input: SubmitInput) => Promise<SubmitResult>
  job: (ref: { sha256: string } | { jobId: string }) => Promise<DocJob>
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

function unreadable(): DocumentError {
  return new DocumentError("The server sent an answer this page cannot read. Nothing was changed. Try again in a minute.", 502, "BAD_ANSWER")
}

function isState(v: unknown): v is JobState {
  return typeof v === "string" && (JOB_STATES as readonly string[]).includes(v)
}

function parseQuestions(raw: unknown): DocQuestion[] {
  if (!Array.isArray(raw)) return []
  const out: DocQuestion[] = []
  for (const q of raw) {
    if (!isObject(q) || typeof q.text !== "string") continue
    out.push({ kind: str(q.kind) ?? "unclear", sheet: str(q.sheet) ?? "", row: num(q.row) ?? 0, text: q.text })
  }
  return out
}

function parseReconciliation(raw: unknown): DocReconciliation | null {
  if (!isObject(raw)) return null
  const status = raw.status
  if (status !== "matched" && status !== "shortfall" && status !== "excess" && status !== "not_checked") return null
  const byArea: AreaReconciliation[] = []
  if (Array.isArray(raw.byArea)) {
    for (const a of raw.byArea) {
      if (!isObject(a) || typeof a.area !== "string") continue
      byArea.push({ area: a.area, expected: num(a.expected) ?? 0, actual: num(a.actual) ?? 0, difference: num(a.difference) ?? 0, status: str(a.status) ?? "" })
    }
  }
  const source = raw.source === "reader" || raw.source === "model" ? raw.source : "none"
  return { status, expected: num(raw.expected), actual: num(raw.actual) ?? 0, difference: num(raw.difference), tolerance: num(raw.tolerance) ?? 0, source, byArea }
}

function parseStats(raw: unknown): DocStats | null {
  if (!isObject(raw)) return null
  return { sheets: num(raw.sheets) ?? 0, rows: num(raw.rows) ?? 0, lines: num(raw.lines) ?? 0 }
}

/** A job answer of the server as a DocJob. Throws DocumentError BAD_ANSWER when the answer is not one. */
export function parseJob(raw: unknown): DocJob {
  if (!isObject(raw) || typeof raw.jobId !== "string" || !isState(raw.state)) throw unreadable()
  let error: DocJob["error"] = null
  if (isObject(raw.error) && typeof raw.error.message === "string") {
    error = {
      code: str(raw.error.code) ?? "rejected",
      message: raw.error.message,
      issues: Array.isArray(raw.error.issues) ? raw.error.issues.filter((i): i is string => typeof i === "string") : [],
    }
  }
  return {
    jobId: raw.jobId,
    state: raw.state,
    fileName: str(raw.fileName),
    projectId: str(raw.projectId),
    questions: parseQuestions(raw.questions),
    reconciliation: parseReconciliation(raw.reconciliation),
    stats: parseStats(raw.stats),
    error,
    updatedAt: str(raw.updatedAt) ?? "",
  }
}

function parseSubmit(raw: unknown): SubmitResult {
  if (!isObject(raw)) throw unreadable()
  if (raw.duplicate === true && typeof raw.projectId === "string") return { kind: "duplicate", projectId: raw.projectId }
  if (typeof raw.jobId === "string" && isState(raw.state)) return { kind: "queued", state: raw.state, jobId: raw.jobId }
  throw unreadable()
}

/** The refusal a non-2xx answer stands for, in the server's own words. */
async function refusalOf(res: Response): Promise<DocumentError> {
  const body: unknown = await res.json().catch(() => null)
  const message = isObject(body) && typeof body.error === "string" && body.error.trim() ? body.error.trim() : `The request failed (HTTP ${res.status}). Nothing was changed.`
  const code = isObject(body) ? (str(body.upstreamCode) ?? str(body.code)) : null
  const issues = isObject(body) && Array.isArray(body.issues) ? body.issues.filter((i): i is string => typeof i === "string") : []
  return new DocumentError(message, res.status, code, issues)
}

function unreached(): DocumentError {
  return new DocumentError("The server could not be reached. Nothing was changed. Check the connection and try again.", 0, "NETWORK")
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  const digest = await crypto.subtle.digest("SHA-256", view as unknown as ArrayBuffer)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

export function createFromDocumentClient(deps: { fetch?: typeof fetch; url?: string } = {}): FromDocumentClient {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init))
  const url = deps.url ?? FROM_DOCUMENT_URL

  return {
    fingerprint: async (file) => sha256Hex(await file.arrayBuffer()),

    async submit(input) {
      const form = new FormData()
      form.append("file", input.file, input.file.name)
      form.append("productId", input.productId)
      if (input.name && input.name.trim()) form.append("name", input.name.trim())
      form.append("mode", input.mode)
      if (input.acknowledgeQuestions) form.append("acknowledgeQuestions", "true")
      if (input.acknowledgeShortfall) form.append("acknowledgeShortfall", "true")
      let res: Response
      try {
        res = await doFetch(url, { method: "POST", body: form, cache: "no-store" })
      } catch {
        throw unreached()
      }
      if (!res.ok) throw await refusalOf(res)
      return parseSubmit(await res.json().catch(() => null))
    },

    async job(ref) {
      const query = "sha256" in ref ? `sha256=${encodeURIComponent(ref.sha256)}` : `jobId=${encodeURIComponent(ref.jobId)}`
      let res: Response
      try {
        res = await doFetch(`${url}?${query}`, { method: "GET", cache: "no-store" })
      } catch {
        throw unreached()
      }
      if (!res.ok) throw await refusalOf(res)
      return parseJob(await res.json().catch(() => null))
    },
  }
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => { clearTimeout(timer); resolve() }, { once: true })
  })

export type WaitOptions = {
  intervalMs?: number
  timeoutMs?: number
  /** Failures in a row (a dropped connection, a 5xx) that are read past before the wait gives up. */
  maxFailures?: number
  signal?: AbortSignal
  onState?: (job: DocJob) => void
  /**
   * The `updatedAt` of the job as it was before the request that is being waited for. A parked job answers with its old state until the
   * server has picked the request up, so a settled answer that still carries this stamp is the old one and is read past.
   */
  staleUpdatedAt?: string
  /** Test seams. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
}

/**
 * Reads the job of a file by its hash until it is in a settled state, and returns it. A job the server reads (received, reading) is waited
 * for; a stopped one is returned at once (unless it is the old answer named by `staleUpdatedAt`). Gives up with DocumentError poll_timeout after `timeoutMs`, and with `aborted` when the signal fires.
 */
export async function waitForJob(client: FromDocumentClient, sha256: string, options: WaitOptions = {}): Promise<DocJob> {
  const interval = options.intervalMs ?? 1500
  const timeout = options.timeoutMs ?? 180_000
  const maxFailures = options.maxFailures ?? 3
  const sleep = options.sleep ?? defaultSleep
  const now = options.now ?? Date.now
  const started = now()
  let failures = 0
  for (;;) {
    if (options.signal?.aborted) throw new DocumentError("Stopped watching this file.", 0, "aborted")
    try {
      const job = await client.job({ sha256 })
      failures = 0
      options.onState?.(job)
      const stale = options.staleUpdatedAt !== undefined && job.updatedAt === options.staleUpdatedAt
      if (SETTLED_STATES.has(job.state) && !stale) return job
    } catch (error) {
      const transient = error instanceof DocumentError && (error.status === 0 || error.status >= 500)
      failures += 1
      if (!transient || failures > maxFailures) throw error
    }
    if (now() - started >= timeout) {
      throw new DocumentError("The file is still being read after several minutes. It keeps going on the server; open it again from Proposals and questions.", 504, "poll_timeout")
    }
    await sleep(interval, options.signal)
  }
}

export type ProductOption = { id: string; name: string }

/** The organisation's products, from this app's own proxy (the same read as the product picker of /projects/new). */
export async function loadProductOptions(): Promise<ProductOption[]> {
  const res = await fetch("/api/products", { cache: "no-store" })
  if (!res.ok) throw new Error(`products: HTTP ${res.status}`)
  const body: unknown = await res.json().catch(() => null)
  const list = isObject(body) ? body.products : null
  if (!Array.isArray(list)) throw new Error("products: unreadable answer")
  return list.flatMap((p) => (isObject(p) && typeof p.id === "string" && typeof p.name === "string" ? [{ id: p.id, name: p.name }] : []))
}

let shared: FromDocumentClient | null = null

/** The signed-in browser's client. */
export function getFromDocumentClient(): FromDocumentClient {
  if (!shared) shared = createFromDocumentClient()
  return shared
}
