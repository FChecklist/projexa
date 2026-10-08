/// <reference types="bun-types" />
// P6: only the organisation's owner/admin can flip PROJEXA's own AI switch; member and viewer are refused and nothing is sent upstream.
// Falsifiability: change ROLE_GROUPS.ORG_ADMIN to ROLE_GROUPS.ANY in route.ts PUT and the member/viewer cases fail.
import { beforeEach, describe, expect, mock, test } from "bun:test";

let role = "owner";
const upstream: Array<{ path: string; method?: string; body?: unknown }> = [];
let flag = false;

const realGuard = await import("@/lib/supabase/auth-guard");
mock.module("@/lib/supabase/auth-guard", () => ({
  ...realGuard,
  requireAuth: async () => ({ user: { id: "u1", email: "u@x.test" }, organizationId: "org1", role, response: null }),
}));
mock.module("@/lib/veridian-client", () => ({
  VeridianApiError: class extends Error { status = 500 },
  callVeridian: async (path: string, o: { method?: string; body?: { allowed?: boolean } }) => {
    upstream.push({ path, method: o.method, body: o.body });
    if (o.method === "PUT") flag = o.body?.allowed === true;
    return { allowed: flag, changedAt: null, changedById: null };
  },
}));
const { GET, PUT } = await import("./route");
const put = (allowed: unknown) => PUT(new Request("http://x/api/org/internal-ai", { method: "PUT", body: JSON.stringify({ allowed }), headers: { "content-type": "application/json" } }));

beforeEach(() => { role = "owner"; upstream.length = 0; flag = false; });

describe("/api/org/internal-ai", () => {
  test("default OFF", async () => {
    expect((await (await GET(new Request("http://x"))).json()).allowed).toBe(false);
  });
  for (const r of ["owner", "admin"]) {
    test(`${r} can switch it on and a re-read shows it saved`, async () => {
      role = r;
      expect((await put(true)).status).toBe(200);
      expect(upstream.at(-1)).toMatchObject({ path: "/internal-ai-allowance", method: "PUT", body: { allowed: true } });
      expect((await (await GET(new Request("http://x"))).json()).allowed).toBe(true);
    });
  }
  for (const r of ["member", "client_viewer", "pm", "site_engineer"]) {
    test(`${r} is refused and nothing is sent`, async () => {
      role = r;
      expect((await put(true)).status).toBe(403);
      expect(upstream).toHaveLength(0);
    });
  }
  test("a non-boolean body is refused", async () => {
    expect((await put("yes")).status).toBe(400);
    expect(upstream).toHaveLength(0);
  });
});
