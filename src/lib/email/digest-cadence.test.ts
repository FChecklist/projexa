/// <reference types="bun-types" />
import { describe, test, expect, mock } from "bun:test";

type MembershipRow = { id: string; userId: string; organizationId: string };
type ScheduleRow = { scheduleId: string; organizationId: string; slot: string; localTime: string; timezone: string };

// Deterministic control over "is this schedule due right now" -- the actual
// timezone/bucket math is covered separately and exhaustively in
// schedule-service.test.ts (pure, no DB). Mocking the module lets this file
// test runDigestCadence's own orchestration (claim -> send -> report) without
// re-deriving real due-ness from wall-clock math.
let enabledSchedules: ScheduleRow[] = [];
let dueScheduleIds = new Set<string>();

mock.module("./schedule-service", () => ({
  listEnabledSchedules: async () => enabledSchedules,
  isDue: (localTime: string, _now: Date, _timezone: string) => {
    const match = enabledSchedules.find((s) => s.localTime === localTime);
    return match ? dueScheduleIds.has(match.scheduleId) : false;
  },
  getOrgLocalDateTime: () => ({ localDate: "2026-09-19", minutesSinceMidnight: 540 }),
}));

let orgMembershipQueue: MembershipRow[][] = [];
let membershipLookupQueue: MembershipRow[] = [];
let currentMembership: MembershipRow | null = null;
let orgsById: Record<string, { id: string; name: string }> = {};
let profilesByUserId: Record<string, { id: string; email: string }> = {};
let openTodosByOrg: Record<string, Array<{ id: string; text: string; dueDate: string | null }>> = {};

let claimResultQueue: Array<{ id: string } | undefined> = [];
let claimedRunIds: Array<{ organizationId: string; scheduleId: string; localDate: string }> = [];
let runUpdateCalls: Array<{ id: string; status: string; membershipsSent: number; membershipsFailed: number }> = [];

let sendEmailCalls: Array<{ to: string; subject: string }> = [];
let sendEmailImpl: (payload: { to: string }) => Promise<{ sent: boolean }> = async () => ({ sent: true });

mock.module("@/lib/db", () => {
  const memberships = { __t: "memberships" };
  const organizations = { __t: "organizations" };
  const profiles = { __t: "profiles" };
  const todos = { __t: "todos" };
  const emailDigestRun = { __t: "emailDigestRun" };
  const emailDigestDelivery = { __t: "emailDigestDelivery" };
  const emailDigestItem = { __t: "emailDigestItem" };

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
        // awaited directly with no .limit() -- same distinguishing trick as
        // the pre-existing version of this test used.
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) => {
          const list = table.__t === "memberships" ? orgMembershipQueue.shift() ?? [] : [];
          return Promise.resolve(list).then(resolve, reject);
        },
      }),
    };
  }

  function insertInto(table: { __t: string }) {
    return {
      values: (values: unknown) => ({
        onConflictDoNothing: () => ({
          returning: () => {
            const claimed = claimResultQueue.shift();
            if (claimed) claimedRunIds.push(values as { organizationId: string; scheduleId: string; localDate: string });
            return Promise.resolve(claimed ? [{ id: claimed.id }] : []);
          },
        }),
        returning: () => {
          if (table.__t === "emailDigestDelivery") {
            return Promise.resolve([{ id: `delivery-${currentMembership?.id}`, replyToken: `rt-${currentMembership?.id}` }]);
          }
          return Promise.resolve([{}]);
        },
      }),
    };
  }

  function updateTable(table: { __t: string }) {
    return {
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          if (table.__t === "emailDigestRun") {
            runUpdateCalls.push({ id: "run", status: patch.status as string, membershipsSent: patch.membershipsSent as number, membershipsFailed: patch.membershipsFailed as number });
          }
          return Promise.resolve();
        },
      }),
    };
  }

  return {
    db: {
      select: () => ({ from: selectFrom }),
      insert: (table: { __t: string }) => insertInto(table),
      update: (table: { __t: string }) => updateTable(table),
    },
    memberships,
    organizations,
    profiles,
    todos,
    emailDigestRun,
    emailDigestDelivery,
    emailDigestItem,
  };
});

mock.module("@/lib/services/email-token-service", () => ({
  issueEmailActionToken: async () => "raw-token",
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridianResult: async () => ({ ok: false, status: 0, data: undefined }),
}));

mock.module("./send", () => ({
  sendEmail: async (payload: { to: string; subject: string }) => {
    sendEmailCalls.push({ to: payload.to, subject: payload.subject });
    return sendEmailImpl(payload);
  },
  emailTemplate: (_title: string, bodyHtml: string) => bodyHtml,
  REPLY_DOMAIN: "reply.test.projexa-ai.com",
}));

const { runDigestCadence } = await import("./digest");

function reset() {
  enabledSchedules = [];
  dueScheduleIds = new Set();
  orgMembershipQueue = [];
  membershipLookupQueue = [];
  currentMembership = null;
  orgsById = {};
  profilesByUserId = {};
  openTodosByOrg = {};
  claimResultQueue = [];
  claimedRunIds = [];
  runUpdateCalls = [];
  sendEmailCalls = [];
  sendEmailImpl = async () => ({ sent: true });
}

