/// <reference types="bun-types" />
// R67 FIX PASS -- the preview proxy had no test, and it is the one route in
// the composer whose whole reason for existing is a NEGATIVE.
//
// C-05 and C-09 both rest on the same guarantee: band 2 can say "I read this
// as ..." BEFORE anything is written. Posting to /api/tasks to find out would
// mint the very row the confirmation step exists to withhold, so the preview
// goes through VERIDIAN's read-only classify endpoint instead.
//
// THE ASSERTION THAT MATTERS IS THEREFORE "AND IT DID NOT WRITE": this proxy
// must never reach /tasks, whatever it is asked. A regression here would not
// break a screen -- it would silently record work nobody confirmed, which is
// the worst failure in this programme's whole surface.
import { describe, expect, test, mock } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";
import { VeridianApiError } from "@/lib/veridian-client";

let mockCtx: AuthContext;
let veridian: (path: string, options: Record<string, unknown>) => Promise<unknown>;
const calls: { path: string; options: Record<string, unknown> }[] = [];

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/veridian-client", () => ({
  VeridianApiError,
  callVeridian: async (path: string, options: Record<string, unknown>) => {
    calls.push({ path, options });
    return veridian(path, options);
  },
}));

const { POST } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "owner", response: null };
}

function post(body: unknown) {
  return { json: async () => body } as never;
}

const PREVIEW = {
  segments: [
    {
      index: 0,
      text: "record 50% on excavation",
      verdict: "task",
      functionId: "record_work_progress",
      params: { percent: 50 },
      missingParams: ["itemCode"],
    },
  ],
  executed: false,
};

describe("POST /api/classify is a PREVIEW", () => {
  test("*** IT NEVER POSTS TO /tasks, WHATEVER IT IS ASKED ***", async () => {
    mockCtx = ctx();
    calls.length = 0;
    veridian = async () => PREVIEW;

    await POST(post({ rawInput: "record 50% on excavation", projectId: "p1" }));

    // One call, and it is the read-only classifier.
    expect(calls).toHaveLength(1);
    expect(calls[0].path).toBe("/classify");
    expect(calls.some((c) => c.path.includes("/tasks"))).toBe(false);
  });

  test("the response carries executed:false through untouched", async () => {
    mockCtx = ctx();
    veridian = async () => PREVIEW;

    const res = await POST(post({ rawInput: "record 50% on excavation" }));
    const body = (await res.json()) as { executed: boolean; segments: unknown[] };

    expect(res.status).toBe(200);
    // VERIDIAN's handler puts this in every response so a caller cannot forget
    // what it is holding. The proxy must not strip it.
    expect(body.executed).toBe(false);
    expect(body.segments).toHaveLength(1);
  });

  test("the body is relayed, so the project the rail already chose reaches the classifier", async () => {
    mockCtx = ctx();
    calls.length = 0;
    veridian = async () => PREVIEW;

    await POST(post({ rawInput: "record 50%", projectId: "p1", mode: "Projects" }));
    expect(calls[0].options.method).toBe("POST");
    expect(calls[0].options.body).toEqual({ rawInput: "record 50%", projectId: "p1", mode: "Projects" });
    // D-04: the org key is resolved on this server, never in the browser.
    expect(calls[0].options.organizationId).toBe("org1");
  });
});

describe("it refuses before it asks, and never invents an answer", () => {
  test("an empty sentence is a 400 in words, and reaches VERIDIAN not at all", async () => {
    mockCtx = ctx();
    calls.length = 0;
    veridian = async () => PREVIEW;

    const res = await POST(post({ rawInput: "   " }));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(400);
    expect(body.error).toBe("Type what you need first");
    expect(calls).toEqual([]);
  });

  test("a non-JSON body is a 400, not a crash", async () => {
    mockCtx = ctx();
    calls.length = 0;
    veridian = async () => PREVIEW;

    const res = await POST({ json: async () => { throw new Error("not json"); } } as never);
    expect(res.status).toBe(400);
    expect(calls).toEqual([]);
  });

  test("a backend refusal keeps ITS words -- 'I could not understand' is not 'I could not reach'", async () => {
    mockCtx = ctx();
    veridian = async () => {
      throw new VeridianApiError("The construction data service didn't answer", 504);
    };

    const res = await POST(post({ rawInput: "record 50% on excavation" }));
    const body = (await res.json()) as { error: string; segments?: unknown };

    expect(res.status).toBe(504);
    expect(body.error).toBe("The construction data service didn't answer");
    // Never an empty segment list, which band 2 would render as "nothing
    // matched" over what was really an outage.
    expect(body.segments).toBeUndefined();
  });

  test("a non-VERIDIAN throw is a 502 with our words and no internals", async () => {
    mockCtx = ctx();
    veridian = async () => {
      throw new Error("write CONNECT_TIMEOUT 3.109.171.244:6543");
    };

    const res = await POST(post({ rawInput: "record 50% on excavation" }));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).toBe("Couldn't reach the classifier");
    expect(body.error).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  test("an unauthenticated caller never reaches the classifier", async () => {
    calls.length = 0;
    mockCtx = { user: null, organizationId: null, role: null, response: new Response(null, { status: 401 }) } as unknown as AuthContext;
    veridian = async () => PREVIEW;

    const res = await POST(post({ rawInput: "record 50% on excavation" }));
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });
});
