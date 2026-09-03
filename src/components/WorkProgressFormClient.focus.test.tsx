/// <reference types="bun-types" />
// R67 E-38 (R-296). "Record progress ->" now lands ON the form with the caret
// already in its first field (?focus=1), instead of dropping the reader on a
// screen where they still have to find the form and click into it.
//
// The item's acceptance asserts document.activeElement is inside the entry
// form. That is exactly what is asserted here, against the real component tree
// in a real DOM -- including the negative, because a form that steals focus on
// every ordinary visit would be worse than one that never takes it.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";

mock.module("sonner", () => ({ toast: { success: mock(() => {}), error: mock(() => {}) } }));
// The form asks Supabase who is signed in purely to scope its offline queue.
mock.module("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));
mock.module("@/lib/offline/work-progress-queue", () => ({
  enqueueWorkProgressEntry: mock(async () => {}),
  listQueuedWorkProgressEntries: mock(async () => []),
  syncQueuedWorkProgressEntries: mock(async () => ({ synced: 0 })),
  uploadQueuedPhoto: mock(async () => null),
}));

import { cleanup, render, waitFor } from "@testing-library/react";
import WorkProgressFormClient from "./WorkProgressFormClient";

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/work-progress/activities")) {
      return new Response(JSON.stringify({ activities: [{ id: "a1", name: "Blockwork", unit: "sqm" }] }), { status: 200 });
    }
    if (url.includes("/api/scope/")) {
      return new Response(
        JSON.stringify({ lineItems: [{ id: "l1", itemCode: "1.01", description: "Blockwork", unit: "sqm", rate: "100" }] }),
        { status: 200 }
      );
    }
    if (url.includes("/api/scope")) {
      return new Response(JSON.stringify({ boqs: [{ id: "b1", version: 1, status: "approved", title: "BOQ v1" }] }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }) as typeof fetch;
}

afterEach(() => {
  cleanup();
  // @ts-expect-error -- test-only global fetch stub cleanup
  delete globalThis.fetch;
});

describe("R67 E-38: ?focus=1 puts the caret in the entry form", () => {
  test("with autoFocus, the active element is a field inside the form", async () => {
    stubFetch();
    const { container } = render(<WorkProgressFormClient projectId="p1" onLogged={() => {}} autoFocus />);

    await waitFor(() => expect(container.querySelector("input, select, textarea")).not.toBeNull());
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active).not.toBeNull();
      // Inside THIS form, not merely "something is focused somewhere".
      expect(container.contains(active)).toBe(true);
      expect(["INPUT", "SELECT", "TEXTAREA"]).toContain(active!.tagName);
    });
  });

  test("without it, the form does not steal the caret on an ordinary visit", async () => {
    stubFetch();
    const { container } = render(<WorkProgressFormClient projectId="p1" onLogged={() => {}} />);

    await waitFor(() => expect(container.querySelector("input, select, textarea")).not.toBeNull());
    const active = document.activeElement as HTMLElement | null;
    // body (or nothing) still holds focus -- no field inside this form took it.
    expect(active === null || active === document.body || !container.contains(active)).toBe(true);
  });

  test("the wrapper the focus ref hangs on adds nothing to the layout", async () => {
    stubFetch();
    const { container } = render(<WorkProgressFormClient projectId="p1" onLogged={() => {}} />);
    await waitFor(() => expect(container.querySelector("input, select, textarea")).not.toBeNull());

    // display:contents -- the kit's FormScreen keeps its own box exactly as it
    // had before this item added a ref to reach the rendered fields.
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.style.display).toBe("contents");
  });
});
