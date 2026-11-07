import { describe, expect, test } from "bun:test"
import { checkApiReadAccess, isReadRestricted } from "./api-read-policy"

describe("api-read-policy", () => {
  test("a client viewer is refused finance, HR and commercial lists", () => {
    for (const p of ["/api/employees", "/api/sales-invoices", "/api/accounts", "/api/journal-entries", "/api/trial-balance", "/api/balance-sheet", "/api/vendors", "/api/customers", "/api/employees/123"]) {
      expect(checkApiReadAccess("GET", p, "client_viewer").allowed).toBe(false)
    }
  })
  test("a site engineer is refused finance and HR but may read vendors and customers", () => {
    expect(checkApiReadAccess("GET", "/api/employees", "site_engineer").allowed).toBe(false)
    expect(checkApiReadAccess("GET", "/api/sales-invoices", "site_engineer").allowed).toBe(false)
    expect(checkApiReadAccess("GET", "/api/vendors", "site_engineer").allowed).toBe(true)
  })
  test("owner, admin, pm and member are never refused", () => {
    for (const r of ["owner", "admin", "pm", "member"]) expect(checkApiReadAccess("GET", "/api/employees", r).allowed).toBe(true)
  })
  test("field and dashboard reads stay open for every role", () => {
    for (const p of ["/api/work-progress", "/api/scope", "/api/projects", "/api/dashboard/project/x", "/api/employeesx"]) {
      expect(checkApiReadAccess("GET", p, "client_viewer").allowed).toBe(true)
      expect(isReadRestricted(p)).toBe(false)
    }
  })
  test("writes are not this policy's business and an unknown role is not refused here", () => {
    expect(checkApiReadAccess("POST", "/api/employees", "client_viewer").allowed).toBe(true)
    expect(checkApiReadAccess("GET", "/api/employees", null).allowed).toBe(true)
  })
})