describe("runDigestCadence", () => {
  test("a due schedule claims a run and sends every membership of that org", async () => {
    reset();
    enabledSchedules = [{ scheduleId: "sched1", organizationId: "org1", slot: "morning", localTime: "09:00", timezone: "Asia/Kolkata" }];
    dueScheduleIds = new Set(["sched1"]);
    claimResultQueue = [{ id: "run1" }];

    const m1: MembershipRow = { id: "m1", userId: "u1", organizationId: "org1" };
    const m2: MembershipRow = { id: "m2", userId: "u2", organizationId: "org1" };
    orgMembershipQueue = [[m1, m2]];
    membershipLookupQueue = [m1, m2];
    orgsById = { org1: { id: "org1", name: "Org One" } };
    profilesByUserId = { u1: { id: "u1", email: "member1@example.com" }, u2: { id: "u2", email: "member2@example.com" } };
    openTodosByOrg = { org1: [{ id: "t1", text: "Todo 1", dueDate: null }] };

    const result = await runDigestCadence(new Date());

    expect(result.runsProcessed).toBe(1);
    expect(result.checked).toBe(2);
    expect(result.sent).toBe(2);
    expect(result.failed).toBe(0);
    expect(sendEmailCalls.map((c) => c.to)).toEqual(["member1@example.com", "member2@example.com"]);
    expect(claimedRunIds).toEqual([{ organizationId: "org1", scheduleId: "sched1", localDate: "2026-09-19", status: "pending" }]);
    expect(runUpdateCalls[0]).toMatchObject({ status: "sent", membershipsSent: 2, membershipsFailed: 0 });
  });

  test("a not-due schedule is skipped entirely -- no claim attempted, nobody emailed", async () => {
    reset();
    enabledSchedules = [{ scheduleId: "sched1", organizationId: "org1", slot: "evening", localTime: "18:00", timezone: "Asia/Kolkata" }];
    dueScheduleIds = new Set(); // nothing due

    const result = await runDigestCadence(new Date());

    expect(result.runsProcessed).toBe(0);
    expect(result.checked).toBe(0);
    expect(claimedRunIds).toEqual([]);
    expect(sendEmailCalls).toEqual([]);
  });

  test("a due schedule that already ran today (conflict) is skipped -- idempotency, no duplicate send", async () => {
    reset();
    enabledSchedules = [{ scheduleId: "sched1", organizationId: "org1", slot: "morning", localTime: "09:00", timezone: "Asia/Kolkata" }];
    dueScheduleIds = new Set(["sched1"]);
    claimResultQueue = [undefined]; // ON CONFLICT DO NOTHING -> nothing returned, already claimed by another trigger

    const result = await runDigestCadence(new Date());

    expect(result.runsProcessed).toBe(0);
    expect(result.checked).toBe(0);
    expect(sendEmailCalls).toEqual([]);
  });

  test("one membership's send throwing doesn't abort the run -- reported failed, the other still sends, run marked partial", async () => {
    reset();
    enabledSchedules = [{ scheduleId: "sched1", organizationId: "org1", slot: "morning", localTime: "09:00", timezone: "Asia/Kolkata" }];
    dueScheduleIds = new Set(["sched1"]);
    claimResultQueue = [{ id: "run1" }];

    const m1: MembershipRow = { id: "m1", userId: "u1", organizationId: "org1" };
    const m2: MembershipRow = { id: "m2", userId: "u2", organizationId: "org1" };
    orgMembershipQueue = [[m1, m2]];
    membershipLookupQueue = [m1, m2];
    orgsById = { org1: { id: "org1", name: "Org One" } };
    profilesByUserId = { u1: { id: "u1", email: "member1@example.com" }, u2: { id: "u2", email: "member2@example.com" } };
    openTodosByOrg = { org1: [{ id: "t1", text: "Todo 1", dueDate: null }] };
    sendEmailImpl = async (payload) => {
      if (payload.to === "member1@example.com") throw new Error("bad email");
      return { sent: true };
    };

    const result = await runDigestCadence(new Date());

    expect(result.checked).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
    expect(runUpdateCalls[0]).toMatchObject({ status: "partial", membershipsSent: 1, membershipsFailed: 1 });
  });

  test("two due schedules for different orgs both process independently", async () => {
    reset();
    enabledSchedules = [
      { scheduleId: "sched1", organizationId: "org1", slot: "morning", localTime: "09:00", timezone: "Asia/Kolkata" },
      { scheduleId: "sched2", organizationId: "org2", slot: "morning", localTime: "09:00", timezone: "Asia/Dubai" },
    ];
    dueScheduleIds = new Set(["sched1", "sched2"]);
    claimResultQueue = [{ id: "run1" }, { id: "run2" }];

    const m1: MembershipRow = { id: "m1", userId: "u1", organizationId: "org1" };
    const m2: MembershipRow = { id: "m2", userId: "u2", organizationId: "org2" };
    orgMembershipQueue = [[m1], [m2]];
    membershipLookupQueue = [m1, m2];
    orgsById = { org1: { id: "org1", name: "Org One" }, org2: { id: "org2", name: "Org Two" } };
    profilesByUserId = { u1: { id: "u1", email: "member1@example.com" }, u2: { id: "u2", email: "member2@example.com" } };
    openTodosByOrg = { org1: [], org2: [] };

    const result = await runDigestCadence(new Date());

    expect(result.runsProcessed).toBe(2);
    expect(result.sent).toBe(2);
    expect(claimedRunIds).toEqual([
      { organizationId: "org1", scheduleId: "sched1", localDate: "2026-09-19", status: "pending" },
      { organizationId: "org2", scheduleId: "sched2", localDate: "2026-09-19", status: "pending" },
    ]);
  });
});
