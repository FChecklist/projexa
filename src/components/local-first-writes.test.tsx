/// <reference types="bun-types" />
// LOCAL-FIRST: the three real writes, through the real screens, against the shared fake sync server.
//   RfiCreateClient          create_rfi    -> an RFI made on the laptop, listed at once, sent by the outbox
//   RfisClient               (the list)    -> shows it with "Saved on this laptop, syncing" until the server confirms
//   RfiObjectClient          answer_rfi    -> the answer shown at once, sent by the outbox
//   ScheduleTaskObjectClient update_task   -> the edit shown at once, sent by the outbox
// With the flag off, or the laptop without the row, every screen does exactly what it did before.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "@/lib/local-first/__fixtures__/fake-sync-server";
import { LOCAL_FIRST_FLAG, setActiveLocalUser } from "@/lib/local-first/local-reader";
import { createOutbox, type Outbox } from "@/lib/local-first/outbox";
import { createReplica } from "@/lib/local-first/replica";

const push = mock((_href: string) => {});
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, prefetch: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/rfis",
  useSearchParams: () => new URLSearchParams(),
}));

// The browser-wired outbox (it needs the Supabase session) is replaced by one over the fake server.
const current: { outbox: Outbox | null } = { outbox: null };
mock.module("@/lib/local-first/outbox-shared", () => ({
  getSharedOutbox: () => current.outbox,
  peekSharedOutbox: () => current.outbox,
  releaseSharedOutbox: () => {},
  startOutbox: () => {},
  getDeviceId: () => "dev-test",
}));

const RfiCreateClient = (await import("./RfiCreateClient")).default;
const RfisClient = (await import("./RfisClient")).default;
const RfiObjectClient = (await import("./RfiObjectClient")).default;
const ScheduleTaskObjectClient = (await import("./ScheduleTaskObjectClient")).default;

type Harness = { idb: IDBFactory; server: FakeSyncServer; outbox: Outbox; fetched: { url: string; method: string }[]; setRoutes: (r: Record<string, () => unknown>) => void };

const realFetch = globalThis.fetch;
let routes: Record<string, () => unknown> = {};
const fetched: Harness["fetched"] = [];

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function harness(opts: { flag?: boolean; seed?: (s: FakeSyncServer) => void; sync?: boolean } = {}): Promise<Harness> {
  const idb = new IDBFactory();
  (globalThis as { indexedDB?: unknown }).indexedDB = idb;
  if (opts.flag !== false) localStorage.setItem(LOCAL_FIRST_FLAG, "1"); else localStorage.removeItem(LOCAL_FIRST_FLAG);
  setActiveLocalUser("u1");
  const server = createFakeSyncServer();
  opts.seed?.(server);
  if (opts.sync !== false) await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  const outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-test", idb, autoFlush: false, locks: null, sleep: async () => {} });
  current.outbox = outbox;
  fetched.length = 0;
  routes = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    fetched.push({ url, method });
    const key = Object.keys(routes).find((k) => url.includes(k));
    if (!key) throw new Error(`unexpected fetch in test: ${method} ${url}`);
    return jsonRes(routes[key]!());
  }) as typeof fetch;
  return { idb, server, outbox, fetched, setRoutes: (r) => { routes = r; } };
}

beforeEach(() => push.mockClear());
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  localStorage.removeItem(LOCAL_FIRST_FLAG);
  setActiveLocalUser(null);
  current.outbox = null;
});

/**
 * Types into a CONTROLLED input. fireEvent.change cannot drive one in this environment (BillingMilestonesClient.test.tsx says
 * so too), so the input's own React onChange prop is called with the value, inside act().
 */
function typeInto(el: Element, value: string) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[key!];
  act(() => { props.onChange!({ target: { value }, currentTarget: { value } }); });
}

const fill = (container: HTMLElement) => {
  typeInto(container.querySelector("input:not([type=date])")!, "Beam depth at grid B");
  typeInto(container.querySelector("textarea")!, "What depth do we pour?");
};

describe("RfiCreateClient", () => {
  test("with the laptop copy on: Save writes the RFI to the laptop, makes NO request to the app server, and goes to the list", async () => {
    const h = await harness();
    const { container, getByRole } = render(<RfiCreateClient projectId="p1" />);
    h.setRoutes({ "/api/rfis": () => { throw new Error("the app server must not be called"); } });
    fill(container);
    fireEvent.click(getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push.mock.calls[0]![0]).toBe("/rfis?projectId=p1");
    expect(h.fetched).toEqual([]); // nothing went to Vercel
    const ops = await h.outbox.listPending();
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ functionId: "create_rfi", projectId: "p1", params: { projectId: "p1", subject: "Beam depth at grid B", question: "What depth do we pour?" } });
  });

  test("with the flag off: exactly the old request, and nothing is queued", async () => {
    const h = await harness({ flag: false });
    h.setRoutes({ "/api/rfis": () => ({ id: "srv-9" }) });
    const { container, getByRole } = render(<RfiCreateClient projectId="p1" />);
    fill(container);
    fireEvent.click(getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push.mock.calls[0]![0]).toBe("/rfis/srv-9");
    expect(h.fetched).toEqual([{ url: "/api/rfis", method: "POST" }]);
    expect(await h.outbox.listPending()).toEqual([]);
  });

  test("with the flag on but this project not copied to the laptop yet: the old request is used", async () => {
    const h = await harness({ sync: false });
    h.setRoutes({ "/api/rfis": () => ({ id: "srv-9" }) });
    const { container, getByRole } = render(<RfiCreateClient projectId="p1" />);
    fill(container);
    fireEvent.click(getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(h.fetched).toEqual([{ url: "/api/rfis", method: "POST" }]);
  });
});

