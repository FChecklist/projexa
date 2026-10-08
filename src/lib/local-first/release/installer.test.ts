import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { SHELL_FILE_PATH as SCRIPT_SHELL_FILE_PATH } from "../../../../scripts/make-release.mjs";
import {
  applyRegistryNumbers,
  flushPendingInstalls,
  getDeviceId,
  installRelease,
  installedCacheMissing,
  manifestDigestOk,
  parseManifest,
  type AppFileTable,
  type InstalledRelease,
  type InstallerDeps,
} from "./installer";
import { META_KEYS, SHELL_FILE_PATH, contentTypeFor, releaseCacheName, urlForReleasePath } from "./release-constants";
import type { InstallRecord, RegistryRelease } from "./release-client";
import { FakeCacheStorage, FakeMeta, builtRelease, fakeOrigin, fixtureFiles, resign, type BuiltRelease } from "./__fixtures__/fakes";

const V1 = "2026.10.02-001";
const V2 = "2026.10.03-002";
const sleepless = async (bytes: Uint8Array) => new Uint8Array(gunzipSync(bytes));

type Harness = ReturnType<typeof harness>;

function harness(initial: BuiltRelease) {
  const caches = new FakeCacheStorage();
  const meta = new FakeMeta();
  const origin = fakeOrigin(initial);
  const switched: string[] = [];
  const records: InstallRecord[] = [];
  let sendOk = true;
  let clock = Date.parse("2026-10-02T10:00:00Z");
  const state = {
    switchError: null as Error | null,
    registry: null as RegistryRelease | null,
  };
  const deps = (): InstallerDeps => ({
    fetchImpl: origin.fetch,
    caches,
    meta,
    now: () => (clock += 1000),
    gunzip: sleepless,
    deviceId: "device-1",
    switchTo: async (version) => {
      if (state.switchError) throw state.switchError;
      switched.push(version);
    },
    registry: async () => state.registry,
    recordInstall: async (r) => {
      records.push(r);
      return sendOk;
    },
  });
  return {
    caches, meta, origin, switched, records, state,
    deps,
    install: () => installRelease(deps()),
    setSendOk: (ok: boolean) => { sendOk = ok; },
  };
}

const installedRelease = (h: Harness) => h.meta.data.get(META_KEYS.release) as InstalledRelease | null;
const fileTable = (h: Harness) => h.meta.data.get(META_KEYS.files) as AppFileTable | null;
const cacheText = async (h: Harness, version: string, path: string) => {
  const hit = await h.caches.caches.get(releaseCacheName(version))?.match(urlForReleasePath(path));
  return hit ? await hit.text() : undefined;
};

