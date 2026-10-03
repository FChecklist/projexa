import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { installRelease } from "./installer";
import { releaseCacheName } from "./release-constants";
import { verifiedInstall, VerifiedInstallError, type VerifiedInstallDeps } from "./verified-install";
import { withInstallLock } from "./install-lock";
import { FakeCacheStorage, FakeMeta, builtRelease, fakeOrigin, fixtureFiles, type BuiltRelease } from "./__fixtures__/fakes";
import type { SwClient } from "./sw-client";

// "Option C" gate (owner decision 2026-10-03): the prepare screen's "app" step is done ONLY when the release is installed with verified digests,
// the worker points at it and controls the page, and persistent storage was asked for. These run the REAL installRelease against fake storage,
// so a gate that skipped verification, or trusted the install result without reading it back, fails here.

const V1 = "2026.10.03-001";
const gz = async (bytes: Uint8Array) => new Uint8Array(gunzipSync(bytes));

function rig(release: BuiltRelease = builtRelease(V1, fixtureFiles(5))) {
  const caches = new FakeCacheStorage();
  const meta = new FakeMeta();
  const origin = fakeOrigin(release);
  const calls: string[] = [];
  const state = { swStarts: true, controls: true, pointer: null as string | null, useReleaseWorks: true, persist: "granted" };
  const sw: SwClient = {
    useRelease: async (version) => { calls.push(`use:${version}`); if (!state.useReleaseWorks) return { ok: false }; state.pointer = version; return { ok: true }; },
    setMode: async () => ({ ok: true }),
    setPerson: async () => ({ ok: true }),
    clearPerson: async () => ({ ok: true }),
    status: async () => ({ ok: true, version: state.pointer }),
  };
  const realInstall = (fetchImpl: typeof fetch = origin.fetch as never) =>
    installRelease({ fetchImpl, caches, meta, gunzip: gz, deviceId: "d1", switchTo: async (v) => { state.pointer = v; } });
  const deps = (over: Partial<VerifiedInstallDeps> = {}): VerifiedInstallDeps => ({
    caches, meta, sw, personId: "u1", localFirstOn: () => true,
    ensureServiceWorker: async () => { calls.push("sw"); return state.swStarts; },
    waitForControl: async () => { calls.push("control"); return state.controls; },
    install: () => { calls.push("install"); return realInstall(); },
    requestPersistence: async () => { calls.push("persist"); return state.persist; },
    ...over,
  });
  return { caches, meta, origin, calls, state, deps, realInstall, run: (over?: Partial<VerifiedInstallDeps>) => verifiedInstall(deps(over)) };
}

const reasonOf = async (p: Promise<unknown>) => {
  try { await p; return null; } catch (e) { return e instanceof VerifiedInstallError ? e.reason : `other:${String(e)}`; }
};

describe("verifiedInstall: the gate behind the prepare screen's 'app' step", () => {
  test("resolves only after a verified install, a controlling worker and a persistence request, in that order", async () => {
    const r = rig();
    const report = await r.run();
    expect(report).toEqual({ version: V1, install: "installed", persistence: "granted" });
    expect(r.calls).toEqual(["sw", "install", "control", "persist"]);
    expect(await r.caches.has(releaseCacheName(V1))).toBe(true);
    expect((r.meta.data.get("app:release") as { version: string }).version).toBe(V1);
  });

  test("a second login on the same browser finds the release already complete and still passes the gate", async () => {
    const r = rig();
    await r.run();
    expect((await r.run()).install).toBe("current");
  });

  test("offline registry / unreachable manifest: fails with manifest_unreachable and nothing is half-installed", async () => {
    const r = rig();
    const down = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    expect(await reasonOf(r.run({ install: () => r.realInstall(down) }))).toBe("manifest_unreachable");
    expect(r.meta.data.get("app:release")).toBeUndefined();
    expect(r.calls).not.toContain("persist");
  });

  test("a corrupted download fails the gate on its digest and leaves no px-release cache", async () => {
    const r = rig();
    r.origin.tamper("bundle", new Uint8Array([1, 2, 3, 4]));
    const reason = await reasonOf(r.run({ install: () => r.realInstall() }));
    expect(["bundle_hash", "bundle_unreadable", "file_hash"]).toContain(reason as string);
    expect(await r.caches.has(releaseCacheName(V1))).toBe(false);
    expect(r.meta.data.get("app:release")).toBeUndefined();
  });

  test("no service worker: fails before touching the network", async () => {
    const r = rig();
    r.state.swStarts = false;
    expect(await reasonOf(r.run())).toBe("no_service_worker");
    expect(r.calls).toEqual(["sw"]);
  });

  test("no Cache Storage: fails", async () => {
    expect(await reasonOf(rig().run({ caches: null }))).toBe("no_cache_storage");
  });

  test("the install result is read back: a 'success' that left no app:release is not trusted", async () => {
    const r = rig();
    const reason = await reasonOf(r.run({ install: async () => ({ status: "installed", version: V1, mode: "full", downloadedFiles: 1, bytes: 1 }) }));
    expect(reason).toBe("release_not_installed");
  });

  test("a cache that went missing after the record was written is caught (cache_incomplete)", async () => {
    const r = rig();
    await r.run();
    await r.caches.delete(releaseCacheName(V1));
    const reason = await reasonOf(r.run({ install: async () => ({ status: "current", version: V1 }) }));
    expect(reason).toBe("cache_incomplete");
  });

  test("a worker that does not take the release pointer fails the gate", async () => {
    const a = rig();
    a.state.useReleaseWorks = false;
    const reason = await reasonOf(
      a.run({
        install: async () => {
          await a.realInstall();
          a.state.pointer = "some-other-release";
          return { status: "installed", version: V1, mode: "full", downloadedFiles: 1, bytes: 1 };
        },
      }),
    );
    expect(reason).toBe("pointer_not_set");
  });

  test("a worker that does not control the page fails the gate, before persistence is asked", async () => {
    const b = rig();
    b.state.controls = false;
    expect(await reasonOf(b.run())).toBe("not_controlling");
    expect(b.calls).not.toContain("persist");
  });

  test("persistence is asked but a refusal does not fail the install", async () => {
    const r = rig();
    r.state.persist = "denied";
    expect((await r.run()).persistence).toBe("denied");
    const again = await r.run({ requestPersistence: async () => { throw new Error("x"); } });
    expect(again.persistence).toBe("denied");
  });
});

describe("withInstallLock", () => {
  test("serialises through the Web Locks manager when there is one, and just runs without it", async () => {
    const seen: string[] = [];
    const locks = { request: async <T,>(name: string, cb: () => Promise<T>) => { seen.push(name); return cb(); } };
    expect(await withInstallLock(async () => 7, locks)).toBe(7);
    expect(seen).toEqual(["px-release-install"]);
    expect(await withInstallLock(async () => 8, null)).toBe(8);
  });
});
