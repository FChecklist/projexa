import { GlobalRegistrator } from "@happy-dom/global-registrator";
// Registering twice in one process throws, and `bun test` runs every file in ONE process.
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook } from "@testing-library/react";
import { gunzipSync } from "node:zlib";
import {
  createInstallPrompt,
  ensurePersistence,
  ensureWorkspaceData,
  runLocalFirstBoot,
  useInstallPrompt,
  type BootDeps,
  type PersistState,
} from "./persistence";
import { META_KEYS, releaseCacheName } from "./release/release-constants";
import type { InstalledRelease } from "./release/installer";
import type { ReleaseClient } from "./release/release-client";
import type { SwClient, SwReply } from "./release/sw-client";
import { FakeCacheStorage, FakeMeta, builtRelease, fakeOrigin, fixtureFiles } from "./release/__fixtures__/fakes";

afterEach(cleanup);

const V1 = "2026.10.02-001";
const V2 = "2026.10.03-002";
const NOW = 1_760_000_000_000;

// ─── 1. persistent storage ──────────────────────────────────────────────────────────────────────

function storageManager(opts: { persisted?: boolean; grant?: boolean; throws?: boolean } = {}) {
  const calls = { persist: 0, persisted: 0 };
  return {
    calls,
    manager: {
      persisted: async () => { calls.persisted += 1; return opts.persisted ?? false; },
      persist: async () => { calls.persist += 1; if (opts.throws) throw new Error("denied by policy"); return opts.grant ?? true; },
    },
  };
}

describe("navigator.storage.persist() is requested once and the outcome recorded", () => {
  test("first run: requested, granted, recorded in the meta store", async () => {
    const meta = new FakeMeta();
    const { manager, calls } = storageManager({ grant: true });
    expect(await ensurePersistence({ storage: manager, meta, now: () => NOW })).toBe("granted");
    expect(calls.persist).toBe(1);
    expect(meta.data.get(META_KEYS.persistence)).toEqual({ requestedAt: NOW, granted: true, reason: "start", reRequestedAfterInstall: false } satisfies PersistState);
  });

  test("every later start: NOT asked again (Firefox would prompt the person each time), whatever the first answer was", async () => {
    for (const grant of [true, false]) {
      const meta = new FakeMeta();
      const first = storageManager({ grant });
      await ensurePersistence({ storage: first.manager, meta, now: () => NOW });
      const later = storageManager({ grant: true });
      for (let i = 0; i < 3; i += 1) expect(await ensurePersistence({ storage: later.manager, meta })).toBe("already_requested");
      expect(later.calls.persist).toBe(0);
    }
  });

  test("denied is recorded as denied; a persist() that throws is a denial, not an error", async () => {
    const denied = new FakeMeta();
    expect(await ensurePersistence({ storage: storageManager({ grant: false }).manager, meta: denied, now: () => NOW })).toBe("denied");
    expect((denied.data.get(META_KEYS.persistence) as PersistState).granted).toBe(false);
    const thrown = new FakeMeta();
    expect(await ensurePersistence({ storage: storageManager({ throws: true }).manager, meta: thrown })).toBe("denied");
  });

  test("storage that is already persistent is recorded and persist() is not called", async () => {
    const meta = new FakeMeta();
    const { manager, calls } = storageManager({ persisted: true });
    expect(await ensurePersistence({ storage: manager, meta, now: () => NOW })).toBe("already_persistent");
    expect(calls.persist).toBe(0);
    expect((meta.data.get(META_KEYS.persistence) as PersistState).granted).toBe(true);
  });

  test("after the app is installed it is asked ONE more time, and no more", async () => {
    const meta = new FakeMeta();
    await ensurePersistence({ storage: storageManager({ grant: false }).manager, meta, now: () => NOW });
    const again = storageManager({ grant: true });
    expect(await ensurePersistence({ storage: again.manager, meta, now: () => NOW + 1 }, "installed")).toBe("granted");
    expect(await ensurePersistence({ storage: again.manager, meta }, "installed")).toBe("already_requested");
    expect(again.calls.persist).toBe(1);
    expect(meta.data.get(META_KEYS.persistence)).toMatchObject({ granted: true, requestedAt: NOW, reason: "installed", reRequestedAfterInstall: true });
  });

  test("a browser without the API is simply 'unsupported'", async () => {
    expect(await ensurePersistence({ storage: undefined, meta: new FakeMeta() })).toBe("unsupported");
    expect(await ensurePersistence({ storage: {}, meta: new FakeMeta() })).toBe("unsupported");
  });
});

// ─── 2. the install prompt ──────────────────────────────────────────────────────────────────────

function installEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  const calls = { prompt: 0 };
  Object.assign(event, { prompt: async () => { calls.prompt += 1; }, userChoice: Promise.resolve({ outcome }) });
  return { event, calls };
}

