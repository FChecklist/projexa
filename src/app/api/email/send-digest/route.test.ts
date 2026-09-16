/// <reference types="bun-types" />
import { describe, expect, test, mock } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";
import { NextResponse } from "next/server";

let mockCtx: AuthContext;
let membershipRows: Array<{ id: string; userId: string; organizationId: string; role: string }>;
let digestArg: string | null = null;
let digestResult: unknown;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(membershipRows),
        }),
      }),
    }),
  },
  memberships: {},
}));

mock.module("@/lib/email/digest", () => ({
  sendDigestForMembership: async (membershipId: string) => {
    digestArg = membershipId;
    return digestResult;
  },
}));

const { POST } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "owner", response: null };
}

describe("POST /api/email/send-digest", () => {
  test("membership found -> forwards its id to sendDigestForMembership and returns the result verbatim", async () => {
    mockCtx = ctx();
    membershipRows = [{ id: "m1", userId: "u1", organizationId: "org1", role: "owner" }];
    digestArg = null;
    digestResult = { sent: true, todoCount: 3, membershipId: "m1" };

    const res = await POST();

    expect(res.status).toBe(200);
    expect(digestArg).toBe("m1");
    expect(await res.json()).toEqual({ sent: true, todoCount: 3, membershipId: "m1" });
  });

  test("no membership row for this user/org -> 404, digest never sent", async () => {
    mockCtx = ctx();
    membershipRows = [];
    digestArg = null;

    const res = await POST();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "No membership found" });
    expect(digestArg).toBeNull();
  });

  test("requireAuth refusal short-circuits before touching db or the digest service", async () => {
    mockCtx = { user: null, organizationId: null, role: null, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
    membershipRows = [{ id: "should-not-be-read", userId: "u1", organizationId: "org1", role: "owner" }];
    digestArg = null;

    const res = await POST();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(digestArg).toBeNull();
  });

  test("missing organizationId on an authenticated ctx -> 400, no membership lookup", async () => {
    mockCtx = { user: { id: "u1", email: "u1@example.com" }, organizationId: null, role: null, response: null };
    membershipRows = [{ id: "should-not-be-read", userId: "u1", organizationId: "org1", role: "owner" }];
    digestArg = null;

    const res = await POST();

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "No organization" });
    expect(digestArg).toBeNull();
  });
});
