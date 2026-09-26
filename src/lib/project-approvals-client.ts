// PROJEXA-BUILD-002 WP-10. The browser side of "Proposals and questions": the proposals an AI or an email prepared for a project, and the
// approve action, through this app's proxy of VERIDIAN's /projects/{id}/approvals.
//
// THE CONTRACT (compliance-tracker src/app/api/v1/projexa/projects/[id]/approvals/route.ts)
//   GET  /api/projects/<id>/approvals   200 {projectId, count, proposals:[{submissionId, source, functionId, label, params, missing[], note,
//                                       preparedById, preparedAt, approve}]}. `params` is what would be written, with the project-side cost
//                                       fields already removed by VERIDIAN. `missing` are required values still unanswered.
//   POST /api/projects/<id>/approvals   {submissionId, params?}
//        201 {approved:true, submissionId, boqId, lineItemIds, route}     the proposal was written
//        200 {approved:false, status:"needs_input", missing}              nothing was written; the answer is a question
//        404 not on this project, 409 already decided / being approved, 422 cannot be written as it stands, 500 AUDIT_WRITE_FAILED
//   There is NO reject action in VERIDIAN for these proposals today. This module does not invent one.
//
// Nothing here stores or logs a proposal. Errors carry the server's own sentence.

export type ProposalMissing = { name: string; label: string; options: Array<{ value: string; label: string }> }

export type ProposalLine = { itemCode: string | null; description: string; unit: string | null; quantity: number | null; rate: number | null }

export type Proposal = {
  submissionId: string
  projectId: string
  source: "email_intelligence" | "paste_back" | string
  label: string
  title: string | null
  /** The number of line items the proposal would write. */
  lineCount: number
  /** The first lines, for the person to recognise the proposal by. */
  lines: ProposalLine[]
  /** The sum of quantity x rate when every line carries both; null when a rate was withheld or is missing. */
  total: number | null
  missing: ProposalMissing[]
  note: string | null
  preparedAt: string
}

export type ApproveResult =
  | { kind: "approved"; boqId: string | null; lineItemIds: string[] }
  | { kind: "needs_input"; missing: ProposalMissing[] }

export class ApprovalError extends Error {
  readonly status: number
  /** The upstream decision status of a 409 (for example "in_progress" or "done"), when it sent one. */
  readonly upstreamStatus: string | null

  constructor(message: string, status: number, upstreamStatus: string | null = null) {
    super(message)
    this.name = "ApprovalError"
    this.status = status
    this.upstreamStatus = upstreamStatus
  }
}

export type ProjectRef = { id: string; name: string }

export type ApprovalsClient = {
  projects: () => Promise<ProjectRef[]>
  list: (projectId: string) => Promise<Proposal[]>
  approve: (projectId: string, submissionId: string, params: Record<string, string>) => Promise<ApproveResult>
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null)

function unreadable(): ApprovalError {
  return new ApprovalError("The server sent an answer this page cannot read. Nothing was changed. Try again in a minute.", 502)
}

function parseMissing(raw: unknown): ProposalMissing[] {
  if (!Array.isArray(raw)) return []
  const out: ProposalMissing[] = []
  for (const m of raw) {
    if (!isObject(m) || typeof m.name !== "string") continue
    const options = Array.isArray(m.options)
      ? m.options.flatMap((o) => (isObject(o) && typeof o.value === "string" ? [{ value: o.value, label: str(o.label) ?? o.value }] : []))
      : []
    out.push({ name: m.name, label: str(m.label) ?? m.name, options })
  }
  return out
}

/** The lines of a proposal's params. `params.lineItems` is what a create_boq proposal would write. */
export function linesOf(params: unknown): ProposalLine[] {
  if (!isObject(params) || !Array.isArray(params.lineItems)) return []
  return params.lineItems.flatMap((l) =>
    isObject(l) && typeof l.description === "string"
      ? [{ itemCode: str(l.itemCode), description: l.description, unit: str(l.unit), quantity: num(l.quantity), rate: num(l.rate) }]
      : [],
  )
}

export const PREVIEW_LINES = 6

function toProposal(projectId: string, raw: unknown): Proposal | null {
  if (!isObject(raw) || typeof raw.submissionId !== "string") return null
  const lines = linesOf(raw.params)
  const priced = lines.length > 0 && lines.every((l) => l.quantity !== null && l.rate !== null)
  return {
    submissionId: raw.submissionId,
    projectId,
    source: str(raw.source) ?? "",
    label: str(raw.label) ?? "Proposal",
    title: isObject(raw.params) ? str(raw.params.title) : null,
    lineCount: lines.length,
    lines: lines.slice(0, PREVIEW_LINES),
    total: priced ? lines.reduce((sum, l) => sum + (l.quantity as number) * (l.rate as number), 0) : null,
    missing: parseMissing(raw.missing),
    note: str(raw.note),
    preparedAt: str(raw.preparedAt) ?? "",
  }
}

async function refusalOf(res: Response): Promise<ApprovalError> {
  const body: unknown = await res.json().catch(() => null)
  const message = isObject(body) && typeof body.error === "string" && body.error.trim() ? body.error.trim() : `The request failed (HTTP ${res.status}). Nothing was changed.`
  return new ApprovalError(message, res.status, isObject(body) ? str(body.upstreamStatus) : null)
}

export function createApprovalsClient(deps: { fetch?: typeof fetch } = {}): ApprovalsClient {
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init))
  const call = async (input: string, init?: RequestInit): Promise<Response> => {
    try {
      return await doFetch(input, { cache: "no-store", ...init })
    } catch {
      throw new ApprovalError("The server could not be reached. Nothing was changed. Check the connection and try again.", 0)
    }
  }

  return {
    async projects() {
      const res = await call("/api/projects")
      if (!res.ok) throw await refusalOf(res)
      const body: unknown = await res.json().catch(() => null)
      if (!isObject(body) || !Array.isArray(body.projects)) throw unreadable()
      return body.projects.flatMap((p) => (isObject(p) && typeof p.id === "string" ? [{ id: p.id, name: str(p.name) ?? p.id }] : []))
    },

    async list(projectId) {
      const res = await call(`/api/projects/${encodeURIComponent(projectId)}/approvals`)
      if (!res.ok) throw await refusalOf(res)
      const body: unknown = await res.json().catch(() => null)
      if (!isObject(body) || !Array.isArray(body.proposals)) throw unreadable()
      return body.proposals.flatMap((p) => {
        const proposal = toProposal(projectId, p)
        return proposal ? [proposal] : []
      })
    },

    async approve(projectId, submissionId, params) {
      const res = await call(`/api/projects/${encodeURIComponent(projectId)}/approvals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId, params }),
      })
      if (!res.ok) throw await refusalOf(res)
      const body: unknown = await res.json().catch(() => null)
      if (!isObject(body)) throw unreadable()
      if (body.approved === true) {
        return { kind: "approved", boqId: str(body.boqId), lineItemIds: Array.isArray(body.lineItemIds) ? body.lineItemIds.filter((i): i is string => typeof i === "string") : [] }
      }
      if (body.status === "needs_input") return { kind: "needs_input", missing: parseMissing(body.missing) }
      throw unreadable()
    },
  }
}

let shared: ApprovalsClient | null = null

/** The signed-in browser's client. */
export function getApprovalsClient(): ApprovalsClient {
  if (!shared) shared = createApprovalsClient()
  return shared
}
