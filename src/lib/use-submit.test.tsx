/// <reference types="bun-types" />
// R67 D-72 -- the one submit's own oracle.
//
// The four things that make this hook worth having, each asserted against the
// behaviour the twelve hand-rolled handlers actually had:
//
//   1. a refused save keeps the server's own words and says nothing was saved;
//   2. a click that produces no request says so, instead of flickering
//      "Saving…" and going quiet (the R52 dead-create-button class);
//   3. a hung upstream is given up on rather than left saving forever;
//   4. a landed save reads "Saved" until the caller has navigated.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { savedReceipt, submitFailure, terminate, useSubmit, failureKind } from "./use-submit";

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function stub(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
}

const PERMIT = { input: "/api/permits", init: { method: "POST" } };

describe("terminate", () => {
  test("a reason without a full stop gets one, so two sentences cannot run together", () => {
    expect(terminate("A permit with that number already exists")).toBe(
      "A permit with that number already exists."
    );
  });

  test("a reason that already ends in punctuation is left exactly as the server wrote it", () => {
    expect(terminate("Is the end date after the issue date?")).toBe("Is the end date after the issue date?");
    expect(terminate("Refused.")).toBe("Refused.");
  });

  test("an empty reason is replaced, never left as a gap in the sentence", () => {
    expect(terminate("")).toBe("the server gave no reason.");
    expect(terminate(null)).toBe("the server gave no reason.");
  });
});

describe("submitFailure", () => {
  test("a refusal quotes the backend and states that nothing was saved", () => {
    const f = submitFailure("refused", "Permit", "A permit with that number already exists");
    expect(f.message).toBe(
      "Could not save the permit — A permit with that number already exists. Nothing was saved."
    );
    expect(f.retryable).toBe(true);
  });

  test("a timeout names the ceiling it actually waited", () => {
    expect(submitFailure("timeout", "BOQ").message).toBe(
      "The server did not answer in 10 s — nothing was saved."
    );
  });

  test("an unreachable server does NOT claim it waited ten seconds", () => {
    // The disclosed deviation from D-72's wording: a DNS failure rejects in
    // milliseconds, and "did not answer in 10 s" would be a false statement
    // about how long the user's request was given.
    const f = submitFailure("unreachable", "Worker");
    expect(f.message).toBe("The request never reached the server — nothing was saved.");
    expect(f.message).not.toContain("10 s");
  });

  test("a click that sent nothing says so in D-72's own words", () => {
    expect(submitFailure("not-sent", "Meeting").message).toBe("Nothing was sent — try again");
  });

  test("a 2xx that confirmed nothing does not claim nothing was saved, and offers no retry", () => {
    const f = submitFailure("unconfirmed", "BOQ", "The server did not return a BOQ id");
    expect(f.message).toBe(
      "The boq was accepted but the server did not confirm it — The server did not return a BOQ id. Check the list before saving again."
    );
    expect(f.message).not.toContain("Nothing was saved");
    // Retrying an accepted write is how a duplicate record is created.
    expect(f.retryable).toBe(false);
  });
});

describe("savedReceipt", () => {
  test("carries the identifier a user would recognise, and where to open it", () => {
    expect(savedReceipt("Permit", "BP-2026-0142", "/permits/9")).toEqual({
      kind: "saved",
      text: "Saved — Permit BP-2026-0142",
      href: "/permits/9",
    });
  });

  test("a record with nothing recognisable still gets a receipt, not a blank one", () => {
    expect(savedReceipt("Attendance", "").text).toBe("Saved — Attendance");
  });
});

describe("failureKind", () => {
  test("distinguishes a timeout from a network failure from a refusal", () => {
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(failureKind(timeout)).toBe("timeout");
    expect(failureKind(new TypeError("Failed to fetch"))).toBe("unreachable");
  });
});

