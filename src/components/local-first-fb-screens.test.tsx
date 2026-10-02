/// <reference types="bun-types" />
// FB: the three local-write screens send the RIGHT thing and never lose what was typed.
//   ScheduleTaskObjectClient  only the fields the person changed (data:F3); based on the version the form LOADED (data:F12);
//                             an applied event of ANOTHER task does not reload this one, and a reload never replaces what
//                             is being typed (data:F5); "Edit again" opens the form filled with a draft (data:F4)
//   RfiObjectClient           a too-long answer is refused before queueing, kept in the box, and said in words (data:F4)
//   RfiCreateClient           "Edit again" fills subject / question / due date from the draft
//
// The UI kit (@fchecklist/veridian-ui-kit, a private package) is replaced by a minimal TEST DOUBLE of the three frame components
// these screens use, so the screens' own logic runs here; local-first-writes.test.tsx covers the same screens against the
// real kit where it is installed.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import type { ReactNode } from "react";
import { createFakeSyncServer, type FakeSyncServer } from "@/lib/local-first/__fixtures__/fake-sync-server";
import { LOCAL_FIRST_FLAG, setActiveLocalUser } from "@/lib/local-first/local-reader";
import { createOutbox, type Outbox } from "@/lib/local-first/outbox";
import { createReplica } from "@/lib/local-first/replica";
import { localDbNameFor, openLocalDb } from "@/lib/local-first/local-db";

const push = mock((_href: string) => {});
const search = { params: new URLSearchParams() };
const realNavigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...realNavigation,
  useRouter: () => ({ push, prefetch: () => {}, replace: () => {}, back: () => {} }),
  usePathname: () => "/rfis",
  useSearchParams: () => search.params,
}));

// The kit's frame, reduced to what these tests read: the title, the messages, the children, and the Save / Edit / Cancel buttons.
type FrameProps = { title?: ReactNode; breadcrumb?: ReactNode; messages?: { text: string }[]; children?: ReactNode; footerActions?: ReactNode; mode?: string; onSave?: () => void; onEdit?: () => void; onCancel?: () => void; saveDisabled?: boolean };
const Messages = ({ messages }: { messages?: { text: string }[] }) => <ul data-testid="messages">{(messages ?? []).map((m) => <li key={m.text}>{m.text}</li>)}</ul>;
mock.module("@fchecklist/veridian-ui-kit/screens", () => ({
  ScreenFrame: (p: FrameProps) => <div>{p.breadcrumb}<Messages messages={p.messages} />{p.children}<div>{p.footerActions}</div></div>,
  StatusBadge: (p: { label: string }) => <span>{p.label}</span>,
  DocumentFlow: () => null,
  ObjectScreen: (p: FrameProps) => (
    <div>
      <h1>{p.title}</h1>
      <Messages messages={p.messages} />
      {p.children}
      {p.mode === "edit" || p.mode === "create" ? <button type="button" disabled={p.saveDisabled} onClick={() => p.onSave?.()}>Save</button> : null}
    </div>
  ),
}));

const toasts: { kind: string; text: string }[] = [];
mock.module("sonner", () => ({ toast: { success: (t: string) => toasts.push({ kind: "success", text: t }), error: (t: string) => toasts.push({ kind: "error", text: t }) } }));

const current: { outbox: Outbox | null } = { outbox: null };
mock.module("@/lib/local-first/outbox-shared", () => ({
  getSharedOutbox: () => current.outbox,
  peekSharedOutbox: () => current.outbox,
  releaseSharedOutbox: () => {},
  startOutbox: () => {},
  getDeviceId: () => "dev-test",
}));

const ScheduleTaskObjectClient = (await import("./ScheduleTaskObjectClient")).default;
const { changedTaskFields } = await import("./ScheduleTaskObjectClient");
const RfiObjectClient = (await import("./RfiObjectClient")).default;
const RfiCreateClient = (await import("./RfiCreateClient")).default;

const realFetch = globalThis.fetch;
let routes: Record<string, (init?: RequestInit) => unknown> = {};
const fetched: { url: string; method: string; body?: unknown }[] = [];

