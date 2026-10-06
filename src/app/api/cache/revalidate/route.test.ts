/// <reference types="bun-types" />
// AUDIT-100 A2 batch 7: POST /api/cache/revalidate, the one Vercel route that clears the page-side list caches after a write the edge function
// answered. It clears ONLY what PX_REVALIDATABLE names (the union of the `revalidate` of projexa-api-routes.json) and only for a signed-in person.
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/supabase/auth-guard";

let signedIn = true;
const cleared: { tags: string[]; paths: string[] } = { tags: [], paths: [] };

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async (): Promise<AuthContext> =>
    signedIn
      ? ({ response: null, organizationId: "org-a", role: "client_viewer", user: { id: "u1", email: "u@a.test" } } as unknown as AuthContext)
      : ({ response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }) } as unknown as AuthContext),
}));
mock.module("next/cache", () => ({
  revalidateTag: (tag: string) => void cleared.tags.push(tag),
  revalidatePath: (path: string) => void cleared.paths.push(path),
  unstable_cache: <A extends unknown[], R>(fn: (...a: A) => Promise<R>) => fn,
}));

const call = async (body: unknown, raw?: string) => {
  const { POST } = await import("./route");
  const res = await POST(new NextRequest("http://localhost:3100/api/cache/revalidate", { method: "POST", headers: { "content-type": "application/json" }, body: raw ?? JSON.stringify(body) }), { params: Promise.resolve({}) } as never);
  return { status: res.status, body: await res.json().catch(() => null) };
};

beforeEach(() => {
  signedIn = true;
  cleared.tags.length = 0;
  cleared.paths.length = 0;
});

describe("POST /api/cache/revalidate", () => {
  test("clears the named list caches for a signed-in person of ANY role (client_viewer here), and answers what it cleared", async () => {
    const out = await call({ tags: ["module:documents", "knowledge-base"], paths: [] });
    expect(out).toEqual({ status: 200, body: { ok: true, tags: ["module:documents", "knowledge-base"], paths: [] } });
    expect(cleared.tags).toEqual(["module:documents", "knowledge-base"]);
  });

  test("a BOQ create clears its tag AND the /scope page", async () => {
    expect((await call({ tags: ["module:scope"], paths: ["/scope"] })).status).toBe(200);
    expect(cleared).toEqual({ tags: ["module:scope"], paths: ["/scope"] });
  });

  test("signed out: 401 and nothing is cleared", async () => {
    signedIn = false;
    expect((await call({ tags: ["projects"] })).status).toBe(401);
    expect(cleared.tags).toEqual([]);
  });

  test("a tag or path that is not on the list is 400 and NOTHING is cleared (not even the valid ones sent with it)", async () => {
    for (const body of [{ tags: ["module:documents", "module:payroll"] }, { tags: ["*"] }, { paths: ["/dashboard"] }, { tags: ["projects"], paths: ["/admin"] }, { tags: [""] }]) {
      expect((await call(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect(cleared).toEqual({ tags: [], paths: [] });
  });

  test("malformed bodies: 400, nothing cleared", async () => {
    for (const body of [{}, { tags: [], paths: [] }, { tags: "projects" }, { tags: [1] }, { tags: ["projects", "projects", "projects", "projects", "projects"] }, null, [], 5]) {
      expect((await call(body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call(null, "{not json")).status).toBe(400);
    expect(cleared).toEqual({ tags: [], paths: [] });
  });
});