describe("RfisClient: the 'saved on this laptop, syncing' marker", () => {
  test("a pending RFI is listed at once with the marker; when the server confirms it, the marker goes and the real row is listed", async () => {
    const h = await harness();
    let serverRfis: unknown[] = [];
    h.setRoutes({ "/api/rfis?projectId=p1": () => ({ rfis: serverRfis }) });
    const { createRfiLocally } = await import("@/lib/local-first/local-writes");
    const queued = await createRfiLocally({ projectId: "p1", subject: "Beam depth", question: "Q?" });
    expect(queued).not.toBeNull();

    const view = render(<RfisClient projectId="p1" />);
    const row = await view.findByTestId("pending-rfi-row");
    expect(row.textContent).toContain("Beam depth");
    expect(view.getByTestId("pending-sync").textContent).toBe("Saved on this laptop, syncing");
    expect(view.queryByText("No RFIs yet.")).toBeNull();

    // the server applies it; the list is read again and shows the real row
    serverRfis = [{ id: "srv-rfi-1", number: 1, subject: "Beam depth", question: "Q?", status: "open", ballInCourt: "architect", answer: null, dueDate: null }];
    await h.outbox.flush();
    await waitFor(() => expect(view.queryByTestId("pending-sync") === null).toBe(true));
    expect(view.queryByTestId("pending-rfi-row") === null).toBe(true);
    expect(view.getByText("RFI-1")).toBeTruthy();
    expect(view.getAllByText("Beam depth")).toHaveLength(1); // not listed twice
  });

  test("with the flag off there is no marker and the list is the server's", async () => {
    const h = await harness({ flag: false });
    h.setRoutes({ "/api/rfis?projectId=p1": () => ({ rfis: [{ id: "a", number: 4, subject: "Door", question: "?", status: "open", ballInCourt: "architect", answer: null, dueDate: null }] }) });
    const view = render(<RfisClient projectId="p1" />);
    await view.findByText("RFI-4");
    expect(view.queryByTestId("pending-sync") === null).toBe(true);
  });

  test("an answer still on its way is shown as answered, with the marker", async () => {
    const h = await harness({ seed: (s) => s.upsert({ kind: "rfis", projectId: "p1", id: "r1", data: { subject: "Door", question: "Which?", status: "open", answer: null } }) });
    h.setRoutes({ "/api/rfis?projectId=p1": () => ({ rfis: [{ id: "r1", number: 2, subject: "Door", question: "Which?", status: "open", ballInCourt: "architect", answer: null, dueDate: null }] }) });
    const { answerRfiLocally } = await import("@/lib/local-first/local-writes");
    await answerRfiLocally({ projectId: "p1", rfiId: "r1", answer: "Use oak" });
    const view = render(<RfisClient projectId="p1" />);
    await view.findByText("RFI-2");
    await waitFor(() => expect(view.getByTestId("pending-sync")).toBeTruthy());
    expect(view.getByText("answered")).toBeTruthy();
    expect(view.queryByText("open")).toBeNull();
  });
});

