#!/usr/bin/env node
// AUDIT-100 (audit100/link-invited-members): BACKFILL -- give every PROJEXA member who has no VERIDIAN user their own one.
//
// New members are linked when they accept an invitation and, lazily, the first time they mint an AI work link (POST <projexa-api>/link-member,
// compliance-tracker supabase/functions/projexa-api/member-link.ts). This script finds the members who joined BEFORE that fix and are still unlinked.
//
//   node scripts/ops/link-unlinked-members.mjs            DRY RUN (the default): read-only, lists counts per organisation and what would happen.
//   node scripts/ops/link-unlinked-members.mjs --apply    links the unlinked members of TEST organisations only (see isTestOrg): an organisation whose
//                                                         PROJEXA or VERIDIAN name says test / e2e / audit / demo. Real customer organisations are never
//                                                         touched by this script, whatever flag is passed; they heal themselves through the app.
//
// HOW IT LINKS: through the SAME database function the app path uses, public.projexa_ensure_member_user (compliance-tracker drizzle/0728), so the role
// mapping (owner/admin -> admin, pm -> manager, site_engineer/member -> member, client_viewer -> client_viewer), the never-upgrade rule and idempotency are
// the function's, not this script's. Running --apply twice changes nothing the second time (every row answers already_linked).
//
// WHERE IT READS: the PROJEXA Supabase project (memberships, organizations, veridian_credentials.veridian_org_id, auth.users email) and the VERIDIAN one
// (compliance.users.auth_user_id), both through the Supabase Management API with the owner's access token: SUPABASE_ACCESS_TOKEN from the environment or
// C:\ct\ct\.env.local. The token is never printed. The output carries no e-mail address and no full id (ids are shortened to 8 characters).
import { existsSync, readFileSync } from "node:fs"

export const PROJEXA_REF = "evpckeuxgvahguwsaeul"
export const VERIDIAN_REF = "pcrjmlpuqsbocqfwoxod"
const ENV_FILES = ["C:\\ct\\ct\\.env.local", ".env.local"]

/** PROJEXA role -> VERIDIAN role, the same table as public.projexa_member_veridian_role (drizzle/0728); used here only to describe a dry run. */
export const ROLE_MAP = Object.freeze({ owner: "admin", admin: "admin", pm: "manager", site_engineer: "member", member: "member", client_viewer: "client_viewer" })

