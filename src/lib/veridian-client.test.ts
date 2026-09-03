/// <reference types="bun-types" />
// R67 F-20 (audit recommendation R-238) -- the abort budget, the retry policy
// and the typed error codes.
//
// WHAT THESE ASSERTIONS PROTECT. The measured defect: veridian-client waited
// 20 s per attempt AND retried a timed-out GET, so a hung upstream cost the
// user 40 s of spinner before the error card appeared -- the dev-server line
// `GET /api/tasks?limit=50 504 in 56s` is that pair. Two rules fix it and both
// are easy to lose again: the per-attempt budget is 8 s, and a TIMEOUT is
// never retried (a connection failure still is, because it costs milliseconds
// and lands on a different socket).
//
// The stub below is what a real fetch does with an AbortSignal: it never
// answers, and rejects when the signal fires. A stub that ignored the signal
// would hang this file instead of failing it, which is why it listens.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  VERIDIAN_FETCH_TIMEOUT_MS,
  VERIDIAN_UPLOAD_TIMEOUT_MS,
  callVeridian,
  callVeridianBinary,
  callVeridianResult,
  callVeridianUpload,
  VeridianApiError,
} from "./veridian-client";

const realFetch = globalThis.fetch;

type FetchCall = { url: string; method: string };
let calls: FetchCall[] = [];

function record(input: RequestInfo | URL, init?: RequestInit): FetchCall {
  const call = { url: String(input), method: (init?.method ?? "GET").toUpperCase() };
  calls.push(call);
  return call;
}

/** Never answers. Rejects exactly when the caller's signal aborts, as fetch does. */
function stubNeverResolves() {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    record(input, init);
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const fail = () => {
        const err = new Error("The operation timed out.");
        err.name = "TimeoutError";
        reject(err);
      };
      if (signal?.aborted) return fail();
      signal?.addEventListener("abort", fail, { once: true });
    });
  }) as typeof fetch;
}

/** Fails the connection the way undici does: TypeError with a coded `cause`. */
function stubConnectionFailure(code: string) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    record(input, init);
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = Object.assign(new Error(code), { code });
    return Promise.reject(err);
  }) as typeof fetch;
}

function stubJson(status: number, body: unknown) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    record(input, init);
    return Promise.resolve(
      new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
    );
  }) as typeof fetch;
}

/** Answers, but only after `delayMs` -- and still honours an abort meanwhile. */
function stubSlowJson(delayMs: number, body: unknown) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    record(input, init);
    return new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
      }, delayMs);
      const fail = () => {
        clearTimeout(timer);
        const err = new Error("The operation timed out.");
        err.name = "TimeoutError";
        reject(err);
      };
      if (init?.signal?.aborted) return fail();
      init?.signal?.addEventListener("abort", fail, { once: true });
    });
  }) as typeof fetch;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

// An explicit apiKey short-circuits resolveApiKey(), so none of these tests
// need a database or a VERIDIAN_API_KEY in the environment.
const KEY = { apiKey: "test-key" } as const;

