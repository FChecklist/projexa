import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { beforeEach, describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createIdentityStore, type DurableIdentity } from "../../identity";
import { openDeviceMeta } from "../../device-meta";
import type { ShellData } from "../context";
import { createBackgroundRefresh } from "../../background-refresh";
import { loadDashboard, projectDashboardSnapshotName, type ProjectDashboardSnapshot } from "./dashboard-adapter";
import { snapshotCacheFor } from "../snapshot-cache";
import { keepProjectDashboard, topUpProjectDashboard } from "./dashboard-keep";

// UAT 2026-10-13, checklist 4.3b (R-50/R-51/R-62): the offline dashboard showed NO money figures because the server's project figures were only kept
// when the dashboard was opened inside the offline shell while online. A person on the normal pages never did. The normal project dashboard page now
// keeps the answer it already fetched, and the background refresh tops it up (at most once per half hour per project).

const NOW = 1_760_000_000_000;
const identity: DurableIdentity = {
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "orgA", role: "pm", lastRefreshAt: NOW, signedInAt: NOW, session: { access_token: "a", refresh_token: "r", expires_at: 1 },
};
const BODY: ProjectDashboardSnapshot = {
  projectId: "p1", progressPercent: 95, percentByValue: 95, contractValue: 5000, budget: 4000, expenses: 1200, delayedTaskCount: 1, taskCount: 9, permitsExpiringCount: 0,
} as ProjectDashboardSnapshot;

let idb: IDBFactory;
const on = () => true;
const shell = (): ShellData => ({ userId: "u1", name: null, email: null, role: "pm", orgId: "orgA", projects: [{ id: "p1", name: "Villa" }], idb });

beforeEach(async () => {
  idb = new IDBFactory();
  localStorage.clear();
  await createIdentityStore({ storage: localStorage, openMeta: () => openDeviceMeta(idb) }).write(identity);
});

describe("the normal dashboard page keeps the server's answer for the offline dashboard", () => {
  test("kept: the offline dashboard's own read finds it, with the time it was fetched, and it is the server's figures untouched", async () => {
    const before = Date.now();
    expect(await keepProjectDashboard("p1", BODY, { idb, localFirstOn: on })).toBe(true);
    const d = await loadDashboard(shell(), "p1", { now: NOW });
    expect(d.snapshot?.body).toEqual(BODY);
    expect(d.snapshot!.fetchedAt).toBeGreaterThanOrEqual(before);
  });

  test("nothing is kept for another project's answer, a malformed one, or when the laptop copy is switched off", async () => {
    expect(await keepProjectDashboard("p2", BODY, { idb, localFirstOn: on })).toBe(false); // the answer is about p1
    expect(await keepProjectDashboard("p1", { projectId: "p1", budget: "lots" }, { idb, localFirstOn: on })).toBe(false);
    expect(await keepProjectDashboard("p1", BODY, { idb, localFirstOn: () => false })).toBe(false);
    expect((await loadDashboard(shell(), "p1", { now: NOW })).snapshot).toBeNull();
  });

  test("no identity on this laptop: nothing is kept (and nothing throws)", async () => {
    localStorage.clear();
    const fresh = new IDBFactory();
    expect(await keepProjectDashboard("p1", BODY, { idb: fresh, localFirstOn: on })).toBe(false);
  });
});

describe("the top-up: one fetch when nothing is kept or it is older than half an hour", () => {
  const answer = (fetched: { n: number }) => (async () => {
    fetched.n += 1;
    return new Response(JSON.stringify(BODY), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;

  test("fetches when nothing is kept, keeps it, and does not fetch again within half an hour; fetches again after", async () => {
    const calls = { n: 0 };
    let clock = Date.now();
    const deps = { idb, localFirstOn: on, fetchImpl: answer(calls), now: () => clock };
    expect(await topUpProjectDashboard("p1", deps)).toBe(true);
    expect(calls.n).toBe(1);
    expect((await loadDashboard(shell(), "p1", { now: NOW })).snapshot?.body).toEqual(BODY);
    clock += 10 * 60_000;
    expect(await topUpProjectDashboard("p1", deps)).toBe(false);
    expect(calls.n).toBe(1);
    clock += 25 * 60_000;
    expect(await topUpProjectDashboard("p1", deps)).toBe(true);
    expect(calls.n).toBe(2);
  });

  test("a struggling server leaves what was kept, and never throws", async () => {
    await snapshotCacheFor({ userId: "u1", role: "pm", idb }).write(projectDashboardSnapshotName("p1"), BODY);
    const failing = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    expect(await topUpProjectDashboard("p1", { idb, localFirstOn: on, fetchImpl: failing, now: () => Date.now() + 3_600_000 })).toBe(false);
    expect((await loadDashboard(shell(), "p1", { now: NOW })).snapshot?.body).toEqual(BODY);
  });
});

describe("the background refresh runs the top-up after syncing the open project", () => {
  const base = { ready: () => true, online: () => true, visible: () => true, syncAll: async () => {}, syncProject: async () => {} };

  test("after a project sync, and after a whole one; not when nothing was due; a failing top-up never fails the refresh", async () => {
    const topped: string[] = [];
    let t = 0;
    const run = createBackgroundRefresh({ ...base, now: () => t, activeProject: () => "p1", topUp: async (p) => { topped.push(p); } });
    expect(await run()).toBe("all");
    expect(topped).toEqual(["p1"]);
    t += 3 * 60_000;
    expect(await run()).toBe("project");
    expect(topped).toEqual(["p1", "p1"]);
    expect(await run()).toBe("skipped"); // too soon: no sync, no top-up
    expect(topped).toHaveLength(2);

    t += 3 * 60_000;
    const failing = createBackgroundRefresh({ ...base, now: () => t, activeProject: () => "p1", topUp: async () => { throw new Error("server down"); } });
    expect(await failing()).toBe("all");
  });
});
