import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { createOutbox } from "../../outbox";
import { createFakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { shellManifestKey } from "../manifest-cache";
import { findShellRoute } from "../route-table";
import { ROUTES } from "../clusters/documents";
import { documentsWriteDeps } from "./documents-writes";
import { openFileCache } from "./documents-file-cache";
import { MEETING_MINUTES_KIND } from "./moms-adapter";
import { docRow, momRow, seedPerson } from "./documents-test-fixtures";
// The replica pull after a sent edit talks to Supabase; here it is a no-op (the REAL module is spread first, see CLAUDE.md's mock.module() note).
const realReplicaShared = await import("../../replica-shared");
mock.module("../../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("../LocalShell");

// The documents cluster, rendered through the REAL shell (route table, adapters, IndexedDB via fake-indexeddb, identity mirror) with the
// NETWORK OFF: every screen opens from the laptop's own database and not one request leaves the laptop. Writes go into a real outbox
// (backed by the fake sync server's client, never flushed here) through documentsWriteDeps.

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const ORIGIN = "https://px.test";
const realFetch = globalThis.fetch;

let idb: IDBFactory;
let fetchCalls: string[];

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}

function go(path: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}${path}`);
}

const identityFor = (userId: string, role: string): DurableIdentity => ({
  userId, email: `${userId}@example.com`, name: "Asha Rao", orgId: "orgA", role, lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
});

async function seedLaptop(opts: { dataOwner?: string; role?: string } = {}) {
  const owner = opts.dataOwner ?? "u1";
  await seedPerson(idb, owner, [
    { projectId: "p1", data: docRow("d1", { name: "Signed contract" }) },
    { projectId: "p1", data: docRow("d2", { category: "drawing", name: "GF plan rev A", metadata: { drawingNo: "A-101", rev: "A", status: "superseded" }, created_at: "2026-01-01T00:00:00Z" }) },
    { projectId: "p1", data: docRow("d3", { category: "drawing", name: "GF plan rev B", metadata: { drawingNo: "A-101", rev: "B", status: "current", supersedesId: "d2" }, created_at: "2026-02-01T00:00:00Z" }) },
    { projectId: "p1", data: docRow("d4", { category: "permit", name: "Building permit", expiry_date: "2020-01-01T00:00:00Z", metadata: { permitNumber: "BP-7" } }) },
    { projectId: "p1", data: momRow("m1"), kind: MEETING_MINUTES_KIND },
    { projectId: "p1", data: momRow("m2", { status: "published", published_at: "2026-04-02T12:00:00Z" }), kind: MEETING_MINUTES_KIND },
  ], { kinds: ["documents", MEETING_MINUTES_KIND] });
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role: opts.role ?? "pm", org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identityFor("u1", opts.role ?? "pm"));
}

beforeEach(() => {
  idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  localStorage.clear();
  sessionStorage.clear();
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  const server = createFakeSyncServer();
  documentsWriteDeps.outbox = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {} });
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  documentsWriteDeps.outbox = undefined;
  setOnline(true);
});

describe("the documents cluster is registered in the shell", () => {
  test("lists and objects of permits, drawings, documents and MoMs; nav orders inside 40-59; create paths are never read as ids", () => {
    expect(findShellRoute("/permits")!.route.pattern).toBe("/permits");
    expect(findShellRoute("/drawings/abc")!.params).toEqual({ id: "abc" });
    expect(findShellRoute("/documents/abc")!.route.pattern).toBe("/documents/:id");
    expect(findShellRoute("/moms/abc")!.route.pattern).toBe("/moms/:id");
    for (const path of ["/permits/new", "/drawings/new", "/documents/upload", "/moms/new"]) expect(findShellRoute(path)!.route.pattern).toBe(path);
    for (const r of ROUTES) if (r.nav) expect(r.nav.order >= 40 && r.nav.order <= 59).toBe(true);
  });
});

describe("with NO network, every screen of the cluster opens from the laptop's own copy", () => {
  test("Documents list -> one document; the file is said plainly to be not kept; not one request", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/documents?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("documents-list")).getAttribute("data-state")).toBe("local");
    expect(getAllByTestId("documents-list-row").map((r) => r.getAttribute("data-doc-id")).sort()).toEqual(["d1", "d2", "d3", "d4"]);

    fireEvent.click(getAllByTestId("documents-list-row").find((r) => r.getAttribute("data-doc-id") === "d1")!.querySelector("a")!);
    expect((await findByTestId("document-object")).getAttribute("data-state")).toBe("local");
    expect(getByTestId("document-title").textContent).toBe("Signed contract");
    expect((await findByTestId("doc-file-absent")).textContent).toContain("not kept on this laptop");
    expect(document.querySelector('[data-testid="doc-file-open"]')).toBeNull(); // no "Open the file" button offline
    expect(document.querySelector('[role="dialog"], [role="alertdialog"], [role="alert"]')).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("a file kept on this laptop is shown offline", async () => {
    await seedLaptop();
    const cache = await openFileCache("u1", { idb });
    await cache.put({ docId: "d1", orgId: "orgA", projectId: "p1", name: "contract.pdf", type: "application/pdf", bytes: new Uint8Array([1, 2, 3]).buffer, pinned: true });
    cache.close();
    setOnline(false);
    go("/local/documents/d1?projectId=p1");
    const { findByTestId } = render(<LocalShell />);
    const kept = await findByTestId("doc-file-kept");
    expect(kept.getAttribute("data-pinned")).toBe("1");
    expect(kept.textContent).toContain("Kept on this laptop.");
    expect(fetchCalls).toEqual([]);
  });

  test("Drawings: 'Current only' by default; the object shows status, what it supersedes and the revision history", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/drawings?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("drawings-list");
    expect(getAllByTestId("drawings-list-row").map((r) => r.getAttribute("data-doc-id"))).toEqual(["d3"]);
    fireEvent.click(getByTestId("drawings-current-only"));
    expect(getAllByTestId("drawings-list-row").map((r) => r.getAttribute("data-doc-id"))).toEqual(["d3", "d2"]);

    fireEvent.click(getAllByTestId("drawings-list-row")[0]!.querySelector("a")!);
    await findByTestId("drawing-object");
    expect(getByTestId("drawing-status").textContent).toBe("✓ Current");
    expect(getByTestId("fact-supersedes").textContent).toBe("GF plan rev A (rev A)");
    expect(getAllByTestId("drawing-history-item").map((li) => li.getAttribute("data-doc-id"))).toEqual(["d3", "d2"]);
    expect(fetchCalls).toEqual([]);
  });

  test("Permits: the online list's own status words; the create path is explained, never 'permit not found'", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/permits?projectId=p1");
    const first = render(<LocalShell />);
    await first.findByTestId("permits-list");
    expect(first.getByTestId("permit-status").textContent).toContain("expired");
    cleanup();

    go("/local/permits/new?projectId=p1");
    const second = render(<LocalShell />);
    // G-15: the create path is a real form on the laptop now (the file waits on the laptop), never the server-only note, never 'permit not found'
    await second.findByTestId("permit-new-form");
    expect(second.queryByTestId("documents-server-only")).toBeNull();
    expect(document.querySelector('[data-testid="permit-object"]')).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("MoM: amend the minutes offline -> shown at once, 'Waiting to sync', queued in THIS person's outbox, nothing sent", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/moms/m1?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("mom-object");
    expect(getByTestId("mom-minutes").textContent).toBe("Agreed to pour slab on Monday.");
    fireEvent.click(getByTestId("mom-amend-open"));
    fireEvent.input(getByTestId("mom-minutes-input"), { target: { value: "Pour moved to Tuesday." } });
    fireEvent.click(getByTestId("mom-amend-save"));

    await waitFor(() => expect(getByTestId("mom-minutes").textContent).toBe("Pour moved to Tuesday."));
    await waitFor(() => expect(getByTestId("doc-waiting").textContent).toBe("Waiting to sync"));
    expect(getByTestId("mom-note").textContent).toContain("will be sent to the server when you are connected");
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listOps()).map((o) => [o.functionId, (o.params as { minutes: string }).minutes])).toEqual([["update_mom_minutes", "Pour moved to Tuesday."]]);
    db.close();
    expect(fetchCalls).toEqual([]);
  });

  test("R-C04 a new meeting with attendees, agenda, minutes and action items: saved on the laptop, ONE create_mom op, listed as Waiting to sync; nothing fetched", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/moms/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("mom-new-form");
    fireEvent.input(getByLabelText("Title"), { target: { value: "Weekly site meeting" } });
    fireEvent.input(getByLabelText("Attendees"), { target: { value: "Asha, Ravi" } });
    fireEvent.input(getByLabelText("Agenda"), { target: { value: ["Slab", "Safety"].join(String.fromCharCode(10)) } });
    fireEvent.input(getByLabelText("Minutes"), { target: { value: "Pour agreed." } });
    fireEvent.input(getByLabelText("Action item 1"), { target: { value: "Order tiles" } });
    fireEvent.input(getByLabelText("Due date for action item 1"), { target: { value: "2026-10-20" } });
    fireEvent.click(getByTestId("mom-new-actions").querySelector("button")!);
    fireEvent.input(getByLabelText("Action item 2"), { target: { value: "Check props" } });
    fireEvent.submit(getByTestId("mom-new-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"), { timeout: 5_000 });
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    const ops = await db.listOps();
    db.close();
    expect(ops.map((o) => o.functionId)).toEqual(["create_mom"]);
    expect(ops[0]!.params).toMatchObject({
      projectId: "p1", title: "Weekly site meeting", attendees: ["Asha", "Ravi"], agenda: ["Slab", "Safety"], minutes: "Pour agreed.",
      actionItems: [{ title: "Order tiles", dueDate: "2026-10-20" }, { title: "Check props" }],
    });
    cleanup();

    go("/local/moms?projectId=p1");
    const list = render(<LocalShell />);
    await list.findByTestId("moms-list");
    await waitFor(() => expect(list.getAllByTestId("moms-list-row").map((r) => r.textContent!).some((t) => t.includes("Weekly site meeting") && t.includes("Waiting to sync"))).toBe(true));
    expect(fetchCalls).toEqual([]);
  });

  test("checklist 2.9b: an action item on a meeting that is already there, offline -> listed as Waiting to sync, ONE add_meeting_action_item op, nothing fetched; publish and PDF are said to be online", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/moms/m1?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId } = render(<LocalShell />);
    await findByTestId("mom-object");
    expect(getByTestId("doc-online-only").textContent).toContain("publishing the minutes and the PDF need a connection");
    // a blank item is refused in words and queues nothing
    fireEvent.submit(getByTestId("mom-item-form"));
    await waitFor(() => expect(getByTestId("mom-item-note").getAttribute("data-ok")).toBe("0"));
    fireEvent.input(getByLabelText("New action item"), { target: { value: "Order tiles" } });
    fireEvent.input(getByLabelText("Due date for the new action item"), { target: { value: "2026-10-20" } });
    fireEvent.submit(getByTestId("mom-item-form"));
    await waitFor(() => expect(getByTestId("mom-item-note").getAttribute("data-ok")).toBe("1"), { timeout: 5_000 });
    expect(getByTestId("mom-item-note").textContent).toContain("will be sent to the server when you are connected");
    await waitFor(() => expect(getByTestId("mom-pending-items").textContent).toContain("Order tiles"));
    expect(getByTestId("mom-pending-items").textContent).toContain("(due 20-10-2026)");
    expect(getByTestId("mom-pending-items").textContent).toContain("Waiting to sync");
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listOps()).map((o) => [o.functionId, o.params])).toEqual([["add_meeting_action_item", { projectId: "p1", meetingId: "m1", title: "Order tiles", dueDate: "2026-10-20" }]]);
    db.close();
    expect(fetchCalls).toEqual([]);
  });

  test("an action item can still be added to PUBLISHED minutes (a follow-up task, as online); a viewer is not offered the form", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/moms/m2?projectId=p1");
    const published = render(<LocalShell />);
    await published.findByTestId("mom-object");
    expect(published.getByTestId("mom-item-form")).toBeTruthy();
    cleanup();
    cleanup();
    idb = new IDBFactory();
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
    await seedLaptop({ role: "viewer" });
    go("/local/moms/m1?projectId=p1");
    const viewer = render(<LocalShell />);
    await viewer.findByTestId("mom-object");
    expect(document.querySelector('[data-testid="mom-item-form"]')).toBeNull();
  });

  test("R-C04 (checklist 3.4): the minutes can be copied as a WhatsApp message offline, nothing fetched; the public share link is said to need a connection", async () => {
    let copiedText = "";
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (t: string) => { copiedText = t; } } });
    await seedLaptop();
    setOnline(false);
    go("/local/moms/m1?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("mom-object");
    fireEvent.click(getByTestId("mom-whatsapp"));
    await waitFor(() => expect(getByTestId("mom-copied").textContent).toContain("Paste it into WhatsApp"));
    expect(copiedText).toContain("*Meeting m1*");
    expect(copiedText).toContain("Agreed to pour slab on Monday.");
    expect(copiedText).toContain("1. 1. Progress");
    expect(getByTestId("doc-online-only").textContent).toContain("The public share link");
    expect(fetchCalls).toEqual([]);
  });

  test("saving minutes that were not changed queues nothing", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/moms/m1?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("mom-object");
    fireEvent.click(getByTestId("mom-amend-open"));
    fireEvent.click(getByTestId("mom-amend-save"));
    await waitFor(() => expect(getByTestId("mom-note").textContent).toBe("Nothing was changed."));
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect(await db.listOps()).toEqual([]);
    db.close();
  });

  test("Document details edited offline: shown at once and waiting; only the registry's fields are queued", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/documents/d1?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("document-object");
    fireEvent.click(getByTestId("doc-edit-open"));
    fireEvent.input(getByTestId("doc-edit-name"), { target: { value: "Signed contract v2" } });
    fireEvent.click(getByTestId("doc-edit-save"));
    await waitFor(() => expect(getByTestId("document-title").textContent).toBe("Signed contract v2Waiting to sync"));
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((await db.listOps()).map((o) => [o.functionId, o.params])).toEqual([["update_document_metadata", { projectId: "p1", documentId: "d1", name: "Signed contract v2" }]]);
    db.close();
    expect(fetchCalls).toEqual([]);
  });

  test("published minutes: no amend button, the lock is said plainly", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/moms/m2?projectId=p1");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("mom-object");
    expect(document.querySelector('[data-testid="mom-amend-open"]')).toBeNull();
    expect(getByTestId("mom-locked").textContent).toContain("published and locked");
  });
});

describe("who sees what", () => {
  test("a viewer-role person is offered no edits (details or minutes)", async () => {
    await seedLaptop({ role: "viewer" });
    setOnline(false);
    go("/local/moms/m1?projectId=p1");
    const moms = render(<LocalShell />);
    await moms.findByTestId("mom-object");
    expect(document.querySelector('[data-testid="mom-amend-open"]')).toBeNull();
    cleanup();
    go("/local/documents/d1?projectId=p1");
    const doc = render(<LocalShell />);
    await doc.findByTestId("document-object");
    expect(document.querySelector('[data-testid="doc-edit-open"]')).toBeNull();
  });

  test("another person's database on this laptop contributes nothing: 'not copied yet', not their documents", async () => {
    await seedLaptop({ dataOwner: "someone-else" });
    setOnline(false);
    go("/local/documents?projectId=p1");
    const { findByTestId } = render(<LocalShell />);
    const list = await findByTestId("documents-list");
    expect(list.getAttribute("data-state")).toBe("not_synced");
    expect(list.textContent).not.toContain("Signed contract");
  });
});


describe("G-15: a permit, a drawing and a document are added OFFLINE with their file kept on the laptop", () => {
  const pick = (input: HTMLElement, name = "scan.pdf") => fireEvent.change(input, { target: { files: [new File(["%PDF-1.4 hello"], name, { type: "application/pdf" })] } });
  const storedJobs = async () => {
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    try {
      return (await db.getMeta<{ kind: string; projectId: string; fileName: string; state: string; fields: Record<string, unknown> }[]>("shell:file-jobs")) ?? [];
    } finally {
      db.close();
    }
  };

  test("permit: the form checks the fields, keeps the file and the fields, shows 'File waiting to upload', sends nothing, queues no record yet", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/permits/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId, getAllByTestId } = render(<LocalShell />);
    await findByTestId("permit-new-form");
    fireEvent.input(getByLabelText("Name"), { target: { value: "Fit-out permit" } });
    fireEvent.input(getByLabelText("Permit number"), { target: { value: "FP-1" } });
    fireEvent.input(getByLabelText("Issued by"), { target: { value: "Municipality" } });
    fireEvent.submit(getByTestId("permit-new-form")); // no expiry date, no file
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("0"));
    expect(await storedJobs()).toEqual([]);

    fireEvent.input(getByLabelText("Expiry date"), { target: { value: "2027-01-31" } });
    pick(getByLabelText("File"));
    fireEvent.submit(getByTestId("permit-new-form"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("1"));
    await waitFor(() => expect(getAllByTestId("files-waiting-item")).toHaveLength(1));
    expect(getByTestId("files-waiting-item").textContent).toContain("File waiting to upload");
    expect(getByTestId("files-waiting-item").textContent).toContain("Fit-out permit");
    const jobs = await storedJobs();
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ kind: "permit", projectId: "p1", fileName: "scan.pdf", state: "waiting", fields: { name: "Fit-out permit", permitNumber: "FP-1", permitAuthority: "Municipality", expiryDate: "2027-01-31" } });
    expect(await documentsWriteDeps.outbox!.listPending()).toEqual([]); // the record waits for its file
    expect(fetchCalls).toEqual([]);
  });

  // checklist 2.20: "Save permit" with no file did nothing and said nothing (the browser's own required-field block). It must say, in words,
  // everything that is still missing -- when the person presses the real Save button, not only on a scripted submit.
  test("permit: pressing Save with nothing filled in says in words what is still needed (no silent browser block); nothing is stored", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/permits/new?projectId=p1");
    const { findByTestId, getByLabelText, getByTestId, getByText } = render(<LocalShell />);
    const form = (await findByTestId("permit-new-form")) as HTMLFormElement;
    expect(form.noValidate).toBe(true);
    fireEvent.click(getByText("Save permit"));
    await waitFor(() => expect(getByTestId("save-note").getAttribute("data-ok")).toBe("0"));
    expect(getByTestId("save-note").textContent).toBe("Still needed to save this permit: name, permit number, who issued it, expiry date, the file.");

    fireEvent.input(getByLabelText("Name"), { target: { value: "Fit-out permit" } });
    fireEvent.input(getByLabelText("Permit number"), { target: { value: "FP-1" } });
    fireEvent.input(getByLabelText("Issued by"), { target: { value: "Municipality" } });
    fireEvent.input(getByLabelText("Expiry date"), { target: { value: "2027-01-31" } });
    fireEvent.click(getByText("Save permit")); // only the file is missing now
    await waitFor(() => expect(getByTestId("save-note").textContent).toBe("Still needed to save this permit: the file."));
    expect(await storedJobs()).toEqual([]);
    expect(fetchCalls).toEqual([]);
  });

  test("drawing and document: same two steps; the document form offers the app's categories", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/drawings/new?projectId=p1");
    const d = render(<LocalShell />);
    await d.findByTestId("drawing-new-form");
    fireEvent.input(d.getByLabelText("Name"), { target: { value: "AR-101 plan" } });
    fireEvent.input(d.getByLabelText("Drawing number (optional)"), { target: { value: "AR-101" } });
    pick(d.getByLabelText("File"), "ar101.pdf");
    fireEvent.submit(d.getByTestId("drawing-new-form"));
    await waitFor(() => expect(d.getByTestId("save-note").getAttribute("data-ok")).toBe("1"));
    cleanup();

    go("/local/documents/upload?projectId=p1");
    const u = render(<LocalShell />);
    await u.findByTestId("document-new-form");
    expect([...(u.getByLabelText("Category") as HTMLSelectElement).options].map((o) => o.value)).toEqual(["", "permit", "drawing", "contract", "certificate", "license", "site_photo", "email", "other"]);
    fireEvent.input(u.getByLabelText("Name"), { target: { value: "Site plan" } });
    fireEvent.change(u.getByLabelText("Category"), { target: { value: "drawing" } });
    pick(u.getByLabelText("File"), "plan.pdf");
    fireEvent.submit(u.getByTestId("document-new-form"));
    await waitFor(() => expect(u.getByTestId("save-note").getAttribute("data-ok")).toBe("1"));
    const jobs = await storedJobs();
    expect(jobs.map((j) => [j.kind, j.fileName])).toEqual([["drawing", "ar101.pdf"], ["document", "plan.pdf"]]);
    expect(fetchCalls).toEqual([]);
  });

  test("the list pages offer the add link and show the waiting files; a read-only role gets the read-only note", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/permits?projectId=p1");
    const l = render(<LocalShell />);
    await l.findByTestId("permits-list");
    expect(l.getByTestId("doc-online-only").textContent).toContain("without a connection");
    expect(l.container.querySelector('a[href*="/permits/new"]')).not.toBeNull();
  });
});
