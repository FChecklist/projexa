import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import { shellManifestKey } from "../manifest-cache";
import { findShellRoute, navRoutes } from "../route-table";
import { ROUTES } from "../clusters/platform-knowledge";
import { MEETINGS_KIND, PROJECT_KIND, WIKI_KIND } from "./platform-adapter";
import { meetingRow, projectRow, seedPlatform, wikiRow } from "./platform-test-fixtures";
// The REAL module is spread first (see CLAUDE.md's mock.module() note); nothing here sends an edit.
const realReplicaShared = await import("../../replica-shared");
mock.module("../../replica-shared", () => ({ ...realReplicaShared, revalidateViaSharedReplica: async () => {} }));
const { default: LocalShell } = await import("../LocalShell");

// The platform-and-knowledge group, rendered through the REAL shell (route table, adapters, IndexedDB via fake-indexeddb, identity mirror)
// with the NETWORK OFF: every screen opens from the laptop's own database and not one request leaves the laptop.

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

async function seedLaptop(role = "pm") {
  await seedPlatform(
    idb, "u1",
    [
      { projectId: "p1", data: wikiRow("w1", { title: "Site rules", content: "Hard hats at all times." }), kind: WIKI_KIND },
      { projectId: "p1", data: meetingRow("m1", { title: "Weekly coordination" }), kind: MEETINGS_KIND },
      { projectId: "p1", data: projectRow("p1", { name: "Cedar Heights Villa" }), kind: PROJECT_KIND },
    ],
    [WIKI_KIND, MEETINGS_KIND, PROJECT_KIND],
    {
      orgKinds: ["currencies", "boq_categories", "org_people"],
      rows: [
        { kind: "currencies", data: { id: "c1", code: "INR", name: "Indian Rupee", symbol: "R", is_base_currency: true } },
        { kind: "boq_categories", data: { id: "b1", name: "Civil", sort_order: 1, is_active: true } },
        { kind: "org_people", data: { id: "u8", name: "Mira Manager", role: "pm", is_active: true, email: "m***@a.example.test" } },
      ],
    },
  );
  const device = await openDeviceMeta(idb);
  await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role, org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
  device.close();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identityFor("u1", role));
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
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  setOnline(true);
});

describe("the platform and knowledge group is registered in the shell", () => {
  test("lists and objects resolve; create paths are never read as ids; GRC and KPIs stay on the generic fallback; the Knowledge Base now resolves", () => {
    expect(findShellRoute("/wiki/abc")!.route.pattern).toBe("/wiki/:id");
    expect(findShellRoute("/meetings/abc")!.params).toEqual({ id: "abc" });
    expect(findShellRoute("/workspace/p1")!.route.pattern).toBe("/workspace/:id");
    for (const path of ["/wiki/new", "/meetings/new"]) expect(findShellRoute(path)!.route.pattern).toBe(path);
    for (const path of ["/grc", "/kpis", "/projects/new"]) expect(findShellRoute(path)).toBeNull();
    expect(findShellRoute("/knowledge-base")).not.toBeNull();
    for (const r of ROUTES) if (r.nav) expect(r.nav.order >= 90 && r.nav.order <= 99).toBe(true);
    expect(navRoutes().map((n) => n.label)).toEqual(expect.arrayContaining(["Projects", "Meetings", "Wiki", "Settings"]));
  });
});

describe("with NO network, every screen of the group opens from the laptop's own copy", () => {
  test("Wiki list -> one page; Meetings list -> one meeting; not one request, no dialog", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/wiki?projectId=p1");
    const { findByTestId, getAllByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("wiki-list")).getAttribute("data-state")).toBe("local");
    expect(getAllByTestId("wiki-list-row").map((r) => r.getAttribute("data-page-id"))).toEqual(["w1"]);
    fireEvent.click(getAllByTestId("wiki-list-row")[0]!.querySelector("a")!);
    expect((await findByTestId("wiki-object")).getAttribute("data-state")).toBe("local");
    expect(getByTestId("wiki-content").textContent).toBe("Hard hats at all times.");

    go("/local/meetings?projectId=p1");
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect((await findByTestId("meetings-list")).getAttribute("data-state")).toBe("local");
    fireEvent.click(getAllByTestId("meetings-list-row")[0]!.querySelector("a")!);
    expect((await findByTestId("meeting-object")).getAttribute("data-state")).toBe("local");
    expect(getByTestId("meeting-title").textContent).toBe("Weekly coordination");
    expect(document.querySelector('[role="dialog"], [role="alertdialog"], [role="alert"]')).toBeNull();
    expect(fetchCalls).toEqual([]);
  });

  test("Projects -> the workspace of a project: a project manager sees all eleven sections, a client viewer only the commercial ones", async () => {
    await seedLaptop("pm");
    setOnline(false);
    go("/local/projects");
    const first = render(<LocalShell />);
    expect((await first.findByTestId("projects-list")).getAttribute("data-state")).toBe("local");
    expect(first.getAllByTestId("projects-list-row")[0]!.textContent).toContain("Cedar Heights Villa");
    expect(first.getAllByTestId("projects-list-row")[0]!.textContent).toContain("R1,500,000"); // the stored value, printed, not computed
    fireEvent.click(first.getAllByTestId("projects-list-row")[0]!.querySelector("a")!);
    await first.findByTestId("workspace");
    expect(first.getAllByTestId("workspace-section")).toHaveLength(11);
    first.unmount();

    cleanup();
    await seedLaptop("client_viewer");
    go("/local/workspace/p1");
    const second = render(<LocalShell />);
    await second.findByTestId("workspace");
    expect(second.getAllByTestId("workspace-section").map((a) => a.getAttribute("data-section"))).toEqual(["boq", "timeline", "milestones", "scope-change-orders", "billing-milestones"]);
    expect(fetchCalls).toEqual([]);
  });

  test("Settings shows the account and the organisation lists from the laptop; no teammate e-mail anywhere", async () => {
    await seedLaptop();
    setOnline(false);
    go("/local/settings");
    const { findByTestId, getByTestId } = render(<LocalShell />);
    expect((await findByTestId("settings")).getAttribute("data-state")).toBe("local");
    expect(getByTestId("settings-currency-code").textContent).toContain("INR");
    expect(getByTestId("settings-category-list").textContent).toContain("Civil");
    expect(getByTestId("settings-team").textContent).toContain("Mira Manager");
    expect(document.body.textContent).not.toContain("a.example.test");
    expect(fetchCalls).toEqual([]);
  });

  test("a project's wiki that has not finished copying says so calmly, offline", async () => {
    await seedPlatform(idb, "u1", [{ projectId: "p1", data: wikiRow("w1"), kind: WIKI_KIND }], [WIKI_KIND], undefined, { done: [] });
    const device = await openDeviceMeta(idb);
    await device.meta.setMeta(shellManifestKey("u1"), { at: NOW, user: { id: "u1", name: "Asha Rao", role: "pm", org_id: "orgA" }, projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }] });
    device.close();
    await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identityFor("u1", "pm"));
    setOnline(false);
    go("/local/wiki?projectId=p1");
    const { findByTestId } = render(<LocalShell />);
    expect((await findByTestId("wiki-list")).getAttribute("data-state")).toBe("not_synced");
    expect(document.querySelector('[role="dialog"], [role="alertdialog"], [role="alert"]')).toBeNull();
    expect(fetchCalls).toEqual([]);
  });
});
