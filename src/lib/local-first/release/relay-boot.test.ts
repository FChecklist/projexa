/// <reference types="bun-types" />
// P4 (1)+(3): the boot pass installs a release a peer handed over (even offline, local data untouched), refuses a bad one for good, and
// follows the registry origin only when the build pins a signing key. Run: bun test --isolate src/lib/local-first/release/relay-boot.test.ts
import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { runLocalFirstBoot, type BootDeps } from "../persistence";
import { RELAY_PENDING_KEY, createReleaseRelay, type RelayPackage } from "./relay";
import { META_KEYS, releaseCacheName } from "./release-constants";
import { FakeCacheStorage, FakeMeta, builtRelease, fakeOrigin, fixtureFiles, type BuiltRelease } from "./__fixtures__/fakes";
import { makeKey, relayPackage, signBuilt } from "./__fixtures__/signing";
import type { SwClient, SwReply } from "./sw-client";
import type { InstalledRelease } from "./installer";

const V1 = "2026.10.02-001";
const V2 = "2026.10.03-002";
const NOW = Date.parse("2026-10-03T10:00:00Z");
const gunzip = async (b: Uint8Array) => new Uint8Array(gunzipSync(b));

class FakeSw implements SwClient {
  pointer: { version: string; personId: string | null; localFirst: boolean } | null = null;
  constructor(private caches: FakeCacheStorage) {}
  async useRelease(version: string, personId?: string | null, localFirst?: boolean): Promise<SwReply | null> {
    if (!(await this.caches.has(releaseCacheName(version)))) return { ok: false, error: "no_cache" };
    this.pointer = { version, personId: personId ?? null, localFirst: localFirst ?? false };
    return { ok: true };
  }
  async setMode(): Promise<SwReply | null> { return { ok: true }; }
  async setPerson(): Promise<SwReply | null> { return { ok: true }; }
  async clearPerson(): Promise<SwReply | null> { return { ok: true }; }
  async status(): Promise<SwReply | null> { return { ok: true, version: this.pointer?.version ?? null, personId: this.pointer?.personId ?? null, localFirst: this.pointer?.localFirst ?? false }; }
}

/** A laptop that has V1 installed (no signing involved for the first install: no key is pinned yet in its trustedKeys=[] first pass). */
async function laptopWithV1(over: Partial<BootDeps> = {}) {
  const v1 = builtRelease(V1, fixtureFiles(6));
  const caches = new FakeCacheStorage();
  const meta = new FakeMeta();
  const origin = fakeOrigin(v1);
  const sw = new FakeSw(caches);
  const state = { online: true };
  const urls: string[] = [];
  const base = (extra: Partial<BootDeps> = {}): BootDeps => ({
    isDevelopment: false, isOnline: () => state.online, meta, caches, sw, ensureServiceWorker: async () => true,
    personId: "person-1", localFirstOn: () => false, gunzip, now: () => NOW, random: () => "device-xyz-123",
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => { urls.push(String(input)); return origin.fetch(input, init); }) as typeof fetch,
    trustedKeys: [],
    ...over,
    ...extra,
  });
  expect((await runLocalFirstBoot(base())).release).toMatchObject({ status: "installed", version: V1 });
  urls.length = 0;
  // the person data that an update must never touch
  meta.data.set("sync:manifest", { projectIds: ["p1"] });
  meta.data.set("identity", { userId: "u1" });
  meta.data.set("ready:u1", true);
  return { v1, caches, meta, origin, sw, state, urls, base };
}

const localKeys = ["sync:manifest", "identity", "ready:u1"] as const;

