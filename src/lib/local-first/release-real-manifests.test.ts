import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { IDBFactory } from "fake-indexeddb";
import { checkHistory, manifestFromRegistry, shaDerivedVersion } from "../../../scripts/verify/release-registry-live.mjs";
import { releaseVersion } from "../../../scripts/make-release.mjs";
import { openLocalDb } from "./local-db";
import { installRelease, manifestDigestOk, parseManifest } from "./release/installer";
import { parseCurrentRelease, type ReleaseManifest } from "./release/release-client";
import { META_KEYS, releaseCacheName } from "./release/release-constants";
import { FakeCacheStorage, builtRelease, fakeOrigin, resign, type BuiltRelease } from "./release/__fixtures__/fakes";
import manifestN from "./__fixtures__/release-real/manifest-n.json";
import manifestN1 from "./__fixtures__/release-real/manifest-n1.json";
import registryN from "./__fixtures__/release-real/registry-n.json";
import registryCurrent from "./__fixtures__/release-real/registry-current-n1.json";
import history from "./__fixtures__/release-real/history.json";

// AUDIT-100 B13: "a new release replaces the installed copy and keeps the local data", against REAL data.
// The fixtures are two consecutive releases of the REAL registry (platform.projexa_release*, the projexa-sync service) and the live
// site's own /_release/release.json, captured by scripts/verify/release-registry-live.mjs --write-fixtures (paths, hashes, sizes,
// times and commit shas only: no personal data). That script, run by hand, is the live half: it re-checks the registry history against
// the real Production deploys, downloads every file of the current release from https://projexa-ai.com and runs the real installer
// with the real bytes. This file is the CI half: the same real manifests, the client's own parsers and the real installer.

const N = manifestN as unknown as ReleaseManifest;
const N1 = manifestN1 as unknown as ReleaseManifest;

describe("B13: the real release manifests", () => {
  test("N and N+1 parse, and each digest is what its own content hashes to", async () => {
    for (const m of [N, N1]) {
      expect(parseManifest(structuredClone(m)).release_version).toBe(m.release_version);
      expect(await manifestDigestOk(m)).toBe(true);
    }
    expect(Date.parse(N.built_at)).toBeLessThan(Date.parse(N1.built_at)); // consecutive registry releases, N first
  });

  test("N's manifest rebuilt from its registry rows has exactly the registered digest (the registry holds the release losslessly)", () => {
    const rebuilt = manifestFromRegistry(
      { release_version: N.release_version, git_sha: N.git_sha, built_at: N.built_at, protocol: N.protocol, schema_version: N.schema, bundle_path: N.bundle.path, bundle_size: N.bundle.size, bundle_sha256: N.bundle.sha256 },
      registryN.files,
    );
    expect(rebuilt.manifest_sha256).toBe(registryN.manifest_sha256);
    expect(rebuilt.manifest_sha256).toBe(N.manifest_sha256);
  });

  test("what the service answers for /release/current parses with the client's parser and is exactly the live site's N+1", () => {
    const parsed = parseCurrentRelease(registryCurrent);
    expect(parsed).not.toBeNull();
    const current = parsed!.current!;
    expect(current.release_version).toBe(N1.release_version);
    expect(current.manifest_sha256).toBe(N1.manifest_sha256);
    const byPath = new Map(current.files.map((f) => [f.path, f]));
    expect(byPath.size).toBe(N1.files.length);
    for (const f of N1.files) {
      expect(byPath.get(f.path)?.sha256).toBe(f.sha256);
      expect(byPath.get(f.path)?.size).toBe(f.size);
    }
  });

  test("the registry's numbering across N -> N+1: same bytes keep file_no and file_version, changed bytes keep file_no and bump file_version", () => {
    const before = new Map(registryN.files.map((f) => [f.path, f]));
    let same = 0;
    let changed = 0;
    let added = 0;
    const numbers = new Set<number>();
    for (const f of registryCurrent.current.files) {
      expect(numbers.has(f.file_no)).toBe(false);
      numbers.add(f.file_no);
      const old = before.get(f.path);
      if (!old) {
        added += 1;
        expect(f.file_version).toBe(1);
        expect([...before.values()].some((o) => o.file_no === f.file_no)).toBe(false);
      } else if (old.sha256 === f.sha256) {
        same += 1;
        expect([f.file_no, f.file_version]).toEqual([old.file_no, old.file_version]);
      } else {
        changed += 1;
        expect(f.file_no).toBe(old.file_no);
        expect(f.file_version).toBeGreaterThan(old.file_version);
      }
    }
    expect(same).toBeGreaterThan(changed + added); // a real consecutive pair: most files are unchanged, so the update is partial
  });
});

