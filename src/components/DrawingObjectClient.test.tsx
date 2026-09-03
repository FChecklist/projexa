/// <reference types="bun-types" />
// R67 D-11. The item's acceptance opens a drawing created a minute earlier and
// expects an ENABLED control named "Remove" whose confirm says "Nothing else
// references it." -- a Playwright step this lane cannot run (no dev server).
// The same rules are asserted here against the exact functions the screen's
// destructive control is built from, plus the rendered screen for the two
// states that matter most: the fresh upload (Remove, enabled) and the one the
// old screen got wrong (a fresh upload with no retention policy, which used to
// read "No retention policy set" and could not be undone by its own uploader).
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";

const push = mock((_: string) => {});
// R67 lane A merge: the real module is spread in rather than replaced. Lane A
// mounts <ObjectContext>/<ScreenContext> inside these screens, and those call
// usePathname() -- a mock that returned only useRouter made the whole module
// lose every other export and the file failed to load at all
// ("Export named 'usePathname' not found in module .../next/navigation.js").
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({ ...realNavigation, useRouter: () => ({ push }) }));

const mod = await import("./DrawingObjectClient");
const DrawingObjectClient = mod.default;
const { destructiveAction, drawingLabel, confirmText } = mod;

const FRESH = {
  id: "d1",
  name: "AR-101 Ground floor plan",
  kind: "dwg" as const,
  discipline: "Architectural",
  isExternalLink: false,
  documentUrl: "https://signed.example/AR-101.dwg",
  createdAt: new Date().toISOString(),
  category: "drawing",
  projectId: "p1",
  projectName: "Cedar Heights Villa - Phase 1",
  isDisposed: false,
  legalHold: false,
  disposalDate: null,
  isRecent: true,
  references: 0,
};

const realFetch = globalThis.fetch;

function stubDrawing(row: Record<string, unknown>) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(row), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

beforeEach(() => {
  window.sessionStorage.clear();
  stubDrawing(FRESH);
});

afterEach(() => {
  cleanup();
  push.mockClear();
  globalThis.fetch = realFetch;
});

describe("drawingLabel", () => {
  test("the register's identifier wins over the file name once there is one", () => {
    expect(drawingLabel({ name: "AR-101 Ground floor plan_final(2).dwg", drawingNo: "AR-101", rev: "B" })).toBe("AR-101 Rev B");
    expect(drawingLabel({ name: "Villa walkthrough", drawingNo: "AR-101" })).toBe("AR-101");
  });

  test("falls back to the name while no identifier exists", () => {
    expect(drawingLabel({ name: "Villa walkthrough" })).toBe("Villa walkthrough");
    expect(drawingLabel({ name: "Villa walkthrough", drawingNo: null, rev: "B" })).toBe("Villa walkthrough");
  });
});

describe("destructiveAction", () => {
  const BASE = { isDisposed: false, legalHold: false, isRecent: false, references: 0, disposalDate: null as string | null };

  test("THE FIXED CASE: a drawing uploaded a minute ago with no retention policy is removable by its uploader", () => {
    expect(destructiveAction({ ...BASE, isRecent: true })).toEqual({ label: "Remove" });
  });

  test("a legal hold outranks the grace window", () => {
    expect(destructiveAction({ ...BASE, isRecent: true, legalHold: true })).toEqual({
      label: "Remove",
      disabledReason: "On legal hold - cannot be removed",
    });
  });

  test("something that references it outranks the grace window, and the reason counts", () => {
    expect(destructiveAction({ ...BASE, isRecent: true, references: 1 })).toEqual({
      label: "Remove",
      disabledReason: "1 other record references this drawing",
    });
    expect(destructiveAction({ ...BASE, isRecent: true, references: 3 }).disabledReason).toBe(
      "3 other records reference this drawing"
    );
  });

  test("outside the window the retention rules take over, each saying what is true and who can act", () => {
    expect(destructiveAction({ ...BASE })).toEqual({
      label: "Dispose",
      disabledReason: "Kept under the retention policy - ask an admin to dispose",
    });
    expect(
      destructiveAction({ ...BASE, disposalDate: "2027-03-01", today: "2026-09-02" }).disabledReason
    ).toBe("Kept until 3/1/2027 under the retention policy");
    // Past its disposal date: Dispose is offered for real.
    expect(destructiveAction({ ...BASE, disposalDate: "2026-08-01", today: "2026-09-02" })).toEqual({ label: "Dispose" });
  });

  test("an already-disposed drawing offers nothing to act on", () => {
    expect(destructiveAction({ ...BASE, isDisposed: true, isRecent: true }).disabledReason).toBe("Already removed");
  });
});

describe("confirmText", () => {
  test("Remove states the blast radius the item quotes, naming the project", () => {
    expect(confirmText("Remove", "AR-101 Rev B", "Cedar Heights Villa - Phase 1")).toBe(
      "Remove AR-101 Rev B from Cedar Heights Villa - Phase 1? Nothing else references it."
    );
  });

  test("a project whose name did not resolve does not produce 'from null'", () => {
    expect(confirmText("Remove", "AR-101", null)).toBe("Remove AR-101 from this project? Nothing else references it.");
  });

  test("Dispose says what disposal actually does", () => {
    expect(confirmText("Dispose", "AR-101", "Cedar Heights")).toBe(
      "Dispose AR-101? Its file is destroyed and cannot be retrieved."
    );
  });
});

describe("DrawingObjectClient", () => {
  test("a freshly uploaded drawing offers an enabled Remove, and Edit", async () => {
    const view = render(<DrawingObjectClient drawingId="d1" projectId="p1" />);
    await waitFor(() => expect(view.getByRole("heading", { name: "AR-101 Ground floor plan" })).toBeTruthy());
    const remove = view.getByRole("button", { name: "Remove" }) as HTMLButtonElement;
    expect(remove.disabled).toBe(false);
    expect(view.getByRole("button", { name: "Edit" })).toBeTruthy();
  });

  test("an older drawing with no retention policy offers Dispose, disabled, saying who can act", async () => {
    stubDrawing({ ...FRESH, isRecent: false, createdAt: "2026-01-04T10:00:00.000Z" });
    const view = render(<DrawingObjectClient drawingId="d1" projectId="p1" />);
    await waitFor(() => expect(view.getByRole("heading", { name: "AR-101 Ground floor plan" })).toBeTruthy());
    const dispose = view.getByRole("button", { name: "Dispose" }) as HTMLButtonElement;
    expect(dispose.disabled).toBe(true);
    expect(dispose.title).toBe("Kept under the retention policy - ask an admin to dispose");
    // The old wording, straight out of the schema, is gone.
    expect(document.body.textContent).not.toContain("No retention policy set");
  });

  test("a failed load says so with the backend's own words and offers a Retry", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "Drawing not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const view = render(<DrawingObjectClient drawingId="d1" projectId="p1" />);
    await waitFor(() => expect(view.getByRole("alert").textContent).toContain("Drawing not found"));
    expect(view.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
