import { describe, expect, test } from "bun:test";
import { changeCursorKey } from "../local-db";
import { MANIFEST_KEY } from "../replica";
import { createTestSigner } from "./__fixtures__/test-signer";
import { createAttestationSource } from "./attest";
import { createServerStep } from "./server-step";
import { PEER_KEYS_KEY, type MetaStore } from "./verify";

function memMeta(init: Record<string, unknown> = {}): MetaStore {
  const data = new Map<string, unknown>(Object.entries(init));
  return { async getMeta<T>(k: string) { return data.get(k) as T | undefined; }, async setMeta(k, v) { data.set(k, v); } };
}

describe("server step: a cheap head check before any pull", () => {
  test("no head moved: no pull at all", async () => {
    const meta = memMeta({ [MANIFEST_KEY]: { projectIds: ["p1", "p2"] }, [changeCursorKey("p1")]: { seq: 10 }, [changeCursorKey("p2")]: { seq: 4 } });
    let pulls = 0;
    const heads: string[] = [];
    const step = createServerStep({ meta, changes: async (r) => { heads.push(r.projectId); expect(r.afterSeq).toBeNull(); return { head_seq: r.projectId === "p1" ? 10 : 4 }; }, sync: async () => { pulls++; return { status: "done" }; } });
    expect(await step()).toEqual({ changed: false });
    expect(pulls).toBe(0);
    expect(heads).toEqual(["p1", "p2"]);
  });
  test("a head moved: one replica sync", async () => {
    const meta = memMeta({ [MANIFEST_KEY]: { projectIds: ["p1"] }, [changeCursorKey("p1")]: { seq: 10 } });
    let pulls = 0;
    const step = createServerStep({ meta, changes: async () => ({ head_seq: 11 }), sync: async () => { pulls++; return { status: "done" }; } });
    expect(await step()).toEqual({ changed: true });
    expect(pulls).toBe(1);
  });
  test("first run (no manifest yet): sync straight away; an unreachable server throws (the scheduler counts it as failed)", async () => {
    let pulls = 0;
    expect(await createServerStep({ meta: memMeta(), changes: async () => ({ head_seq: 0 }), sync: async () => { pulls++; return { status: "done" }; } })()).toEqual({ changed: true });
    expect(pulls).toBe(1);
    const down = createServerStep({ meta: memMeta({ [MANIFEST_KEY]: { projectIds: ["p1"] }, [changeCursorKey("p1")]: { seq: 1 } }), changes: async () => { throw new Error("network"); }, sync: async () => ({ status: "done" }) });
    await expect(down()).rejects.toThrow("network");
  });
});

describe("attestation source", () => {
  const NOW = Date.parse("2026-10-02T10:00:00Z");
  async function attestBody(signer: Awaited<ReturnType<typeof createTestSigner>>, userId = "u1") {
    return {
      token: await signer.token({ sub: userId, org: "o1", view: "v1", projects: ["p1"] }, NOW),
      expires_at: new Date(NOW + 86_400_000).toISOString(), org_id: "o1", user_id: userId, view_class: "v1", projects: ["p1"],
      channel: "chan", public_keys: [signer.publicKey], server_time: new Date(NOW).toISOString(),
    };
  }
  test("stores keys + token; keeps working with the server down; refreshes only when close to expiry", async () => {
    const signer = await createTestSigner();
    const meta = memMeta();
    let calls = 0;
    let down = false;
    let now = NOW;
    const src = createAttestationSource({ meta, userId: "u1", now: () => now, fetchAttest: async () => { calls++; if (down) throw new Error("down"); return attestBody(signer); } });
    expect(await src.current()).toBeNull();
    expect(await src.refresh()).toBe(true);
    expect(await meta.getMeta(PEER_KEYS_KEY)).toHaveLength(1);
    expect((await src.current())?.claims.org).toBe("o1");
    expect(await src.refresh()).toBe(true); // fresh: no call
    expect(calls).toBe(1);
    down = true;
    now = NOW + 23 * 3_600_000; // within 2 h of expiry: tries, fails, keeps the cached one
    expect(await src.refresh()).toBe(false);
    expect(calls).toBe(2);
    expect((await src.current())?.channel).toBe("chan");
    now = NOW + 25 * 3_600_000; // expired: no longer presented
    expect(await src.current()).toBeNull();
  });
  test("the server's person id may differ from the browser session id (live: compliance id vs Supabase auth id) and is still stored", async () => {
    const signer = await createTestSigner();
    const meta = memMeta();
    const src = createAttestationSource({ meta, userId: "auth-session-id", now: () => NOW, fetchAttest: async () => attestBody(signer, "server-person-id") });
    expect(await src.refresh()).toBe(true);
    expect((await src.current())?.claims.sub).toBe("server-person-id");
    expect(await meta.getMeta(PEER_KEYS_KEY)).toHaveLength(1);
  });
});