describe("fresh install from the one bundle", () => {
  test("verifies and writes every file into px-release-<version>, stores app:release and the file table, switches, records the install", async () => {
    const files = [...fixtureFiles(6), { path: "logo-mark.svg", text: "<svg/>" }, { path: SHELL_FILE_PATH, text: "<html>shell</html>" }];
    const release = builtRelease(V1, files);
    const h = harness(release);
    const result = await h.install();

    expect(result).toEqual({ status: "installed", version: V1, mode: "full", downloadedFiles: 8, bytes: release.manifest.bundle.size });
    // every file, byte for byte, under the URL the browser asks for (the shell under /local)
    const cache = h.caches.caches.get(releaseCacheName(V1))!;
    expect(cache.entries.size).toBe(8);
    expect(await cacheText(h, V1, "_next/static/chunks/file-03.js")).toBe(new TextDecoder().decode(release.files.get("_next/static/chunks/file-03.js")));
    expect(await cacheText(h, V1, SHELL_FILE_PATH)).toBe("<html>shell</html>");
    expect([...cache.entries.keys()]).toContain("/local");
    // the content type is right, so a cached script still runs
    expect(cache.entries.get("/_next/static/chunks/file-00.js")!.headers).toContainEqual(["content-type", "text/javascript; charset=utf-8"]);
    expect(cache.entries.get("/logo-mark.svg")!.headers).toContainEqual(["content-type", "image/svg+xml"]);
    // app:release
    const rel = installedRelease(h)!;
    expect(rel).toMatchObject({ version: V1, manifest_sha256: release.manifest.manifest_sha256, git_sha: "abc123", protocol: 2, schema: 3, files: 8, mode: "full" });
    expect(rel.installed_at >= rel.downloaded_at).toBe(true);
    // the file table
    const table = fileTable(h)!;
    expect(table.version).toBe(V1);
    expect(table.rows.map((r) => r.path)).toEqual(release.manifest.files.map((f) => f.path));
    expect(table.rows[0]).toEqual({ path: release.manifest.files[0]!.path, file_no: null, file_version: null, sha256: release.manifest.files[0]!.sha256, size: release.manifest.files[0]!.size, version: V1 });
    // the switch and the record
    expect(h.switched).toEqual([V1]);
    expect(h.records).toHaveLength(1);
    expect(h.records[0]).toMatchObject({ device_id: "device-1", release_version: V1, manifest_sha256: release.manifest.manifest_sha256, previous_release: null, status: "installed", files: 8, bytes: release.manifest.bundle.size });
  });

  test("the install requests reach the network, not the service worker's cache (X-Px-Install, no-store)", async () => {
    const h = harness(builtRelease(V1, fixtureFiles(3)));
    await h.install();
    expect(h.origin.inits.length).toBeGreaterThan(0);
    for (const init of h.origin.inits) {
      expect((init.headers as Record<string, string>)["X-Px-Install"]).toBe("1");
      expect(init.cache).toBe("no-store");
    }
  });

  test("the registry's file numbers and versions are stored when it has numbered THIS release", async () => {
    const release = builtRelease(V1, fixtureFiles(3));
    const h = harness(release);
    h.state.registry = {
      release_version: V1,
      manifest_sha256: release.manifest.manifest_sha256,
      built_at: release.manifest.built_at,
      files: release.manifest.files.map((f, i) => ({ path: f.path, file_no: 100 + i, file_version: 2, sha256: f.sha256, size: f.size })),
    };
    await h.install();
    expect(fileTable(h)!.rows.map((r) => [r.file_no, r.file_version])).toEqual([[100, 2], [101, 2], [102, 2]]);
  });

  test("a registry that has not numbered it yet leaves them null, and applyRegistryNumbers fills them in later (never for another release)", async () => {
    const release = builtRelease(V1, fixtureFiles(2));
    const h = harness(release);
    await h.install();
    expect(fileTable(h)!.rows.every((r) => r.file_no === null)).toBe(true);
    const other = builtRelease(V2, fixtureFiles(2, "other"));
    const wrong: RegistryRelease = { release_version: V2, manifest_sha256: other.manifest.manifest_sha256, built_at: "", files: other.manifest.files.map((f, i) => ({ ...f, file_no: i + 1, file_version: 1 })) };
    expect(await applyRegistryNumbers(h.meta, wrong)).toBe(false);
    const right: RegistryRelease = { release_version: V1, manifest_sha256: release.manifest.manifest_sha256, built_at: "", files: release.manifest.files.map((f, i) => ({ ...f, file_no: 7 + i, file_version: 3 })) };
    expect(await applyRegistryNumbers(h.meta, right)).toBe(true);
    expect(fileTable(h)!.rows.map((r) => [r.file_no, r.file_version])).toEqual([[7, 3], [8, 3]]);
    expect(await applyRegistryNumbers(h.meta, right)).toBe(false); // already applied
    expect(await applyRegistryNumbers(h.meta, null)).toBe(false);
  });

  test("installing the release that is already installed and complete does nothing but read the manifest", async () => {
    const h = harness(builtRelease(V1, fixtureFiles(4)));
    await h.install();
    const before = h.origin.requests.length;
    const again = await h.install();
    expect(again).toEqual({ status: "current", version: V1 });
    expect(h.origin.requests.slice(before)).toEqual(["/_release/release.json"]);
    expect(h.switched).toEqual([V1]);
    expect(h.records).toHaveLength(1);
  });

  test("an installed release whose cache was emptied is reinstalled (the cache is the truth, not the meta)", async () => {
    const h = harness(builtRelease(V1, fixtureFiles(4)));
    await h.install();
    await h.caches.delete(releaseCacheName(V1));
    expect(await installedCacheMissing({ caches: h.caches, meta: h.meta })).toBe(true);
    const again = await h.install();
    expect(again).toMatchObject({ status: "updated", version: V1, mode: "full" });
    expect(await installedCacheMissing({ caches: h.caches, meta: h.meta })).toBe(false);
  });
});

