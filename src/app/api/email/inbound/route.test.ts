/// <reference types="bun-types" />
import { describe, test, expect, mock } from "bun:test";

const AUTH_HEADER = "Basic " + Buffer.from("wh_user:wh_pass").toString("base64");

let membershipRow: { id: string; userId: string; organizationId: string } | null;
let profileRow: { id: string; email: string } | null;
let deliveryRow: { id: string; organizationId: string; membershipId: string; replyToken: string } | null;
let digestItems: Array<{ id: string; refCode: number; entityType: string; entityId: string; allowedVerbs: string[]; consumedAt: Date | null }>;

let auditLogRows: Array<{ event: string; actor: string; metadata: Record<string, unknown> }> = [];
let reportNoteRows: Array<{ organizationId: string; membershipId: string; deliveryId: string | null; rawText: string }> = [];

let consumeCalls: Array<{ itemId: string; verb: string }> = [];
let consumeResult: (itemId: string) => boolean = () => true;
let applyCalls: Array<{ entityType: string; entityId: string; verb: string; payloadText: string }> = [];
let applyImpl: (entityType: string, entityId: string, verb: string) => Promise<void> = async () => {};

let sendEmailCalls: Array<{ to: string; subject: string }> = [];

process.env.POSTMARK_INBOUND_USERNAME = "wh_user";
process.env.POSTMARK_INBOUND_PASSWORD = "wh_pass";

mock.module("@/lib/db", () => ({
  db: {
    select: () => ({
      from: (table: { __t: string }) => ({
        where: () => ({
          limit: () => {
            if (table.__t === "memberships") return Promise.resolve(membershipRow ? [membershipRow] : []);
            if (table.__t === "profiles") return Promise.resolve(profileRow ? [profileRow] : []);
            return Promise.resolve([]);
          },
        }),
      }),
    }),
    insert: (table: { __t: string }) => ({
      values: (values: Record<string, unknown>) => {
        if (table.__t === "securityAuditLog") auditLogRows.push(values as (typeof auditLogRows)[number]);
        if (table.__t === "dailyReportNote") reportNoteRows.push(values as (typeof reportNoteRows)[number]);
        return Promise.resolve();
      },
    }),
  },
  memberships: { __t: "memberships" },
  profiles: { __t: "profiles" },
  securityAuditLog: { __t: "securityAuditLog" },
  dailyReportNote: { __t: "dailyReportNote" },
}));

mock.module("@/lib/services/digest-item-service", () => ({
  findDeliveryByReplyToken: async (token: string) => (deliveryRow && deliveryRow.replyToken === token ? deliveryRow : null),
  listDigestItemsForDelivery: async () => digestItems,
  consumeDigestItem: async (itemId: string, verb: string) => {
    consumeCalls.push({ itemId, verb });
    return consumeResult(itemId);
  },
}));

mock.module("@/lib/services/digest-item-dispatcher", () => ({
  applyDigestItemVerb: async (entityType: string, entityId: string, verb: string, payloadText: string) => {
    applyCalls.push({ entityType, entityId, verb, payloadText });
    return applyImpl(entityType, entityId, verb);
  },
}));

mock.module("@/lib/email/send", () => ({
  sendEmail: async (payload: { to: string; subject: string }) => {
    sendEmailCalls.push({ to: payload.to, subject: payload.subject });
    return { sent: true };
  },
  emailTemplate: (_title: string, bodyHtml: string) => bodyHtml,
}));

const { POST } = await import("./route");

function reset() {
  membershipRow = { id: "m1", userId: "u1", organizationId: "org1" };
  profileRow = { id: "u1", email: "site@example.com" };
  deliveryRow = { id: "delivery1", organizationId: "org1", membershipId: "m1", replyToken: "abc123" };
  digestItems = [
    { id: "item1", refCode: 1, entityType: "todo", entityId: "todo-uuid-1", allowedVerbs: ["done", "note"], consumedAt: null },
    { id: "item2", refCode: 2, entityType: "rfi", entityId: "rfi-uuid-2", allowedVerbs: ["answer"], consumedAt: null },
  ];
  auditLogRows = [];
  reportNoteRows = [];
  consumeCalls = [];
  consumeResult = () => true;
  applyCalls = [];
  applyImpl = async () => {};
  sendEmailCalls = [];
}

function request(body: unknown, headers: Record<string, string> = { authorization: AUTH_HEADER }) {
  return new Request("http://localhost/api/email/inbound", { method: "POST", headers, body: JSON.stringify(body) }) as never;
}

