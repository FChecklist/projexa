import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY, doneKey } from "../replica";
import { BOQ_LINES_KIND } from "../boq-local";
import { createIdentityStore, type DurableIdentity } from "../identity";
import { openDeviceMeta } from "../device-meta";
import { shellManifestKey } from "./manifest-cache";
import { EDITS_META_KEY } from "./pending-edits";
// The replica pull after a sent edit talks to Supabase; here it is a no-op (the REAL module is spread first, see CLAUDE.md's mock.module() note).
const realReplicaShared = await import("../replica-shared");
mock.module("../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("./LocalShell");

// The shell, rendered, with the NETWORK OFF: it must open and draw the BOQ screens from the laptop's own database, take an edit, and
// send it when the laptop is back online. Everything is real code (the shell, the route table, the adapters, IndexedDB via
// fake-indexeddb, the identity mirror, the edit queue, the connectivity state); only the browser's network is faked.

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const ORIGIN = "https://px.test";
const realFetch = globalThis.fetch;

let idb: IDBFactory;
let fetchCalls: { url: string; method: string; body: unknown }[];

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

function go(path: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}${path}`);
}

function line(id: string, over: Record<string, unknown> = {}) {
  return {
    id, boqId: "boqA", boqTitle: "Tower A", boqVersion: 2, boqStatus: "approved", parentLineItemId: null, activityId: null,
    itemCode: `C${id}`, category: null, description: `line ${id}`, unit: "m3", quantity: "2", rate: "10", amount: "20", createdAt: `2026-01-0${id}T00:00:00Z`, ...over,
  };
}

const identity: DurableIdentity = {
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role: "pm", lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
};

async function seedLaptop() {
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: [BOQ_LINES_KIND], at: 1 });
  const rows = [line("1"), line("2", { parentLineItemId: "1", amount: "5" })];
  await db.putRecords(rows.map((r) => ({ id: `${BOQ_LINES_KIND}:${r.id}`, type: BOQ_LINES_KIND, orgId: "orgA", projectId: "p1", data: r, updatedAt: 1 })));
  await db.setMeta(doneKey("p1", BOQ_LINES_KIND), { at: NOW, redacted: false, hiddenFields: [] });
  db.close();
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role: "pm", org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
}

beforeEach(() => {
  idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  localStorage.clear();
  sessionStorage.clear();
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setOnline(true);
});

describe("the shell opens OFFLINE from the laptop's own copy", () => {
  test("the prerendered HTML is only a skeleton, so it cannot disagree with the first client render (no hydration mismatch)", () => {
    const html = renderToString(<LocalShell />);
    expect(html).toContain('data-testid="local-shell-skeleton"');
    expect(html).not.toContain("PROJEXA");
  });

  test("with no network at all: the BOQ list is drawn from the local database, under the person's own project, with the calm offline marker", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope?projectId=p1");
    const { findByTestId, getByTestId, getAllByTestId } = render(<LocalShell />);

    expect((await findByTestId("scope-list")).getAttribute("data-state")).toBe("local");
    expect(getAllByTestId("scope-list-row").map((r) => r.textContent)).toEqual([expect.stringContaining("Tower A")]);
    expect(getByTestId("local-shell-project").textContent).toContain("Cedar Heights Villa");
    expect((getByTestId("local-shell-project") as HTMLSelectElement).value).toBe("p1");
    expect(getByTestId("local-shell-person").textContent).toBe("asha@example.com");
    expect(getByTestId("local-shell").getAttribute("data-org-id")).toBe("orgA");
    expect(getByTestId("connectivity-marker").textContent).toBe("Working on this laptop; will sync when connected");
    expect(fetchCalls).toEqual([]); // not one request left the laptop
  });

  test("a project opened from a link (?projectId=) becomes the person's open project, so the scheduler catches it up at once, not hourly", async () => {
    await seedLaptop();
    setOnline(false);
    expect(localStorage.getItem("px-shell-project:u1")).toBeNull();
    go("/local/scope?projectId=p1");
    const { findByTestId } = render(<LocalShell />);
    await findByTestId("scope-list");
    await waitFor(() => expect(localStorage.getItem("px-shell-project:u1")).toBe("p1"));
  });

  test("clicking a BOQ opens its screen without a page load; its lines and total come from the laptop; Back works", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("scope-list");

    fireEvent.click(getAllByTestId("scope-list-row")[0]!.querySelector("a")!);
    const screen = await findByTestId("scope-object");
    expect(screen.getAttribute("data-state")).toBe("local");
    expect(window.location.pathname).toBe("/local/scope/boqA"); // stayed under /local; no navigation request
    expect(getByTestId("boq-local-title").textContent).toBe("Tower A");
    expect(getAllByTestId("boq-local-line").map((r) => r.getAttribute("data-line-id"))).toEqual(["1", "2"]);
    expect(getByTestId("boq-local-total").textContent).toContain("20.00"); // a sub-task's 5 is inside its parent's 20
    expect(fetchCalls).toEqual([]);

    // The browser's Back button: the address returns to the list and the shell hears popstate (happy-dom has no real history).
    go("/local/scope?projectId=p1");
    window.dispatchEvent(new Event("popstate"));
    expect((await findByTestId("scope-list")).getAttribute("data-state")).toBe("local");
  });

  test("no identity on the laptop and no network: it says so calmly and offers the offline passcode sign-in (AUDIT-100 B20); nothing is fetched", async () => {
    setOnline(false);
    go("/local/scope");
    const { findByTestId } = render(<LocalShell />);
    const message = await findByTestId("local-shell-signed-out");
    expect(message.textContent).toContain("You are offline. Sign in with the email and passcode you used on this laptop.");
    expect(message.textContent).toContain("The first sign-in on a laptop needs a connection.");
    const form = await findByTestId("local-shell-offline-signin");
    expect(form.querySelector("#email")).not.toBeNull();
    expect(form.querySelector("#password")).not.toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("a screen the shell does not have yet, offline: a calm explanation, no error, no dialog", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/payroll");
    const { findByTestId } = render(<LocalShell />);
    const note = await findByTestId("local-shell-not-here");
    expect(note.getAttribute("data-online")).toBe("0");
    expect(note.textContent).toContain("not saved on this laptop yet");
    expect(document.querySelector('[role="dialog"], [role="alertdialog"], [role="alert"]') === null).toBe(true);
  });
});

describe("typing in the BOQ line's category box (lf-e8)", () => {
  test("a second keystroke-event arriving before React renders: the screen keeps working and shows what was typed", async () => {
    // In Chromium one keystroke raises onChange AND onInput; the second handler's state update was not computed at once (another
    // was already queued), so React ran its updater later, after the event was over, read a null currentTarget and crashed the whole
    // screen ("This page couldn't load"). Two input events inside one act() batch give React exactly that ordering here.
    await seedLaptop();
    setOnline(false);
    go("/local/scope/boqA?projectId=p1");
    const { findByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("boq-local-title");
    const input = getAllByTestId("boq-line-category-input")[1]! as HTMLInputElement;
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => { errors.push(event.error ?? event.message); event.preventDefault(); };
    window.addEventListener("error", onError);
    try {
      act(() => {
        fireEvent.input(input, { target: { value: "Stee" } });
        fireEvent.input(input, { target: { value: "Steel" } });
      });
    } catch (err) {
      errors.push(err);
    } finally {
      window.removeEventListener("error", onError);
    }
    expect(errors).toEqual([]);
    expect((getAllByTestId("boq-line-category-input")[1]! as HTMLInputElement).value).toBe("Steel");
    expect(await findByTestId("boq-line-save")).toBeTruthy();
  });
});

describe("an edit made offline is kept, then sent when the laptop is back online", () => {
  test("type a category offline -> Save -> 'Waiting to sync' and nothing sent; go online -> ONE PATCH of the person's intent; the waiting mark clears", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/scope/boqA?projectId=p1");
    const { findByTestId, getAllByTestId, queryByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("boq-local-title");

    const input = getAllByTestId("boq-line-category-input")[1]! as HTMLInputElement; // line 2
    fireEvent.input(input, { target: { value: "Steel" } });
    fireEvent.click(await findByTestId("boq-line-save"));

    await waitFor(() => expect(getByTestId("boq-line-waiting").textContent).toBe("Waiting to sync"));
    expect(getByTestId("boq-local-note").textContent).toContain("will be sent to the server when you are connected");
    expect((getAllByTestId("boq-line-category-input")[1]! as HTMLInputElement).value).toBe("Steel"); // the screen shows what was just typed
    expect(fetchCalls).toEqual([]);
    // kept in THIS person's database, and in the order made
    const person = await openLocalDb(idb, localDbNameFor("u1"));
    const stored = await person.getMeta<{ lineId: string; patch: { category: string | null } }[]>(EDITS_META_KEY);
    person.close();
    expect(stored!.map((e) => [e.lineId, e.patch.category])).toEqual([["2", "Steel"]]);

    setOnline(true);
    await waitFor(() => expect(fetchCalls.filter((c) => c.method === "PATCH")).toHaveLength(1), { timeout: 4000 });
    expect(fetchCalls.find((c) => c.method === "PATCH")).toEqual({ url: "/api/scope/line-items/2", method: "PATCH", body: { category: "Steel", expectedCategory: null } }); // G-14: carries what the person saw (line 2 had no category)
    await waitFor(() => expect(queryByTestId("boq-line-waiting") === null).toBe(true), { timeout: 4000 });
    const after = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await after.getMeta(EDITS_META_KEY)).toEqual([]);
    after.close();
  });

  test("a server that answers 503 keeps the edit and does not lose it: still 'Waiting to sync'", async () => {
    await seedLaptop();
    go("/local/scope/boqA?projectId=p1");
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response("{}", { status: 503 });
    }) as typeof fetch;
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("boq-local-title");
    fireEvent.input(getAllByTestId("boq-line-category-input")[0]!, { target: { value: "Civil" } });
    fireEvent.click(await findByTestId("boq-line-save"));
    await waitFor(() => expect(fetchCalls.some((c) => c.method === "PATCH")).toBe(true), { timeout: 4000 });
    await waitFor(() => expect(getByTestId("boq-line-waiting") !== null).toBe(true));
    const person = await openLocalDb(idb, localDbNameFor("u1"));
    expect(((await person.getMeta<unknown[]>(EDITS_META_KEY)) ?? []).length).toBe(1);
    person.close();
  });
});
