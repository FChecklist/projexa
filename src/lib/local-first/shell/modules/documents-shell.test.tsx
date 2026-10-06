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