describe("B13: the real registry history", () => {
  test("ordered by build time, the old sha-derived numbers were out of order: exactly the registry's own versions, and nothing else wrong", () => {
    for (const r of history.releases) expect(shaDerivedVersion(r.built_at, r.git_sha)).toBe(r.release_version);
    const result = checkHistory(history);
    expect(result.defects.filter((d) => d.code !== "VERSION_NOT_MONOTONIC")).toEqual([]);
    expect(result.defects.length).toBe(9); // 9 of the 25 consecutive pairs, e.g. 2026.10.05-990 built before 2026.10.05-305
    // every Production deploy either registered (in deploy order) or was replaced before any laptop asked the service to register it
    expect(result.mapped.filter((m) => m.release_version).length).toBeGreaterThanOrEqual(10);
    for (const n of result.notes) expect(n.code).toBe("SUPERSEDED_BEFORE_REGISTRATION");
  });

  test("the build-time numbering (make-release.mjs since B13), applied to the same real build times, is strictly in order with no repeat", () => {
    const versions = [...history.releases]
      .sort((a, b) => Date.parse(a.built_at) - Date.parse(b.built_at))
      .map((r) => releaseVersion({ date: new Date(r.built_at), buildNumber: undefined, sha: r.git_sha }));
    for (let i = 1; i < versions.length; i += 1) expect(versions[i] > versions[i - 1]).toBe(true);
    const fixed = history.releases.map((r) => ({ ...r, release_version: releaseVersion({ date: new Date(r.built_at), buildNumber: undefined, sha: r.git_sha }) }));
    expect(checkHistory({ ...history, releases: fixed }).defects).toEqual([]);
  });

  test("the checker sees a deploy order the registry does not follow, and a live deploy that never registered", () => {
    const fixed = history.releases.map((r) => ({ ...r, release_version: releaseVersion({ date: new Date(r.built_at), buildNumber: undefined, sha: r.git_sha }) }));
    const latest = [...history.deployments].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const [a, b] = [latest[0].sha, latest[1].sha];
    const ra = fixed.find((r) => r.git_sha === a)!;
    const rb = fixed.find((r) => r.git_sha === b)!;
    const swapped = fixed.map((r) => (r === ra ? { ...r, git_sha: b } : r === rb ? { ...r, git_sha: a } : r));
    expect(checkHistory({ ...history, releases: swapped }).defects.map((d) => d.code)).toContain("DEPLOY_ORDER_NOT_REGISTRY_ORDER");
    const dropped = fixed.filter((r) => r.git_sha !== a);
    expect(checkHistory({ ...history, releases: dropped }).defects.map((d) => d.code)).toContain("LIVE_DEPLOY_NOT_REGISTERED");
  });
});

// The real installer on a laptop with the app's real local database (fake-indexeddb), moving from N to N+1 with the REAL manifests'
// paths, sizes and change set. CI has no live site, so each file's bytes are stood in by bytes derived from its REAL sha256: a file
// the real N and N+1 share gets identical stand-in bytes, a changed file gets different ones, exactly as on the live site. (The live
// script does the same run with the real bytes from https://projexa-ai.com.)
function standIn(real: ReleaseManifest): BuiltRelease {
  const files = real.files.map((f) => ({ path: f.path, text: `${f.path}\n${f.sha256}\n` }));
  const built = builtRelease(real.release_version, files, { builtAt: real.built_at });
  return { ...built, manifest: resign({ ...built.manifest, git_sha: real.git_sha, protocol: real.protocol, schema: real.schema }) };
}

const gunzip = async (b: Uint8Array) => new Uint8Array(gunzipSync(b));

