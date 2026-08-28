/// <reference types="bun-types" />
// R62 B7 regression tests for R43 F_001 (closed via PR #178 / R52 Gate 2).
// See that fault row's justification for the full history; the fix touched
// two structurally distinct defects in this file and both regress silently
// if reverted:
//
//  1. load() read materialsRes.json()/receiptsRes.json() without checking
//     res.ok, so a failing /api/materials/master or /api/materials rendered
//     the plain "No materials in the master yet." / "No material movements
//     recorded yet." empty copy instead of the backend's own error -- the
//     same class as R48_HTTP_ERROR_SWALLOWED_AS_EMPTY_LIST_01, one route
//     earlier than the generic guard in no-swallowed-http-errors.test.ts.
//  2. createMaterial()/createReceipt() opened with a silent
//     `if (!name.trim() || !unit.trim()) return;` guard and the button was
//     only `disabled={masterSubmitting}` -- a user who clicked "Add
//     Material" before filling Name/Unit got no dialog change, no request
//     and no message at all (fail-after-click).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws ("Failed to register. Happy DOM
// has already been globally registered."), and `bun test` runs every file in
// ONE process -- see src/components/ui/form-field.test.tsx's own comment on
// this. Register only if no DOM is installed yet.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";

// Dynamically imported so this module (and its transitive
// @radix-ui/react-tabs/@radix-ui/react-dialog -> react-presence chain) is
// only evaluated AFTER GlobalRegistrator.register() has run -- see
// ProcurementClient.test.tsx's own comment for why a static import would
// permanently wire Radix's Presence to a no-op for the rest of the process.
const MaterialsClient = (await import("./MaterialsClient")).default;

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Routes the fake global fetch by path AND method. Paths are checked
 * longest-first because "/api/materials/master" contains the shorter
 * "/api/materials" as a literal substring -- checking in declaration order
 * would let the receipts handler swallow every master-list request too. */
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
  "/api/materials/master": (method) => (method === "GET" ? jsonRes({ materials: [] }) : jsonRes({ id: "m-new" }, 201)),
  "/api/materials": (method) => (method === "GET" ? jsonRes({ receipts: [] }) : jsonRes({ id: "r-new" }, 201)),
};

describe("MaterialsClient (R43 F_001)", () => {
  test("a failed Material Master load shows the backend's own error, not the false 'No materials' empty state", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/materials/master": (method) => (method === "GET" ? jsonRes({ error: "Materials down (500)" }, 500) : jsonRes({}, 201)),
    });

    const { getByText, queryByText } = render(<MaterialsClient projectId="p1" />);

    await waitFor(() => expect(getByText(/Materials down \(500\)/)).toBeDefined());
    expect(queryByText("No materials in the master yet.")).toBeNull();
  });

  test("a failed Inbound Receipts load shows its own error on its own tab, not the false empty state, while Master stays a genuine empty state", async () => {
    globalThis.fetch = router({
      ...DEFAULTS,
      "/api/materials": (method) => (method === "GET" ? jsonRes({ error: "Receipts down (502)" }, 500) : jsonRes({}, 201)),
    });

    const { getByRole, getByText, queryByText } = render(<MaterialsClient projectId="p1" />);

    // Master (default tab): genuinely empty, not a failure -- must show the
    // real empty-state copy.
    await waitFor(() => expect(getByText("No materials in the master yet.")).toBeDefined());

    // Radix Tabs switches on mousedown (see @radix-ui/react-tabs), not click.
    fireEvent.mouseDown(getByRole("tab", { name: /Inbound Receipts/i }), { button: 0 });

    await waitFor(() => expect(getByText(/Receipts down \(502\)/)).toBeDefined());
    expect(queryByText("No material movements recorded yet.")).toBeNull();
  });

  test("Add Material is blocked while Name/Unit are empty, names what's missing, and a click while blocked fires no request", async () => {
    const calls: { method: string; url: string }[] = [];
    globalThis.fetch = router(DEFAULTS, calls);

    const { getByRole, getByText } = render(<MaterialsClient projectId="p1" />);
    await waitFor(() => expect(getByRole("button", { name: /Add Material/i })).toBeDefined());

    fireEvent.click(getByRole("button", { name: /Add Material/i }));
    const dialog = getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: /Add Material/i }) as HTMLButtonElement;

    // The old bug: clicking this produced no dialog change, no request and no
    // message at all -- indistinguishable from a dead button. The fix: the
    // button is natively disabled AND the missing fields are named, instead
    // of a silent no-op.
    expect(submit.disabled).toBe(true);
    expect(getByText("2 required fields left: Name, Unit")).toBeDefined();

    const postsBeforeClick = calls.filter((c) => c.method === "POST").length;
    fireEvent.click(submit); // native `disabled` blocks this -- no handler should run
    expect(calls.filter((c) => c.method === "POST").length).toBe(postsBeforeClick);
  });
});