describe("useSubmit", () => {
  test("a 2xx reads 'Saved' and hands the parsed body to onSuccess", async () => {
    stub(201, { id: "permit-9" });
    let received: unknown = null;
    const { result } = renderHook(() =>
      useSubmit<{ id: string }>({
        objectLabel: "Permit",
        buildRequest: () => PERMIT,
        onSuccess: (body) => {
          received = body;
        },
      })
    );

    act(() => result.current.submit());
    await waitFor(() => expect(result.current.state).toBe("saved"));
    expect(result.current.saved).toBe(true);
    expect(result.current.failure).toBeNull();
    expect(received).toEqual({ id: "permit-9" });
  });

  test("a non-2xx keeps the backend's own message and re-enables the button", async () => {
    stub(409, { error: "A permit with that number already exists on this project" });
    const { result } = renderHook(() =>
      useSubmit({ objectLabel: "Permit", buildRequest: () => PERMIT, onSuccess: () => {} })
    );

    act(() => result.current.submit());
    await waitFor(() => expect(result.current.failure).not.toBeNull());
    expect(result.current.failure?.kind).toBe("refused");
    expect(result.current.failure?.message).toContain("A permit with that number already exists on this project.");
    expect(result.current.failure?.message).toContain("Nothing was saved.");
    // Re-enabled, so the correction costs an edit and not a retype.
    expect(result.current.state).toBe("idle");
    expect(result.current.saving).toBe(false);
  });

  test("a body with no error string still refuses in words rather than a blank", async () => {
    globalThis.fetch = (async () => new Response("<html>502</html>", { status: 502 })) as typeof globalThis.fetch;
    const { result } = renderHook(() =>
      useSubmit({ objectLabel: "BOQ", buildRequest: () => PERMIT, onSuccess: () => {} })
    );

    act(() => result.current.submit());
    await waitFor(() => expect(result.current.failure).not.toBeNull());
    expect(result.current.failure?.message).toBe(
      "Could not save the boq — Request failed (HTTP 502). Nothing was saved."
    );
  });

  test("a build that refuses to produce a request says nothing was sent, and issues no fetch", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useSubmit({ objectLabel: "Meeting", buildRequest: () => null, onSuccess: () => {} })
    );

    act(() => result.current.submit());
    await waitFor(() => expect(result.current.failure).not.toBeNull());
    expect(result.current.failure?.message).toBe("Nothing was sent — try again");
    expect(calls).toBe(0);
    expect(result.current.state).toBe("idle");
  });

  test("a network failure is reported as unreachable, not as a refusal", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useSubmit({ objectLabel: "Worker", buildRequest: () => PERMIT, onSuccess: () => {} })
    );

    act(() => result.current.submit());
    await waitFor(() => expect(result.current.failure).not.toBeNull());
    expect(result.current.failure?.kind).toBe("unreachable");
  });

  test("a transport failure the caller handles produces no failure at all", async () => {
    // The Work Progress form queues the entry on the device when the network
    // is gone. That is a second real outcome, not an error to show.
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof globalThis.fetch;

    let queued = false;
    const { result } = renderHook(() =>
      useSubmit({
        objectLabel: "Entry",
        buildRequest: () => PERMIT,
        onSuccess: () => {},
        onTransportError: () => {
          queued = true;
          return true;
        },
      })
    );

    act(() => result.current.submit());
    await waitFor(() => expect(queued).toBe(true));
    expect(result.current.failure).toBeNull();
    expect(result.current.state).toBe("idle");
  });

  test("a second click while the first is in flight cannot post twice", async () => {
    let calls = 0;
    let release: ((r: Response) => void) | null = null;
    globalThis.fetch = ((): Promise<Response> => {
      calls += 1;
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useSubmit({ objectLabel: "Permit", buildRequest: () => PERMIT, onSuccess: () => {} })
    );

    act(() => result.current.submit());
    await waitFor(() => expect(calls).toBe(1));
    act(() => result.current.submit());
    expect(calls).toBe(1);

    await act(async () => {
      release?.(new Response(JSON.stringify({ id: "x" }), { status: 201, headers: { "content-type": "application/json" } }));
      await Promise.resolve();
    });
  });

  test("every write carries an abort signal, so a hung upstream cannot save forever", async () => {
    let seen: AbortSignal | null = null;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen = init?.signal ?? null;
      return new Response(JSON.stringify({ id: "x" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useSubmit({ objectLabel: "Permit", buildRequest: () => PERMIT, onSuccess: () => {} })
    );
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.state).toBe("saved"));

    // Not "a signal exists somewhere" -- the request itself carries one, which
    // is the whole difference from the twelve handlers this replaced.
    expect(seen).not.toBeNull();
    expect(typeof (seen as unknown as AbortSignal).aborted).toBe("boolean");
  });

  test("a server that never answers is given up on, and the request is aborted", async () => {
    // The defect this replaces: twelve handlers called fetch() with no signal
    // at all, so a hung upstream left "Saving…" on the button indefinitely.
    let seenSignal: AbortSignal | null = null;
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      seenSignal = init?.signal ?? null;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() =>
      useSubmit({
        objectLabel: "Permit",
        buildRequest: () => PERMIT,
        onSuccess: () => {},
        timeoutMs: 1_000,
      })
    );

    act(() => result.current.submit());
    await waitFor(() => expect(result.current.failure).not.toBeNull(), { timeout: 4_000 });
    expect(result.current.failure?.kind).toBe("timeout");
    // The sentence names the ceiling that actually expired -- with the
    // product default of 10 s that is D-72's own wording, asserted above.
    expect(result.current.failure?.message).toBe("The server did not answer in 1 s — nothing was saved.");
    expect((seenSignal as unknown as AbortSignal).aborted).toBe(true);
    expect(result.current.state).toBe("idle");
  });

  test("a 2xx whose body confirms nothing is reported as unconfirmed, never as a refusal", async () => {
    stub(201, { ok: true });
    const { result } = renderHook(() =>
      useSubmit<{ id?: string }>({
        objectLabel: "Permit",
        buildRequest: () => PERMIT,
        onSuccess: (body) => {
          if (!body?.id) throw new Error("The server did not confirm a saved permit");
        },
      })
    );

    act(() => result.current.submit());
    await waitFor(() => expect(result.current.failure).not.toBeNull());
    expect(result.current.failure?.kind).toBe("unconfirmed");
    expect(result.current.failure?.message).toContain("The server did not confirm a saved permit.");
    expect(result.current.failure?.message).not.toContain("Nothing was saved");
  });

  test("clearFailure removes the banner without sending anything", async () => {
    stub(400, { error: "no" });
    const { result } = renderHook(() =>
      useSubmit({ objectLabel: "Permit", buildRequest: () => PERMIT, onSuccess: () => {} })
    );
    act(() => result.current.submit());
    await waitFor(() => expect(result.current.failure).not.toBeNull());
    act(() => result.current.clearFailure());
    expect(result.current.failure).toBeNull();
  });
});
