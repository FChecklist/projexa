/// <reference types="bun-types" />
// requireRole()/ROLE_GROUPS are pure functions over an already-resolved
// AuthContext -- per this repo's convention (see notification-service.test.ts),
// tested directly without a live Supabase session. This is the server-side
// enforcement PM/Site-Engineer route gating actually depends on: a
// site_engineer must be able to hit a progress-entry route (ROLE_GROUPS.FIELD)
// but be rejected from a budget-mutating route (ROLE_GROUPS.PM_OR_ABOVE),
// while a pm can hit both.
import { describe, expect, test } from "bun:test";
import { requireRole, ROLE_GROUPS, type AuthContext } from "./auth-guard";

function ctxWithRole(role: string | null): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role, response: null };
}

describe("requireRole", () => {
  test("site_engineer is rejected from a PM_OR_ABOVE (budget-mutating) route", () => {
    const result = requireRole(ctxWithRole("site_engineer"), ROLE_GROUPS.PM_OR_ABOVE);
    expect(result).not.toBeNull();
    expect(result!.status).toBe(403);
  });

  test("site_engineer is allowed on a FIELD (progress-entry) route", () => {
    const result = requireRole(ctxWithRole("site_engineer"), ROLE_GROUPS.FIELD);
    expect(result).toBeNull();
  });

  test("pm is allowed on both a PM_OR_ABOVE route and a FIELD route", () => {
    expect(requireRole(ctxWithRole("pm"), ROLE_GROUPS.PM_OR_ABOVE)).toBeNull();
    expect(requireRole(ctxWithRole("pm"), ROLE_GROUPS.FIELD)).toBeNull();
  });

  test("client_viewer is rejected from both PM_OR_ABOVE and FIELD routes", () => {
    expect(requireRole(ctxWithRole("client_viewer"), ROLE_GROUPS.PM_OR_ABOVE)!.status).toBe(403);
    expect(requireRole(ctxWithRole("client_viewer"), ROLE_GROUPS.FIELD)!.status).toBe(403);
  });

  test("owner and admin are allowed on both role groups", () => {
    for (const role of ["owner", "admin"]) {
      expect(requireRole(ctxWithRole(role), ROLE_GROUPS.PM_OR_ABOVE)).toBeNull();
      expect(requireRole(ctxWithRole(role), ROLE_GROUPS.FIELD)).toBeNull();
    }
  });

  test("a null role (no resolved membership) is rejected from every gated route", () => {
    expect(requireRole(ctxWithRole(null), ROLE_GROUPS.PM_OR_ABOVE)!.status).toBe(403);
    expect(requireRole(ctxWithRole(null), ROLE_GROUPS.FIELD)!.status).toBe(403);
  });
});