describe("the 8 s abort budget", () => {
  test("the budget is 8 s, not the 20 s that cost the user 40", () => {
    // Asserted on the constant rather than on a stopwatch: `bun test` runs
    // every file in ONE process, and a loaded event loop fires an 8 s timer
    // several hundred milliseconds late -- which would make a tight wall-clock
    // bound flaky without saying anything more about the code than this does.
    expect(VERIDIAN_FETCH_TIMEOUT_MS).toBe(8_000);
  });

  test(
    "a hung upstream settles as UPSTREAM_TIMEOUT after ONE attempt, in one budget",
    async () => {
      stubNeverResolves();
      const startedAt = Date.now();
      const result = await callVeridianResult("/scope", KEY);
      const elapsed = Date.now() - startedAt;

      expect(result.ok).toBe(false);
      expect(result.code).toBe("UPSTREAM_TIMEOUT");
      // It really waited the budget rather than failing instantly...
      expect(elapsed).toBeGreaterThanOrEqual(7_500);
      // ...and it waited ONE budget, not two. The regression this guards is
      // the retry-on-timeout that made a hung upstream cost 2 x 20 s; a second
      // attempt could not possibly land under 12 s.
      expect(elapsed).toBeLessThan(12_000);
      expect(calls.length).toBe(1);
    },
    30_000
  );

  test(
    "the throwing form carries the same code and a real duration",
    async () => {
      stubNeverResolves();
      let caught: unknown;
      try {
        await callVeridian("/scope", KEY);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(VeridianApiError);
      const err = caught as VeridianApiError;
      expect(err.code).toBe("UPSTREAM_TIMEOUT");
      expect(err.status).toBe(504);
      expect(err.durationMs).toBeGreaterThan(7_000);
      // The internal URL and the exact budget stay in `detail` (R46S11_03).
      expect(err.message).not.toContain("http");
      expect(calls.length).toBe(1);
    },
    30_000
  );
});

describe("the retry policy", () => {
  test("a GET whose connection fails is retried exactly once", async () => {
    stubConnectionFailure("ECONNREFUSED");
    const result = await callVeridianResult("/scope", KEY);
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NETWORK");
    expect(calls.length).toBe(2);
  });

  test("ECONNRESET and ENOTFOUND are the same class", async () => {
    stubConnectionFailure("ECONNRESET");
    expect((await callVeridianResult("/scope", KEY)).code).toBe("NETWORK");
    expect(calls.length).toBe(2);

    calls = [];
    stubConnectionFailure("ENOTFOUND");
    expect((await callVeridianResult("/scope", KEY)).code).toBe("NETWORK");
    expect(calls.length).toBe(2);
  });

  test("a POST is never retried, even on a connection failure", async () => {
    stubConnectionFailure("ECONNRESET");
    const result = await callVeridianResult("/scope", { ...KEY, method: "POST", body: { a: 1 } });
    expect(result.ok).toBe(false);
    expect(result.code).toBe("NETWORK");
    // A retried POST is a duplicated BOQ, permit or task.
    expect(calls.length).toBe(1);
  });
});

describe("the closed code set", () => {
  test("a 500 from the upstream is UPSTREAM_500 and keeps its own words", async () => {
    stubJson(500, { error: "boq rollup failed" });
    const result = await callVeridianResult("/scope", KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.code).toBe("UPSTREAM_500");
    expect(result.message).toBe("boq rollup failed");
  });

  test("'supabaseKey is required' is STORAGE_UNAVAILABLE, never a generic error", async () => {
    stubJson(500, { error: "supabaseKey is required." });
    const result = await callVeridianResult("/documents", KEY);
    expect(result.code).toBe("STORAGE_UNAVAILABLE");
    expect(result.message).toContain("file storage is not configured");
  });

  test("a 404 carries no infrastructure code -- it is a real answer", async () => {
    stubJson(404, { error: "no screen definition seeded" });
    const result = await callVeridianResult("/screen-definitions/moms.list", KEY);
    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(result.code).toBeNull();
    expect(result.message).toBe("no screen definition seeded");
  });

  test("a success carries the data, a null code and a measured duration", async () => {
    stubJson(200, { meetings: [{ id: "m1" }] });
    const result = await callVeridianResult<{ meetings: { id: string }[] }>("/veri-meetings", KEY);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.data.meetings[0].id).toBe("m1");
    expect(result.code).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// R67 MERGE (lane B x lane F2) -- THE TWO VOCABULARIES STAY APART.
// ---------------------------------------------------------------------------
//
// B-09 gave VeridianApiError a `code` carrying the upstream's BUSINESS-RULE
// refusal (BOQ_LINE_REQUIRED); F-20 gave the same class a `code` carrying the
// four-value TRANSPORT classification. Merging the two lanes forced a choice,
// and the choice was one field each: `ruleCode` for B-09, `code` for F-20.
//
// These assertions exist because the tempting "simplification" -- folding
// ruleCode back into code -- is silently destructive. It would either widen
// VeridianErrorCode to `string`, which breaks veridian-response.ts's
// RETRYABLE_CODES membership test and so makes the Retry-After advice
// dishonest, or drop the rule code, which sends the Daily Entry form back to
// printing "VERIDIAN API request failed (400)" instead of "Pick a BOQ line".
describe("R67 merge: a rule refusal and a transport failure use different fields", () => {
  test("a coded 400 carries ruleCode + missing, and NO transport code", async () => {
    // Exactly what compliance-tracker's progress route answers for B-09:
    // {code, missing} and no `error` prose at all.
    stubJson(400, { code: "BOQ_LINE_REQUIRED", missing: ["boqLine"] });

    let thrown: unknown = null;
    try {
      await callVeridian("/work-progress", { ...KEY, method: "POST", body: { projectId: "p1" } });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(VeridianApiError);
    const e = thrown as VeridianApiError;
    // B-09's half: the rule code survives the trip. Before the merge fix it
    // was thrown away, and the refusal degraded to the generic sentence.
    expect(e.ruleCode).toBe("BOQ_LINE_REQUIRED");
    expect(e.missing).toEqual(["boqLine"]);
    // F-20's half: a 4xx is a real answer, so it gets no infrastructure code
    // and must never be advertised as retryable.
    expect(e.code).toBeNull();
    expect(e.status).toBe(400);
  });

  test("a transport failure carries the transport code and NO ruleCode", async () => {
    stubJson(500, { error: "boq rollup failed" });

    let thrown: unknown = null;
    try {
      await callVeridian("/work-progress", { ...KEY, method: "POST", body: {} });
    } catch (err) {
      thrown = err;
    }

    const e = thrown as VeridianApiError;
    expect(e.code).toBe("UPSTREAM_500");
    expect(e.ruleCode).toBeUndefined();
    expect(e.missing).toBeUndefined();
  });
});

describe("caller cancellation", () => {
  test("an aborted caller is not reported as an upstream timeout", async () => {
    stubNeverResolves();
    const controller = new AbortController();
    const pending = callVeridianResult("/scope", { ...KEY, signal: controller.signal });
    controller.abort();
    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.status).toBe(499);
    expect(result.code).toBeNull();
    expect(calls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// R67 F-20 FIX -- the read budget is not the transfer budget.
// ---------------------------------------------------------------------------
//
// fetchWithTimeout() is shared by every transport in this file, so cutting it
// from 20 s to 8 s also cut the two that carry FILE BYTES: callVeridianUpload
// (POST /api/permits, /api/drawings, /api/documents, and /api/scope/import,
// which relays a BOQ workbook VERIDIAN parses server-side) and
// callVeridianBinary. Those have no "This is taking longer than usual" screen
// contract -- the 8 s figure exists only because that is when the UI gives up
// on a READ -- and because F-20 also removed the retry for non-GET, an abort
// there is final with nothing saved. A site engineer's multi-megabyte drawing
// over 4G is exactly the upload that lands between 8 s and 20 s.
describe("the upload budget is its own number", () => {
  test("the two budgets are separate constants, and the read one is untouched", () => {
    expect(VERIDIAN_FETCH_TIMEOUT_MS).toBe(8_000);
    expect(VERIDIAN_UPLOAD_TIMEOUT_MS).toBe(30_000);
    // Asserted as a relationship too: whichever one a later change moves, a
    // transfer must never be given less room than a screen read.
    expect(VERIDIAN_UPLOAD_TIMEOUT_MS).toBeGreaterThan(VERIDIAN_FETCH_TIMEOUT_MS);
  });

  test(
    "an upload that takes longer than the READ budget still completes",
    async () => {
      // 9.5 s: comfortably past the 8 s at which this call used to be aborted,
      // and nowhere near the 30 s it now has. Under the pre-fix code both calls
      // below threw UPSTREAM_TIMEOUT and the file was lost.
      stubSlowJson(9_500, { id: "drawing-1" });

      const form = new FormData();
      form.append("file", new Blob(["bytes"], { type: "application/pdf" }), "plan.pdf");

      const [uploaded, binary] = await Promise.all([
        callVeridianUpload<{ id: string }>("/drawings", form, KEY),
        callVeridianBinary("/reports/wpr.pdf", KEY),
      ]);

      expect(uploaded.id).toBe("drawing-1");
      expect(binary.contentType).toContain("application/json");
      // One attempt each -- a POST is still never retried.
      expect(calls.length).toBe(2);
      expect(calls.some((c) => c.method === "POST")).toBe(true);
    },
    40_000
  );
});
