/// <reference types="bun-types" />
// R67 F-20 -- the proxy's half of the abort budget.
//
// The rule these assertions hold: a failure where the upstream never gave a
// real answer AND might give one shortly (a timeout, a dead socket) answers 503
// with Retry-After, because retrying is genuinely the next move. Everything
// else keeps its own status, because retrying it changes nothing and pretending
// otherwise sends the user round a loop -- a 404 or a 400 because the upstream
// DID answer, and STORAGE_UNAVAILABLE because an unconfigured supabaseKey will
// still be unconfigured in five seconds and the screen already says so ("this
// needs an administrator"). Every one of them carries Server-Timing so a
// per-screen latency budget can be measured rather than guessed.

import { describe, expect, test } from "bun:test";
import { VeridianApiError } from "./veridian-client";
import {
  RETRY_AFTER_SECONDS,
  classifyUpstreamFailure,
  serverTimingHeader,
  veridianErrorResponse,
} from "./veridian-response";

describe("classifyUpstreamFailure", () => {
  test("a timeout becomes 503 + retryable, whatever status it arrived as", () => {
    const err = new VeridianApiError("did not respond in time", 504, "detail", "UPSTREAM_TIMEOUT", 8001);
    const f = classifyUpstreamFailure(err, "Failed to load scope");
    expect(f.status).toBe(503);
    expect(f.retryable).toBe(true);
    expect(f.code).toBe("UPSTREAM_TIMEOUT");
    expect(f.durationMs).toBe(8001);
    expect(f.message).toBe("did not respond in time");
  });

  test("a dead socket never answered, so it is 503 + retryable", () => {
    const f = classifyUpstreamFailure(new VeridianApiError("x", 502, undefined, "NETWORK", 3), "f");
    expect(f.status).toBe(503);
    expect(f.retryable).toBe(true);
  });

  test("an unconfigured storage client keeps its own status and gets NO Retry-After", () => {
    // It is infrastructure, but it is not transient: the message the same
    // failure carries is "…this needs an administrator", and a supabaseKey
    // that is missing now will still be missing in five seconds. Sending every
    // client back in 5 s would queue them behind a broken service AND
    // contradict the sentence on the screen. The CODE survives -- that is what
    // lets the screen name the cause instead of shrugging.
    const f = classifyUpstreamFailure(new VeridianApiError("x", 500, undefined, "STORAGE_UNAVAILABLE", 3), "f");
    expect(f.status).toBe(500);
    expect(f.retryable).toBe(false);
    expect(f.code).toBe("STORAGE_UNAVAILABLE");
  });

  test("a 404 keeps its own status and is not retryable", () => {
    const f = classifyUpstreamFailure(new VeridianApiError("no row", 404, undefined, null, 12), "Failed to load");
    expect(f.status).toBe(404);
    expect(f.retryable).toBe(false);
    expect(f.code).toBeNull();
  });

  test("an upstream 500 keeps 500 -- it answered, so waiting 5 s is not the fix", () => {
    const f = classifyUpstreamFailure(new VeridianApiError("boom", 500, undefined, "UPSTREAM_500", 40), "Failed");
    expect(f.status).toBe(500);
    expect(f.retryable).toBe(false);
  });

  test("a failed VeridianResult classifies identically to the thrown error", () => {
    const f = classifyUpstreamFailure(
      { ok: false, status: 504, code: "UPSTREAM_TIMEOUT", message: "did not respond in time", durationMs: 8003, data: null },
      "Failed to load meetings"
    );
    expect(f.status).toBe(503);
    expect(f.retryable).toBe(true);
    expect(f.code).toBe("UPSTREAM_TIMEOUT");
    expect(f.durationMs).toBe(8003);
    expect(f.message).toBe("did not respond in time");
  });

  test("a non-VeridianApiError falls back to the caller's own words", () => {
    const f = classifyUpstreamFailure(new Error("something else"), "Failed to load permits");
    expect(f.status).toBe(502);
    expect(f.message).toBe("Failed to load permits");
    expect(f.code).toBe("NETWORK");
  });
});

describe("serverTimingHeader", () => {
  test("names the upstream, and the handler when it is measured", () => {
    expect(serverTimingHeader(1234)).toBe("upstream;dur=1234");
    expect(serverTimingHeader(1234.6, 12.2)).toBe("upstream;dur=1235, app;dur=12");
  });

  test("never emits a negative duration", () => {
    expect(serverTimingHeader(-5)).toBe("upstream;dur=0");
  });
});

describe("the responses a proxy returns", () => {
  test("a timeout answers 503, Retry-After: 5, the typed code and a timing header", async () => {
    const res = veridianErrorResponse(
      new VeridianApiError("The construction data service did not respond in time. Please retry.", 504, "d", "UPSTREAM_TIMEOUT", 8002),
      "Failed to load tasks"
    );
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe(String(RETRY_AFTER_SECONDS));
    expect(res.headers.get("Server-Timing")).toBe("upstream;dur=8002");
    expect(await res.json()).toEqual({
      error: "The construction data service did not respond in time. Please retry.",
      code: "UPSTREAM_TIMEOUT",
    });
  });

  test("a 404 answers 404 with no Retry-After", () => {
    const res = veridianErrorResponse(new VeridianApiError("no row", 404, undefined, null, 9), "Failed");
    expect(res.status).toBe(404);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  test("unconfigured storage answers 500 with the code, and no Retry-After to contradict it", async () => {
    const res = veridianErrorResponse(
      new VeridianApiError(
        "The construction data service's file storage is not configured. Nothing was lost -- this needs an administrator.",
        500,
        undefined,
        "STORAGE_UNAVAILABLE",
        14
      ),
      "Failed to upload"
    );
    expect(res.status).toBe(500);
    expect(res.headers.get("Retry-After")).toBeNull();
    expect((await res.json()).code).toBe("STORAGE_UNAVAILABLE");
  });
});