describe("RfiObjectClient: answering", () => {
  const OPEN = { id: "r1", projectId: "p1", number: 2, subject: "Door", question: "Which?", status: "open", ballInCourt: "architect", answer: null, dueDate: null };
  const seedRfi = (s: FakeSyncServer) => s.upsert({ kind: "rfis", projectId: "p1", id: "r1", data: { subject: "Door", question: "Which?", status: "open", answer: null } });

  test("with the RFI on the laptop: the answer is written there, shown at once with the marker, and no PATCH is made; when applied the marker goes", async () => {
    const h = await harness({ seed: seedRfi });
    let served: unknown = OPEN;
    h.setRoutes({ "/api/rfis/r1": () => served });
    const view = render(<RfiObjectClient rfiId="r1" />);
    await view.findByText(/RFI-2/);
    typeInto(view.getByPlaceholderText("Your answer…"), "Use oak");
    fireEvent.click(view.getByRole("button", { name: "Submit Answer" }));

    await view.findByTestId("pending-sync");
    expect(view.getByText("Use oak")).toBeTruthy(); // shown at once
    expect(h.fetched.some((f) => f.method === "PATCH")).toBe(false);
    expect(view.queryByPlaceholderText("Your answer…")).toBeNull(); // the RFI now reads as answered
    expect((view.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(true); // cannot close what the server has not seen answered

    served = { ...OPEN, status: "answered", answer: "Use oak" };
    await h.outbox.flush();
    await waitFor(() => expect(view.queryByTestId("pending-sync") === null).toBe(true));
    expect(view.getByText("Use oak")).toBeTruthy();
    expect((view.getByRole("button", { name: "Close" }) as HTMLButtonElement).disabled).toBe(false);
    expect(h.server.getRow("rfis", "r1")).toMatchObject({ data: { answer: "Use oak", status: "answered" } });
  });

  test("with the RFI NOT on the laptop: the old PATCH is made", async () => {
    const h = await harness();
    h.setRoutes({ "/api/rfis/r1": () => OPEN });
    const view = render(<RfiObjectClient rfiId="r1" />);
    await view.findByText(/RFI-2/);
    typeInto(view.getByPlaceholderText("Your answer…"), "Use oak");
    fireEvent.click(view.getByRole("button", { name: "Submit Answer" }));
    await waitFor(() => expect(h.fetched.some((f) => f.method === "PATCH")).toBe(true));
    expect(await h.outbox.listPending()).toEqual([]);
  });
});

describe("ScheduleTaskObjectClient: editing a task", () => {
  const TASK = {
    id: "t1", projectId: "p1", number: 12, title: "Joinery shop drawings", description: null, priority: "medium", statusId: "s1",
    startDate: "2026-08-01", dueDate: "2026-09-05", completionPercentage: 40, isArchived: false,
  };
  const seedTask = (s: FakeSyncServer) => s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Joinery shop drawings", statusId: "s1", priority: "medium", completionPercentage: 40 } });
  const routesFor = (get: () => unknown) => ({ "/api/board": () => ({ columns: [{ id: "s1", name: "In progress" }] }), "/api/schedule/tasks/t1": get });

  async function editTitle(view: ReturnType<typeof render>, title: string) {
    fireEvent.click(await view.findByRole("button", { name: /Edit/ }));
    typeInto(view.getByDisplayValue("Joinery shop drawings"), title);
    fireEvent.click(view.getByRole("button", { name: /^Save/ }));
  }

  test("with the task on the laptop: the edit is written there, shown at once with the marker, no PATCH is made; when applied the marker goes", async () => {
    const h = await harness({ seed: seedTask });
    let served: unknown = TASK;
    h.setRoutes(routesFor(() => served));
    const view = render(<ScheduleTaskObjectClient taskId="t1" />);
    await view.findByText(/#12 Joinery shop drawings/);
    await editTitle(view, "Joinery shop drawings v2");

    await view.findByTestId("pending-sync");
    await view.findByText(/#12 Joinery shop drawings v2/); // shown at once
    expect(h.fetched.some((f) => f.method === "PATCH")).toBe(false);
    const ops = await h.outbox.listPending();
    expect(ops[0]).toMatchObject({ functionId: "update_task", record: { kind: "tasks", id: "t1", baseVersion: 1 }, params: { projectId: "p1", issueId: "t1", title: "Joinery shop drawings v2", statusId: "s1", priority: "medium" } });

    served = { ...TASK, title: "Joinery shop drawings v2" };
    await h.outbox.flush();
    await waitFor(() => expect(view.queryByTestId("pending-sync") === null).toBe(true));
    expect(view.getByText(/#12 Joinery shop drawings v2/)).toBeTruthy();
    expect(h.server.getRow("tasks", "t1")).toMatchObject({ version: 2, data: { title: "Joinery shop drawings v2" } });
  });

  test("when the server refuses it, the screen goes back to the server's title and the person is told in words", async () => {
    const h = await harness({ seed: seedTask });
    h.setRoutes(routesFor(() => TASK));
    const view = render(<ScheduleTaskObjectClient taskId="t1" />);
    await view.findByText(/#12 Joinery shop drawings/);
    await editTitle(view, "Renamed");
    await view.findByTestId("pending-sync");
    // somebody with no right to rename it: the server rejects the op
    h.server.registerFunction("update_task", () => ({ rejected: "NOT_PERMITTED" }));
    await h.outbox.flush();
    await waitFor(() => expect(view.queryByTestId("pending-sync") === null).toBe(true));
    expect(view.getByText(/#12 Joinery shop drawings$/)).toBeTruthy();
    expect(h.outbox.getState().notices[0]!.message).toBe("Your change to this task was not saved. Your role does not allow that. It was undone on this laptop.");
  });

  test("with the task NOT on the laptop (or the flag off): the old PATCH is made, nothing is queued", async () => {
    const h = await harness({ flag: false, seed: seedTask });
    h.setRoutes(routesFor(() => TASK));
    const view = render(<ScheduleTaskObjectClient taskId="t1" />);
    await view.findByText(/#12 Joinery shop drawings/);
    await editTitle(view, "Renamed");
    await waitFor(() => expect(h.fetched.some((f) => f.method === "PATCH")).toBe(true));
    expect(await h.outbox.listPending()).toEqual([]);
    expect(view.queryByTestId("pending-sync") === null).toBe(true);
  });
});