async function harness(seed: (s: FakeSyncServer) => void) {
  const idb = new IDBFactory();
  (globalThis as { indexedDB?: unknown }).indexedDB = idb;
  localStorage.setItem(LOCAL_FIRST_FLAG, "1");
  setActiveLocalUser("u1");
  const server = createFakeSyncServer();
  seed(server);
  const sync = () => createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  await sync();
  let n = 0;
  const outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-test", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++n}` });
  current.outbox = outbox;
  fetched.length = 0;
  toasts.length = 0;
  routes = {};
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    fetched.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const key = Object.keys(routes).find((k) => url.includes(k));
    // Reads are served; any online WRITE fails as it would with the laptop offline (the case these screens must survive).
    if (!key || method !== "GET") throw new TypeError(`offline: ${method} ${url}`);
    return new Response(JSON.stringify(routes[key]!(init)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { idb, server, outbox, sync };
}

beforeEach(() => { push.mockClear(); search.params = new URLSearchParams(); });
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  localStorage.removeItem(LOCAL_FIRST_FLAG);
  setActiveLocalUser(null);
  current.outbox = null;
});

/** Types into a CONTROLLED input (fireEvent.change cannot drive one here): calls its React onChange inside act(). */
function typeInto(el: Element, value: string) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  const props = (el as unknown as Record<string, { onChange?: (e: unknown) => void }>)[key!];
  act(() => { props.onChange!({ target: { value }, currentTarget: { value } }); });
}

const TASK = { id: "t1", projectId: "p1", number: 12, title: "Joinery", description: null, priority: "medium", statusId: "s1", startDate: "2026-08-01", dueDate: null, completionPercentage: 40, isArchived: false };
const seedTasks = (s: FakeSyncServer) => {
  s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Joinery", statusId: "s1", priority: "medium", completionPercentage: 40 } });
  s.upsert({ kind: "tasks", projectId: "p1", id: "t2", data: { title: "Other task", statusId: "s1" } });
};
const taskRoutes = (get: () => unknown) => ({ "/api/board": () => ({ columns: [{ id: "s1", name: "In progress" }, { id: "s2", name: "Done" }] }), "/api/schedule/tasks/t1": get });

describe("changedTaskFields (data:F3)", () => {
  test("only what differs from what the form opened with; untouched fields (a derived % complete) are never in it", () => {
    expect(changedTaskFields(TASK, { ...TASK, title: "New" })).toEqual({ title: "New" });
    expect(changedTaskFields(TASK, { ...TASK })).toEqual({});
    expect(changedTaskFields(TASK, { ...TASK, dueDate: "" as unknown as null, description: "" as unknown as null })).toEqual({}); // empty == missing
    expect(changedTaskFields(TASK, { ...TASK, completionPercentage: 55, startDate: "" as unknown as null })).toEqual({ completionPercentage: 55, startDate: null });
  });
});