describe("a failed verification switches NOTHING and keeps the old release", () => {
  async function withV1() {
    const h = harness(builtRelease(V1, fixtureFiles(6, "v1")));
    await h.install();
    const snapshot = {
      release: structuredClone(installedRelease(h)),
      table: structuredClone(fileTable(h)),
      cacheNames: [...h.caches.caches.keys()],
      v1Entries: [...h.caches.caches.get(releaseCacheName(V1))!.entries.keys()],
      switched: [...h.switched],
    };
    return { h, snapshot };
  }

  function expectUntouched(h: Harness, snapshot: Awaited<ReturnType<typeof withV1>>["snapshot"]) {
    expect(installedRelease(h)).toEqual(snapshot.release);
    expect(fileTable(h)).toEqual(snapshot.table);
    expect([...h.caches.caches.keys()]).toEqual(snapshot.cacheNames); // no px-release-V2, V1 still there
    expect([...h.caches.caches.get(releaseCacheName(V1))!.entries.keys()]).toEqual(snapshot.v1Entries);
    expect(h.switched).toEqual(snapshot.switched);
  }

  test("a bundle whose bytes do not match the manifest's sha256", async () => {
    const { h, snapshot } = await withV1();
    const v2 = builtRelease(V2, fixtureFiles(6, "v2"));
    h.origin.serve(v2);
    const damaged = new Uint8Array(v2.bundle);
    damaged[damaged.length - 20] = damaged[damaged.length - 20]! ^ 0xff;
    h.origin.tamper("bundle", damaged);
    const result = await h.install();
    expect(result).toMatchObject({ status: "failed", version: V2, reason: "bundle_hash" });
    expectUntouched(h, snapshot);
    expect(h.records.at(-1)).toMatchObject({ status: "failed", release_version: V2, previous_release: V1 });
    expect(h.records.at(-1)!.error).toContain("bundle_hash");
    expect(h.meta.data.get(META_KEYS.releaseFailure)).toMatchObject({ version: V2, reason: "bundle_hash" });
  });

  test("a file inside a good bundle that does not match its own manifest entry", async () => {
    const { h, snapshot } = await withV1();
    const good = builtRelease(V2, fixtureFiles(6, "v2"));
    // a build whose manifest lists a different sha for one file than the bundle holds (and a correct digest over that lie)
    const forged = resign({ ...good.manifest, files: good.manifest.files.map((f, i) => (i === 2 ? { ...f, sha256: "0".repeat(64) } : f)) });
    h.origin.serve({ ...good, manifest: forged });
    const result = await h.install();
    expect(result).toMatchObject({ status: "failed", reason: "file_hash" });
    expectUntouched(h, snapshot);
  });

  test("a manifest that does not match its own digest", async () => {
    const { h, snapshot } = await withV1();
    const v2 = builtRelease(V2, fixtureFiles(6, "v2"));
    const doctored = { ...v2.manifest, files: v2.manifest.files.map((f, i) => (i === 0 ? { ...f, size: f.size + 1 } : f)) };
    h.origin.serve({ ...v2, manifest: doctored });
    expect(await manifestDigestOk(doctored)).toBe(false);
    const result = await h.install();
    expect(result).toMatchObject({ status: "failed", reason: "manifest_digest" });
    expectUntouched(h, snapshot);
  });

  test("a manifest that is not the contract's shape, an unreachable manifest, an unreachable bundle", async () => {
    const { h, snapshot } = await withV1();
    const v2 = builtRelease(V2, fixtureFiles(6, "v2"));
    h.origin.serve({ ...v2, manifest: { ...v2.manifest, files: [] } });
    expect(await h.install()).toMatchObject({ status: "failed", reason: "manifest_invalid" });
    h.origin.serve(v2);
    h.origin.fail("manifest", 503);
    expect(await h.install()).toMatchObject({ status: "failed", reason: "manifest_unreachable", version: null });
    h.origin.serve(v2);
    h.origin.fail("bundle", 500);
    expect(await h.install()).toMatchObject({ status: "failed", reason: "bundle_unreachable" });
    expectUntouched(h, snapshot);
  });

  test("a bundle with a file the manifest does not list, or lacking one it does", async () => {
    const { h, snapshot } = await withV1();
    const extra = builtRelease(V2, [...fixtureFiles(6, "v2"), { path: "sneaky.js", text: "evil" }]);
    const clean = builtRelease(V2, fixtureFiles(6, "v2"));
    h.origin.serve({ ...clean, bundle: extra.bundle, manifest: resign({ ...clean.manifest, bundle: extra.manifest.bundle }) });
    expect(await h.install()).toMatchObject({ status: "failed", reason: "file_unexpected" });
    const fewer = builtRelease(V2, fixtureFiles(5, "v2"));
    h.origin.serve({ ...clean, bundle: fewer.bundle, manifest: resign({ ...clean.manifest, bundle: fewer.manifest.bundle }) });
    expect(await h.install()).toMatchObject({ status: "failed", reason: "file_missing" });
    expectUntouched(h, snapshot);
  });

  test("the service worker refusing to switch undoes the meta and drops the new cache", async () => {
    const { h, snapshot } = await withV1();
    h.origin.serve(builtRelease(V2, fixtureFiles(6, "v2")));
    h.state.switchError = new Error("no active service worker");
    const result = await h.install();
    expect(result).toMatchObject({ status: "failed", reason: "switch" });
    expectUntouched(h, snapshot);
  });

  test("a storage failure (quota) while writing the new cache", async () => {
    const { h, snapshot } = await withV1();
    h.origin.serve(builtRelease(V2, fixtureFiles(6, "v2")));
    h.caches.failOpenFor = (name) => name === releaseCacheName(V2);
    expect(await h.install()).toMatchObject({ status: "failed", reason: "storage" });
    expectUntouched(h, snapshot);
  });

  test("a meta write failure undoes everything", async () => {
    const { h, snapshot } = await withV1();
    h.origin.serve(builtRelease(V2, fixtureFiles(6, "v2")));
    h.meta.failSetFor = (key) => key === META_KEYS.release;
    expect(await h.install()).toMatchObject({ status: "failed", reason: "meta" });
    h.meta.failSetFor = null;
    expectUntouched(h, snapshot);
  });

  test("the same version number with different content is refused, never written over the working release", async () => {
    const { h, snapshot } = await withV1();
    h.origin.serve(builtRelease(V1, fixtureFiles(6, "rebuilt")));
    expect(await h.install()).toMatchObject({ status: "failed", reason: "version_collision" });
    expectUntouched(h, snapshot);
  });

  test("a first install that fails leaves nothing behind", async () => {
    const release = builtRelease(V1, fixtureFiles(3));
    const h = harness(release);
    h.origin.tamper("bundle", new Uint8Array([1, 2, 3]));
    expect(await h.install()).toMatchObject({ status: "failed", reason: "bundle_hash" });
    expect(h.caches.caches.size).toBe(0);
    expect(installedRelease(h)).toBeUndefined();
    expect(h.switched).toEqual([]);
  });

  test("a failed install that could not be reported is kept and delivered later", async () => {
    const h = harness(builtRelease(V1, fixtureFiles(3)));
    h.origin.tamper("bundle", new Uint8Array([9]));
    h.setSendOk(false);
    await h.install();
    expect((h.meta.data.get(META_KEYS.installPending) as InstallRecord[]).map((r) => r.status)).toEqual(["failed"]);
    const sent: InstallRecord[] = [];
    expect(await flushPendingInstalls(h.meta, async (r) => { sent.push(r); return false; })).toBe(0);
    expect((h.meta.data.get(META_KEYS.installPending) as InstallRecord[]).length).toBe(1); // still waiting
    expect(await flushPendingInstalls(h.meta, async (r) => { sent.push(r); return true; })).toBe(1);
    expect(h.meta.data.get(META_KEYS.installPending)).toEqual([]);
    expect(sent.length).toBe(2);
  });
});

