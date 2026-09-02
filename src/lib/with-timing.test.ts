/// <reference types="bun-types" />
// R67 F-28. The wrapper every /api route wears: does it actually separate the
// time spent waiting on VERIDIAN from the time spent in this process, and does
// it survive the failure paths a latency table cares most about?

import { describe, expect, test } from "bun:test";
import { NextResponse } from "next/server";
import { withTiming } from "./with-timing";
import { beginRequestTiming, currentRequestTiming, recordRequestOrg, recordUpstream, runWithRequestTiming } from "./request-timing";

function parseServerTiming(header: string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of (header ?? "").split(",")) {
    const [name, dur] = part.trim().split(";dur=");
    if (name && dur !== undefined) out[name] = Number(dur);
  }
  return out;
}

function fakeRequest(pathname: string) {
  return { nextUrl: { pathname } } as unknown as Parameters<typeof fetch>[0];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("request-timing ledger", () => {
  test("outside a timed scope, recording is a silent no-op", () => {
    // Server components and scripts import veridian-client too; they must not
    // crash, and they must not accumulate into anyone else's request.
    expect(() => recordUpstream(50)).not.toThrow();
    expect(() => recordRequestOrg("org-1")).not.toThrow();
    expect(currentRequestTiming()).toBeUndefined();
  });

  test("two overlapping requests keep separate ledgers", async () => {
    const a = beginRequestTiming();
    const b = beginRequestTiming();
    await Promise.all([
      runWithRequestTiming(a, async () => {
        recordUpstream(100);
        await sleep(10);
        recordUpstream(100);
      }),
      runWithRequestTiming(b, async () => {
        await sleep(5);
        recordUpstream(7);
      }),
    ]);
    expect(a.upstreamMs).toBe(200);
    expect(a.upstreamCalls).toBe(2);
    expect(b.upstreamMs).toBe(7);
    expect(b.upstreamCalls).toBe(1);
  });
});

describe("withTiming", () => {
  test("splits the wait on VERIDIAN from this process's own work", async () => {
    const handler = withTiming("GET", async () => {
      // What a real proxy does: 120 ms of it was VERIDIAN answering.
      recordUpstream(120);
      await sleep(30);
      return NextResponse.json({ ok: true });
    });

    const res = await handler(fakeRequest("/api/moms") as never);
    const timing = parseServerTiming(res.headers.get("Server-Timing"));
    expect(timing.upstream).toBe(120);
    // `app` is total minus upstream. The handler really slept 30 ms, so this
    // is a genuine measurement, not a constant -- assert the shape rather than
    // an exact figure a busy CI box cannot promise.
    expect(timing.app).toBeGreaterThanOrEqual(0);
    expect(timing.app).toBeLessThan(120);
  });

  test("app;dur is never negative even when the clocks disagree", async () => {
    // Upstream is measured by veridian-client's own clock and the total by
    // this wrapper's; a few ms of drift must not produce "app;dur=-3" in a
    // header other tools parse.
    const handler = withTiming("GET", async () => {
      recordUpstream(60_000);
      return NextResponse.json({ ok: true });
    });
    const res = await handler(fakeRequest("/api/scope") as never);
    expect(parseServerTiming(res.headers.get("Server-Timing")).app).toBe(0);
  });

  test("the response body, status and other headers are untouched", async () => {
    const handler = withTiming("GET", async () =>
      NextResponse.json({ vendors: [] }, { status: 200, headers: { "Cache-Control": "private, max-age=600" } })
    );
    const res = await handler(fakeRequest("/api/vendors") as never);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=600");
    expect(await res.json()).toEqual({ vendors: [] });
  });

  test("a failing upstream still counts toward `upstream` -- the user waited for it", async () => {
    const handler = withTiming("GET", async () => {
      recordUpstream(8_000); // the abort budget, spent and lost
      return NextResponse.json({ error: "The construction data service did not respond in time." }, { status: 503 });
    });
    const res = await handler(fakeRequest("/api/tasks") as never);
    expect(res.status).toBe(503);
    expect(parseServerTiming(res.headers.get("Server-Timing")).upstream).toBe(8_000);
  });

  test("a handler that throws is re-thrown, not swallowed into a 200", async () => {
    const handler = withTiming("POST", async () => {
      throw new Error("boom");
    });
    await expect(handler(fakeRequest("/api/tasks") as never)).rejects.toThrow("boom");
  });

  test("wrapping an already-wrapped handler returns it unchanged (re-export chains)", async () => {
    const once = withTiming("GET", async () => NextResponse.json({ ok: true }));
    expect(withTiming("GET", once)).toBe(once);
  });

  test("a handler declaring no parameters at all still works", async () => {
    // Several GETs in this repo take no arguments; the route name simply
    // cannot be resolved, and that must never fail the request.
    const handler = withTiming("GET", async () => NextResponse.json({ ok: true }));
    const res = await handler();
    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toContain("app;dur=");
  });
});
