/// <reference types="bun-types" />
// P4 (3), the wire half: two laptops of one organisation, one holds a signed release, the other takes it over the verified peer link.
// Run: bun test --isolate src/lib/local-first/peer/release-relay.test.ts
import { describe, expect, test } from "bun:test";
import { gunzipSync } from "node:zlib";
import { createTestSigner } from "./__fixtures__/test-signer";
import { connect, makeLaptop } from "./__fixtures__/laptop";
import { RELAY_PENDING_KEY, RELAY_KEEP_KEY, createReleaseRelay, type ReleaseRelay, type RelayPackage } from "../release/relay";
import { FakeMeta, builtRelease, fixtureFiles } from "../release/__fixtures__/fakes";
import { makeKey, noise, relayPackage } from "../release/__fixtures__/signing";
import { b64url, fromB64url } from "../../release-dist/signed-manifest";

const NOW = Date.parse("2026-10-02T10:00:00Z");
const base = { org: "org-1", view: "view-pm", nowMs: NOW };
const gunzip = async (b: Uint8Array) => new Uint8Array(gunzipSync(b));
const V1 = "2026.10.02-001";
const V2 = "2026.10.03-002";

async function until(cond: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
}

async function world(o: { installedB?: string | null; keysB?: "pinned" | "none" } = {}) {
  const signer = await createTestSigner();
  const A = await makeLaptop(signer, { ...base, userId: "ua", projects: ["p1"] });
  const B = await makeLaptop(signer, { ...base, userId: "ub", projects: ["p1"] });
  const key = await makeKey("k1");
  // a bundle of about 500 KB of noise: several relay chunks
  const rel = builtRelease(V2, [...fixtureFiles(3), { path: "_next/static/big.bin", bytes: noise(500_000) }]);
  const pkg = await relayPackage(rel, key);
  const metaA = new FakeMeta();
  const metaB = new FakeMeta();
  const relayA = createReleaseRelay({ meta: metaA, keys: [key.trusted], installedVersion: async () => V2, gunzip });
  const relayB = createReleaseRelay({ meta: metaB, keys: o.keysB === "none" ? [] : [key.trusted], installedVersion: async () => (o.installedB === undefined ? V1 : o.installedB), gunzip });
  const results: Array<{ accepted: boolean; reason?: string; version?: string }> = [];
  return { A, B, key, rel, pkg, metaA, metaB, relayA, relayB, results };
}

const pendingOf = (m: FakeMeta) => (m.data.get(RELAY_PENDING_KEY) as RelayPackage | undefined) ?? null;

