import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY } from "../replica";
import { createIdentityStore, type DurableIdentity } from "../identity";
import { openDeviceMeta } from "../device-meta";
import LocalShell from "./LocalShell";

// lf-e10b, found in a real Chromium (e2e/lf-documents-docs.spec.ts): once a laptop is prepared, the service worker answers every app
// URL with the on-laptop shell (online too), but the shell never mounted AiAttach (only the online app's layout did). So on every
// local-first screen the person's browser AI had no door (no window.projexa.ai, no manual in the page) and a delete it asked for had
// no "Yes, do it" for the person to click (requirements R7, R11, R12). The shell must mount it, once.

const NOW = 1_760_000_000_000;
let idb: IDBFactory;

const identity: DurableIdentity = {
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role: "member", lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
};

beforeEach(async () => {
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

test("every on-laptop screen carries the browser AI's door: the inline manual, exactly once", async () => {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL("https://px.test/local/permits?projectId=p1");
  const { findByTestId } = render(<LocalShell />);
  await findByTestId("permits-list");
  await waitFor(() => expect(document.querySelectorAll("script#px-ai-manual")).toHaveLength(1));
  const manual = JSON.parse(document.querySelector("script#px-ai-manual")!.textContent ?? "{}") as Record<string, unknown>;
  expect(Object.keys(manual).length).toBeGreaterThan(0);
});
