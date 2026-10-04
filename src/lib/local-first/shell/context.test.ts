import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import { MANIFEST_KEY, type StoredManifest } from "../replica";
import type { DurableIdentity } from "../identity";
import type { SyncClient, SyncManifest } from "../sync-client";
import { FakeMeta } from "../release/__fixtures__/fakes";
import { buildShellData, chooseProject, projectLabel, readShellData, selectedProjectKey } from "./context";
import { readShellManifest, refreshShellManifest, shellManifestKey, toShellManifest } from "./manifest-cache";

const NOW = 1_760_000_000_000;

const identity = (over: Partial<DurableIdentity> = {}): DurableIdentity => ({
  userId: "u1", email: "asha@example.com", name: "Asha Rao", orgId: "org-from-identity", role: "pm", lastRefreshAt: NOW, signedInAt: NOW, session: null, ...over,
});
const replica = (over: Partial<StoredManifest> = {}): StoredManifest => ({ userId: "u1", orgId: "org-1", projectIds: ["p1", "p2"], kinds: ["boq_lines"], at: NOW, ...over });
const names = (over: Partial<ReturnType<typeof toShellManifest>> = {}) => ({
  at: NOW, user: { id: "u1", name: "Asha R.", role: "owner", org_id: "org-1" },
  projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }, { id: "p2", name: null, status: null }], ...over,
});

describe("the shell's data comes from this laptop", () => {
  test("the project list is the replica's, the names are the cached manifest's, an unnamed project is still tellable apart", () => {
    const data = buildShellData({ identity: identity(), replica: replica(), names: names() });
    expect(data.projects).toEqual([{ id: "p1", name: "Cedar Heights Villa" }, { id: "p2", name: "Project p2" }]);
    expect(data.orgId).toBe("org-1"); // the replica's organisation wins
    expect(data).toMatchObject({ userId: "u1", email: "asha@example.com", name: "Asha Rao", role: "pm" });
    expect(projectLabel("0123456789abcdef", "  ")).toBe("Project 01234567");
  });

  test("without a replica manifest yet, the cached manifest names the projects; with neither there are none", () => {
    expect(buildShellData({ identity: identity(), replica: null, names: names() }).projects.map((p) => p.id)).toEqual(["p1", "p2"]);
    const none = buildShellData({ identity: identity(), replica: null, names: null });
    expect(none.projects).toEqual([]);
    expect(none.orgId).toBe("org-from-identity");
  });

  test("a manifest that belongs to ANOTHER person contributes nothing: two people on one laptop never see each other's projects", () => {
    const data = buildShellData({ identity: identity(), replica: replica({ userId: "someone-else", projectIds: ["x"] }), names: names({ user: { id: "someone-else", name: "X", role: "r", org_id: "o" } }) });
    expect(data.projects).toEqual([]);
    expect(data.name).toBe("Asha Rao");
  });

  test("readShellData reads the replica manifest from THIS person's database and the names from the device meta", async () => {
    const idb = new IDBFactory();
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    await db.setMeta(MANIFEST_KEY, replica());
    db.close();
    const other = await openLocalDb(idb, localDbNameFor("u2"));
    await other.setMeta(MANIFEST_KEY, replica({ userId: "u2", projectIds: ["theirs"] }));
    other.close();
    const deviceMeta = new FakeMeta();
    deviceMeta.data.set(shellManifestKey("u1"), names());
    const data = await readShellData({ identity: identity(), deviceMeta, idb });
    expect(data.projects.map((p) => p.name)).toEqual(["Cedar Heights Villa", "Project p2"]);
    expect(data.projects.some((p) => p.id === "theirs")).toBe(false);
  });

  test("a laptop that has copied nothing yet reads as no projects, not as an error", async () => {
    const data = await readShellData({ identity: identity(), deviceMeta: new FakeMeta(), idb: new IDBFactory() });
    expect(data.projects).toEqual([]);
  });

  test("the selected project: the URL's, else the remembered, else the first -- and only one this person has", () => {
    const projects = [{ id: "p1", name: "A" }, { id: "p2", name: "B" }];
    expect(chooseProject(projects, "p2", "p1")).toBe("p2");
    expect(chooseProject(projects, null, "p2")).toBe("p2");
    expect(chooseProject(projects, null, null)).toBe("p1");
    expect(chooseProject(projects, "someone-elses", "also-not-mine")).toBe("p1");
    expect(chooseProject([], "p1", "p1")).toBeNull();
    expect(selectedProjectKey("u1")).toBe("px-shell-project:u1");
  });
});

describe("the cached manifest (names, role, organisation), refreshed at most daily", () => {
  const sync = (over: Partial<SyncManifest> = {}): SyncManifest => ({
    user: { id: "u1", name: "Asha Rao", role: "pm", org_id: "org-1" },
    projects: [{ id: "p1", name: "Cedar Heights Villa", status: "active" }],
    kinds: [],
    ...over,
  });
  const client = (impl: () => Promise<SyncManifest>): Pick<SyncClient, "manifest"> & { calls: number } => {
    const c = { calls: 0, manifest: async () => { c.calls += 1; return impl(); } };
    return c;
  };

  test("a missing record is fetched and stored; a fresh one is not fetched again", async () => {
    const meta = new FakeMeta();
    const c = client(async () => sync());
    const first = await refreshShellManifest({ client: c, meta, userId: "u1", now: () => NOW });
    expect(first.result).toBe("refreshed");
    expect((await readShellManifest(meta, "u1"))!.projects[0]).toEqual({ id: "p1", name: "Cedar Heights Villa", status: "active" });
    const second = await refreshShellManifest({ client: c, meta, userId: "u1", now: () => NOW + 3_600_000 });
    expect(second.result).toBe("fresh");
    expect(c.calls).toBe(1);
    const third = await refreshShellManifest({ client: c, meta, userId: "u1", now: () => NOW + 25 * 3_600_000 });
    expect(third.result).toBe("refreshed");
    expect(c.calls).toBe(2);
    expect((await refreshShellManifest({ client: c, meta, userId: "u1", now: () => NOW + 25 * 3_600_000, force: true })).result).toBe("refreshed");
  });

  test("a failure keeps the old record and never throws", async () => {
    const meta = new FakeMeta();
    await refreshShellManifest({ client: client(async () => sync()), meta, userId: "u1", now: () => NOW });
    const failed = await refreshShellManifest({ client: client(async () => { throw new Error("server down"); }), meta, userId: "u1", now: () => NOW + 48 * 3_600_000 });
    expect(failed.result).toBe("failed");
    expect(failed.manifest!.projects).toHaveLength(1);
  });

  test("a manifest for a different person is never stored under this person", async () => {
    const meta = new FakeMeta();
    const result = await refreshShellManifest({ client: client(async () => sync({ user: { id: "someone-else", org_id: "o" } })), meta, userId: "u1", now: () => NOW });
    expect(result.result).toBe("failed");
    expect(await readShellManifest(meta, "u1")).toBeNull();
  });

  test("a damaged record reads as absent", async () => {
    const meta = new FakeMeta();
    meta.data.set(shellManifestKey("u1"), { at: "yesterday" });
    expect(await readShellManifest(meta, "u1")).toBeNull();
    meta.data.set(shellManifestKey("u1"), { at: NOW, user: { id: "u2" }, projects: [] });
    expect(await readShellManifest(meta, "u1")).toBeNull();
  });
});
