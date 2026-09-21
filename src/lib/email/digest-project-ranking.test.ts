/// <reference types="bun-types" />
import { describe, test, expect, mock } from "bun:test";

// Regression test for the verified PROJEXA-E2E digest gap: collectDigestItems()
// used to take the FIRST MAX_PROJECTS(3) projects out of /projects' own
// name-sorted response with no ranking. A real org (Meridian Construction
// Group) has near-empty "E2E-BatchA-..." fixture projects that sort before
// its one genuinely active project, so that project's open RFIs/submittals/
// punch/billing items were never scanned and the digest came back with only
// org-wide todos. This test reproduces that exact shape (three near-empty
// projects ahead, in name order, of one busy project) and asserts the busy
// project's items make it into the digest anyway.

type MembershipRow = { id: string; userId: string; organizationId: string };

const membership: MembershipRow = { id: "m1", userId: "u1", organizationId: "org1" };
const org = { id: "org1", name: "Meridian Construction Group" };
const profile = { id: "u1", email: "pm@example.com" };

// /projects' own name-sorted order: three near-empty fixtures first, the
// genuinely busy project last -- position 4, past the old raw slice(0, 3).
const projects = [
  { id: "p-a", name: "E2E-BatchA-1", status: "active" },
  { id: "p-b", name: "E2E-BatchA-2", status: "active" },
  { id: "p-c", name: "E2E-BatchA-3", status: "active" },
  { id: "p-zzz-busy", name: "Zenith Tower - Residential", status: "active" },
];

const emailDigestItemInserts: Array<{ refCode: number; entityType: string; entityId: string }> = [];
let deliverySentAt: unknown = "not-set";
let sentHtml = "";

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
        limit: (_n: number) => {
          if (table.__t === "memberships") return Promise.resolve([membership]);
          if (table.__t === "organizations") return Promise.resolve([org]);
          if (table.__t === "profiles") return Promise.resolve([profile]);
          if (table.__t === "todos") return Promise.resolve([]); // no org-wide todos -- isolates this test to project-sourced items
          return Promise.resolve([]);
        },
      }),
    };
  }

  function insertInto(table: { __t: string }) {
    return {
      values: (values: unknown) => {
        if (table.__t === "emailDigestDelivery") {
          return {
            returning: () => Promise.resolve([{ id: "delivery1", replyToken: "rt1" }]),
          };
        }
        if (table.__t === "emailDigestItem") {
          emailDigestItemInserts.push(...(values as Array<{ refCode: number; entityType: string; entityId: string }>));
          return Promise.resolve([]);
        }
        return Promise.resolve([]);
      },
    };
  }

  function updateTable(table: { __t: string }) {
    return {
      set: (patch: Record<string, unknown>) => ({
        where: () => {
          if (table.__t === "emailDigestDelivery") deliverySentAt = patch.sentAt;
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

mock.module("./schedule-service", () => ({
  listEnabledSchedules: async () => [],
  isDue: () => false,
  getOrgLocalDateTime: () => ({ localDate: "2026-09-21", minutesSinceMidnight: 0 }),
}));

mock.module("./send", () => ({
  sendEmail: async (payload: { to: string; subject: string; html: string }) => {
    sentHtml = payload.html;
    return { sent: true };
  },
  emailTemplate: (_title: string, bodyHtml: string) => bodyHtml,
  REPLY_DOMAIN: "reply.test.projexa-ai.com",
}));

mock.module("@/lib/veridian-client", () => ({
  callVeridianResult: async (path: string) => {
    if (path === "/projects") return { ok: true, status: 200, data: { projects } };

    const projectId = new URL(`https://x${path}`).searchParams.get("projectId");
    const isBusyProject = projectId === "p-zzz-busy";

    if (path.startsWith("/rfis")) {
      return {
        ok: true,
        status: 200,
        data: { rfis: isBusyProject ? [{ id: "rfi-1", number: 12, subject: "Rebar grade", status: "open" }] : [] },
      };
    }
    if (path.startsWith("/submittals")) {
      return {
        ok: true,
        status: 200,
        data: { submittals: isBusyProject ? [{ id: "sub-1", number: 4, title: "Shop drawings", status: "pending" }] : [] },
      };
    }
    if (path.startsWith("/punch-list")) {
      return {
        ok: true,
        status: 200,
        data: { items: isBusyProject ? [{ id: "punch-1", number: 7, description: "Paint touch-up", status: "open" }] : [] },
      };
    }
    if (path.startsWith("/billing-claims")) {
      return { ok: true, status: 200, data: { claims: [] } };
    }
    return { ok: false, status: 404, data: undefined };
  },
}));

const { sendDigestForMembership } = await import("./digest");

describe("collectDigestItems project ranking", () => {
  test("a busy project's items are included even when it's 4th (past the old raw top-3) in /projects' own order", async () => {
    const result = await sendDigestForMembership("m1");

    expect(result.sent).toBe(true);
    // Old behavior (naive slice(0, MAX_PROJECTS) over raw /projects order):
    // only the 3 near-empty fixtures would ever be scanned -> itemCount 0.
    expect(result.itemCount).toBe(3);

    const entityIds = emailDigestItemInserts.map((i) => i.entityId).sort();
    expect(entityIds).toEqual(["punch-1", "rfi-1", "sub-1"]);

    expect(sentHtml).toContain("RFI #12");
    expect(sentHtml).toContain("Zenith Tower - Residential");
    expect(deliverySentAt).not.toBeNull();
  });
});
