/// <reference types="bun-types" />
// Sumeet live UAT 2026-10-13: a brand-new project has no activities and the progress form could not make one (the backend POST existed, no screen called it).
// With no activities and no read error, the form offers "Add activity"; it posts, re-reads the list and selects the new activity.
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
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Types into a CONTROLLED input (fireEvent.change cannot drive one in this environment): calls its React onChange inside act(). */
function typeInto(el: Element, value: string) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[key!];
  act(() => { props.onChange!({ target: { value }, currentTarget: { value } }); });
}

function rig(opts: { activitiesAfterAdd?: { id: string; name: string }[]; postStatus?: number } = {}) {
  const calls: { method: string; url: string; body?: unknown }[] = [];
  let created = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (url.includes("/api/work-progress/activities") && method === "POST") {
      if ((opts.postStatus ?? 201) >= 400) return json({ error: "Forbidden: members only" }, opts.postStatus);
      created = true;
      return json({ id: "act-new", name: "Brick partition" }, 201);
    }
    if (url.includes("/api/work-progress/activities")) return json({ activities: created ? opts.activitiesAfterAdd ?? [{ id: "act-new", name: "Brick partition" }] : [], categories: [] });
    if (url.includes("/api/scope")) return json({ boqs: [] });
    return json({});
  }) as typeof fetch;
  return calls;
}

describe("WorkProgressFormClient: a project with no activities", () => {
  test("offers 'Add activity', posts the name, re-reads the list and the offer goes away", async () => {
    const calls = rig();
    const { findByTestId, getByLabelText, queryByTestId } = render(<Form projectId="p1" onLogged={() => {}} />);
    await findByTestId("first-activity");
    typeInto(getByLabelText("Name of the first activity"), "Brick partition");
    fireEvent.click(await findByTestId("first-activity-add"));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url).toContain("/api/work-progress/activities");
    expect(post.body).toEqual({ projectId: "p1", name: "Brick partition" });
    await waitFor(() => expect(queryByTestId("first-activity")).toBeNull());
    expect(calls.filter((c) => c.method === "GET" && c.url.includes("/api/work-progress/activities")).length).toBeGreaterThanOrEqual(2);
  });

  test("a blank name sends nothing and says why", async () => {
    const calls = rig();
    const { findByTestId, findByRole } = render(<Form projectId="p1" onLogged={() => {}} />);
    fireEvent.click(await (async () => { await findByTestId("first-activity"); return findByTestId("first-activity-add"); })());
    expect((await findByRole("alert")).textContent).toContain("Name the activity first");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  test("a refusal is shown in the server's words", async () => {
    rig({ postStatus: 403 });
    const { findByTestId, getByLabelText, findByRole } = render(<Form projectId="p1" onLogged={() => {}} />);
    await findByTestId("first-activity");
    typeInto(getByLabelText("Name of the first activity"), "Brick partition");
    fireEvent.click(await findByTestId("first-activity-add"));
    expect((await findByRole("alert")).textContent).toContain("Forbidden: members only");
  });

  test("a project that already has activities does not show the offer", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/work-progress/activities")) return json({ activities: [{ id: "a1", name: "Excavation" }], categories: [] });
      return json({ boqs: [] });
    }) as typeof fetch;
    const { queryByTestId, findByText } = render(<Form projectId="p1" onLogged={() => {}} />);
    await findByText("Progress entry");
    await new Promise((r) => setTimeout(r, 50));
    expect(queryByTestId("first-activity")).toBeNull();
  });
});
