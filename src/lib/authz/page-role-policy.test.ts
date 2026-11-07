/// <reference types="bun-types" />
import { describe, test, expect } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { PAGE_ROLE_POLICY, checkPageRoleAccess, pageNeedsRole } from "./page-role-policy";

const APP_ROOT = join(import.meta.dir, "..", "..", "app", "(app)");

describe("page-role-policy", () => {
  test("every listed prefix is a real page folder (no stale entry)", () => {
    for (const prefix of Object.keys(PAGE_ROLE_POLICY)) expect(existsSync(join(APP_ROOT, prefix.slice(1)))).toBe(true);
  });
  test("client_viewer and site_engineer are sent away from finance, HR and commercial screens", () => {
    for (const p of ["/accounting", "/payroll", "/employees", "/recruitment", "/employees/abc", "/vendors/new", "/invoices"]) {
      for (const role of ["client_viewer", "site_engineer"]) expect(checkPageRoleAccess(p, role).allowed).toBe(false);
    }
  });
  test("pm may open commercial screens but not payroll or accounting; owner and admin open everything", () => {
    expect(checkPageRoleAccess("/employees", "pm").allowed).toBe(true);
    expect(checkPageRoleAccess("/payroll", "pm").allowed).toBe(false);
    for (const role of ["owner", "admin"]) expect(checkPageRoleAccess("/payroll", role).allowed).toBe(true);
  });
  test("the screens Sumeet needs stay open to every role, and an unknown role is not refused", () => {
    for (const p of ["/dashboard", "/scope", "/work-progress", "/reports", "/schedule", "/documents", "/change-orders", "/billing-milestones"]) {
      expect(pageNeedsRole(p)).toBe(false);
      expect(checkPageRoleAccess(p, "client_viewer").allowed).toBe(true);
    }
    expect(checkPageRoleAccess("/employees", null).allowed).toBe(true);
  });
});
