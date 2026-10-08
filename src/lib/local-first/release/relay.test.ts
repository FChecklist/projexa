/// <reference types="bun-types" />
// P4 (3), the unit half: what a relay accepts, keeps and serves. Run: bun test --isolate src/lib/local-first/release/relay.test.ts
import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { RELAY_KEEP_KEY, RELAY_PENDING_KEY, createReleaseRelay, verifyRelayPackage, type RelayPackage } from "./relay";
import { FakeMeta, builtRelease, fixtureFiles } from "./__fixtures__/fakes";
import { makeKey, noise, relayPackage } from "./__fixtures__/signing";

const gunzip = async (b: Uint8Array) => new Uint8Array(gunzipSync(b));
const V1 = "2026.10.02-001";
const V2 = "2026.10.03-002";

async function setup(installed: string | null = V1) {
  const key = await makeKey("k1");
  const rel = builtRelease(V2, [...fixtureFiles(3), { path: "_next/static/big.bin", bytes: noise(30_000) }]);
  const pkg = await relayPackage(rel, key);
  const meta = new FakeMeta();
  const relay = createReleaseRelay({ meta, keys: [key.trusted], installedVersion: async () => installed, gunzip });
  return { key, rel, pkg, meta, relay };
}

const flip = (bytes: Uint8Array, at = 100): Uint8Array => {
  const copy = new Uint8Array(bytes);
  copy[at] = copy[at]! ^ 0xff;
  return copy;
};

describe("accept: a package from a peer is held to the download standard", () => {
  test("a good, signed, newer package is parked for the next install", async () => {
    const { relay, meta, pkg } = await setup();
    expect(await relay.accept(pkg)).toEqual({ ok: true });
    expect((meta.data.get(RELAY_PENDING_KEY) as RelayPackage).manifest.manifest_sha256).toBe(pkg.manifest.manifest_sha256);
  });

  test("a tampered bundle (one flipped byte) is refused and nothing is parked", async () => {
    const { relay, meta, pkg } = await setup();
    expect(await relay.accept({ ...pkg, bundle: flip(pkg.bundle) })).toEqual({ ok: false, reason: "bundle" });
    expect(meta.data.get(RELAY_PENDING_KEY) ?? null).toBeNull();
  });

  test("a bundle that matches its own hash but not the signed manifest is refused (manifest digest)", async () => {
    const { relay, pkg, key } = await setup();
    const other = builtRelease(V2, fixtureFiles(2, "other"));
    // the other release's manifest with the first one signature
    expect(await relay.accept({ manifest: other.manifest, signature: pkg.signature, bundle: other.bundle })).toEqual({ ok: false, reason: "signature" });
    const tamperedManifest = { ...pkg.manifest, git_sha: "evil" };
    expect(await relay.accept({ ...pkg, manifest: tamperedManifest })).toEqual({ ok: false, reason: "manifest_digest" });
    expect(key.trusted.kid).toBe("k1");
  });

  test("a signature by a key that is not pinned is refused", async () => {
    const { relay, rel } = await setup();
    const attacker = await makeKey("k1");
    expect(await relay.accept(await relayPackage(rel, attacker))).toEqual({ ok: false, reason: "signature" });
  });

  test("an unsigned package is refused", async () => {
    const { relay, pkg } = await setup();
    expect(await relay.accept({ ...pkg, signature: undefined as never })).toEqual({ ok: false, reason: "malformed" });
  });

  test("an old release, even validly signed, cannot downgrade the laptop", async () => {
    const { relay, pkg } = await setup("2026.10.09-001");
    expect(await relay.accept(pkg)).toEqual({ ok: false, reason: "not_newer" });
    const same = await setup(V2);
    expect(await same.relay.accept(same.pkg)).toEqual({ ok: false, reason: "not_newer" });
  });

  test("with no pinned key the relay is off: nothing is accepted, wanted or offered", async () => {
    const { pkg } = await setup();
    const relay = createReleaseRelay({ meta: new FakeMeta(), keys: [], installedVersion: async () => V1 });
    expect(await relay.accept(pkg)).toEqual({ ok: false, reason: "no_keys" });
    expect(await relay.wants({ version: V2, manifest_sha256: pkg.manifest.manifest_sha256 })).toBe(false);
    expect(await relay.offer()).toBeNull();
  });
});

describe("keep / offer / serve: a laptop never relays what it did not verify", () => {
  test("keep stores a verified package; offer and serve hand exactly it out", async () => {
    const { relay, pkg } = await setup();
    expect(await relay.keep(pkg)).toEqual({ ok: true });
    expect(await relay.offer()).toEqual({ version: V2, manifest_sha256: pkg.manifest.manifest_sha256, size: pkg.bundle.length });
    expect((await relay.serve(pkg.manifest.manifest_sha256))?.bundle).toEqual(pkg.bundle);
    expect(await relay.serve("0".repeat(64))).toBeNull();
  });

  test("keep refuses an unverified package, so it can never be offered", async () => {
    const { relay, meta, pkg } = await setup();
    expect(await relay.keep({ ...pkg, bundle: flip(pkg.bundle) })).toEqual({ ok: false, reason: "bundle" });
    expect(meta.data.get(RELAY_KEEP_KEY) ?? null).toBeNull();
    expect(await relay.offer()).toBeNull();
  });

  test("a stored package damaged AFTER it was kept is not offered and not served (verified again at the moment of sending)", async () => {
    const { relay, meta, pkg } = await setup();
    await relay.keep(pkg);
    meta.data.set(RELAY_KEEP_KEY, { ...pkg, bundle: flip(pkg.bundle, 500) });
    expect(await relay.offer()).toBeNull();
    expect(await relay.serve(pkg.manifest.manifest_sha256)).toBeNull();
  });

  test("wants: only a strictly newer version, only a plausible offer", async () => {
    const { relay } = await setup(V1);
    expect(await relay.wants({ version: V2, manifest_sha256: "a".repeat(64) })).toBe(true);
    expect(await relay.wants({ version: V1, manifest_sha256: "a".repeat(64) })).toBe(false);
    expect(await relay.wants({ version: "2026.09.01-001", manifest_sha256: "a".repeat(64) })).toBe(false);
    expect(await relay.wants({ version: "not-a-version", manifest_sha256: "a".repeat(64) })).toBe(false);
  });

  test("verifyRelayPackage is the single check: ok for the good package", async () => {
    const { pkg, key } = await setup();
    expect(await verifyRelayPackage(pkg, { keys: [key.trusted], installedVersion: V1, requireNewer: true, gunzip })).toEqual({ ok: true });
  });
});
