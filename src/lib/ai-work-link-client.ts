// PROJEXA-BUILD-002 WP-08 (register rows AW-405, AW-406). The browser side of the AI work link screens: a signed-in PROJEXA session makes,
// lists and revokes its own work links, and reads the warning it must see first, by calling the Supabase Edge Function `ai-work-link` on
// the VERIDIAN project with its own access token. No Vercel function is in the path and PROJEXA adds no server route for this.
//
// THE CONTRACT (compliance-tracker supabase/functions/ai-work-link/mint.ts), every call carries Authorization: Bearer <session token>
//   GET  /warning?project=<id>&level=0|1   200 the sentence the person reads before a link exists, with the counts it names
//   POST /mint  {projectId, level, days, label?}   201 the link, once. The answer holds the token: nothing here stores or logs it
//   GET  /links?project=<id>               200 {links:[...]} the person's own links; never a token, never a hash
//   POST /links/<id>/revoke                200 {link_id, revoked, already}
//   POST /new-project  {days}              201 a shell project and a level 0 link for the same person, in one action
//   Every refusal is {error, status, code, hint?}. 401 SESSION_STALE means the session token is older than 15 minutes: this file
//   refreshes the session and sends the same request once more (a refused mint wrote nothing, so the second send cannot double it).
//
// WHAT THIS FILE NEVER DOES WITH A TOKEN. A minted link is returned to the caller in memory and goes nowhere else: it is not written to
// localStorage, sessionStorage, a cookie, the URL, a log line, an analytics call or an error message. Requests are made with credentials
// omitted, no referrer and no cache, and the request URL carries only a project id, a level and a link id (never a token).
//
// THE URL IS A CODE CONSTANT, like BOQ_READ_GATEWAY_URL in boq-gateway-client.ts: a public address changed by a reviewed edit, not by an
// environment variable that can drift between deployments.
import { createClient } from "@/lib/supabase/client"

export const AWL_URL = "https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/ai-work-link"

export type AwlLevel = 0 | 1
export type AwlDays = 1 | 7 | 30
export const AWL_DAYS: ReadonlyArray<AwlDays> = [1, 7, 30]

/** An answer that is not a success. `status` is the HTTP status, or 0 when nothing was received at all. `message` is plain text for the person. */
export class AwlError extends Error {
  readonly status: number
  readonly code: string | null

  constructor(message: string, status: number, code: string | null = null) {
    super(message)
    this.name = "AwlError"
    this.status = status
    this.code = code
  }
}

export type AwlWarning = {
  projectId: string
  projectName: string
  /** The one true sentence for the current state, made by the database. It is shown as it arrives, never rebuilt here. */
  sentence: string
  level: AwlLevel
  lines: number
  tasks: number
  people: number
  moneyVisible: boolean
  /** False while direct entries are switched off for everyone: a level 1 link still reads and drafts only. */
  writesEnabled: boolean
  /** The highest level this person may choose: 1 from the member role up, otherwise 0. */
  maxLevel: AwlLevel
}

export type AwlMinted = {
  linkId: string
  level: AwlLevel
  expiresAt: string
  label: string | null
  project: { id: string; name: string | null } | null
  /** The full link, including the token. Shown once. */
  link: string
  /** The inbox link, or null until the confirm host is set up. */
  inbox: string | null
  notice: string
  /** True for POST /new-project: the project is a new, empty shell made for this link. */
  shell: boolean
}

export type AwlLinkStatus = "active" | "expired" | "revoked"

export type AwlLinkRow = {
  id: string
  projectId: string
  projectName: string | null
  label: string | null
  level: AwlLevel
  createdAt: string | null
  expiresAt: string
  revokedAt: string | null
  lastUsedAt: string | null
  status: AwlLinkStatus
}

export type AwlRevoked = { linkId: string; revoked: boolean; already: boolean }

/** Where the session token comes from. `refresh` gets a token issued now (the Auth service's refresh), for the stale-session retry. */
export type AwlSession = {
  accessToken: () => Promise<string | null>
  refresh: () => Promise<string | null>
}

export type AwlDeps = {
  session: AwlSession
  /** The Fetch API. The tests pass a fake; the default is the browser's. */
  fetch?: typeof fetch
  baseUrl?: string
}

export type AwlClient = {
  warning: (projectId: string, level: AwlLevel) => Promise<AwlWarning>
  mint: (input: { projectId: string; level: AwlLevel; days: AwlDays; label?: string }) => Promise<AwlMinted>
  links: (projectId: string) => Promise<AwlLinkRow[]>
  revoke: (linkId: string) => Promise<AwlRevoked>
  newProject: (input: { days: AwlDays }) => Promise<AwlMinted>
}

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
const levelOf = (v: unknown): AwlLevel => (v === 1 ? 1 : 0)

function unreadable(): AwlError {
  return new AwlError("The AI work link service sent an answer this page cannot read. Nothing was changed. Try again in a minute.", 502, "BAD_ANSWER")
}

