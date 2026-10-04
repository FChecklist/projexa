import { describe, expect, test } from "bun:test";
import { createIdentityStore } from "./identity";
import { OFFLINE_PIN_KEY, createPinRecord, rememberPinAfterOnlineLogin, unlockOffline, verifyPin } from "./offline-pin";

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), raw: m };
}

describe("offline pin", () => {
  test("hash verifies the right pin and rejects a wrong one", async () => {
    const rec = await createPinRecord("s3cret-pass", { userId: "u1" });
    expect(await verifyPin("s3cret-pass", rec)).toBe(true);
    expect(await verifyPin("s3cret-pasx", rec)).toBe(false);
    expect(await verifyPin("", rec)).toBe(false);
  });

  test("two records for the same pin use different salts", async () => {
    const a = await createPinRecord("same", { userId: "u1" });
    const b = await createPinRecord("same", { userId: "u1" });
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
  });

  test("never stores the plain pin", async () => {
    const storage = memStorage();
    await rememberPinAfterOnlineLogin(storage, "Me@Example.com", "plain-pin-9876", { userId: "u1" });
    const raw = storage.getItem(OFFLINE_PIN_KEY)!;
    expect(raw).toBeTruthy();
    expect(raw).not.toContain("plain-pin-9876");
    expect(Object.keys(JSON.parse(raw))).toEqual(["me@example.com"]);
  });

  test("unlocks offline with the right pin (any email case) and rebuilds the identity the shell reads", async () => {
    const storage = memStorage();
    const idStorage = memStorage();
    const identityStore = createIdentityStore({ storage: idStorage });
    await rememberPinAfterOnlineLogin(storage, "me@example.com", "pw-1", { userId: "u1", name: "Me", orgId: "o1", role: "admin" });
    const r = await unlockOffline({ storage, identityStore, now: () => 5000 }, " ME@example.com ", "pw-1");
    expect(r.ok).toBe(true);
    const id = await identityStore.read();
    expect(id).toMatchObject({ userId: "u1", email: "me@example.com", name: "Me", orgId: "o1", role: "admin", lastRefreshAt: 5000 });
  });

  test("wrong pin refuses and writes no identity", async () => {
    const storage = memStorage();
    const identityStore = createIdentityStore({ storage: memStorage() });
    await rememberPinAfterOnlineLogin(storage, "me@example.com", "pw-1", { userId: "u1" });
    const r = await unlockOffline({ storage, identityStore }, "me@example.com", "nope");
    expect(r).toMatchObject({ ok: false, reason: "wrong_pin" });
    expect(await identityStore.read()).toBeNull();
  });

  test("unknown email says to sign in online first", async () => {
    const identityStore = createIdentityStore({ storage: memStorage() });
    const r = await unlockOffline({ storage: memStorage(), identityStore }, "who@example.com", "x");
    expect(r).toMatchObject({ ok: false, reason: "no_record" });
    if (!r.ok) expect(r.notice).toContain("online");
  });
});
