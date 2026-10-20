/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { ensureOrganization, ENSURE_FAILED_MESSAGE, withOrgRetry, type EnsureDeps } from "./ensure-org-client";

function deps(over: Partial<EnsureDeps> & { member?: boolean } = {}) {
  let member = over.member ?? false;
  const calls = { provision: [] as string[] };
  const d: EnsureDeps = {
    getUser: async () => ({ id: "u1", email: "asha@lakeview-builders.co.in" }),
    hasMembership: async () => member,
    provision: async (name) => {
      calls.provision.push(name);
      await new Promise((r) => setTimeout(r, 10));
      member = true;
      return { ok: true };
    },
    ...over,
  };
  return { d, calls };
}

describe("ensureOrganization", () => {
  test("a person with no membership is provisioned with the default name, once, even for two simultaneous calls", async () => {
    const { d, calls } = deps();
    const [a, b] = await Promise.all([ensureOrganization(d), ensureOrganization(d)]);
    expect(a.status).toBe("provisioned");
    expect(b.status).toBe("provisioned");
    expect(calls.provision).toEqual(["Lakeview Builders"]);
  });

  test("a later call re-reads the membership and leaves the new organisation alone", async () => {
    const { d, calls } = deps();
    await ensureOrganization(d);
    expect((await ensureOrganization(d)).status).toBe("present");
    expect(calls.provision.length).toBe(1);
  });

  test("a person who already has an organisation is left alone", async () => {
    const { d, calls } = deps({ member: true });
    expect((await ensureOrganization(d)).status).toBe("present");
    expect(calls.provision).toEqual([]);
  });

  test("signed out does nothing", async () => {
    const { d, calls } = deps({ getUser: async () => null });
    expect((await ensureOrganization(d)).status).toBe("signed_out");
    expect(calls.provision).toEqual([]);
  });

  test("a provisioning failure is reported with a plain sentence (never 'No organization')", async () => {
    const { d } = deps({ provision: async () => ({ ok: false }) });
    const r = await ensureOrganization(d);
    expect(r).toEqual({ status: "failed", error: ENSURE_FAILED_MESSAGE });
    expect(ENSURE_FAILED_MESSAGE).not.toMatch(/No organization/i);
  });

  test("a throw is a failure, not a crash", async () => {
    const { d } = deps({ hasMembership: async () => { throw new Error("offline"); } });
    expect((await ensureOrganization(d)).status).toBe("failed");
  });
});

describe("withOrgRetry (create-project after 'No organization')", () => {
  const isNoOrg = (e: unknown) => e instanceof Error && /No organization/.test(e.message);

  test("provisions once and retries the create once, returning the second result", async () => {
    let creates = 0, ensures = 0;
    const out = await withOrgRetry(
      async () => { creates++; if (creates === 1) throw new Error("No organization"); return { id: "p1" }; },
      async () => { ensures++; return { status: "provisioned" as const }; },
      isNoOrg,
    );
    expect(out).toEqual({ id: "p1" });
    expect([creates, ensures]).toEqual([2, 1]);
  });

  test("never retries twice: a second refusal propagates", async () => {
    let creates = 0;
    await expect(withOrgRetry(async () => { creates++; throw new Error("No organization"); }, async () => ({ status: "provisioned" as const }), isNoOrg)).rejects.toThrow("No organization");
    expect(creates).toBe(2);
  });

  test("other errors are not retried and do not provision", async () => {
    let ensures = 0;
    await expect(withOrgRetry(async () => { throw new Error("boom"); }, async () => { ensures++; return { status: "present" as const }; }, isNoOrg)).rejects.toThrow("boom");
    expect(ensures).toBe(0);
  });

  test("a failed set-up surfaces the plain sentence, is reported, and the create is not retried", async () => {
    let creates = 0;
    let reported = "";
    await expect(
      withOrgRetry(async () => { creates++; throw new Error("No organization"); }, async () => ({ status: "failed" as const, error: "VERIDIAN down" }), isNoOrg, (d) => { reported = d; }),
    ).rejects.toThrow(ENSURE_FAILED_MESSAGE);
    expect(creates).toBe(1);
    expect(reported).toBe("VERIDIAN down");
  });
});