async function laptopWithN() {
  const relN = standIn(N);
  const relN1 = standIn(N1);
  const origin = fakeOrigin(relN);
  const caches = new FakeCacheStorage();
  const db = await openLocalDb(new IDBFactory(), "projexa-local");
  const first = await installRelease({ fetchImpl: origin.fetch, caches, meta: db, gunzip, deviceId: "laptop-b13", switchTo: async () => {} });
  expect(first).toMatchObject({ status: "installed", version: N.release_version, mode: "full" });
  await db.putRecord({ id: "tasks:t1", type: "tasks", orgId: "org1", projectId: "p1", data: { id: "t1", title: "Fix the site gate" }, serverVersion: 3 });
  await db.putRecord({ id: "boq_items:b1", type: "boq_items", orgId: "org1", projectId: "p1", data: { id: "b1", description: "Tiling", qty: 12 }, serverVersion: 1, dirty: "op-1" });
  await db.putOp({ opId: "op-1", functionId: "update_boq_item", projectId: "p1", params: { qty: 12 }, record: { kind: "boq_items", id: "b1", baseVersion: 1 }, clientAt: "2026-10-05T10:00:00Z", status: "pending", attempts: 0, nextAttemptAt: 0 });
  const snapshot = async () => JSON.stringify({ rows: await db.listByOrg("org1"), ops: await db.listOps() });
  return { relN, relN1, origin, caches, db, snapshot, before: await snapshot() };
}

describe("B13: N installed, the service says N+1 (the real pair) -> the real installer", () => {
  test("switches to N+1 downloading only the changed files; N's cache is whole until the switch; the person's data is untouched", async () => {
    const l = await laptopWithN();
    expect(l.relN1.manifest.files.map((f) => f.path)).toEqual(N1.files.map((f) => f.path));
    const unchanged = new Set(N.files.filter((f) => N1.files.some((g) => g.path === f.path && g.sha256 === f.sha256)).map((f) => f.path));
    const toDownload = N1.files.filter((f) => !unchanged.has(f.path)).length;

    l.origin.serve(l.relN1);
    l.origin.requests.length = 0;
    let atSwitch: { version: string; nStillThere: boolean; n1Files: number } | null = null;
    const result = await installRelease({
      fetchImpl: l.origin.fetch,
      caches: l.caches,
      meta: l.db,
      gunzip,
      deviceId: "laptop-b13",
      switchTo: async (v) => {
        atSwitch = { version: v, nStillThere: await l.caches.has(releaseCacheName(N.release_version)), n1Files: l.caches.caches.get(releaseCacheName(v))?.entries.size ?? 0 };
      },
    });
    expect(result).toMatchObject({ status: "updated", version: N1.release_version, mode: "partial", downloadedFiles: toDownload });
    expect(l.origin.requests.length).toBe(1 + toDownload); // the manifest + the changed files, never the bundle
    expect(atSwitch).toEqual({ version: N1.release_version, nStillThere: true, n1Files: N1.files.length });
    expect((await l.caches.keys()).filter((k) => k.startsWith("px-release-"))).toEqual([releaseCacheName(N1.release_version)]);
    expect(await l.db.getMeta<{ version: string }>(META_KEYS.release)).toMatchObject({ version: N1.release_version, manifest_sha256: l.relN1.manifest.manifest_sha256 });
    expect(await l.snapshot()).toBe(l.before);
  });

  test("one changed file with the wrong bytes: refused, nothing switches, N's cache and meta stay, the person's data is untouched", async () => {
    const l = await laptopWithN();
    l.origin.serve(l.relN1);
    const changed = N1.files.find((f) => !N.files.some((g) => g.path === f.path && g.sha256 === f.sha256) && f.path !== "_shell/local.html")!;
    l.origin.tamper(changed.path, new TextEncoder().encode("not the release's bytes"));
    let switched = false;
    const result = await installRelease({ fetchImpl: l.origin.fetch, caches: l.caches, meta: l.db, gunzip, deviceId: "laptop-b13", switchTo: async () => { switched = true; } });
    expect(result).toMatchObject({ status: "failed", reason: "file_hash" });
    expect(switched).toBe(false);
    expect((await l.caches.keys()).filter((k) => k.startsWith("px-release-"))).toEqual([releaseCacheName(N.release_version)]);
    expect(await l.db.getMeta<{ version: string }>(META_KEYS.release)).toMatchObject({ version: N.release_version });
    expect(await l.snapshot()).toBe(l.before);
  });
});
