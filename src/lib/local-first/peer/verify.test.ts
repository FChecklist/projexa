import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { localDbNameFor, openLocalDb } from "../local-db";
import { createTestSigner } from "./__fixtures__/test-signer";
import { PEER_KEYS_KEY, TEST_VECTOR, canonicalize, createKeyRing, sha256Hex, verifyRow, verifyToken, type MetaStore } from "./verify";

// The laptop half of the signing contract (CONTRACT.md section 1 + 4). The vector is the one compliance-tracker's sign.ts asserts.

function memMeta(): MetaStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return { data, async getMeta<T>(k: string) { return data.get(k) as T | undefined; }, async setMeta(k, v) { data.set(k, v); } };
}

const NOW = Date.parse("2026-10-02T10:00:00Z");

describe("canonical JSON (shared test vector)", () => {
  test("matches sign.ts byte for byte", async () => {
    expect(canonicalize(TEST_VECTOR.value)).toBe(TEST_VECTOR.canonical);
    expect(await sha256Hex(TEST_VECTOR.canonical)).toBe(TEST_VECTOR.sha256);
    // the literal constants of CONTRACT.md / sign.ts, not just self-consistency
    expect(TEST_VECTOR.sha256).toBe("bcbc2a5c6e5947a6e1ed5e22aaa51395f6b040407127c6d9a870c7872ce8e565");
  });
  test("drops undefined members, keeps array order", () => {
    expect(canonicalize({ b: undefined, a: [3, 1] })).toBe('{"a":[3,1]}');
  });
});

describe("attestation tokens", () => {
  test("a valid token verifies and yields its claims", async () => {
    const s = await createTestSigner();
    const keys = createKeyRing(memMeta());
    await keys.replace([s.publicKey]);
    const r = await verifyToken(await s.token({ org: "o1", view: "v1", projects: ["p1"] }, NOW), keys, NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.claims).toMatchObject({ org: "o1", view: "v1", projects: ["p1"] });
  });
  test("expired, tampered, unknown-key and malformed tokens are refused", async () => {
    const s = await createTestSigner();
    const other = await createTestSigner("kother");
    const keys = createKeyRing(memMeta());
    await keys.replace([s.publicKey]);
    const tok = await s.token({ org: "o1", view: "v1", projects: ["p1"] }, NOW);
    expect(await verifyToken(tok, keys, NOW + 86_401_000)).toEqual({ ok: false, reason: "expired" });
    const [h, , sig] = tok.split(".");
    const forged = btoa(JSON.stringify({ typ: "px-peer", v: 1, sub: "x", org: "o2", projects: ["p1"], view: "v1", iat: NOW / 1000, exp: NOW / 1000 + 100 })).replace(/=+$/, "");
    expect(await verifyToken(`${h}.${forged}.${sig}`, keys, NOW)).toEqual({ ok: false, reason: "bad_signature" });
    expect(await verifyToken(await other.token({ org: "o1", view: "v1", projects: [] }, NOW), keys, NOW)).toEqual({ ok: false, reason: "unknown_key" });
    expect(await verifyToken("not.a-token", keys, NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(await verifyToken(42, keys, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("row signatures", () => {
  test("a signed row verifies; any change to org, project, version or data does not", async () => {
    const s = await createTestSigner();
    const keys = createKeyRing(memMeta());
    await keys.replace([s.publicKey]);
    const row = await s.row("o1", { project: "p1", kind: "rfis", id: "r1", version: 3, updated_at: "2026-10-01T00:00:00Z", data: { subject: "Door" } });
    expect(await verifyRow(row, "o1", keys)).toBe(true);
    expect(await verifyRow(row, "o2", keys)).toBe(false);
    expect(await verifyRow({ ...row, project: "p2" }, "o1", keys)).toBe(false);
    expect(await verifyRow({ ...row, version: 4 }, "o1", keys)).toBe(false);
    expect(await verifyRow({ ...row, data: { subject: "Doors" } }, "o1", keys)).toBe(false);
    expect(await verifyRow({ ...row, kid: "nope" }, "o1", keys)).toBe(false);
  });
});

describe("key cache", () => {
  test("verification works with our server unreachable: keys come from the local database", async () => {
    const s = await createTestSigner();
    const idb = new IDBFactory();
    const db1 = await openLocalDb(idb, localDbNameFor("u1"));
    await createKeyRing(db1).replace([s.publicKey]);
    db1.close();
    // a fresh start of the app, no network call anywhere: only the local database
    const db2 = await openLocalDb(idb, localDbNameFor("u1"));
    expect(Array.isArray(await db2.getMeta(PEER_KEYS_KEY))).toBe(true);
    const keys = createKeyRing(db2);
    const row = await s.row("o1", { project: "p1", kind: "rfis", id: "r1", version: 1, updated_at: "2026-10-01T00:00:00Z", data: {} });
    expect(await verifyRow(row, "o1", keys)).toBe(true);
    expect((await verifyToken(await s.token({ org: "o1", view: "v", projects: [] }, NOW), keys, NOW)).ok).toBe(true);
    db2.close();
  });
  test("a key the server stopped listing no longer verifies", async () => {
    const s = await createTestSigner();
    const meta = memMeta();
    const keys = createKeyRing(meta);
    await keys.replace([s.publicKey]);
    await keys.replace([]);
    const row = await s.row("o1", { project: "p1", kind: "rfis", id: "r1", version: 1, updated_at: "x", data: {} });
    expect(await verifyRow(row, "o1", keys)).toBe(false);
  });
});