describe("the install-as-an-app prompt is captured and offered as ONE calm action", () => {
  test("beforeinstallprompt is captured (the browser's own bar is suppressed) and canInstall turns on", () => {
    const target = new EventTarget();
    const prompt = createInstallPrompt();
    prompt.attach(target);
    expect(prompt.get()).toEqual({ canInstall: false, installed: false });
    const { event } = installEvent();
    target.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(prompt.get()).toEqual({ canInstall: true, installed: false });
  });

  test("install() shows the browser's dialog once, records the answer, and the offer goes away", async () => {
    const target = new EventTarget();
    const meta = new FakeMeta();
    const prompt = createInstallPrompt({ meta, now: () => NOW });
    prompt.attach(target);
    const { event, calls } = installEvent("accepted");
    target.dispatchEvent(event);
    expect(await prompt.install()).toBe("accepted");
    expect(calls.prompt).toBe(1);
    expect(meta.data.get("install:prompt")).toEqual({ outcome: "accepted", at: NOW });
    expect(prompt.get().canInstall).toBe(false);
    expect(await prompt.install()).toBe("unavailable"); // a deferred prompt works once
    expect(calls.prompt).toBe(1);
  });

  test("a dismissed dialog is recorded as dismissed and never nags: no second offer until the browser fires the event again", async () => {
    const target = new EventTarget();
    const prompt = createInstallPrompt();
    prompt.attach(target);
    target.dispatchEvent(installEvent("dismissed").event);
    expect(await prompt.install()).toBe("dismissed");
    expect(prompt.get().canInstall).toBe(false);
  });

  test("appinstalled marks it installed, withdraws the offer and runs the follow-up (a second persist() request)", () => {
    const target = new EventTarget();
    let followUps = 0;
    const prompt = createInstallPrompt({ onInstalled: () => { followUps += 1; } });
    prompt.attach(target);
    target.dispatchEvent(installEvent().event);
    target.dispatchEvent(new Event("appinstalled"));
    expect(prompt.get()).toEqual({ canInstall: false, installed: true });
    expect(followUps).toBe(1);
  });

  test("already running as an installed app: never offered", () => {
    const target = new EventTarget();
    const prompt = createInstallPrompt({ isStandalone: () => true });
    prompt.attach(target);
    target.dispatchEvent(installEvent().event);
    expect(prompt.get()).toEqual({ canInstall: false, installed: true });
  });

  test("listeners are told only about real changes, and detaching stops capture", () => {
    const target = new EventTarget();
    const prompt = createInstallPrompt();
    const detach = prompt.attach(target);
    let heard = 0;
    prompt.subscribe(() => { heard += 1; });
    target.dispatchEvent(installEvent().event);
    target.dispatchEvent(installEvent().event); // a second event changes nothing visible
    expect(heard).toBe(1);
    detach();
    const late = installEvent();
    target.dispatchEvent(late.event);
    expect(late.event.defaultPrevented).toBe(false);
  });

  test("the hook follows the controller", async () => {
    const target = new EventTarget();
    const prompt = createInstallPrompt();
    prompt.attach(target);
    const { result } = renderHook(() => useInstallPrompt(prompt));
    expect(result.current.canInstall).toBe(false);
    act(() => { target.dispatchEvent(installEvent().event); });
    expect(result.current.canInstall).toBe(true);
    await act(async () => { await result.current.install(); });
    expect(result.current.canInstall).toBe(false);
  });
});

// ─── 3. the release is back if its cache went missing ──────────────────────────────────────────

class FakeSw implements SwClient {
  pointer: { version: string; personId: string | null; localFirst: boolean } | null = null;
  calls: string[] = [];
  constructor(private caches: FakeCacheStorage) {}
  async useRelease(version: string, personId?: string | null, localFirst?: boolean): Promise<SwReply | null> {
    this.calls.push(`use:${version}:${personId ?? "-"}:${localFirst}`);
    if (!(await this.caches.has(releaseCacheName(version)))) return { ok: false, error: "no_cache" };
    this.pointer = { version, personId: personId ?? this.pointer?.personId ?? null, localFirst: localFirst ?? this.pointer?.localFirst ?? false };
    return { ok: true };
  }
  async setMode(localFirst: boolean): Promise<SwReply | null> { this.calls.push(`mode:${localFirst}`); if (this.pointer) this.pointer.localFirst = localFirst; return { ok: true }; }
  async setPerson(personId: string): Promise<SwReply | null> { this.calls.push(`person:${personId}`); if (this.pointer) this.pointer.personId = personId; return { ok: true }; }
  async clearPerson(): Promise<SwReply | null> { return { ok: true }; }
  async status(): Promise<SwReply | null> { this.calls.push("status"); return { ok: true, version: this.pointer?.version ?? null, personId: this.pointer?.personId ?? null, localFirst: this.pointer?.localFirst ?? false }; }
}

