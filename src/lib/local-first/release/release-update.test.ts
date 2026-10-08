/// <reference types="bun-types" />
// P4 (1): the installer signature hook, and an installed laptop picking up the next release WITHOUT touching its local data.
// Run: bun test --isolate src/lib/local-first/release/release-update.test.ts
import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { installRelease, type InstallerDeps } from "./installer";
import { META_KEYS } from "./release-constants";
import { FakeCacheStorage, FakeMeta, builtRelease, fakeOrigin, fixtureFiles, type BuiltRelease } from "./__fixtures__/fakes";
import { makeKey, signBuilt, type TestKey } from "./__fixtures__/signing";
import type { ReleaseSignature } from "../../release-dist/signed-manifest";
import { PINNED_RELEASE_KEYS } from "../../release-dist/pinned-keys";

const V1 = "2026.10.02-001";
const V2 = "2026.10.03-002";
const gunzip = async (b: Uint8Array) => new Uint8Array(gunzipSync(b));

type SigSource = () => ReleaseSignature | "missing";

/** The fake origin plus the signature file next to release.json. */
function origin(initial: BuiltRelease, sig: SigSource) {
  const o = fakeOrigin(initial);
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "https://px.test").pathname;
    if (path === "/_release/release.sig.json") {
      o.requests.push(path);
      const s = sig();
      return s === "missing" ? new Response("nope", { status: 404 }) : new Response(JSON.stringify(s), { status: 200 });
    }
    return o.fetch(input, init);
  }) as typeof fetch;
  return { ...o, fetchImpl };
}

function laptop(initial: BuiltRelease, sig: SigSource, keys: InstallerDeps["trustedKeys"], requiredFrom?: string) {
  const caches = new FakeCacheStorage();
  const meta = new FakeMeta();
  const org = origin(initial, sig);
  const switched: string[] = [];
  const kept: string[] = [];
  const deps = (): InstallerDeps => ({
    fetchImpl: org.fetchImpl, caches, meta, gunzip, deviceId: "device-1", staticBase: "",
    trustedKeys: keys,
    ...(requiredFrom !== undefined ? { signatureRequiredFrom: requiredFrom } : {}),
    switchTo: async (v) => { switched.push(v); },
    keepForRelay: async (k) => { kept.push(k.manifest.release_version); },
  });
  return { caches, meta, org, switched, kept, install: () => installRelease(deps()) };
}

describe("signature hook (after the manifest digest, before any byte is written)", () => {
  test("a pinned key and a valid signature: installs, and the verified release is kept for relaying", async () => {
    const key = await makeKey("k1");
    const rel = builtRelease(V1, fixtureFiles(4));
    const sig = await signBuilt(rel, key);
    const l = laptop(rel, () => sig, [key.trusted]);
    expect((await l.install()).status).toBe("installed");
    expect(l.switched).toEqual([V1]);
    expect(l.kept).toEqual([V1]);
  });

  test("a pinned key and NO signature file: refused, nothing written, nothing switched", async () => {
    const key = await makeKey("k1");
    const rel = builtRelease(V1, fixtureFiles(4));
    const l = laptop(rel, () => "missing", [key.trusted]);
    const r = await l.install();
    expect(r).toMatchObject({ status: "failed", reason: "manifest_signature" });
    expect(l.switched).toEqual([]);
    expect(l.caches.caches.size).toBe(0);
    expect(l.meta.data.get(META_KEYS.release) ?? null).toBeNull();
    expect(l.org.requests).not.toContain(`/${rel.manifest.bundle.path}`); // not one byte of the release was fetched
  });

  test("a signature made by a key this build does not pin is refused", async () => {
    const pinned = await makeKey("k1");
    const attacker: TestKey = await makeKey("k1"); // same kid, different key
    const rel = builtRelease(V1, fixtureFiles(4));
    const forged = await signBuilt(rel, attacker);
    const l = laptop(rel, () => forged, [pinned.trusted]);
    expect(await l.install()).toMatchObject({ status: "failed", reason: "manifest_signature" });
    expect(l.switched).toEqual([]);
  });

  test("a valid signature for ANOTHER release is refused (no replaying an old signature over new content)", async () => {
    const key = await makeKey("k1");
    const old = builtRelease(V1, fixtureFiles(4));
    const next = builtRelease(V2, fixtureFiles(4, "v2"));
    const oldSig = await signBuilt(old, key);
    const l = laptop(next, () => oldSig, [key.trusted]);
    expect(await l.install()).toMatchObject({ status: "failed", reason: "manifest_signature" });
    expect(l.switched).toEqual([]);
  });

  test("no pinned key: the installer behaves as before and never asks for a signature", async () => {
    const rel = builtRelease(V1, fixtureFiles(4));
    const l = laptop(rel, () => "missing", []);
    expect((await l.install()).status).toBe("installed");
    expect(l.org.requests).not.toContain("/_release/release.sig.json");
  });
});

