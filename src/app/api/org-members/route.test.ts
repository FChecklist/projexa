/// <reference types="bun-types" />
// A4S14_settings_01: the Settings "Team" table never showed the currently
// authenticated member (owner or otherwise) because this route filtered
// `ctx.user!.id` out of the memberships it returned, even though
// GET /api/organization (the "Your Account" card on the same page) reads
// that same person's role/email straight off ctx with no such filter. The
// roster must be the full membership list for the org, caller included.
import { describe, expect, test, mock } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let mockCtx: AuthContext;
let mockMembersResult: { data: unknown[] | null; error: { message: string } | null };

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => ({
      select: () => ({
        eq: async () => mockMembersResult,
      }),
    }),
  }),
}));

const { GET } = await import("./route");

function ctxFor(userId: string): AuthContext {
  return { user: { id: userId, email: `${userId}@example.com` }, organizationId: "org1", role: "owner", response: null };
}

describe("GET /api/org-members", () => {
  test("includes the currently authenticated caller (e.g. the owner) in the roster", async () => {
    mockCtx = ctxFor("owner1");
    mockMembersResult = {
      data: [
        { user_id: "owner1", role: "owner", profiles: { email: "owner1@example.com", display_name: "Owner One" } },
        { user_id: "member1", role: "member", profiles: { email: "member1@example.com", display_name: "Member One" } },
      ],
      error: null,
    };
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.members.map((m: { user_id: string }) => m.user_id).sort()).toEqual(["member1", "owner1"]);
  });

  test("returns a lone owner's own membership row rather than an empty roster", async () => {
    mockCtx = ctxFor("solo-owner");
    mockMembersResult = {
      data: [{ user_id: "solo-owner", role: "owner", profiles: { email: "solo@example.com", display_name: null } }],
      error: null,
    };
    const res = await GET();
    const body = await res.json();
    expect(body.members).toHaveLength(1);
    expect(body.members[0].user_id).toBe("solo-owner");
  });

  test("propagates a query error as a 500", async () => {
    mockCtx = ctxFor("owner1");
    mockMembersResult = { data: null, error: { message: "boom" } };
    const res = await GET();
    expect(res.status).toBe(500);
  });
});
