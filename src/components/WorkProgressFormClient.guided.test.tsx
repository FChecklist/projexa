/// <reference types="bun-types" />
// GUIDED ERRORS (G2): the daily-entry form finds its own faults before anything is sent, shows them in the guide panel AND beside the box, and keeps
// what was typed when the person leaves and comes back.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";

mock.module("next/navigation", () => ({ useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, prefetch() {} }), usePathname: () => "/work-progress", useSearchParams: () => new URLSearchParams() }));
mock.module("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } }) }));
mock.module("@/lib/offline/work-progress-queue", () => ({
  enqueueWorkProgressEntry: async () => ({}),
  listQueuedWorkProgressEntries: async () => [],
  syncQueuedWorkProgressEntries: async () => ({ synced: 0, failed: 0 }),
  uploadQueuedPhoto: async () => {},
}));

const Form = (await import("./WorkProgressFormClient")).default;

const realFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  try { sessionStorage.clear(); } catch { /* ignore */ }
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function typeInto(el: Element, value: string) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[key!];
  act(() => { props.onChange!({ target: { value }, currentTarget: { value } }); });
}

function rig(opts: { post?: Response } = {}) {
  const calls: { method: string; url: string }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });
    if (url.includes("/api/work-progress/activities")) return json({ activities: [{ id: "a1", name: "Brick partition", unit: "m2" }], categories: [] });
    if (url.includes("/api/scope")) return json({ boqs: [] });
    if (url.endsWith("/api/work-progress") && method === "POST") return opts.post ?? json({ id: "e1" }, 201);
    return json({});
  }) as typeof fetch;
  return calls;
}

describe("WorkProgressFormClient: guided faults", () => {
  test("Log Entry on an empty form sends nothing and names every missing box in the guide panel", async () => {
    const calls = rig();
    const view = render(<Form projectId="p1" onLogged={() => {}} />);
    await waitFor(() => expect(view.getByTestId("wp-percent")).toBeDefined());
    const button = view.getByRole("button", { name: /^Log Entry/ }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    fireEvent.click(button);
    const panel = await view.findByTestId("fault-panel");
    expect(panel.getAttribute("data-fault-code")).toBe("WP_ACTIVITY_MISSING");
    expect(view.getByTestId("fault-panel-more").textContent).toContain("Type the quantity done");
    expect(view.getByTestId("fault-panel-more").textContent).toContain("Type the % complete");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  test("a percentage of 140 is written beside the box at once, and the box is marked invalid", async () => {
    rig();
    const view = render(<Form projectId="p1" onLogged={() => {}} />);
    await waitFor(() => expect(view.getByTestId("wp-percent")).toBeDefined());
    typeInto(view.getByTestId("wp-percent"), "140");
    await waitFor(() => expect(view.getByTestId("wp-percent").getAttribute("aria-invalid")).toBe("true"));
    const ids = (view.getByTestId("wp-percent").getAttribute("aria-describedby") ?? "").split(" ").filter((i) => i.endsWith("-error"));
    expect(document.getElementById(ids[0]!)?.textContent).toContain("outside 0 to 100");
  });

  test("a date in the future is refused beside the date box", async () => {
    rig();
    const view = render(<Form projectId="p1" onLogged={() => {}} />);
    await waitFor(() => expect(view.getByTestId("wp-date")).toBeDefined());
    typeInto(view.getByTestId("wp-date"), "2999-01-01");
    await waitFor(() => expect(view.getByTestId("wp-date").getAttribute("aria-invalid")).toBe("true"));
  });

  test("what was typed is kept in the draft, and a fresh mount puts it back and says so", async () => {
    rig();
    const first = render(<Form projectId="p1" onLogged={() => {}} />);
    await waitFor(() => expect(first.getByTestId("wp-quantity")).toBeDefined());
    typeInto(first.getByTestId("wp-quantity"), "3");
    typeInto(first.getByTestId("wp-percent"), "30");
    await waitFor(() => expect(sessionStorage.getItem("px-draft:work-progress-new:p1")).toContain('"quantityDone":"3"'));
    first.unmount();
    const second = render(<Form projectId="p1" onLogged={() => {}} />);
    await waitFor(() => expect(second.getByTestId("wp-draft-restored")).toBeDefined());
    expect((second.getByTestId("wp-quantity") as HTMLInputElement).value).toBe("3");
    expect((second.getByTestId("wp-percent") as HTMLInputElement).value).toBe("30");
  });

  test("another project's draft is not put into this project's form", async () => {
    rig();
    const first = render(<Form projectId="p1" onLogged={() => {}} />);
    await waitFor(() => expect(first.getByTestId("wp-quantity")).toBeDefined());
    typeInto(first.getByTestId("wp-quantity"), "3");
    await waitFor(() => expect(sessionStorage.getItem("px-draft:work-progress-new:p1")).not.toBeNull());
    first.unmount();
    const other = render(<Form projectId="p2" onLogged={() => {}} />);
    await waitFor(() => expect(other.getByTestId("wp-quantity")).toBeDefined());
    expect((other.getByTestId("wp-quantity") as HTMLInputElement).value).toBe("");
    expect(other.queryByTestId("wp-draft-restored")).toBeNull();
  });
});