describe("a release handed over by a peer is installed by the next boot pass", () => {
  test("OFFLINE: installs from the parked package with no network request at all, and the local data is untouched", async () => {
    const key = await makeKey("k1");
    const t = await laptopWithV1();
    const v2 = builtRelease(V2, fixtureFiles(6, "v2"));
    t.meta.data.set(RELAY_PENDING_KEY, await relayPackage(v2, key));
    t.state.online = false;
    const before = localKeys.map((k) => t.meta.data.get(k));
    const report = await runLocalFirstBoot(t.base({ trustedKeys: [key.trusted] }));
    expect(report.release).toMatchObject({ status: "updated", version: V2 });
    expect(t.urls).toEqual([]); // not one request
    expect((t.meta.data.get(META_KEYS.release) as InstalledRelease).version).toBe(V2);
    expect(t.sw.pointer?.version).toBe(V2);
    expect(t.meta.data.get(RELAY_PENDING_KEY) ?? null).toBeNull();
    expect(localKeys.map((k) => t.meta.data.get(k))).toEqual(before);
  });

  test("a tampered package is refused for good: the old release stays and the package is dropped, not retried at every start", async () => {
    const key = await makeKey("k1");
    const t = await laptopWithV1();
    const v2 = builtRelease(V2, fixtureFiles(6, "v2"));
    const pkg = await relayPackage(v2, key);
    const bad = new Uint8Array(pkg.bundle);
    bad[50] = bad[50]! ^ 0xff;
    t.meta.data.set(RELAY_PENDING_KEY, { ...pkg, bundle: bad });
    t.state.online = false;
    await runLocalFirstBoot(t.base({ trustedKeys: [key.trusted] }));
    expect((t.meta.data.get(META_KEYS.release) as InstalledRelease).version).toBe(V1);
    expect(t.sw.pointer?.version).toBe(V1);
    expect(t.meta.data.get(RELAY_PENDING_KEY) ?? null).toBeNull();
  });

  test("a package signed by a key this build does not pin is refused", async () => {
    const pinned = await makeKey("k1");
    const attacker = await makeKey("k1");
    const t = await laptopWithV1();
    const v2 = builtRelease(V2, fixtureFiles(6, "v2"));
    t.meta.data.set(RELAY_PENDING_KEY, await relayPackage(v2, attacker));
    t.state.online = false;
    await runLocalFirstBoot(t.base({ trustedKeys: [pinned.trusted] }));
    expect((t.meta.data.get(META_KEYS.release) as InstalledRelease).version).toBe(V1);
    expect(t.meta.data.get(RELAY_PENDING_KEY) ?? null).toBeNull();
  });

  test("a release installed from a verified download is kept, so this laptop can pass it on", async () => {
    const key = await makeKey("k1");
    const t = await laptopWithV1();
    const v2 = builtRelease(V2, fixtureFiles(6, "v2"));
    const sig = await signBuilt(v2, key);
    t.origin.serve(v2);
    const relay = createReleaseRelay({ meta: t.meta, keys: [key.trusted], installedVersion: async () => V2, gunzip });
    // a signature file next to the manifest, as the publisher puts it
    const withSig = t.base({
      trustedKeys: [key.trusted], relay,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = new URL(String(input), "https://px.test").pathname;
        return path === "/_release/release.sig.json" ? new Response(JSON.stringify(sig), { status: 200 }) : t.origin.fetch(input, init);
      }) as typeof fetch,
      checkEveryMs: 0,
    });
    const report = await runLocalFirstBoot(withSig);
    expect(report.release).toMatchObject({ status: "updated", version: V2 });
    expect(await relay.offer()).toMatchObject({ version: V2 });
  });
});

describe("where the bytes come from", () => {
  const registryWith = (origin: string | null) => ({
    current: async () => ({ current: null, min_compatible: null, registered: true, origin }),
    ensureRegistered: async () => null,
    recordInstall: async () => true,
  }) as unknown as NonNullable<BootDeps["registry"]>;

  async function run(pinned: boolean) {
    const key = await makeKey("k1");
    const t = await laptopWithV1();
    const v2: BuiltRelease = builtRelease(V2, fixtureFiles(6, "v2"));
    t.origin.serve(v2);
    const sig = await signBuilt(v2, key);
    const bucket = "https://bucket.example/storage/projexa-release";
    const seen: string[] = [];
    const report = await runLocalFirstBoot(t.base({
      trustedKeys: pinned ? [key.trusted] : [],
      registry: registryWith(bucket),
      checkEveryMs: 0,
      fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        seen.push(url);
        const path = new URL(url.startsWith(bucket) ? url.slice(bucket.length) : url, "https://px.test").pathname;
        if (path === "/_release/release.sig.json") return new Response(JSON.stringify(sig), { status: 200 });
        return t.origin.fetch(path, init);
      }) as typeof fetch,
    }));
    return { report, seen, bucket };
  }

  test("a build that pins a signing key follows the registry origin", async () => {
    const { report, seen, bucket } = await run(true);
    expect(report.release).toMatchObject({ status: "updated", version: V2 });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((u) => u.startsWith(bucket))).toBe(true);
  });

  test("a build with no pinned key ignores the origin the registry names (a wrong origin could then serve anything)", async () => {
    const { seen, bucket } = await run(false);
    expect(seen.some((u) => u.startsWith(bucket))).toBe(false);
  });
});

export type { RelayPackage };