function boot(over: Partial<BootDeps> = {}) {
  const release = builtRelease(V1, fixtureFiles(5));
  const caches = new FakeCacheStorage();
  const meta = new FakeMeta();
  const origin = fakeOrigin(release);
  const sw = new FakeSw(caches);
  const state = { online: true, localFirst: false, now: NOW };
  const deps = (): BootDeps => ({
    isDevelopment: false,
    isOnline: () => state.online,
    meta,
    caches,
    sw,
    ensureServiceWorker: async () => true,
    personId: "person-1",
    localFirstOn: () => state.localFirst,
    fetchImpl: origin.fetch,
    gunzip: async (b) => new Uint8Array(gunzipSync(b)),
    now: () => state.now,
    random: () => "device-xyz-123",
    ...over,
  });
  return { release, caches, meta, origin, sw, state, deps, run: () => runLocalFirstBoot(deps()) };
}

describe("runLocalFirstBoot: the release is installed, kept, and brought back if its cache goes missing", () => {
  test("a development server never touches any of it", async () => {
    const t = boot({ isDevelopment: true });
    expect((await t.run()).skipped).toBe("development");
    expect(t.origin.requests).toEqual([]);
  });

  test("no Cache Storage, or no service worker: skipped, nothing fetched", async () => {
    const a = boot({ caches: null });
    expect((await a.run()).skipped).toBe("no_cache_storage");
    const b = boot({ ensureServiceWorker: async () => false });
    expect((await b.run()).skipped).toBe("no_service_worker");
    expect(b.origin.requests).toEqual([]);
  });

  test("first start online: the release is installed, the worker is pointed at it for this person and the current mode", async () => {
    const t = boot();
    t.state.localFirst = true;
    const report = await t.run();
    expect(report.release).toMatchObject({ status: "installed", version: V1 });
    expect(t.sw.pointer).toEqual({ version: V1, personId: "person-1", localFirst: true });
    expect(await t.caches.has(releaseCacheName(V1))).toBe(true);
    expect((t.meta.data.get(META_KEYS.release) as InstalledRelease).version).toBe(V1);
    expect(t.meta.data.get(META_KEYS.device)).toBe("device-xyz-123");
  });

  test("SILENT RE-INSTALL: the cache went missing, the person is online -> the release is installed again, with no question asked", async () => {
    const t = boot({ checkEveryMs: 10 * 24 * 60 * 60 * 1000 });
    await t.run();
    await t.caches.delete(releaseCacheName(V1)); // the browser evicted it, or the user cleared site data
    t.sw.pointer = null;
    t.origin.requests.length = 0;
    const report = await t.run();
    expect(report.release).toMatchObject({ status: "updated", version: V1, mode: "full" });
    expect(await t.caches.has(releaseCacheName(V1))).toBe(true);
    expect(t.sw.pointer?.version).toBe(V1);
    expect(t.origin.requests).toContain(`/${t.release.manifest.bundle.path}`);
  });

  test("the cache is missing but the laptop is OFFLINE: nothing is requested, nothing breaks; it happens when the laptop is back online", async () => {
    const t = boot();
    await t.run();
    await t.caches.delete(releaseCacheName(V1));
    t.state.online = false;
    t.origin.requests.length = 0;
    const report = await t.run();
    expect(report.release).toBeNull();
    expect(t.origin.requests).toEqual([]);
    t.state.online = true;
    expect((await t.run()).release).toMatchObject({ status: "updated" });
  });

  test("an installed, complete release is not looked at again for six hours (cost: one small request, not one per page)", async () => {
    const t = boot();
    await t.run();
    t.origin.requests.length = 0;
    t.state.now += 60 * 60 * 1000; // an hour later
    expect((await t.run()).release).toBeNull();
    expect(t.origin.requests).toEqual([]);
    t.state.now += 6 * 60 * 60 * 1000;
    expect((await t.run()).release).toEqual({ status: "current", version: V1 });
    expect(t.origin.requests).toEqual(["/_release/release.json"]);
  });

  test("a newer release is picked up when the check comes due", async () => {
    const t = boot();
    await t.run();
    t.origin.serve(builtRelease(V2, fixtureFiles(5).map((f, i) => (i === 0 ? { ...f, text: "changed" } : f))));
    t.state.now += 7 * 60 * 60 * 1000;
    const report = await t.run();
    expect(report.release).toMatchObject({ status: "updated", version: V2, mode: "partial", downloadedFiles: 1 });
    expect(t.sw.pointer?.version).toBe(V2);
    expect([...t.caches.caches.keys()]).toEqual([releaseCacheName(V2)]);
  });

  test("a failed install is reported, keeps the old release, and is retried at the next start", async () => {
    const t = boot();
    await t.run();
    t.origin.serve(builtRelease(V2, fixtureFiles(5, "v2")));
    t.origin.tamper("bundle", new Uint8Array([1]));
    t.state.now += 7 * 60 * 60 * 1000;
    expect((await t.run()).release).toMatchObject({ status: "failed", reason: "bundle_hash" });
    expect(t.sw.pointer?.version).toBe(V1);
    t.origin.serve(builtRelease(V2, fixtureFiles(5, "v2")));
    t.state.now += 60_000;
    expect((await t.run()).release).toMatchObject({ status: "updated", version: V2 }); // the failed check did not count as a check
  });

  test("the worker's pointer is repaired when it was cleared (even offline), and follows the person and the mode", async () => {
    const t = boot();
    await t.run();
    t.sw.pointer = null; // the worker lost its record
    t.state.online = false;
    t.sw.calls.length = 0;
    expect((await t.run()).pointerFixed).toBe(true);
    expect(t.sw.pointer?.version).toBe(V1);
    t.state.localFirst = true;
    expect((await t.run()).modeSynced).toBe(true);
    expect(t.sw.pointer?.localFirst).toBe(true);
    // another person signed in on this laptop: the pointer is handed to them
    const other = boot();
    await other.run();
    other.sw.pointer!.personId = "someone-else";
    const report = await runLocalFirstBoot({ ...other.deps(), personId: "person-2" });
    expect(report.pointerFixed).toBe(true);
    expect(other.sw.pointer?.personId).toBe("person-2");
  });

  test("a pointer with no person yet gets one", async () => {
    const t = boot({ personId: null });
    await t.run();
    expect(t.sw.pointer?.personId).toBeNull();
    const report = await runLocalFirstBoot({ ...t.deps(), personId: "person-1" });
    expect(report.pointerFixed).toBe(true);
    expect(t.sw.pointer?.personId).toBe("person-1");
  });

  test("with a registry: it is asked to register, the install is recorded, and records that could not be sent are delivered later", async () => {
    const sent: string[] = [];
    let accept = false;
    const registry = {
      current: async () => null,
      register: async () => true,
      ensureRegistered: async () => null,
      recordInstall: async (r: { status: string }) => { if (accept) { sent.push(r.status); return true; } return false; },
    } as unknown as ReleaseClient;
    const t = boot({ registry });
    await t.run(); // recording fails: kept
    expect((t.meta.data.get(META_KEYS.installPending) as unknown[]).length).toBe(1);
    accept = true;
    t.state.now += 7 * 60 * 60 * 1000;
    const report = await t.run();
    expect(report.installsFlushed).toBe(1);
    expect(sent).toEqual(["installed"]);
  });
});

