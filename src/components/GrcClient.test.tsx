/// <reference types="bun-types" />
// R62 B7 regression test for A4S14_06 (High), fixed in PR #178.
//
// RECORDED: 7 of 8 GRC sub-tabs unreachable by click -- root-caused by owner
// ruling to R48_LAYOUT_REFLOW_01, NOT this file (its Tabs usage is the plain
// shared primitive with static labels; nothing here can move a tab). NOT
// re-tested here for that reason.
//
// WHAT THIS FILE ACTUALLY FIXED, exercised on the Risk Register panel (one
// of the 7 identically-shaped panels the PR fixed the same way):
//  1. load() did `const data = await res.json(); setRisks(data.risks ?? [])`
//     with res.ok never read -- a failing backend rendered as the confident
//     "No risks logged yet." empty state.
//  2. createRisk() opened with `if (!title.trim()) return;` while the button
//     was only `disabled={submitting}` -- Log Risk was a fail-after-click
//     no-op with Title empty, no dialog change, no request, no message.
//
// This test fails without the fix: reverting RiskRegisterPanel's load() to
// a bare `res.json()` makes "No risks logged yet." render on a real 500;
// reverting Log Risk's disabled wiring to `disabled={submitting}` makes it
// enabled while Title is still empty.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const GrcClient = (await import("./GrcClient")).default;

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

// Every source any GrcClient panel might touch once its tab mounts, defaulted
// healthy so a test only has to override what it cares about. The Dashboard
// tab is open by default, so /api/grc-dashboard is always requested.
const DEFAULTS: Record<string, () => Response> = {
  "/api/grc-dashboard": () =>
    jsonRes({
      risks: { openCount: 0, totalCount: 0, byCategory: {}, bySeverity: {}, heatmap: [] },
      audit: { engagementCount: 0, openFindingsCount: 0, overdueFindingsCount: 0 },
      policies: { totalCount: 0, draftCount: 0, underReviewCount: 0, publishedCount: 0 },
      vendorRisk: { totalCount: 0, highTierCount: 0 },
    }),
  "/api/risks": () => jsonRes({ risks: [] }),
};

describe("GrcClient (A4S14_06)", () => {
  test("Risk Register: a failing load shows the backend's own error, never the confident 'No risks logged yet.' empty state", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/risks": () => jsonRes({ error: "Risk service unavailable (X)" }, 500),
    });

    const { getByRole, getByText, queryByText } = render(<GrcClient />);

    // Radix Tabs switches on mousedown (see @radix-ui/react-tabs), not click.
    await waitFor(() => getByRole("tab", { name: "Risk Register" }));
    fireEvent.mouseDown(getByRole("tab", { name: "Risk Register" }), { button: 0 });

    await waitFor(() => expect(getByText(/Risk service unavailable \(X\)/)).toBeDefined());
    expect(queryByText("No risks logged yet.")).toBeNull();
  });

  test("Risk Register: Log Risk is disabled while Title is empty and names what's missing", async () => {
    globalThis.fetch = router(DEFAULTS);

    const { getByRole } = render(<GrcClient />);

    await waitFor(() => getByRole("tab", { name: "Risk Register" }));
    fireEvent.mouseDown(getByRole("tab", { name: "Risk Register" }), { button: 0 });

    const panel = within(await waitFor(() => getByRole("tabpanel")));
    await waitFor(() => panel.getByText("No risks logged yet."));

    // The trigger and the dialog's own submit button share the same visible
    // label ("Log Risk"), so scope the click to the tab panel's trigger.
    fireEvent.click(panel.getByRole("button", { name: /Log Risk/i }));

    const dialog = within(await waitFor(() => getByRole("dialog")));
    const submitButton = dialog.getByRole("button", { name: "Log Risk" });
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
    expect(dialog.getByText(/1 required field left: Title/)).toBeDefined();
  });
});
