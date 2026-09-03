/// <reference types="bun-types" />
// R67 FIX PASS -- the chain-options proxy had no test.
//
// src/lib/chain-options.ts's builders are well covered; the ROUTE is where the
// two rules that matter most live, and neither is expressible in a pure test:
//
//   1. AN UNKNOWN LEVEL IS A 404 WITH WORDS, NOT AN EMPTY LIST. "There is
//      nothing to choose here" and "I do not know what you asked for" are
//      different answers, and rendering the second as the first is the silent
//      empty state this programme exists to remove.
//   2. A FAILED READ IS AN ERROR, NOT AN EMPTY GRID. A /scope read that 500s
//      must never come back as a level with zero options -- that would tell a
//      site engineer his twelve-line BOQ is empty.
//
// It also pins decision D-04: the org API key is resolved HERE, server-side.
// The browser calls this route; this route calls VERIDIAN.
import { describe, expect, test, mock } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";
import { VeridianApiError } from "@/lib/veridian-client";

let mockCtx: AuthContext;
let veridian: (path: string) => Promise<unknown>;
const calls: string[] = [];

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/veridian-client", () => ({
  VeridianApiError,
  callVeridian: async (path: string) => {
    calls.push(path);
    return veridian(path);
  },
}));

const { GET } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "owner", response: null };
}

function req(query: string) {
  return { url: `https://projexa.test/api/chain-options${query}` } as never;
}

const BOQS = [
  {
    id: "boq1",
    version: 2,
    lineItems: [
      { id: "li1", itemCode: "R60SK-A", description: "Excavation", parentLineItemId: null },
      { id: "li2", itemCode: "R60SK-B", description: "Backfill", parentLineItemId: null },
    ],
  },
];

describe("GET /api/chain-options", () => {
  test("a BOQ level comes back as chips, with the item code the executor resolves by", async () => {
    mockCtx = ctx();
    calls.length = 0;
    veridian = async () => BOQS;

    const res = await GET(req("?projectId=p1&path=work_progress,record_progress"));
    const body = (await res.json()) as { legend: string; options: { id: string; label: string }[] };

    expect(res.status).toBe(200);
    expect(body.options.length).toBeGreaterThan(0);
    // The chip's id is the ITEM CODE, because that is what the write resolves
    // a line by -- a label the user recognises with an id the server accepts.
    expect(body.options.map((o) => o.id)).toContain("R60SK-A");
    expect(body.legend).toBeTruthy();
    // D-04: the read went through this server, with the org's key.
    expect(calls[0]).toContain("/scope?projectId=p1");
  });

  test("*** AN UNKNOWN LEVEL IS A 404 IN WORDS, NEVER AN EMPTY LIST ***", async () => {
    mockCtx = ctx();
    veridian = async () => BOQS;

    const res = await GET(req("?projectId=p1&path=not_a_module,not_a_verb"));
    const body = (await res.json()) as { error: string; options?: unknown };

    expect(res.status).toBe(404);
    expect(body.error).toBeTruthy();
    // The distinction this test exists for: no `options` key at all, so a
    // panel cannot render "nothing to choose" over a question it misheard.
    expect(body.options).toBeUndefined();
  });

  test("no project yet is its own sentence, not the same 404 as an unknown step", async () => {
    mockCtx = ctx();
    veridian = async () => BOQS;

    const res = await GET(req("?path=work_progress,record_progress"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(404);
    expect(body.error).toBe("Pick a project before choosing a line");
  });

  test("no path at all is a 400 -- the caller asked nothing", async () => {
    mockCtx = ctx();
    veridian = async () => BOQS;

    const res = await GET(req("?projectId=p1"));
    expect(res.status).toBe(400);
  });

  test("*** A FAILED READ IS AN ERROR, NOT AN EMPTY GRID ***", async () => {
    mockCtx = ctx();
    veridian = async () => {
      throw new VeridianApiError("The construction data service didn't answer", 504);
    };

    const res = await GET(req("?projectId=p1&path=work_progress,record_progress"));
    const body = (await res.json()) as { error: string; options?: unknown };

    // 504, and the backend's OWN words -- an empty list here would say "this
    // project has no BOQ" about a project with twelve lines.
    expect(res.status).toBe(504);
    expect(body.error).toBe("The construction data service didn't answer");
    expect(body.options).toBeUndefined();
  });

  test("a non-VERIDIAN throw is a 502 with our words, never the raw exception", async () => {
    mockCtx = ctx();
    veridian = async () => {
      throw new Error("write CONNECT_TIMEOUT 3.109.171.244:6543");
    };

    const res = await GET(req("?projectId=p1&path=work_progress,record_progress"));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).toBe("Couldn't load this project's BOQ");
    expect(body.error).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });

  test("an unauthenticated caller never reaches VERIDIAN at all", async () => {
    calls.length = 0;
    mockCtx = { user: null, organizationId: null, role: null, response: new Response(null, { status: 401 }) } as unknown as AuthContext;
    veridian = async () => BOQS;

    const res = await GET(req("?projectId=p1&path=work_progress,record_progress"));
    expect(res.status).toBe(401);
    expect(calls).toEqual([]);
  });
});
