import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY, doneKey } from "../replica";
import { BOQ_LINES_KIND } from "../boq-local";
import { createIdentityStore, type DurableIdentity } from "../identity";
import { openDeviceMeta } from "../device-meta";
import { shellManifestKey } from "./manifest-cache";
const realReplicaShared = await import("../replica-shared");
mock.module("../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("./LocalShell");

// LOCAL-FIRST browser AI (package lf-e11), found by the first real-browser run: the /local shell -- the document the service worker
// serves for EVERY app address while the laptop is offline -- never mounted AiAttach, so a page opened with no internet had no
// window.projexa.ai at all, and the person's AI could not work offline (R1 + R11). This renders the real shell with the network OFF and
// checks the AI door opens for the person kept on the laptop, reading the laptop's own rows, with no request leaving the laptop.

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const realFetch = globalThis.fetch;
let fetchCalls: string[];

const identity: DurableIdentity = {
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role: "pm", lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
};

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
}

async function seedLaptop(idb: IDBFactory) {
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1"], kinds: [BOQ_LINES_KIND], at: 1 });
  await db.putRecords([{ id: `${BOQ_LINES_KIND}:l1`, type: BOQ_LINES_KIND, orgId: "orgA", projectId: "p1", data: { id: "l1", description: "Blockwork" }, updatedAt: 1 }]);
  await db.setMeta(doneKey("p1", BOQ_LINES_KIND), { at: NOW, redacted: false, hiddenFields: [] });
  db.close();
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role: "pm", org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
}

beforeEach(() => {
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  localStorage.clear();
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetchCalls.push(String(input));
    throw new TypeError("Failed to fetch"); // offline: nothing answers
  }) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setOnline(true);
  try { delete (window as unknown as { projexa?: unknown }).projexa; } catch { /* already gone */ }
});

test("offline, the /local shell publishes window.projexa.ai for the person kept on the laptop, and it reads the laptop's rows", async () => {
  await seedLaptop((globalThis as unknown as { indexedDB: IDBFactory }).indexedDB);
  setOnline(false);
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://px.test/local/scope?projectId=p1");
  const { findByTestId } = render(<LocalShell />);
  await findByTestId("scope-list");

  await waitFor(() => expect(typeof (window as unknown as { projexa?: { ai?: unknown } }).projexa?.ai).toBe("object"), { timeout: 5_000 });
  const api = (window as unknown as { projexa: { ai: { list(kind: string, o?: object): Promise<{ items: { id: string; data: { description: string } }[] }> } } }).projexa.ai;
  const lines = await api.list(BOQ_LINES_KIND, { projectId: "p1" });
  expect(lines.items.map((i) => [i.id, i.data.description])).toEqual([["l1", "Blockwork"]]);
  // the in-page manual is there too
  expect(document.getElementById("px-ai-manual")?.getAttribute("type")).toBe("application/json");
  // and nothing went to Supabase or anywhere else to find out who the person is
  expect(fetchCalls.filter((u) => u.includes("/auth/v1/"))).toEqual([]);
});
