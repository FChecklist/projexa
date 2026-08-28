/// <reference types="bun-types" />
// R62 B7 regression test for A4S14_04 (Critical), fixed in PR #165 (ebbd0dd).
//
// THE DEFECT: load() did `const data: FloorPlan = await res.json();
// setFloorPlan(data);` with res.ok never read. GET /api/floor-plans/[id]
// answers a failure with { error: "..." } and a real status; that body
// parses fine and is truthy, so the `if (loading || !floorPlan) return`
// guard let it through, and `floorPlan.rooms.flatMap(...)` then read
// .flatMap off undefined -- an UNCAUGHT TypeError that tore down the whole
// React tree, leaving the browser on its own "This page could not load"
// screen. No app shell, no in-app error state.
//
// THE FIX: fetchJson reads the status first and throws; on failure the
// component renders an in-app error card (role="alert", the backend's own
// message, Retry + Back to floor plans) instead of ever reaching the
// flatMap read.
//
// This test fails without the fix: reverting load() to a bare `res.json()`
// makes rendering throw an uncaught TypeError instead of showing the error
// card, which surfaces here as render() itself throwing/rejecting rather
// than the assertions below being met.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const FloorPlanEditorClient = (await import("./FloorPlanEditorClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function router(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler();
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

describe("FloorPlanEditorClient (A4S14_04)", () => {
  test("a failed GET /api/floor-plans/[id] renders the backend's real error, not an uncaught crash reading .rooms.flatMap off undefined", async () => {
    globalThis.fetch = router({
      "/api/floor-plans/plan-1": () => jsonRes({ error: "VERIDIAN request timed out after 20000ms" }, 504),
    });

    const { getByRole, getByText } = render(<FloorPlanEditorClient floorPlanId="plan-1" />);

    const alert = await waitFor(() => getByRole("alert"));
    expect(alert.textContent).toContain("VERIDIAN request timed out after 20000ms");
    expect(getByText("Retry")).toBeDefined();
    expect(getByText("Back to floor plans")).toBeDefined();
  });
});
