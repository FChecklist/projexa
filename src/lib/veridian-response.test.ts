/// <reference types="bun-types" />
// R67 F-20 -- the proxy's half of the abort budget.
//
// The rule these assertions hold: a failure where the upstream never gave a
// real answer (a timeout, a dead socket, an unconfigured storage client)
// answers 503 with Retry-After, because retrying is genuinely the next move.
// A failure where it DID answer (404, 400) keeps its own status, because
// retrying it changes nothing and pretending otherwise sends the user round a
// loop. Both carry Server-Timing so a per-screen latency budget can be
// measured rather than guessed.

import { describe, expect, test } from "bun:test";
import { VeridianApiError } from "./veridian-client";
import {
  RETRY_AFTER_SECONDS,
  classifyUpstreamFailure,
  serverTimingHeader,
  veridianErrorResponse,
  veridianJsonResponse,
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

  test("a dead socket and an unconfigured storage client are the same class", () => {
    expect(classifyUpstreamFailure(new VeridianApiError("x", 502, undefined, "NETWORK", 3), "f").status).toBe(503);
    expect(classifyUpstreamFailure(new VeridianApiError("x", 500, undefined, "STORAGE_UNAVAILABLE", 3), "f").status).toBe(503);
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

  test("a success carries the same timing header", async () => {
    const res = veridianJsonResponse({ meetings: [] }, 210);
    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toBe("upstream;dur=210");
    expect(await res.json()).toEqual({ meetings: [] });
  });
});
