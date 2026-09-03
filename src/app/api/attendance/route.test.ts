/// <reference types="bun-types" />
// R67 FIX PASS (C-08) -- THE REPLACE-REQUIRED PATH WAS DEAD END TO END.
//
// THE DEFECT, and why no test caught it. C-08 gives the composer a "replace
// it?" question for the normal case a foreman hits every morning: attendance
// for today is already saved and he is marking the crew again. The shell
// branches on `d?.code === "REPLACE_REQUIRED"`, and the compliance-tracker
// route was changed specifically to put that code in the 409 body -- but the
// code was destroyed twice on the way back:
//
//   1. veridian-client's error builder threw `new VeridianApiError(message,
//      status)` and dropped errorBody.code; the class had no `code` field.
//   2. THIS proxy's catch re-serialised only `{ error }`.
//
// Neither file was part of lane C's original change, so the shell's branch was
// unreachable in production while every unit test passed: the pure logic was
// covered, the TRANSPORT between the two halves was not. That is what this
// file pins -- a 409 carrying code REPLACE_REQUIRED reaching the exact client
// shape the shell reads.
import { describe, expect, test, mock } from "bun:test";
import type { AuthContext } from "@/lib/supabase/auth-guard";
import { VeridianApiError } from "@/lib/veridian-client";

let mockCtx: AuthContext;
let nextResult: () => Promise<unknown>;
let lastCall: { path: string; options: Record<string, unknown> } | null = null;

mock.module("@/lib/supabase/auth-guard", () => ({
  requireAuth: async () => mockCtx,
}));

mock.module("@/lib/veridian-client", () => ({
  VeridianApiError,
  callVeridian: async (path: string, options: Record<string, unknown>) => {
    lastCall = { path, options };
    return nextResult();
  },
}));

const { POST } = await import("./route");

function ctx(): AuthContext {
  return { user: { id: "u1", email: "u1@example.com" }, organizationId: "org1", role: "owner", response: null };
}

function post(body: unknown) {
  return { json: async () => body } as never;
}

const CREW = {
  projectId: "p1",
  attendanceDate: "2026-09-03",
  entries: [{ rosterId: "w1", status: "present" }],
};

describe("POST /api/attendance", () => {
  test("a first save relays the batch body through and answers 201", async () => {
    mockCtx = ctx();
    nextResult = async () => ({ written: 12, present: 12, absent: 0, replaced: false });

    const res = await POST(post(CREW));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ written: 12 });
    // The batch shape is relayed verbatim -- this proxy does not reshape it,
    // so the server's own `entries` branch is what decides batch vs single.
    expect(lastCall?.path).toBe("/attendance");
    expect((lastCall?.options as { body?: unknown })?.body).toEqual(CREW);
  });

  test("*** A 409 CARRYING REPLACE_REQUIRED REACHES THE CLIENT WITH ITS CODE ***", async () => {
    mockCtx = ctx();
    nextResult = async () => {
      throw new VeridianApiError(
        "Attendance for 2026-09-03 is already saved for 2 of these workers",
        409,
        undefined,
        "REPLACE_REQUIRED"
      );
    };

    const res = await POST(post(CREW));
    const body = (await res.json()) as { error: string; code?: string };

    expect(res.status).toBe(409);
    // THE ASSERTION THAT WOULD HAVE CAUGHT THE DEFECT. The shell reads exactly
    // this field; without it the whole "replace it?" question is unreachable
    // and the row is a dead end.
    expect(body.code).toBe("REPLACE_REQUIRED");
    // The sentence still travels, because the confirmation names the blast
    // radius ("...for 2 of these workers") and that count is in the sentence.
    expect(body.error).toContain("2 of these workers");
  });

  test("a refusal with no code carries no code -- one is never invented", async () => {
    mockCtx = ctx();
    nextResult = async () => {
      throw new VeridianApiError("Roster entry not found", 404);
    };

    const res = await POST(post(CREW));
    const body = (await res.json()) as { error: string; code?: string };

    expect(res.status).toBe(404);
    expect(body.code).toBeUndefined();
    expect(body.error).toBe("Roster entry not found");
  });

  test("a non-VERIDIAN failure is a 502 with our own words, never the raw throw", async () => {
    mockCtx = ctx();
    nextResult = async () => {
      throw new Error("write CONNECT_TIMEOUT 3.109.171.244:6543");
    };

    const res = await POST(post(CREW));
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(502);
    expect(body.error).toBe("Failed to record attendance");
    // The R66 leak, closed at this hop too: no IP:port reaches a browser.
    expect(body.error).not.toMatch(/\d+\.\d+\.\d+\.\d+/);
  });
});

describe("VeridianApiError carries the backend's machine-readable reason", () => {
  test("code is optional and survives construction", () => {
    const withCode = new VeridianApiError("already saved", 409, undefined, "REPLACE_REQUIRED");
    expect(withCode.code).toBe("REPLACE_REQUIRED");
    expect(withCode.status).toBe(409);

    const withoutCode = new VeridianApiError("not found", 404);
    expect(withoutCode.code).toBeUndefined();
  });
});
