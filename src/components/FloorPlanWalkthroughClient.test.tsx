/// <reference types="bun-types" />
// R62 B7 regression test for A4S14_05 (Critical), fixed in PR #165 (ebbd0dd).
//
// THE DEFECT: `const data = await res.json(); setScene(data);` with res.ok
// never read. GET /api/floor-plans/[id]/scene answers a failure with
// { error: "..." } and a real status; that body is truthy, so the `!scene`
// guard let it through, and `scene.rooms.length` read .length off undefined
// -- an UNCAUGHT TypeError, on top of the parent /floor-plans/[id] route's
// own separate crash (A4S14_04). Ends on the browser's own "This page could
// not load" screen; no walkthrough UI (3D view, camera controls) ever
// renders.
//
// THE FIX: fetchJson reads the status first and throws; on failure the
// component renders an in-app error card (role="alert", the backend's own
// message, Retry + "Back to 2D Editor") instead of ever reaching the
// .rooms.length read.
//
// This test fails without the fix: reverting load() to a bare `res.json()`
// makes rendering throw an uncaught TypeError instead of showing the error
// card.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const FloorPlanWalkthroughClient = (await import("./FloorPlanWalkthroughClient")).default;

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

describe("FloorPlanWalkthroughClient (A4S14_05)", () => {
  test("a failed GET .../scene renders the backend's real error, not an uncaught crash reading .rooms.length off undefined", async () => {
    globalThis.fetch = router({
      "/api/floor-plans/plan-1/scene": () => jsonRes({ error: "VERIDIAN request timed out after 20000ms" }, 504),
    });

    const { getByRole, getByText } = render(<FloorPlanWalkthroughClient floorPlanId="plan-1" />);

    const alert = await waitFor(() => getByRole("alert"));
    expect(alert.textContent).toContain("VERIDIAN request timed out after 20000ms");
    expect(getByText("Retry")).toBeDefined();
    expect(getByText("Back to 2D Editor")).toBeDefined();
  });
});