function parseWarning(raw: unknown): AwlWarning {
  if (!isObject(raw) || typeof raw.sentence !== "string" || raw.sentence.trim() === "") throw unreadable()
  const project = isObject(raw.project) ? raw.project : {}
  return {
    projectId: str(project.id) ?? "",
    projectName: str(project.name) ?? "",
    sentence: raw.sentence,
    level: levelOf(raw.level),
    lines: count(raw.lines),
    tasks: count(raw.tasks),
    people: count(raw.people),
    moneyVisible: raw.money_visible === true,
    writesEnabled: raw.writes_enabled === true,
    maxLevel: levelOf(raw.max_level),
  }
}

function parseMinted(raw: unknown, shell: boolean): AwlMinted {
  if (!isObject(raw) || typeof raw.link_id !== "string" || !isObject(raw.links) || typeof raw.links.link !== "string" || raw.links.link === "") throw unreadable()
  const project = isObject(raw.project) && typeof raw.project.id === "string" ? { id: raw.project.id, name: str(raw.project.name) } : null
  return {
    linkId: raw.link_id,
    level: levelOf(raw.level),
    expiresAt: str(raw.expires_at) ?? "",
    label: str(raw.label),
    project,
    link: raw.links.link,
    inbox: str(raw.links.inbox),
    notice: str(raw.notice) ?? "This is the only time the link is shown. Copy it now and paste it into an assistant that only you use.",
    shell,
  }
}

function parseLinks(raw: unknown): AwlLinkRow[] {
  if (!isObject(raw) || !Array.isArray(raw.links)) throw unreadable()
  const rows: AwlLinkRow[] = []
  for (const item of raw.links) {
    if (!isObject(item) || typeof item.id !== "string") continue
    const revokedAt = str(item.revoked_at)
    rows.push({
      id: item.id,
      projectId: str(item.project_id) ?? "",
      projectName: str(item.project_name),
      label: str(item.label),
      level: levelOf(item.level),
      createdAt: str(item.created_at),
      expiresAt: str(item.expires_at) ?? "",
      revokedAt,
      lastUsedAt: str(item.last_used_at),
      status: revokedAt !== null ? "revoked" : item.active === true ? "active" : "expired",
    })
  }
  return rows
}

function parseRevoked(raw: unknown): AwlRevoked {
  if (!isObject(raw) || typeof raw.revoked !== "boolean") throw unreadable()
  return { linkId: str(raw.link_id) ?? "", revoked: raw.revoked, already: raw.already === true }
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

function refusal(status: number, body: unknown): AwlError {
  const message = isObject(body) && typeof body.error === "string" && body.error.trim() !== "" ? body.error : `The AI work link service answered ${status}.`
  return new AwlError(message, status, isObject(body) ? str(body.code) : null)
}

/** The typed calls, over any Fetch and any session source. Nothing here reads a global except the default fetch. */
export function createAwlClient(deps: AwlDeps): AwlClient {
  const base = (deps.baseUrl ?? AWL_URL).replace(/\/+$/, "")
  const doFetch: typeof fetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init))

  async function send(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      // The first try uses the session as it is. After SESSION_STALE the second try uses a token the Auth service issued just now.
      const token = attempt === 0 ? await deps.session.accessToken() : await deps.session.refresh()
      if (!token) throw new AwlError("Sign in to PROJEXA again to make an AI work link.", 401, "SESSION_REQUIRED")
      let res: Response
      try {
        res = await doFetch(`${base}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}), Accept: "application/json" },
          body: body ? JSON.stringify(body) : undefined,
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        })
      } catch {
        throw new AwlError("Could not reach the AI work link service. Check your connection and try again.", 0, "NETWORK")
      }
      const answer = await readBody(res)
      if (res.ok) return answer
      const error = refusal(res.status, answer)
      if (attempt === 0 && res.status === 401 && error.code === "SESSION_STALE") continue
      throw error
    }
    throw new AwlError("Sign in to PROJEXA again to make an AI work link.", 401, "SESSION_STALE")
  }

  return {
    async warning(projectId, level) {
      return parseWarning(await send("GET", `/warning?project=${encodeURIComponent(projectId)}&level=${level}`))
    },
    async mint(input) {
      const label = input.label?.trim()
      const answer = await send("POST", "/mint", { projectId: input.projectId, level: input.level, days: input.days, ...(label ? { label } : {}) })
      return parseMinted(answer, false)
    },
    async links(projectId) {
      return parseLinks(await send("GET", `/links?project=${encodeURIComponent(projectId)}`))
    },
    async revoke(linkId) {
      return parseRevoked(await send("POST", `/links/${encodeURIComponent(linkId)}/revoke`))
    },
    async newProject(input) {
      return parseMinted(await send("POST", "/new-project", { days: input.days }), true)
    },
  }
}

/** The signed-in browser session of this app (cookies, through @supabase/ssr). */
export function browserSession(): AwlSession {
  return {
    accessToken: async () => {
      const { data } = await createClient().auth.getSession()
      return data.session?.access_token ?? null
    },
    refresh: async () => {
      const { data } = await createClient().auth.refreshSession()
      return data.session?.access_token ?? null
    },
  }
}

let shared: AwlClient | null = null

/** The client the screens use. Made on first use, so importing this file never touches the session. */
export function getAwlClient(): AwlClient {
  if (!shared) shared = createAwlClient({ session: browserSession() })
  return shared
}
