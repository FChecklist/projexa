/// <reference types="bun-types" />
// R62 B7 regression test for F_024 (Critical): "GET /api/organization for
// the CEO session returns organization id ...bc689d97... That id does not
// exist as a row in [the organizations table] at all (0 rows) ... the API
// path fabricates/returns a phantom org object instead of erroring or
// falling back to a real org."
//
// CLOSURE HISTORY: R52/R56/R60 each independently re-derived that the
// original test queried the WRONG Supabase project (compliance-tracker's
// own DB) for an id that only ever existed in PROJEXA's own separate
// project -- an id/project-space scoping error in the original test, not a
// defect here. Confirmed fresh this session by reading
// src/app/api/organization/route.ts: it does a real
// supabase.from("organizations").select(...).eq("id",
// ctx.organizationId!).single() and returns a 404 { error } when the row is
// missing. There is no branch anywhere in this file that can construct an
// organization object that didn't come back from that query.
//
// WHAT THIS GUARDS: the one behavior a regression back toward the recorded
// symptom would require -- returning 200 with an organization body when the
// row lookup found nothing, or returning an organization whose fields don't
// match what the query actually returned.
import { describe, expect, test, mock } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let mockOrgResult: { data: Record<string, unknown> | null; error: { message: string } | null };
let queriedId: string | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "organizations") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: (_col: string, id: string) => {
            queriedId = id;
            return { single: async () => mockOrgResult };
          },
        }),
      };
    },
  }),
}));

const { GET } = await import("./route");

function ctxFor(organizationId: string): AuthContext {
  return { user: { id: "u1", email: "ceo@example.com" }, organizationId, role: "owner", response: null };
}

describe("GET /api/organization (F_024)", () => {
  test("an organizationId with no matching row returns 404 with no fabricated organization -- never a phantom 200", async () => {
    mockCtx = ctxFor("bc689d97-2dd8-47ab-b5f7-5eb3d696ad34");
    mockOrgResult = { data: null, error: null };
    const res = await GET();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.organization).toBeUndefined();
    expect(body.error).toBeDefined();
  });

  test("a real query error is also surfaced as 404 with the DB's own message, never papered over with a fabricated org", async () => {
    mockCtx = ctxFor("some-org-id");
    mockOrgResult = { data: null, error: { message: "row not found" } };
    const res = await GET();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.organization).toBeUndefined();
    expect(body.error).toBe("row not found");
  });

  test("a real row is echoed back verbatim -- the returned organization.id always matches what was actually queried and returned by the DB, never invented", async () => {
    mockCtx = ctxFor("real-org-1");
    mockOrgResult = {
      data: { id: "real-org-1", name: "Demo Organization", slug: "demo-organization", created_at: "2026-01-01", country: "IN" },
      error: null,
    };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(queriedId).toBe("real-org-1");
    expect(body.organization).toEqual(mockOrgResult.data);
    expect(body.organization.id).toBe(mockCtx.organizationId);
  });
});