// ─── 4. the person's data is back if IndexedDB lost it ─────────────────────────────────────────

describe("ensureWorkspaceData: the workspace re-download when IndexedDB lost the data", () => {
  function deps(over: Partial<Parameters<typeof ensureWorkspaceData>[0]> = {}) {
    const calls = { redownload: 0 };
    return {
      calls,
      deps: {
        isOnline: () => true,
        wasPrepared: () => true,
        hasData: async () => false,
        redownload: async () => { calls.redownload += 1; return { status: "done" }; },
        budgetMs: 1000,
        ...over,
      },
    };
  }

  test("prepared before, data gone, online: the existing workspace download runs again", async () => {
    const { calls, deps: d } = deps();
    expect(await ensureWorkspaceData(d)).toBe("redownloaded");
    expect(calls.redownload).toBe(1);
  });

  test("offline: nothing is attempted", async () => {
    const { calls, deps: d } = deps({ isOnline: () => false });
    expect(await ensureWorkspaceData(d)).toBe("not_online");
    expect(calls.redownload).toBe(0);
  });

  test("never prepared on this laptop: left to the first-run 'Preparing your workspace' screen", async () => {
    const { calls, deps: d } = deps({ wasPrepared: () => false });
    expect(await ensureWorkspaceData(d)).toBe("never_prepared");
    expect(calls.redownload).toBe(0);
  });

  test("data still there, or impossible to tell: no download is started", async () => {
    const present = deps({ hasData: async () => true });
    expect(await ensureWorkspaceData(present.deps)).toBe("present");
    const unknown = deps({ hasData: async () => { throw new Error("idb blocked"); } });
    expect(await ensureWorkspaceData(unknown.deps)).toBe("present");
    expect(present.calls.redownload + unknown.calls.redownload).toBe(0);
  });

  test("a download that does not finish is 'failed', not an exception", async () => {
    const partial = deps({ redownload: async () => ({ status: "partial" }) });
    expect(await ensureWorkspaceData(partial.deps)).toBe("failed");
    const thrown = deps({ redownload: async () => { throw new Error("network"); } });
    expect(await ensureWorkspaceData(thrown.deps)).toBe("failed");
  });
});