describe("signature_required_from: an unsigned build cannot lock a laptop out, a bad signature always refuses", () => {
  test("below the required-from version an unsigned release (404) installs; a signed one is still verified", async () => {
    const key = await makeKey("k1");
    const rel = builtRelease(V1, fixtureFiles(4));
    const unsigned = laptop(rel, () => "missing", [key.trusted], "2099.01.01-000");
    expect((await unsigned.install()).status).toBe("installed");
    expect(unsigned.kept).toEqual([]); // nothing verified, so it is not offered to peers
    const forged = await signBuilt(rel, await makeKey("k1"));
    const bad = laptop(rel, () => forged, [key.trusted], "2099.01.01-000");
    expect(await bad.install()).toMatchObject({ status: "failed", reason: "manifest_signature" });
  });

  test("from the required-from version on, an unsigned release is refused", async () => {
    const key = await makeKey("k1");
    const rel = builtRelease(V1, fixtureFiles(4));
    const l = laptop(rel, () => "missing", [key.trusted], V1);
    expect(await l.install()).toMatchObject({ status: "failed", reason: "manifest_signature" });
    expect(l.switched).toEqual([]);
  });

  test("with the REAL pinned key list, a release signed by any other key is refused (even though unsigned ones are tolerated)", async () => {
    const rel = builtRelease(V1, fixtureFiles(4));
    const other = await makeKey(PINNED_RELEASE_KEYS[0].kid); // the real kid, a different key
    const forged = await signBuilt(rel, other);
    const l = laptop(rel, () => forged, PINNED_RELEASE_KEYS, "2099.01.01-000");
    expect(await l.install()).toMatchObject({ status: "failed", reason: "manifest_signature" });
    expect(l.switched).toEqual([]);
  });
});

describe("an installed laptop picks up the next release and keeps its local data", () => {
  test("only the changed file is downloaded; the person data and every other meta key are untouched", async () => {
    const key = await makeKey("k1");
    const files1 = fixtureFiles(12);
    const rel1 = builtRelease(V1, files1);
    const files2 = files1.map((f, i) => (i === 3 ? { ...f, text: `${f.text}-changed` } : f));
    const rel2 = builtRelease(V2, files2);
    let sig = await signBuilt(rel1, key);
    const l = laptop(rel1, () => sig, [key.trusted]);
    expect((await l.install()).status).toBe("installed");

    // the person data and settings, written the way the rest of the app writes them
    l.meta.data.set("sync:manifest", { projectIds: ["p1"] });
    l.meta.data.set("sync:changes:p1", { seq: 41 });
    l.meta.data.set("identity", { userId: "u1" });
    l.meta.data.set("ready:u1", true);
    const before = new Map(l.meta.data);

    l.org.serve(rel2);
    sig = await signBuilt(rel2, key);
    l.org.requests.length = 0;
    const result = await l.install();

    expect(result).toMatchObject({ status: "updated", version: V2, mode: "partial", downloadedFiles: 1 });
    expect(l.org.requests).not.toContain(`/${rel2.manifest.bundle.path}`); // no second full download
    expect(l.switched).toEqual([V1, V2]);
    for (const [k, v] of before) {
      if (k === META_KEYS.release || k === META_KEYS.files || k === META_KEYS.releaseFailure) continue;
      expect(l.meta.data.get(k)).toEqual(v); // not one local-data key changed
    }
    expect([...l.meta.data.keys()].filter((k) => !before.has(k))).toEqual([]); // and none was added (no re-prepare marker, no new store)
  });
});
