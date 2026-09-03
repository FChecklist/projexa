/// <reference types="bun-types" />
// R67 E-37 (R-298), the half of the item that is a REGRESSION GUARD rather
// than a change.
//
// R-298 recorded two /api/dashboard-hierarchy/* requests firing on /floor-plans
// and failing there. Reading the code, nothing on that page issues them: the
// page itself calls resolveSelectedProject only, and DashboardHierarchyClient
// -- the sole component in this repo that touches those endpoints -- is mounted
// exactly once, on /dashboard/hierarchy. So there was no guard to add and no
// call to remove, and I am not inventing one.
//
// What IS worth keeping is the property the finding was about: this screen must
// fetch its own module's data and nothing else. That is asserted here, so if a
// future edit reaches for a hierarchy call (or any cross-module one) from this
// client, it fails in this file rather than in a browser waterfall.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));

import { cleanup, render, waitFor } from "@testing-library/react";
import FloorPlansClient from "./FloorPlansClient";

let requested: string[] = [];

afterEach(() => {
  cleanup();
  requested = [];
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("R67 E-37: /floor-plans fetches its own module and nothing else", () => {
  test("no request to a dashboard-hierarchy endpoint", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify({ floorPlans: [] }), { status: 200 });
    }) as typeof fetch;

    const { container } = render(<FloorPlansClient projectId="prj-cedar" />);
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));

    expect(requested.some((url) => url.includes("hierarchy"))).toBe(false);
    // Every request this screen makes belongs to this screen's own module.
    expect(requested.every((url) => url.includes("/api/floor-plans"))).toBe(true);
    // And it renders, rather than sitting on a spinner.
    await waitFor(() => expect(container.textContent).toBeTruthy());
  });
});