describe("an update of an installed release", () => {
  function twoReleases(total: number, changed: number) {
    const v1Files = fixtureFiles(total, "v1");
    const v2Files = v1Files.map((f, i) => (i < changed ? { ...f, text: `${f.text} CHANGED` } : f));
    return { v1: builtRelease(V1, v1Files), v2: builtRelease(V2, v2Files) };
  }

  test("fewer than half the files changed: ONLY the changed files are fetched, each from its own URL; the rest come from the old cache", async () => {
    const { v1, v2 } = twoReleases(10, 2);
    const h = harness(v1);
    await h.install();
    h.origin.serve(v2);
    h.origin.requests.length = 0;
    const result = await h.install();

    expect(result).toEqual({ status: "updated", version: V2, mode: "partial", downloadedFiles: 2, bytes: v2.manifest.files.slice(0, 2).reduce((n, f) => n + f.size, 0) });
    expect(h.origin.requests).toEqual(["/_release/release.json", "/_next/static/chunks/file-00.js", "/_next/static/chunks/file-01.js"]);
    expect(h.origin.requests).not.toContain(`/${v2.manifest.bundle.path}`);
    // the new cache holds ALL ten files with the new bytes for the two that changed
    const cache = h.caches.caches.get(releaseCacheName(V2))!;
    expect(cache.entries.size).toBe(10);
    expect(await cacheText(h, V2, "_next/static/chunks/file-00.js")).toContain("CHANGED");
    expect(await cacheText(h, V2, "_next/static/chunks/file-09.js")).toBe(new TextDecoder().decode(v1.files.get("_next/static/chunks/file-09.js")));
    // the old release is gone, the new one is live and recorded as an update
    expect([...h.caches.caches.keys()]).toEqual([releaseCacheName(V2)]);
    expect(h.switched).toEqual([V1, V2]);
    expect(installedRelease(h)).toMatchObject({ version: V2, mode: "partial" });
    expect(fileTable(h)!.version).toBe(V2);
    expect(h.records.at(-1)).toMatchObject({ status: "updated", previous_release: V1, release_version: V2 });
  });

  test("a file the new release no longer has is simply not carried over", async () => {
    const v1 = builtRelease(V1, fixtureFiles(10, "v1"));
    const v2 = builtRelease(V2, fixtureFiles(10, "v1").slice(0, 9));
    const h = harness(v1);
    await h.install();
    h.origin.serve(v2);
    const result = await h.install();
    expect(result).toMatchObject({ status: "updated", mode: "partial", downloadedFiles: 0 });
    expect(h.caches.caches.get(releaseCacheName(V2))!.entries.size).toBe(9);
  });

  test("half or more of the files changed: STILL only the changed files (delta-only), never the bundle", async () => {
    const { v1, v2 } = twoReleases(10, 7);
    const h = harness(v1);
    await h.install();
    h.origin.serve(v2);
    h.origin.requests.length = 0;
    const result = await h.install();
    expect(result).toMatchObject({ status: "updated", mode: "partial", downloadedFiles: 7 });
    expect(h.origin.requests).not.toContain(`/${v2.manifest.bundle.path}`);
    expect(h.origin.requests.length).toBe(1 + 7);
  });

  test("every file changed (nothing to reuse): the one bundle is the cheapest way and is used", async () => {
    const { v1, v2 } = twoReleases(10, 10);
    const h = harness(v1);
    await h.install();
    h.origin.serve(v2);
    h.origin.requests.length = 0;
    const result = await h.install();
    expect(result).toMatchObject({ status: "updated", mode: "full", downloadedFiles: 10 });
    expect(h.origin.requests).toEqual(["/_release/release.json", `/${v2.manifest.bundle.path}`]);
  });

  test("a changed file served with the wrong bytes: the update fails and the old release stays", async () => {
    const { v1, v2 } = twoReleases(10, 2);
    const h = harness(v1);
    await h.install();
    h.origin.serve(v2);
    h.origin.tamper("_next/static/chunks/file-01.js", new TextEncoder().encode("not what the manifest says"));
    const result = await h.install();
    expect(result).toMatchObject({ status: "failed", reason: "file_hash" });
    expect([...h.caches.caches.keys()]).toEqual([releaseCacheName(V1)]);
    expect(installedRelease(h)).toMatchObject({ version: V1 });
    expect(h.switched).toEqual([V1]);
  });

  test("a damaged copy in the OLD cache is not trusted: that file is fetched again", async () => {
    const { v1, v2 } = twoReleases(10, 1);
    const h = harness(v1);
    await h.install();
    h.caches.caches.get(releaseCacheName(V1))!.entries.get("/_next/static/chunks/file-05.js")!.bytes = new TextEncoder().encode("rotted");
    h.origin.serve(v2);
    h.origin.requests.length = 0;
    const result = await h.install();
    expect(result).toMatchObject({ status: "updated", mode: "partial", downloadedFiles: 2 });
    expect(h.origin.requests).toContain("/_next/static/chunks/file-05.js");
    expect(await cacheText(h, V2, "_next/static/chunks/file-05.js")).toBe(new TextDecoder().decode(v1.files.get("_next/static/chunks/file-05.js")));
  });

  test("only release caches are forgotten after the switch: the worker's own cache and anything else stays", async () => {
    const { v1, v2 } = twoReleases(4, 1);
    const h = harness(v1);
    await h.caches.open("px-sw-meta");
    await h.caches.open("someone-elses-cache");
    await h.caches.open(releaseCacheName("2020.01.01-001")); // a stray older release
    await h.install();
    h.origin.serve(v2);
    await h.install();
    expect([...h.caches.caches.keys()].sort()).toEqual([releaseCacheName(V2), "px-sw-meta", "someone-elses-cache"].sort());
  });
});