describe("release relay over the peer link", () => {
  test("a verified, signed release crosses in several chunks and is parked for install on the other laptop", async () => {
    const w = await world();
    await w.relayA.keep(w.pkg);
    const msgs: string[] = [];
    await connect(w.A, w.B, {
      nowMs: NOW,
      tapAtoB: (t) => (msgs.push(JSON.parse(t).t), t),
      a: { release: w.relayA },
      b: { release: w.relayB, onRelease: (r) => w.results.push(r) },
    });
    await until(() => pendingOf(w.metaB) !== null || w.results.length > 0);
    expect(w.results).toEqual([{ accepted: true, version: V2 }]);
    const got = pendingOf(w.metaB)!;
    expect(got.manifest.manifest_sha256).toBe(w.pkg.manifest.manifest_sha256);
    expect(got.bundle).toEqual(w.pkg.bundle);
    expect(msgs.filter((t) => t === "rel_chunk").length).toBeGreaterThanOrEqual(3);
    expect(pendingOf(w.metaA)).toBeNull(); // the holder takes nothing back from the laptop it served
  });

  test("a bundle altered in transit is refused and nothing is parked", async () => {
    const w = await world();
    await w.relayA.keep(w.pkg);
    let done = false;
    await connect(w.A, w.B, {
      nowMs: NOW,
      tapAtoB: (t) => {
        const m = JSON.parse(t);
        if (m.t === "rel_chunk" && m.i === 1) {
          const bytes = fromB64url(m.b);
          bytes[10] = bytes[10]! ^ 0xff;
          m.b = b64url(bytes);
          return JSON.stringify(m);
        }
        return t;
      },
      a: { release: w.relayA },
      b: { release: w.relayB, onRelease: (r) => { w.results.push(r); done = true; } },
    });
    await until(() => done);
    expect(w.results).toEqual([{ accepted: false, reason: "bundle" }]);
    expect(pendingOf(w.metaB)).toBeNull();
  });

  test("a peer that serves a package signed by an unpinned key is refused (signature)", async () => {
    const w = await world();
    const attacker = await makeKey("k1");
    const forged = await relayPackage(w.rel, attacker);
    // a misbehaving peer: its relay hands out whatever it likes (it does not run our checks)
    const liar: ReleaseRelay = {
      offer: async () => ({ version: V2, manifest_sha256: forged.manifest.manifest_sha256, size: forged.bundle.length }),
      wants: async () => false,
      serve: async () => forged,
      accept: async () => ({ ok: false, reason: "malformed" }),
      keep: async () => ({ ok: false, reason: "malformed" }),
    };
    let done = false;
    await connect(w.A, w.B, { nowMs: NOW, a: { release: liar }, b: { release: w.relayB, onRelease: (r) => { w.results.push(r); done = true; } } });
    await until(() => done);
    expect(w.results).toEqual([{ accepted: false, reason: "signature" }]);
    expect(pendingOf(w.metaB)).toBeNull();
  });

  test("a laptop whose stored release is damaged does not offer it at all", async () => {
    const w = await world();
    await w.relayA.keep(w.pkg);
    const damaged = new Uint8Array(w.pkg.bundle);
    damaged[1000] = damaged[1000]! ^ 0xff;
    w.metaA.data.set(RELAY_KEEP_KEY, { ...w.pkg, bundle: damaged });
    const msgs: string[] = [];
    await connect(w.A, w.B, { nowMs: NOW, tapAtoB: (t) => (msgs.push(JSON.parse(t).t), t), a: { release: w.relayA }, b: { release: w.relayB } });
    await new Promise((r) => setTimeout(r, 150));
    expect(msgs.some((t) => t.startsWith("rel_"))).toBe(false);
    expect(pendingOf(w.metaB)).toBeNull();
  });

  test("a laptop that already runs this release or a newer one does not even ask", async () => {
    const w = await world({ installedB: V2 });
    await w.relayA.keep(w.pkg);
    const fromB: string[] = [];
    await connect(w.A, w.B, { nowMs: NOW, tapBtoA: (t) => (fromB.push(JSON.parse(t).t), t), a: { release: w.relayA }, b: { release: w.relayB } });
    await new Promise((r) => setTimeout(r, 150));
    expect(fromB).not.toContain("rel_want");
    expect(pendingOf(w.metaB)).toBeNull();
  });

  test("a build with no pinned key neither asks for nor takes a relayed release", async () => {
    const w = await world({ keysB: "none" });
    await w.relayA.keep(w.pkg);
    const fromB: string[] = [];
    await connect(w.A, w.B, { nowMs: NOW, tapBtoA: (t) => (fromB.push(JSON.parse(t).t), t), a: { release: w.relayA }, b: { release: w.relayB } });
    await new Promise((r) => setTimeout(r, 150));
    expect(fromB).not.toContain("rel_want");
    expect(pendingOf(w.metaB)).toBeNull();
  });

  test("a peer cannot push a package nobody asked for", async () => {
    const w = await world();
    let done = false;
    await connect(w.A, w.B, {
      nowMs: NOW,
      tapAtoB: (t) => {
        const m = JSON.parse(t);
        if (m.t === "have") return JSON.stringify({ t: "rel_start", manifest: w.pkg.manifest, signature: w.pkg.signature, size: w.pkg.bundle.length, chunks: 1 });
        return t;
      },
      a: {},
      b: { release: w.relayB, onRelease: () => { done = true; } },
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(done).toBe(false);
    expect(pendingOf(w.metaB)).toBeNull();
  });
});