const TEST_RE = /(^|[^a-z])(test|e2e|audit|demo)([^a-z]|$)/i
/** A test organisation: its PROJEXA name or its VERIDIAN name says test, e2e, audit or demo (as a word). */
export function isTestOrg(projexaName, veridianName) {
  return TEST_RE.test(String(projexaName ?? "")) || TEST_RE.test(String(veridianName ?? ""))
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const EMAIL_RE = /^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`
const short = (id) => String(id ?? "").slice(0, 8)

function accessToken() {
  let tok = (process.env.SUPABASE_ACCESS_TOKEN || "").trim()
  if (!tok) {
    for (const f of ENV_FILES) {
      if (!existsSync(f)) continue
      const line = readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.startsWith("SUPABASE_ACCESS_TOKEN="))
      if (line) {
        tok = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")
        break
      }
    }
  }
  return tok || null
}

async function sql(ref, query, token) {
  let last = ""
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 3000 * attempt))
    try {
      const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(60_000),
      })
      const text = await r.text()
      if (r.status < 300) return JSON.parse(text)
      last = `management query failed ${r.status}: ${text.slice(0, 200)}`
      if (r.status < 500 && r.status !== 429) break
    } catch (e) {
      last = `management query not sent: ${String(e?.message ?? e)}`
    }
  }
  throw new Error(last.split(token).join("[redacted]"))
}

/** Pure: the members joined with their VERIDIAN state, and the plan for each. Exported for the unit test. */
export function plan(members, veridianUsersBySub, veridianUsersByEmail, veridianOrgs) {
  return members.map((m) => {
    const vOrg = m.veridian_org_id ? veridianOrgs.get(m.veridian_org_id) : null
    const test = isTestOrg(m.org_name, vOrg?.name)
    const linked = veridianUsersBySub.get(m.user_id)
    const mapped = ROLE_MAP[m.role] ?? null
    let state
    if (linked) state = linked.org_id === m.veridian_org_id ? (linked.is_active ? "linked" : "linked_deactivated") : "linked_elsewhere"
    else if (!m.veridian_org_id || !vOrg) state = "unlinked_no_veridian_org"
    else if (!mapped) state = "unlinked_role_not_mapped"
    else if (!m.email) state = "unlinked_no_email"
    else {
      const byEmail = veridianUsersByEmail.get(String(m.email).toLowerCase())
      // unlinked_email_row_in_org: an unlinked row of this org has the email (linked if it is no more powerful than the mapped role, else left alone)
      // unlinked_email_row_other_identity: the org's row with this email is already linked to ANOTHER sign-in (in practice the person's VERIDIAN-app
      //   login): it is never re-pointed, that would break their VERIDIAN sign-in; only the gateway's email fallback (drizzle/0618, owner question
      //   OQ-15) or a second identity column could serve them
      // unlinked_email_in_other_org: the email belongs to a user of another VERIDIAN organisation (users.email is unique): never touched
      state = !byEmail
        ? "unlinked_would_create"
        : byEmail.org_id !== m.veridian_org_id
          ? "unlinked_email_in_other_org"
          : byEmail.auth_user_id
            ? "unlinked_email_row_other_identity"
            : "unlinked_email_row_in_org"
    }
    return { ...m, mapped, test, state, veridian_org_name: vOrg?.name ?? null }
  })
}

async function main() {
  const apply = process.argv.includes("--apply")
  const token = accessToken()
  if (!token) {
    console.error("No SUPABASE_ACCESS_TOKEN available (environment or C:\\ct\\ct\\.env.local).")
    process.exit(2)
  }
  const members = await sql(
    PROJEXA_REF,
    `select m.user_id::text, m.role::text as role, m.organization_id::text, o.name as org_name, vc.veridian_org_id::text, u.email
       from public.memberships m
       join public.organizations o on o.id = m.organization_id
       left join public.veridian_credentials vc on vc.organization_id = m.organization_id
       left join auth.users u on u.id = m.user_id
      order by o.name, m.created_at`,
    token,
  )
  const subs = [...new Set(members.map((m) => m.user_id).filter((s) => UUID_RE.test(s)))]
  const emails = [...new Set(members.map((m) => String(m.email ?? "").toLowerCase()).filter((e) => EMAIL_RE.test(e)))]
  const vOrgIds = [...new Set(members.map((m) => m.veridian_org_id).filter((s) => s && ID_RE.test(s)))]
  const vUsers = subs.length || emails.length
    ? await sql(
        VERIDIAN_REF,
        `select u.id, u.org_id, u.is_active, u.auth_user_id::text, lower(u.email) as email, u.role::text as role from compliance.users u
          where ${subs.length ? `u.auth_user_id in (${subs.map(lit).join(",")})` : "false"} or ${emails.length ? `lower(u.email) in (${emails.map(lit).join(",")})` : "false"}`,
        token,
      )
    : []
  const vOrgRows = vOrgIds.length ? await sql(VERIDIAN_REF, `select id, name, is_active from compliance.organisations where id in (${vOrgIds.map(lit).join(",")})`, token) : []
  const bySub = new Map(vUsers.filter((u) => u.auth_user_id).map((u) => [u.auth_user_id, u]))
  const byEmail = new Map(vUsers.map((u) => [u.email, u]))
  const orgs = new Map(vOrgRows.map((o) => [o.id, o]))
  const rows = plan(members, bySub, byEmail, orgs)

  // the report: per organisation, per state, per role (no emails, no full ids)
  const byOrg = new Map()
  for (const r of rows) {
    const k = `${r.org_name}${r.test ? "  [TEST]" : ""}`
    if (!byOrg.has(k)) byOrg.set(k, [])
    byOrg.get(k).push(r)
  }
  const total = { members: rows.length, linked: 0, unlinked: 0, unlinked_test: 0, unlinked_real: 0 }
  console.log(`${apply ? "APPLY (test organisations only)" : "DRY RUN (read-only)"} -- PROJEXA members vs VERIDIAN users\n`)
  for (const [org, list] of byOrg) {
    const counts = {}
    for (const r of list) {
      counts[r.state] = (counts[r.state] ?? 0) + 1
      if (r.state === "linked") total.linked++
      else if (r.state.startsWith("unlinked")) {
        total.unlinked++
        r.test ? total.unlinked_test++ : total.unlinked_real++
      }
    }
    console.log(`${org}: ${list.length} members  ${JSON.stringify(counts)}`)
    for (const r of list.filter((x) => x.state.startsWith("unlinked"))) console.log(`    ${short(r.user_id)}  ${r.role} -> ${r.mapped ?? "(no mapping)"}  ${r.state}`)
  }
  console.log(`\nTOTAL ${JSON.stringify(total)}`)

  if (!apply) {
    console.log("\nDry run: nothing was written. --apply links the unlinked members of the [TEST] organisations only.")
    return
  }
  // every unlinked member of a test org with an org and a mapped role is sent; the FUNCTION decides (an email_taken answer writes nothing)
  const targets = rows.filter((r) => r.test && r.state.startsWith("unlinked") && r.veridian_org_id && r.mapped && UUID_RE.test(r.user_id) && EMAIL_RE.test(String(r.email ?? "")))
  console.log(`\nApplying to ${targets.length} member(s) of test organisations:`)
  const outcomes = {}
  for (const r of targets) {
    if (!ID_RE.test(r.veridian_org_id)) continue
    const out = await sql(
      VERIDIAN_REF,
      `select outcome, role from public.projexa_ensure_member_user(${lit(r.veridian_org_id)}, ${lit(r.user_id)}::uuid, ${lit(String(r.email).toLowerCase())}, null, ${lit(r.role)})`,
      token,
    )
    const o = out[0] ?? { outcome: "no_answer", role: null }
    outcomes[o.outcome] = (outcomes[o.outcome] ?? 0) + 1
    console.log(`    ${r.org_name}  ${short(r.user_id)}  ${r.role} -> ${o.outcome}${o.role ? ` (${o.role})` : ""}`)
  }
  console.log(`\nAPPLIED ${JSON.stringify(outcomes)}`)
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}` || import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  main().catch((e) => {
    console.error(String(e?.message ?? e))
    process.exit(1)
  })
}
