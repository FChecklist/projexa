/// <reference types="bun-types" />
// R67 D-71 -- the shared list hook's own oracle.
//
// read-outcome.test.ts proves the DECISION (a 500 is never an empty list).
// This proves the hook actually carries that decision into a component:
// that a failure never populates rows, that an empty 200 still reaches the
// empty branch, that a failed refresh does not destroy rows the user already
// had, and that a superseded response cannot paint over a newer one.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useListRead } from "./use-list-read";

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

type Row = { id: string };
const select = (body: unknown) => (body as { rows?: Row[] } | null)?.rows;

function stub(status: number, body: unknown) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    })) as typeof globalThis.fetch;
}

describe("useListRead", () => {
  test("a 200 with rows lands as ready, with a load time", async () => {
    stub(200, { rows: [{ id: "a" }, { id: "b" }] });
    const { result } = renderHook(() => useListRead<Row>({ url: "/api/things", select }));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.rows).toHaveLength(2);
    expect(result.current.loadedAt).toBeInstanceOf(Date);
    expect(result.current.error).toBeNull();
  });

  test("a 200 with zero rows is ready-and-empty, not an error", async () => {
    stub(200, { rows: [] });
    const { result } = renderHook(() => useListRead<Row>({ url: "/api/things", select }));

    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.rows).toEqual([]);
    expect(result.current.outcome?.status).toBe("empty");
  });

  test("a 500 never produces rows, and keeps the backend's own message", async () => {
    stub(500, { error: "No VERIDIAN credentials configured (AR-04)" });
    const { result } = renderHook(() => useListRead<Row>({ url: "/api/things", select }));

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.rows).toEqual([]);
    expect(result.current.error?.status).toBe(500);
    expect(result.current.error?.message).toBe("No VERIDIAN credentials configured (AR-04)");
    // The empty branch must be unreachable: PaneState's mayShowEmptyState
    // takes this status, and "error" is not "ready".
    expect(result.current.outcome?.status).toBe("error");
  });

  test("a failed REFRESH keeps the rows the user already had", async () => {
    stub(200, { rows: [{ id: "a" }] });
    const { result } = renderHook(() => useListRead<Row>({ url: "/api/things", select }));
    await waitFor(() => expect(result.current.status).toBe("ready"));

    stub(504, { error: "upstream gone" });
    act(() => result.current.reload());

    await waitFor(() => expect(result.current.status).toBe("error"));
    // Blanking the table on a failed poll throws away information the user
    // could read a second ago. PaneState dates what is left, it does not
    // delete it.
    expect(result.current.rows).toHaveLength(1);
  });

  test("a null url stays idle and issues no read at all", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      return new Response("{}", { status: 200 });
    }) as typeof globalThis.fetch;

    const { result } = renderHook(() => useListRead<Row>({ url: null, select }));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(calls).toBe(0);
    expect(result.current.startedAt).toBeNull();
  });

  test("a superseded response cannot paint over the newer url's rows", async () => {
    // Project A's read is slow; the user switches to project B, whose read
    // answers first. Without the sequence guard, A's late rows would land
    // under B's heading -- the wrong-project fault by another route.
    let resolveSlow: ((r: Response) => void) | null = null;
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("slow")) {
        return new Promise<Response>((resolve) => {
          resolveSlow = resolve;
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ rows: [{ id: "fast" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
    }) as typeof globalThis.fetch;

    const { result, rerender } = renderHook(
      ({ url }: { url: string }) => useListRead<Row>({ url, select }),
      { initialProps: { url: "/api/things?slow=1" } }
    );

    rerender({ url: "/api/things?fast=1" });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(result.current.rows.map((r) => r.id)).toEqual(["fast"]);

    // The slow read now answers, too late to matter.
    await act(async () => {
      resolveSlow?.(
        new Response(JSON.stringify({ rows: [{ id: "slow" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );
      await Promise.resolve();
    });

    expect(result.current.rows.map((r) => r.id)).toEqual(["fast"]);
  });
});
