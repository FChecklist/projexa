/// <reference types="bun-types" />
import { beforeEach, describe, expect, mock, test } from "bun:test";

let invites: unknown[] = [];
let provisionCalls: { userId: string; name: string }[] = [];
let provisionResult: { status: number; body: Record<string, unknown> } | Error = { status: 201, body: { organizationId: "o" } };

const chain: any = { from: () => chain, where: () => chain, limit: async () => invites };
mock.module("@/lib/db", () => ({ db: { select: () => chain }, orgInvites: { id: "id", email: "email", acceptedAt: "a", revokedAt: "r", expiresAt: "e" } }));
mock.module("./provision-org", () => ({
  provisionOrgForUser: async (_s: unknown, userId: string, name: string) => {
    provisionCalls.push({ userId, name });
    if (provisionResult instanceof Error) throw provisionResult;
    return provisionResult;
  },
}));

const { autoProvisionOrganization, resetAutoProvisionCooldown } = await import("./auto-provision");
const sb = { from: () => ({}) };

beforeEach(() => {
  invites = [];
  provisionCalls = [];
  provisionResult = { status: 201, body: { organizationId: "o" } };
  resetAutoProvisionCooldown();
});

describe("autoProvisionOrganization", () => {
  test("provisions with the default name derived from the e-mail", async () => {
    expect(await autoProvisionOrganization(sb, { id: "u1", email: "sumeetds@gmail.com" })).toEqual({ ok: true });
    expect(provisionCalls).toEqual([{ userId: "u1", name: "My Company" }]);
  });

  test("a live invitation for the address means: do not start an organisation of their own", async () => {
    invites = [{ id: "i1" }];
    expect(await autoProvisionOrganization(sb, { id: "u1", email: "a@b.com" })).toEqual({ ok: false, reason: "invite_pending" });
    expect(provisionCalls).toEqual([]);
  });

  test("a failure is reported, and repeated calls within the cooldown do not hammer provisioning", async () => {
    provisionResult = { status: 502, body: { error: "x" } };
    const t = 1_000_000;
    expect(await autoProvisionOrganization(sb, { id: "u1", email: "a@b.com" }, { now: () => t })).toEqual({ ok: false, reason: "failed" });
    expect(await autoProvisionOrganization(sb, { id: "u1", email: "a@b.com" }, { now: () => t + 1000 })).toEqual({ ok: false, reason: "failed" });
    expect(provisionCalls.length).toBe(1);
    provisionResult = { status: 201, body: {} };
    expect(await autoProvisionOrganization(sb, { id: "u1", email: "a@b.com" }, { now: () => t + 11_000 })).toEqual({ ok: true });
  });

  test("a throw is a failure", async () => {
    provisionResult = new Error("db down");
    expect(await autoProvisionOrganization(sb, { id: "u9", email: null })).toEqual({ ok: false, reason: "failed" });
  });
});
