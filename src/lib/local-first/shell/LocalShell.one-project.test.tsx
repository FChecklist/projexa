import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY, doneKey } from "../replica";
import { BOQ_LINES_KIND } from "../boq-local";
import { createIdentityStore, type DurableIdentity } from "../identity";
import { openDeviceMeta } from "../device-meta";
import { shellManifestKey } from "./manifest-cache";
import { readCookieProjectId } from "../../project-cookie";
import { PROJECT_PREFERENCE_KEY, readStoredProjectId, writeStoredProjectId } from "../../project-preference";
import { activeProjectFor, noteShownProject, readSelectedProject, selectedProjectKey, writeSelectedProject } from "./context";
const realReplicaShared = await import("../replica-shared");
mock.module("../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("./LocalShell");

// UAT 2026-10-13, F63 / checklist 2.23: ONE source of truth for the selected project. The offline shell used to keep `px-shell-project:<user>`
// while the normal pages' top rail kept `veri.rail.project` (+ its cookie); a page opened by a full reload could show one project while the
// rail named another, so a write could land in a project the person did not last look at. These tests drive the rail's store and the shell
// together: they fail while the shell has a store of its own.

process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key-not-a-real-credential";

const NOW = 1_760_000_000_000;
const ORIGIN = "https://px.test";
const realFetch = globalThis.fetch;
let idb: IDBFactory;

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? "online" : "offline"));
}
function go(path: string) {
  (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`${ORIGIN}${path}`);
}
const identity: DurableIdentity = {
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role: "pm", lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
};
function line(id: string, projectBoq: string) {
  return {
    id, boqId: projectBoq, boqTitle: `BOQ of ${projectBoq}`, boqVersion: 1, boqStatus: "approved", parentLineItemId: null, activityId: null,
    itemCode: `C${id}`, category: null, description: `line ${id}`, unit: "m3", quantity: "2", rate: "10", amount: "20", createdAt: "2026-01-01T00:00:00Z",
  };
}

async function seedTwoProjects() {
  const db = await openLocalDb(idb, localDbNameFor("u1"));
  await db.setMeta(MANIFEST_KEY, { userId: "u1", orgId: "orgA", projectIds: ["p1", "p2"], kinds: [BOQ_LINES_KIND], at: 1 });
  for (const [p, boq] of [["p1", "boqOne"], ["p2", "boqTwo"]] as const) {
    await db.putRecords([{ id: `${BOQ_LINES_KIND}:${p}-1`, type: BOQ_LINES_KIND, orgId: "orgA", projectId: p, data: line(`${p}-1`, boq), updatedAt: 1 }]);
    await db.setMeta(doneKey(p, BOQ_LINES_KIND), { at: NOW, redacted: false, hiddenFields: [] });
  }
  db.close();
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), {
    at: NOW, user: { id: "u1", name: "Asha Rao", role: "pm", org_id: "orgA" },
    projects: [{ id: "p1", name: "Empty project", status: "active" }, { id: "p2", name: "UAT Villa 21", status: "active" }],
  });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
}

function clearCookie() {
  document.cookie = `${PROJECT_PREFERENCE_KEY}=; path=/; max-age=0`;
}

beforeEach(() => {
  idb = new IDBFactory();
  (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = idb;
  localStorage.clear();
  sessionStorage.clear();
  clearCookie();
  noteShownProject("u1", null);
  globalThis.fetch = (async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setOnline(true);
});

describe("one stored answer to 'which project' for the rail and the offline shell (F63)", () => {
  test("the shell's key IS the rail's key, and what the rail stored is what the shell and the auto-sync read", () => {
    expect(selectedProjectKey("u1")).toBe(PROJECT_PREFERENCE_KEY);
    writeStoredProjectId("p2"); // the top rail's own writer (M24Shell chooseProject)
    expect(readSelectedProject()).toBe("p2");
    expect(activeProjectFor("u1")).toBe("p2"); // what the sync scheduler uses for "the project the person has open"
  });

  test("what the shell stores is what the normal pages read: localStorage AND the cookie the server pages use", () => {
    go("/local/scope"); // a real origin, so the cookie jar works
    writeSelectedProject("p2");
    expect(readStoredProjectId()).toBe("p2");
    expect(readCookieProjectId()).toBe("p2");
    expect(localStorage.getItem("px-shell-project:u1")).toBeNull(); // no second store
  });

  test("the offline shell opens the project the RAIL last named, not a copy of its own", async () => {
    await seedTwoProjects();
    setOnline(false);
    writeStoredProjectId("p2");
    go("/local/scope");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("scope-list");
    expect((getByTestId("local-shell-project") as HTMLSelectElement).value).toBe("p2");
  });

  test("picking a project in the offline shell moves the rail's stored choice (and the cookie) with it, so a reload on a normal page agrees", async () => {
    await seedTwoProjects();
    setOnline(false);
    writeStoredProjectId("p1");
    go("/local/scope");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    await findByTestId("scope-list");
    expect((getByTestId("local-shell-project") as HTMLSelectElement).value).toBe("p1");
    fireEvent.change(getByTestId("local-shell-project"), { target: { value: "p2" } });
    await waitFor(() => expect(readStoredProjectId()).toBe("p2"));
    expect(readCookieProjectId()).toBe("p2");
    expect(localStorage.getItem("px-shell-project:u1")).toBeNull();
  });

  test("a project opened from a link (?projectId=) becomes the rail's choice too", async () => {
    await seedTwoProjects();
    setOnline(false);
    expect(readStoredProjectId()).toBeNull();
    go("/local/scope?projectId=p2");
    const { findByTestId } = render(<LocalShell />);
    await findByTestId("scope-list");
    await waitFor(() => expect(readStoredProjectId()).toBe("p2"));
    expect(readCookieProjectId()).toBe("p2");
  });
});