describe("ScheduleTaskObjectClient", () => {
  async function openAndEdit(view: ReturnType<typeof render>, title: string) {
    fireEvent.click(await view.findByRole("button", { name: /Edit/ }));
    typeInto(view.getByDisplayValue("Joinery"), title);
  }

  test("(data:F3) a title edit sends ONLY the title -- never the task's % complete -- and the server applies it", async () => {
    const h = await harness(seedTasks);
    routes = taskRoutes(() => TASK);
    const view = render(<ScheduleTaskObjectClient taskId="t1" />);
    await view.findByText(/#12 Joinery/);
    await openAndEdit(view, "Joinery v2");
    fireEvent.click(view.getByRole("button", { name: /^Save/ }));
    await waitFor(async () => expect(await h.outbox.listPending()).toHaveLength(1));
    const [op] = await h.outbox.listPending();
    expect(op!.params).toEqual({ projectId: "p1", issueId: "t1", title: "Joinery v2" });
    expect(fetched.some((f) => f.method === "PATCH")).toBe(false);
  });

  test("(data:F12) the edit is based on the version the form LOADED: a newer row that arrived meanwhile is merged, not overwritten", async () => {
    const h = await harness(seedTasks);
    routes = taskRoutes(() => TASK);
    const view = render(<ScheduleTaskObjectClient taskId="t1" />);
    await view.findByText(/#12 Joinery/);
    await openAndEdit(view, "Mine");
    // while the form is open, someone else changes the status and this laptop's copy is refreshed (another tab's sync)
    h.server.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Joinery", statusId: "s2", priority: "medium", completionPercentage: 40 } });
    await h.sync();
    fireEvent.click(view.getByRole("button", { name: /^Save/ }));
    await waitFor(async () => expect(await h.outbox.listPending()).toHaveLength(1));
    expect((await h.outbox.listPending())[0]!.record!.baseVersion).toBe(1); // what the form loaded, not the laptop's newer 2
    const rep = await h.outbox.flush();
    expect(rep).toMatchObject({ merged: 1, applied: 1 });
    expect(h.server.getRow("tasks", "t1")!.data).toMatchObject({ title: "Mine", statusId: "s2" }); // theirs kept, mine applied
  });

  test("(data:F5) an applied edit of ANOTHER task does not reload this one; while editing, a reload never replaces the typing", async () => {
    const h = await harness(seedTasks);
    let served = TASK;
    routes = taskRoutes(() => served);
    const view = render(<ScheduleTaskObjectClient taskId="t1" />);
    await view.findByText(/#12 Joinery/);
    await openAndEdit(view, "Half-typed title");
    const gets = () => fetched.filter((f) => f.method === "GET" && f.url.includes("/api/schedule/tasks/t1")).length;
    const before = gets();
    // another task of the same project is edited and applied
    await h.outbox.enqueue({ functionId: "update_task", projectId: "p1", params: { issueId: "t2", title: "x" }, record: { kind: "tasks", id: "t2", baseVersion: 1 } });
    await act(async () => { await h.outbox.flush(); });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(gets()).toBe(before);
    // and even a reload of THIS task (Retry, its own applied event) keeps what is being typed
    served = { ...TASK, title: "Server's newer title" };
    await h.outbox.enqueue({ functionId: "update_task", projectId: "p1", params: { issueId: "t1", priority: "high" }, record: { kind: "tasks", id: "t1", baseVersion: 1 } });
    await act(async () => { await h.outbox.flush(); });
    await waitFor(() => expect(gets()).toBe(before + 1));
    expect(view.getByDisplayValue("Half-typed title")).toBeTruthy();
  });

  test("(data:F4) Edit again: opened with ?draft=<opId>, the form is in edit mode, filled with what was typed, and says why", async () => {
    const h = await harness(seedTasks);
    routes = taskRoutes(() => TASK);
    await h.outbox.enqueue({ functionId: "update_task", projectId: "p1", params: { projectId: "p1", issueId: "t1", title: " ", description: "my long notes" }, label: "Your change to this task", record: { kind: "tasks", id: "t1", baseVersion: 1 } });
    await h.outbox.flush(); // refused (empty title): a draft is kept
    search.params = new URLSearchParams("draft=op-1");
    const view = render(<ScheduleTaskObjectClient taskId="t1" />);
    await waitFor(() => expect(view.getByDisplayValue("my long notes")).toBeTruthy());
    expect(view.getByTestId("messages").textContent).toContain("Your changes are filled in below");
    // fix the title and save: the draft goes once it is re-sent
    typeInto(view.container.querySelector("input")!, "Joinery fixed"); // the title, the form's first field
    fireEvent.click(view.getByRole("button", { name: /^Save/ }));
    await waitFor(async () => expect((await h.outbox.refresh()).drafts).toEqual([]));
    const [op] = await h.outbox.listPending();
    expect(op!.params).toMatchObject({ title: "Joinery fixed", description: "my long notes" });
  });

  test("a % complete typed into a BOQ-linked task is refused on the laptop in words, the form keeps it, and the online save is tried", async () => {
    const h = await harness((s) => s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Joinery", statusId: "s1", completionPercentage: 40, boq_line_item_id: "li1" } }));
    routes = taskRoutes(() => TASK);
    const view = render(<ScheduleTaskObjectClient taskId="t1" />);
    await view.findByText(/#12 Joinery/);
    fireEvent.click(await view.findByRole("button", { name: /Edit/ }));
    typeInto(view.getByDisplayValue("40"), "55");
    fireEvent.click(view.getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(JSON.stringify(toasts.filter((t) => t.kind === "error"))).toContain("comes from its BOQ line"));
    expect(await h.outbox.pendingCount()).toBe(0);
    expect(fetched.some((f) => f.method === "PATCH")).toBe(true); // offline here, so it failed -- and said so
    expect(view.getByDisplayValue("55")).toBeTruthy();
  });
});

describe("RfiObjectClient", () => {
  const RFI = { id: "r1", projectId: "p1", number: 3, subject: "Beam", question: "Depth?", status: "open", ballInCourt: "architect", answer: null, dueDate: null };
  const seedRfi = (s: FakeSyncServer) => s.upsert({ kind: "rfis", projectId: "p1", id: "r1", data: { subject: "Beam", question: "Depth?", status: "open" } });

  test("(data:F4) an answer longer than the server takes is NOT queued; the text stays in the box and the person is told the limit", async () => {
    const h = await harness(seedRfi);
    routes = { "/api/rfis/r1": () => RFI };
    const view = render(<RfiObjectClient rfiId="r1" />);
    await view.findByText(/RFI-3/);
    const long = "a".repeat(2100);
    typeInto(view.container.querySelector("textarea")!, long);
    fireEvent.click(view.getByRole("button", { name: /Submit|Answer/ }));
    await waitFor(() => expect(JSON.stringify(toasts.filter((t) => t.kind === "error"))).toContain("2,000"));
    expect(await h.outbox.pendingCount()).toBe(0);
    expect((view.container.querySelector("textarea") as HTMLTextAreaElement).value).toBe(long);
  });

  test("Edit again puts the refused answer back in the box", async () => {
    const h = await harness(seedRfi);
    routes = { "/api/rfis/r1": () => RFI };
    const db = await openLocalDb(h.idb, localDbNameFor("u1"));
    await db.transact((tx) => tx.putDraft({ opId: "op-9", functionId: "answer_rfi", projectId: "p1", params: { projectId: "p1", rfiId: "r1", answer: "My careful answer" }, record: { kind: "rfis", id: "r1" }, message: "was not saved", at: 1 }));
    db.close();
    search.params = new URLSearchParams("draft=op-9");
    const view = render(<RfiObjectClient rfiId="r1" />);
    await waitFor(() => expect((view.container.querySelector("textarea") as HTMLTextAreaElement | null)?.value).toBe("My careful answer"));
  });
});

describe("RfiCreateClient", () => {
  test("Edit again fills subject, question and due date from the draft; saving it again removes the draft", async () => {
    const h = await harness(() => {});
    const db = await openLocalDb(h.idb, localDbNameFor("u1"));
    await db.transact((tx) => tx.putDraft({ opId: "op-7", functionId: "create_rfi", projectId: "p1", params: { projectId: "p1", subject: "Lift pit", question: "Waterproofing?", dueDate: "2026-10-20" }, creates: { kind: "rfis", id: "local-x" }, message: "was not saved", at: 1 }));
    db.close();
    search.params = new URLSearchParams("draft=op-7");
    const view = render(<RfiCreateClient projectId="p1" />);
    await waitFor(() => expect(view.getByDisplayValue("Lift pit")).toBeTruthy());
    expect(view.getByDisplayValue("Waterproofing?")).toBeTruthy();
    expect(view.getByDisplayValue("2026-10-20")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Save" }));
    await waitFor(async () => expect((await h.outbox.refresh()).drafts).toEqual([]));
    expect((await h.outbox.listPending())[0]!.params).toMatchObject({ subject: "Lift pit", question: "Waterproofing?", dueDate: "2026-10-20" });
  });
});
