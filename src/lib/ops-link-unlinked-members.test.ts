/// <reference types="bun-types" />
// scripts/ops/link-unlinked-members.mjs (AUDIT-100 link-invited-members backfill): the pure parts.
//   * isTestOrg: --apply touches only organisations whose PROJEXA or VERIDIAN name says test / e2e / audit / demo, as a word
//   * plan: the state of each member, which decides what a dry run reports (the database function decides what --apply writes)
//   * ROLE_MAP equals the database mapping's table (drizzle/0728 in compliance-tracker, also unit-tested there)
import { describe, expect, test } from "bun:test"
import { isTestOrg, plan, ROLE_MAP } from "../../scripts/ops/link-unlinked-members.mjs"

describe("isTestOrg", () => {
  test("test, e2e, audit, demo as a word, in either name", () => {
    for (const [px, v] of [["Acme Test Construction", null], ["Meridian Construction Group", "Meridian Construction Group (E2E Test Org)"], ["Demo Organization", null], ["Skyline Builders (PROJEXA Demo)", null], ["R74-TEST-Projexa-Tenant-A", null], ["Audit org", null]]) {
      expect(isTestOrg(px, v)).toBe(true)
    }
  })
  test("real-looking names are not test orgs, nor names that merely contain the letters", () => {
    for (const name of ["Al Maha Skyline Contracting & Interiors LLC", "Meridian Interiors LLC", "Cobalt Fitout FZE", "Skyline Builders", "Contest Builders", "Democrat Homes", "Auditorium Fitouts", null]) {
      expect(isTestOrg(name, null)).toBe(false)
    }
  })
})

describe("plan", () => {
  const orgs = new Map([["v1", { id: "v1", name: "V One" }]])
  const m = (over: Record<string, unknown>) => ({ user_id: "u", role: "pm", organization_id: "p1", org_name: "Test Org", veridian_org_id: "v1", email: "a@x.test", ...over })
  test("each state", () => {
    const bySub = new Map([["s-linked", { org_id: "v1", is_active: true }], ["s-else", { org_id: "v2", is_active: true }], ["s-off", { org_id: "v1", is_active: false }]])
    const byEmail = new Map([
      ["same@x.test", { org_id: "v1", auth_user_id: null }],
      ["other-id@x.test", { org_id: "v1", auth_user_id: "veridian-login" }],
      ["elsewhere@x.test", { org_id: "v9", auth_user_id: null }],
    ])
    const rows = plan(
      [
        m({ user_id: "s-linked" }),
        m({ user_id: "s-else" }),
        m({ user_id: "s-off" }),
        m({ user_id: "n1", veridian_org_id: null }),
        m({ user_id: "n2", veridian_org_id: "missing" }),
        m({ user_id: "n3", role: "superuser" }),
        m({ user_id: "n4", email: null }),
        m({ user_id: "n5", email: "new@x.test" }),
        m({ user_id: "n6", email: "SAME@x.test" }),
        m({ user_id: "n7", email: "other-id@x.test" }),
        m({ user_id: "n8", email: "elsewhere@x.test" }),
      ],
      bySub,
      byEmail,
      orgs,
    )
    expect(rows.map((r: { state: string }) => r.state)).toEqual([
      "linked",
      "linked_elsewhere",
      "linked_deactivated",
      "unlinked_no_veridian_org",
      "unlinked_no_veridian_org",
      "unlinked_role_not_mapped",
      "unlinked_no_email",
      "unlinked_would_create",
      "unlinked_email_row_in_org",
      "unlinked_email_row_other_identity",
      "unlinked_email_in_other_org",
    ])
    expect(rows[7]).toMatchObject({ mapped: "manager", test: true })
  })
  test("ROLE_MAP: never admin below owner/admin; client_viewer stays client_viewer", () => {
    expect(ROLE_MAP).toEqual({ owner: "admin", admin: "admin", pm: "manager", site_engineer: "member", member: "member", client_viewer: "client_viewer" })
  })
})