describe("small pieces", () => {
  test("parseManifest accepts a built manifest and rejects each broken shape", () => {
    const { manifest } = builtRelease(V1, fixtureFiles(2));
    expect(parseManifest(manifest)).toEqual(manifest);
    const broken: unknown[] = [
      null, [], {},
      { ...manifest, release_version: "1.0" },
      { ...manifest, manifest_sha256: "xyz" },
      { ...manifest, bundle: { path: 1 } },
      { ...manifest, files: [{ path: "a", size: 1, sha256: "no" }] },
      { ...manifest, files: [manifest.files[0], manifest.files[0]] },
      { ...manifest, protocol: "2" },
    ];
    for (const value of broken) expect(() => parseManifest(value)).toThrow(/not valid/);
  });

  test("the device id is made once and then kept", async () => {
    const meta = new FakeMeta();
    let n = 0;
    const a = await getDeviceId(meta, () => `device-id-${++n}`);
    const b = await getDeviceId(meta, () => `device-id-${++n}`);
    expect([a, b]).toEqual(["device-id-1", "device-id-1"]);
  });

  test("the build script and the app agree on the shell's virtual path, and it is cached under /local", () => {
    expect(SHELL_FILE_PATH).toBe(SCRIPT_SHELL_FILE_PATH);
    expect(urlForReleasePath(SHELL_FILE_PATH)).toBe("/local");
    expect(urlForReleasePath("_next/static/a.js")).toBe("/_next/static/a.js");
    expect(contentTypeFor("_next/static/media/x.woff2")).toBe("font/woff2");
    expect(contentTypeFor("noextension")).toBe("application/octet-stream");
  });

  test("installedCacheMissing is false when nothing was ever installed", async () => {
    expect(await installedCacheMissing({ caches: new FakeCacheStorage(), meta: new FakeMeta() })).toBe(false);
  });
});
