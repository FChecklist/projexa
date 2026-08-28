/// <reference types="bun-types" />
// R62 B7 regression test for A4S14_03 (High), fixed in PR #178.
//
// TWO INDEPENDENT DEFECTS WERE RECORDED AS ONE "dead New Floor Plan button":
//  1. load() did `const data = await res.json(); setPlans(data.floorPlans ?? [])`
//     with res.ok never read. A failing VERIDIAN proxy returns an error body
//     that parses fine as JSON, so `data.floorPlans` came back undefined and
//     `?? []` rendered a confident "No floor plans yet." on a real failure.
//  2. The dialog TRIGGER was never dead -- Radix opens it fine. What did
//     nothing was the CREATE button inside: createPlan() opened with
//     `if (!name.trim()) return;` while the button was only
//     `disabled={submitting}`, so clicking Create with Name empty produced no
//     dialog change, no request, no message -- the exact recorded symptom, on
//     a different control.
//
// This test fails without the fix in FloorPlansClient.tsx: reverting load()
// to a bare `res.json()` + `?? []` makes "No floor plans yet." render instead
// of the real backend message; reverting the Create button to
// `disabled={submitting}` (dropping the `missing` wiring into PrimarySubmit)
// makes it enabled while Name is still empty.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const FloorPlansClient = (await import("./FloorPlansClient")).default;

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

describe("FloorPlansClient (A4S14_03)", () => {
  test("a failing load shows the backend's own error, never the confident 'No floor plans yet.' empty state", async () => {
    globalThis.fetch = router({
      "/api/floor-plans": () => jsonRes({ error: "VERIDIAN request timed out after 20000ms" }, 504),
    });

    const { getByText, queryByText } = render(<FloorPlansClient projectId="proj-1" />);

    await waitFor(() => expect(getByText(/VERIDIAN request timed out after 20000ms/)).toBeDefined());
    expect(queryByText("No floor plans yet.")).toBeNull();
  });

  test("Create is disabled while Name is empty and names what's missing, so the click-lands-but-nothing-happens guard is unreachable", async () => {
    globalThis.fetch = router({
      "/api/floor-plans": () => jsonRes({ floorPlans: [] }),
    });

    const { getByText, getByRole } = render(<FloorPlansClient projectId="proj-1" />);

    await waitFor(() => expect(getByText("No floor plans yet.")).toBeDefined());

    fireEvent.click(getByRole("button", { name: /New Floor Plan/i }));

    const createButton = await waitFor(() => getByRole("button", { name: "Create" }));
    expect((createButton as HTMLButtonElement).disabled).toBe(true);
    expect(getByText(/1 required field left: Name/)).toBeDefined();
  });
});
