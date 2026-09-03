/// <reference types="bun-types" />
// R67 E-30 (R-263). The hook's own acceptance clauses.
//
// SCALED, NOT FAKED. The item states them at the real budget ("a fetch stub
// that resolves after 30 s reaches state 'timeout' at 20 s, and 'running' with
// elapsed >= 1 by 1 s"). bun:test has no fake timers, so the same clauses are
// asserted at a scaled budget -- a 400 ms task against a 120 ms timeout -- and
// the elapsed clause is asserted at the real one-second tick, which is the only
// part of this that a scale would change the meaning of.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { DEFAULT_RUN_TIMEOUT_MS, timeoutSentence, useTimedRun } from "./use-timed-run";

afterEach(cleanup);

/** A task that answers after `ms`, or rejects with an AbortError if aborted first. */
function slowTask(ms: number, value: unknown = "answer") {
  return (signal: AbortSignal) =>
    new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => resolve(value), ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("aborted", "AbortError"));
        },
        { once: true }
      );
    });
}

describe("useTimedRun", () => {
  test("a run that answers in time reaches done, with how long it took and when", async () => {
    const { result } = renderHook(() => useTimedRun({ timeoutMs: 500 }));
    await act(async () => {
      await result.current.run(slowTask(20, "rows"));
    });
    expect(result.current.state).toBe("done");
    expect(result.current.result).toBe("rows");
    expect(result.current.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.current.ranAt).not.toBeNull();
    expect(result.current.error).toBeNull();
  });

  test("a task slower than the budget reaches 'timeout' -- and the task is really aborted", async () => {
    let aborted = false;
    const { result } = renderHook(() => useTimedRun({ timeoutMs: 120 }));
    const task = (signal: AbortSignal) => {
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      return slowTask(400)(signal);
    };
    await act(async () => {
      await result.current.run(task as (s: AbortSignal) => Promise<unknown>);
    });
    await waitFor(() => expect(result.current.state).toBe("timeout"));
    expect(aborted).toBe(true);
    // It reports the budget, not a half-measured elapsed value.
    expect(result.current.elapsedSeconds).toBe(0); // 120 ms rounds to 0 s at this scale
  });

  test("the elapsed counter really ticks -- 'running' with elapsed >= 1 by ~1 s", async () => {
    const { result } = renderHook(() => useTimedRun({ timeoutMs: 5000 }));
    act(() => {
      void result.current.run(slowTask(2500));
    });
    expect(result.current.state).toBe("running");
    await waitFor(() => expect(result.current.elapsedSeconds).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    expect(result.current.state).toBe("running");
    act(() => result.current.cancel());
  });

  test("Cancel stops the request and says 'cancelled', not 'failed'", async () => {
    let aborted = false;
    const { result } = renderHook(() => useTimedRun({ timeoutMs: 5000 }));
    const task = (signal: AbortSignal) => {
      signal.addEventListener("abort", () => { aborted = true; }, { once: true });
      return slowTask(2000)(signal);
    };
    act(() => {
      void result.current.run(task as (s: AbortSignal) => Promise<unknown>);
    });
    act(() => result.current.cancel());
    await waitFor(() => expect(result.current.state).toBe("cancelled"));
    expect(aborted).toBe(true);
    expect(result.current.error).toBeNull();
  });

  test("a rejected task reaches 'failed' and keeps the backend's own words", async () => {
    const { result } = renderHook(() => useTimedRun({ timeoutMs: 500 }));
    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("boqId does not belong to this project")));
    });
    expect(result.current.state).toBe("failed");
    expect(result.current.error).toBe("boqId does not belong to this project");
  });

  test("a cancelled run's late answer never commits -- that is how a cancelled report reappears", async () => {
    const { result } = renderHook(() => useTimedRun({ timeoutMs: 5000 }));
    // A task that ignores the abort entirely, which is the real hazard.
    act(() => {
      void result.current.run(() => new Promise((resolve) => setTimeout(() => resolve("late"), 150)));
    });
    act(() => result.current.cancel());
    await new Promise((r) => setTimeout(r, 250));
    expect(result.current.state).toBe("cancelled");
    expect(result.current.result).toBeNull();
  });

  test("reset clears everything back to idle", async () => {
    const { result } = renderHook(() => useTimedRun({ timeoutMs: 500 }));
    await act(async () => {
      await result.current.run(slowTask(10, "rows"));
    });
    act(() => result.current.reset());
    expect(result.current.state).toBe("idle");
    expect(result.current.result).toBeNull();
    expect(result.current.ranAt).toBeNull();
  });
});

describe("timeoutSentence", () => {
  test("R-263's own sentence, built from the real budget", () => {
    expect(timeoutSentence()).toBe("This report did not answer in 20 s.");
    expect(DEFAULT_RUN_TIMEOUT_MS).toBe(20_000);
    expect(timeoutSentence(30_000)).toBe("This report did not answer in 30 s.");
  });
});
