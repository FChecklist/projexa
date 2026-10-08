/// <reference types="bun-types" />
import { describe, expect, mock, test } from "bun:test";
import { runPostLogin, type PostLoginDeps } from "./post-login";

const base = (o: Partial<PostLoginDeps> = {}): PostLoginDeps => {
  const store = new Map<string, string>([["projexa_pending_org_name", "Acme"]]);
  return {
    getSession: async () => ({ user: { id: "u9" } }), hasMembership: async () => false,
    storage: { getItem: (k) => store.get(k) ?? null, removeItem: (k) => void store.delete(k) },
    provision: mock(async () => ({ ok: true as const })), saveIdentity: mock(async () => {}),
    startShellInstall: mock(async () => {}), messages: { genericError: "g", provisionError: "p" }, ...o,
  };
};
describe("runPostLogin", () => {
  test("no session => plain error, nothing else runs", async () => {
    const d = base({ getSession: async () => null });
    expect(await runPostLogin(d)).toEqual({ ok: false, notice: "g" });
    expect(d.saveIdentity).not.toHaveBeenCalled();
  });
  test("new person with a kept company name: provisions, clears the name, saves identity, starts install", async () => {
    const d = base();
    expect(await runPostLogin(d)).toEqual({ ok: true });
    expect(d.provision).toHaveBeenCalledWith("Acme");
    expect(d.storage!.getItem("projexa_pending_org_name")).toBeNull();
    expect(d.saveIdentity).toHaveBeenCalledTimes(1);
    await Promise.resolve(); await Promise.resolve();
    expect(d.startShellInstall).toHaveBeenCalled();
  });
  test("provision failure stops with its message and keeps the name", async () => {
    const d = base({ provision: async () => ({ ok: false, error: "nope" }) });
    expect(await runPostLogin(d)).toEqual({ ok: false, notice: "nope" });
    expect(d.storage!.getItem("projexa_pending_org_name")).toBe("Acme");
  });
  test("identity save failure never blocks", async () => {
    expect(await runPostLogin(base({ saveIdentity: async () => { throw new Error("x"); } }))).toEqual({ ok: true });
  });
});
