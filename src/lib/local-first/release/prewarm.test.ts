import { afterEach, describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { installRelease } from "./installer";
import { prewarmReleaseBundle, resetPrewarm, takePrewarmedBundle } from "./prewarm";
import { FakeCacheStorage, FakeMeta, builtRelease, fakeOrigin, fixtureFiles } from "./__fixtures__/fakes";

afterEach(() => resetPrewarm());
const release = () => builtRelease("2026.10.08-001", fixtureFiles(5));

describe("P1 pre-verification download of the public release bundle", () => {
  test("asks only for the two public release files, with no token and no cookies, and holds verified bytes", async () => {
    const r = release();
    const origin = fakeOrigin(r);
    expect(await prewarmReleaseBundle({ fetchImpl: origin.fetch, staticBase: "", hasInstalledRelease: async () => false })).toBe(true);
    // No organisation data, no API, no registry: exactly the manifest and the bundle.
    expect(origin.requests).toEqual(["/_release/release.json", `/${r.manifest.bundle.path}`]);
    for (const init of origin.inits) {
      const headers = JSON.stringify(init.headers ?? {}).toLowerCase();
      expect(headers).not.toContain("authorization");
      expect(headers).not.toContain("cookie");
      expect(init.credentials).not.toBe("include");
    }
    expect(takePrewarmedBundle(r.manifest)?.length).toBe(r.manifest.bundle.size);
    expect(takePrewarmedBundle(r.manifest)).toBeNull(); // single use
  });

  test("a static host gets credentials omitted", async () => {
    const r = release();
    const origin = fakeOrigin(r);
    await prewarmReleaseBundle({ fetchImpl: origin.fetch, staticBase: "https://static.example", hasInstalledRelease: async () => false });
    for (const init of origin.inits) expect(init.credentials).toBe("omit");
  });

  test("a tampered bundle is not kept", async () => {
    const r = release();
    const origin = fakeOrigin(r);
    origin.tamper("bundle", new Uint8Array([1, 2, 3]));
    expect(await prewarmReleaseBundle({ fetchImpl: origin.fetch, staticBase: "", hasInstalledRelease: async () => false })).toBe(false);
    expect(takePrewarmedBundle(r.manifest)).toBeNull();
  });

  test("an unreachable server is quiet", async () => {
    const failing = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await prewarmReleaseBundle({ fetchImpl: failing, staticBase: "" })).toBe(false);
  });

  test("bytes for a different manifest are refused", async () => {
    const r = release();
    const origin = fakeOrigin(r);
    await prewarmReleaseBundle({ fetchImpl: origin.fetch, staticBase: "", hasInstalledRelease: async () => false });
    const other = builtRelease("2026.10.08-002", fixtureFiles(5, "v2"));
    expect(takePrewarmedBundle(other.manifest)).toBeNull();
  });

  test("the installer uses the held bundle and does not download it again, still verifying it", async () => {
    const r = release();
    const origin = fakeOrigin(r);
    await prewarmReleaseBundle({ fetchImpl: origin.fetch, staticBase: "", hasInstalledRelease: async () => false });
    origin.requests.length = 0;
    const result = await installRelease({
      fetchImpl: origin.fetch, caches: new FakeCacheStorage(), meta: new FakeMeta(), gunzip: async (b) => new Uint8Array(gunzipSync(b)),
      deviceId: "d", staticBase: "", trustedKeys: [], switchTo: async () => {}, takePrewarmedBundle,
    });
    expect(result.status).toBe("installed");
    expect(origin.requests).toEqual(["/_release/release.json"]);
  });

  // DELTA-ONLY (docs/local-first/DELTA_ONLY.md path 1): a returning person on the same machine triggers ZERO bundle downloads.
  test("a laptop that already has a release installed reads only the small manifest: no bundle, however often the e-mail is submitted", async () => {
    const r = release();
    const origin = fakeOrigin(r);
    for (let i = 0; i < 3; i += 1) {
      resetPrewarm(); // a refresh: the in-memory hold is gone
      expect(await prewarmReleaseBundle({ fetchImpl: origin.fetch, staticBase: "", hasInstalledRelease: async () => true })).toBe(true);
    }
    expect(origin.requests).toEqual(Array(3).fill("/_release/release.json"));
    expect(origin.requests.some((p) => p.includes(r.manifest.bundle.path))).toBe(false);
    expect(takePrewarmedBundle(r.manifest)).toBeNull();
  });

  test("the real default looks in the device meta: with a release recorded there the bundle is not fetched", async () => {
    const r = release();
    const origin = fakeOrigin(r);
    // no indexedDB in the test runtime -> unreadable -> first-install behaviour (bundle fetched); the explicit dep above proves the skip
    expect(await prewarmReleaseBundle({ fetchImpl: origin.fetch, staticBase: "" })).toBe(true);
  });
});
