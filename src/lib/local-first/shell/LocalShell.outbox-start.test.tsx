import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY } from "../replica";
import { createIdentityStore, type DurableIdentity } from "../identity";
import { openDeviceMeta } from "../device-meta";

// lf-e10b, found in a real Chromium (e2e/lf-documents-docs.spec.ts): an edit made OFFLINE on a shell screen (a document's details, a
// meeting's minutes, a change order, a time entry: every outbox write of the shell) and followed by a reload was NEVER sent while the
// person stayed on the laptop's screens. The outbox is created lazily by the first enqueue, and only M24Shell (the online app's shell)
// started it on load; after a reload the on-laptop shell held the stored ops but nothing was listening for "online", so the edit
// waited forever. The shell must start the person's outbox as soon as it knows who they are, exactly as M24Shell does.

const started: string[] = [];
const realOutboxShared = await import("../outbox-shared");
// The REAL module is spread first (see CLAUDE.md's mock.module() note); only startOutbox is recorded.
mock.module("../outbox-shared", () => ({ ...realOutboxShared, startOutbox: (userId: string) => { started.push(userId); } }));
const { default: LocalShell } = await import("./LocalShell");

const NOW = 1_760_000_000_000;
let idb: IDBFactory;

const identity: DurableIdentity = {
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role: "pm", lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
};

beforeEach(async () => {
  started.length = 0;
  idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => false });
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: ["documents"], at: 1 });
  db.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => true });
});

test("the on-laptop shell starts the person's outbox once it knows who they are, so ops stored before a reload are sent when the laptop is back online", async () => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://px.test/local/documents?projectId=p1");
  const { findByTestId } = render(<LocalShell />);
  await findByTestId("documents-list");
  await waitFor(() => expect(started).toEqual(["u1"]));
});

test("no identity on the laptop: no outbox is started (there is nobody to send for)", async () => {
  localStorage.clear();
  idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://px.test/local/documents");
  const { findByTestId } = render(<LocalShell />);
  await findByTestId("local-shell-signed-out");
  await new Promise((r) => setTimeout(r, 50));
  expect(started).toEqual([]);
});
