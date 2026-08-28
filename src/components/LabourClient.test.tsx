/// <reference types="bun-types" />
// R62 B7 regression tests for R43 F_005 (closed via PR #178 / R52 Gate 2).
// See that fault row's justification for the full history; two structurally
// distinct defects were fixed there and both regress silently if reverted:
//
//  1. load() read rosterRes.json()/attRes.json() without checking res.ok,
//     so a failing /api/labour-roster or /api/attendance rendered the plain
//     "No workers on the roster yet." / "No attendance recorded yet." empty
//     copy instead of the backend's own error.
//  2. createRoster()/createAttendance() opened with a silent
//     `if (!name.trim() || !dailyRate) return;` guard and the button was
//     only `disabled={rosterSubmitting}` -- a user who clicked "Add Worker"
//     before filling Name/Daily Rate got no dialog change, no request and
//     no message at all (fail-after-click).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

const LabourClient = (await import("./LabourClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function router(handlers: Record<string, (method: string, init?: RequestInit) => Response>, calls?: { method: string; url: string }[]) {
  const entries = Object.entries(handlers).sort((a, b) => b[0].length - a[0].length);
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    calls?.push({ method, url });
    for (const [path, handler] of entries) {
      if (url.includes(path)) return handler(method, init);
    }
    throw new Error(`unexpected fetch in test: ${method} ${url}`);
  }) as typeof fetch;
}

const DEFAULTS: Record<string, (method: string) => Response> = {
  "/api/currencies": () => jsonRes({ currencies: [] }),
  "/api/labour-roster": (method) => (method === "GET" ? jsonRes({ roster: [] }) : jsonRes({ id: "w-new" }, 201)),
  "/api/attendance": (method) => (method === "GET" ? jsonRes({ attendance: [] }) : jsonRes({ id: "a-new" }, 201)),
  "/api/vendors": () => jsonRes({ vendors: [] }),
};

describe("LabourClient (R43 F_005)", () => {
  test("a failed Roster load shows the backend's own error, not the false 'No workers' empty state", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/labour-roster": (method) => (method === "GET" ? jsonRes({ error: "Roster down (500)" }, 500) : jsonRes({}, 201)),
    });

    const { getByText, queryByText } = render(<LabourClient projectId="p1" />);

    await waitFor(() => expect(getByText(/Roster down \(500\)/)).toBeDefined());
    expect(queryByText("No workers on the roster yet.")).toBeNull();
  });

  test("a failing vendors lookup does not blank the roster (Promise.allSettled, not Promise.all)", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/labour-roster": (method) =>
        method === "GET"
          ? jsonRes({ roster: [{ id: "r1", name: "Ali Khan", employeeCode: null, trade: null, skillLevel: null, vendorId: null, dailyRate: "500", isActive: true }] })
          : jsonRes({}, 201),
      "/api/vendors": () => jsonRes({ error: "Vendors down" }, 500),
    });

    const { getByText } = render(<LabourClient projectId="p1" />);
    // The roster entry that succeeded must still render even though the
    // sibling vendors lookup failed -- Promise.all would have discarded both.
    await waitFor(() => expect(getByText("Ali Khan")).toBeDefined());
  });

  test("Add Worker is blocked while Name/Daily Rate are empty, names what's missing, and a click while blocked fires no request", async () => {
    const calls: { method: string; url: string }[] = [];
    globalThis.fetch = router(DEFAULTS, calls);

    const { getByRole, getByText } = render(<LabourClient projectId="p1" />);
    await waitFor(() => expect(getByRole("button", { name: /Add Worker/i })).toBeDefined());

    fireEvent.click(getByRole("button", { name: /Add Worker/i }));
    const dialog = getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: /Add Worker/i }) as HTMLButtonElement;

    // The old bug: clicking this produced no dialog change, no request and no
    // message at all -- indistinguishable from a dead button. The fix: the
    // button is natively disabled AND the missing fields are named, instead
    // of a silent no-op.
    expect(submit.disabled).toBe(true);
    expect(getByText("2 required fields left: Name, Daily Rate")).toBeDefined();

    const postsBeforeClick = calls.filter((c) => c.method === "POST").length;
    fireEvent.click(submit); // native `disabled` blocks this -- no handler should run
    expect(calls.filter((c) => c.method === "POST").length).toBe(postsBeforeClick);
  });
});