describe("POST /api/email/inbound", () => {
  test("no Authorization header -> 401, nothing touched", async () => {
    reset();
    const res = await POST(request({ To: "d-abc123@reply.projexa-ai.com" }, {}));
    expect(res.status).toBe(401);
    expect(consumeCalls).toEqual([]);
  });

  test("wrong Basic Auth credentials -> 401", async () => {
    reset();
    const badAuth = "Basic " + Buffer.from("wrong:wrong").toString("base64");
    const res = await POST(request({ To: "d-abc123@reply.projexa-ai.com" }, { authorization: badAuth }));
    expect(res.status).toBe(401);
  });

  test("unknown reply token -> 200 (no retry storm), nothing applied, refusal logged", async () => {
    reset();
    const res = await POST(request({ To: "d-doesnotexist@reply.projexa-ai.com", From: "site@example.com", TextBody: "1 done" }));
    expect(res.status).toBe(200);
    expect(consumeCalls).toEqual([]);
    expect(auditLogRows.some((r) => r.event === "email_reply_refused" && r.metadata.reason === "unknown_reply_token")).toBe(true);
  });

  test("From address doesn't match the membership's profile email -> refused, nothing applied", async () => {
    reset();
    const res = await POST(
      request({ To: "d-abc123@reply.projexa-ai.com", From: "someone-else@example.com", TextBody: "1 done" })
    );
    expect(res.status).toBe(200);
    expect(consumeCalls).toEqual([]);
    expect(auditLogRows.some((r) => r.event === "email_reply_refused" && r.metadata.reason === "sender_mismatch")).toBe(true);
  });

  test("matching sender, 'StrippedTextReply' preferred over 'TextBody' -- a numbered done applies and is acknowledged", async () => {
    reset();
    const res = await POST(
      request({
        To: "d-abc123@reply.projexa-ai.com",
        From: "site@example.com",
        TextBody: "1 done\n\n> quoted original digest below\n> 1. Pour foundation",
        StrippedTextReply: "1 done",
      })
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, applied: 1, failed: 0, noted: false });
    expect(consumeCalls).toEqual([{ itemId: "item1", verb: "done" }]);
    expect(applyCalls).toEqual([{ entityType: "todo", entityId: "todo-uuid-1", verb: "done", payloadText: "" }]);
    expect(auditLogRows.some((r) => r.event === "email_reply_item_applied")).toBe(true);
    expect(sendEmailCalls).toHaveLength(1);
    expect(sendEmailCalls[0].to).toBe("site@example.com");
  });

  test("already-consumed item (a concurrent/duplicate webhook) is never double-applied", async () => {
    reset();
    consumeResult = () => false; // lost the race / already handled
    const res = await POST(request({ To: "d-abc123@reply.projexa-ai.com", From: "site@example.com", TextBody: "1 done" }));
    const body = await res.json();
    expect(body.applied).toBe(0);
    expect(applyCalls).toEqual([]);
    expect(auditLogRows.some((r) => r.event === "email_reply_item_refused" && r.metadata.reason === "already_consumed")).toBe(true);
  });

  test("applying the verb throws (e.g. VERIDIAN rejects the transition) -> recorded as a failed application, not silently lost", async () => {
    reset();
    applyImpl = async () => {
      throw new Error("RFI already answered");
    };
    const res = await POST(request({ To: "d-abc123@reply.projexa-ai.com", From: "site@example.com", TextBody: "2 answer: use grade-40 rebar" }));
    const body = await res.json();
    expect(body.applied).toBe(0);
    expect(body.failed).toBe(1);
    expect(consumeCalls).toEqual([{ itemId: "item2", verb: "answer" }]); // claimed before the failed apply -- no retry/double-apply
    expect(auditLogRows.some((r) => r.event === "email_reply_item_apply_failed")).toBe(true);
  });

  test("unmatched free text becomes a daily_report_note, not silently dropped", async () => {
    reset();
    const res = await POST(
      request({ To: "d-abc123@reply.projexa-ai.com", From: "site@example.com", TextBody: "1 done\nAlso starting electrical tomorrow." })
    );
    const body = await res.json();
    expect(body.noted).toBe(true);
    expect(reportNoteRows).toEqual([{ organizationId: "org1", membershipId: "m1", deliveryId: "delivery1", rawText: "Also starting electrical tomorrow." }]);
  });
});
