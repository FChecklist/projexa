/// <reference types="bun-types" />
// R62 B7 regression test for A4S14_11 (High), fixed in PR #165 (ebbd0dd).
//
// RECORDED: "Add Material" is a dead no-op -- clicked, no [role="dialog"]
// appears; the Inbound and Cost Report endpoints both 502 and render as
// "No receipts recorded yet." / "No receipts to report yet.".
//
// THE CORRECTION: there never was a dialog on this route -- Add Material
// submits the INLINE Spec/Unit/Unit Cost form beside it. The click did land
// and the handler did run: it hit `if (!spec.trim() || !unit.trim()) return;`
// and returned in SILENCE with both fields empty (F_006-class, not the
// Radix/kit click-failure family it was grouped with).
//
// THE FIX: the guard now sets an inline role="alert" message AND toasts
// instead of returning silently. Separately, load() moved to
// Promise.allSettled + fetchJson so a 502 on Inbound/Cost Report renders a
// named per-tab error instead of the confident "No receipts..." empty copy,
// while Catalog (which answered 200) still renders.
//
// This test fails without the fix: reverting addMaterial()'s guard to a bare
// `if (!spec.trim() || !unit.trim()) return;` makes clicking Add Material
// with both fields empty produce no message and no fetch call at all;
// reverting load() to bare `res.json()` calls makes "No receipts recorded
// yet." / "No receipts to report yet." render on real 502s.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const SiteMaterialsClient = (await import("./SiteMaterialsClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function router(handlers: Record<string, () => Response>) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, handler] of Object.entries(handlers)) {
      if (url.includes(path)) return handler(init);
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  }) as typeof fetch;
}

describe("SiteMaterialsClient (A4S14_11)", () => {
  test("Add Material with Spec and Unit both empty shows an inline reason and never fires a request -- the click-lands-but-nothing-happens bug", async () => {
    let postCalled = false;
    globalThis.fetch = router({
      "/api/construction-materials/inbound": () => jsonRes({ inbound: [] }),
      "/api/construction-materials/cost-report": () => jsonRes({ report: [] }),
      "/api/construction-materials": (init?: RequestInit) => {
        if (init?.method === "POST") postCalled = true;
        return jsonRes({ materials: [] });
      },
    });

    const { getByRole, getByText } = render(<SiteMaterialsClient projectId="proj-1" />);

    await waitFor(() => getByText("No materials yet."));
    fireEvent.click(getByRole("button", { name: /Add Material/i }));

    const alert = await waitFor(() => getByRole("alert"));
    expect(alert.textContent).toContain("Spec and Unit are both required to add a material.");
    expect(postCalled).toBe(false);
  });

  test("Inbound (502) and Cost Report (502) each show their own named failure, never the confident 'No receipts...' empty copy, while Catalog (200) still renders", async () => {
    globalThis.fetch = router({
      // Longer/more-specific paths first: router matches by substring, and
      // "/api/construction-materials" is itself a substring of both the
      // inbound and cost-report URLs.
      "/api/construction-materials/inbound": () => jsonRes({ error: "Bad Gateway" }, 502),
      "/api/construction-materials/cost-report": () => jsonRes({ error: "Bad Gateway" }, 502),
      "/api/construction-materials": () => jsonRes({ materials: [{ id: "m1", spec: "OPC 53 Cement", unit: "bag", unitCost: "350" }] }),
    });

    const { getByRole, getByText, queryByText } = render(<SiteMaterialsClient projectId="proj-1" />);

    // Catalog answered 200 and must still render even while the other two are down.
    await waitFor(() => getByText("OPC 53 Cement"));

    fireEvent.mouseDown(getByRole("tab", { name: "Inbound" }), { button: 0 });
    await waitFor(() => expect(getByText(/Inbound receipts could not be loaded/)).toBeDefined());
    expect(queryByText("No receipts recorded yet.")).toBeNull();

    fireEvent.mouseDown(getByRole("tab", { name: "Cost Report" }), { button: 0 });
    await waitFor(() => expect(getByText(/cost report could not be loaded/)).toBeDefined());
    expect(queryByText("No receipts to report yet.")).toBeNull();
  });
});
