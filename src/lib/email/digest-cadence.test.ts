/// <reference types="bun-types" />
import { describe, test, expect, mock } from "bun:test";

type MembershipRow = { id: string; userId: string; organizationId: string };

let openOrgIds: string[] = [];
let orgMembershipQueue: MembershipRow[][] = [];
let membershipLookupQueue: MembershipRow[] = [];
let currentMembership: MembershipRow | null = null;
let orgsById: Record<string, { id: string; name: string }> = {};
let profilesByUserId: Record<string, { id: string; email: string }> = {};
let openTodosByOrg: Record<string, Array<{ id: string; text: string }>> = {};

let sendEmailCalls: Array<{ to: string; subject: string }> = [];
let sendEmailImpl: (payload: { to: string }) => Promise<{ sent: boolean }> = async () => ({ sent: true });

// Same mocking posture as send-digest/route.test.ts and [token]/route.test.ts:
// runDigestCadence calls the REAL sendDigestForMembership (same-module self
// call, can't be mocked from outside), so @/lib/db has to serve both
// runDigestCadence's own org/membership scan AND sendDigestForMembership's
// per-membership lookups. Table identity comes from the opaque `__t` stand-in
// each mocked export carries; .where()'s args are ignored (never inspected,
// same as the org-scoping precedent) -- instead, "which row" is tracked via
// closure state (queues popped in the exact sequential-call order
// runDigestCadence produces, since it awaits one membership at a time, never
// concurrently).
mock.module("@/lib/db", () => {
  const memberships = { __t: "memberships" };
  const organizations = { __t: "organizations" };
  const profiles = { __t: "profiles" };
  const todos = { __t: "todos" };

  function selectFrom(table: { __t: string }) {
    return {
      where: () => ({
        limit: (n: number) => {
          if (table.__t === "memberships") {
            const m = membershipLookupQueue.shift() ?? null;
            currentMembership = m;
            return Promise.resolve(m ? [m] : []);
          }
          if (table.__t === "organizations") {
            const org = currentMembership ? orgsById[currentMembership.organizationId] : undefined;
            return Promise.resolve(org ? [org] : []);
          }
          if (table.__t === "profiles") {
            const p = currentMembership ? profilesByUserId[currentMembership.userId] : undefined;
            return Promise.resolve(p ? [p] : []);
          }
          if (table.__t === "todos") {
            const orgId = currentMembership?.organizationId;
            const rows = orgId ? openTodosByOrg[orgId] ?? [] : [];
            return Promise.resolve(rows.slice(0, n));
          }
          return Promise.resolve([]);
        },
        // runDigestCadence's own "every membership in this org" listing is
        // awaited directly, with no .limit() call -- that's what
        // distinguishes it from sendDigestForMembership's single-row lookup
        // above, both of which query the same `memberships` table.
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          const list = table.__t === "memberships" ? orgMembershipQueue.shift() ?? [] : [];
          return Promise.resolve(list).then(resolve, reject);
        },
      }),
    };
  }

  return {
    db: {
      selectDistinct: () => ({
        from: () => ({
          where: () => Promise.resolve(openOrgIds.map((organizationId) => ({ organizationId }))),
        }),
      }),
      select: () => ({ from: selectFrom }),
    },
    memberships,
    organizations,
    profiles,
    todos,
  };
});

mock.module("@/lib/services/email-token-service", () => ({
  issueEmailActionToken: async () => "raw-token",
}));

mock.module("@/lib/email/send", () => ({
  sendEmail: async (payload: { to: string; subject: string }) => {
    sendEmailCalls.push({ to: payload.to, subject: payload.subject });
    return sendEmailImpl(payload);
  },
  emailTemplate: (_title: string, bodyHtml: string) => bodyHtml,
  REPLY_DOMAIN: "reply.test.projexa-ai.com",
}));

const { runDigestCadence } = await import("./digest");

function reset() {
  openOrgIds = [];
  orgMembershipQueue = [];
  membershipLookupQueue = [];
  currentMembership = null;
  orgsById = {};
  profilesByUserId = {};
  openTodosByOrg = {};
  sendEmailCalls = [];
  sendEmailImpl = async () => ({ sent: true });
}

describe("runDigestCadence", () => {
  test("an org with 2 open todos across 2 memberships -> both get a digest attempt", async () => {
    reset();
    const m1: MembershipRow = { id: "m1", userId: "u1", organizationId: "org1" };
    const m2: MembershipRow = { id: "m2", userId: "u2", organizationId: "org1" };
    openOrgIds = ["org1"];
    orgMembershipQueue = [[m1, m2]];
    membershipLookupQueue = [m1, m2];
    orgsById = { org1: { id: "org1", name: "Org One" } };
    profilesByUserId = {
      u1: { id: "u1", email: "member1@example.com" },
      u2: { id: "u2", email: "member2@example.com" },
    };
    openTodosByOrg = {
      org1: [
        { id: "t1", text: "Todo 1" },
        { id: "t2", text: "Todo 2" },
      ],
    };

    const result = await runDigestCadence();

    expect(result.checked).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    // one send per membership, addressed to that membership's own profile email
    expect(sendEmailCalls.map((c) => c.to)).toEqual(["member1@example.com", "member2@example.com"]);
  });

  test("an org with zero open todos -> zero digest attempts", async () => {
    reset();
    openOrgIds = []; // no org came back from the "distinct org with an open todo" scan

    const result = await runDigestCadence();

    expect(result.checked).toBe(0);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.results).toEqual([]);
    expect(sendEmailCalls).toEqual([]);
  });

  test("one membership's send throwing doesn't abort the run -- it's reported as failed, the other still sends", async () => {
    reset();
    const m1: MembershipRow = { id: "m1", userId: "u1", organizationId: "org1" };
    const m2: MembershipRow = { id: "m2", userId: "u2", organizationId: "org1" };
    openOrgIds = ["org1"];
    orgMembershipQueue = [[m1, m2]];
    membershipLookupQueue = [m1, m2];
    orgsById = { org1: { id: "org1", name: "Org One" } };
    profilesByUserId = {
      u1: { id: "u1", email: "member1@example.com" },
      u2: { id: "u2", email: "member2@example.com" },
    };
    openTodosByOrg = { org1: [{ id: "t1", text: "Todo 1" }] };
    sendEmailImpl = async (payload) => {
      if (payload.to === "member1@example.com") throw new Error("bad email");
      return { sent: true };
    };

    const result = await runDigestCadence();

    expect(result.checked).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results.find((r) => r.membershipId === "m1")).toMatchObject({ sent: false, error: "bad email" });
    expect(result.results.find((r) => r.membershipId === "m2")).toMatchObject({ sent: true });
    // both were attempted despite the first one throwing
    expect(sendEmailCalls).toHaveLength(2);
  });
});
