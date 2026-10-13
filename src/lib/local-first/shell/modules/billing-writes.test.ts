import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { findFunction } from "../../ai/registry";
import { createOutbox, type Outbox } from "../../outbox";
import { createReplica } from "../../replica";
import { loadBilling, type BillingData } from "./billing-adapter";
import { DRAFT_UNTIL_CONFIRMED, createBillingMilestoneOffline, mayCreateBillingMilestone, type NewBillingMilestone } from "./billing-writes";
import { shellData } from "./documents-test-fixtures";
import { seedOrgKinds } from "./finance-test-seed";

// R-95 / checklist 2.14: a billing milestone made with no network is a DRAFT. The laptop sends create_progress_claim (registry: level 2, manager rank),
// which the server turns into ONE claim in the state "milestone achieved": no invoice, no amount. Real replica and outbox against the shared fake
// sync server. The server's own end (only the claim row is written, nothing invoiced) is proven in compliance-tracker
// src/lib/pipeline/coverage-wave7.test.ts (create_progress_claim: one claim row, only in construction_progress_claims, nothing invoiced; no function approves or invoices a claim).

type Rig = { idb: IDBFactory; server: FakeSyncServer; outbox: Outbox; enqueued: () => number };

const CUSTOMERS = [
  { id: "c-here", customer_name: "Lakeview Developers", is_active: true },
  { id: "c-other", customer_name: "Asha Interiors", is_active: true },
  { id: "c-gone", customer_name: "Closed Co", is_active: false },
];

async function rig(opts: { boqs?: Record<string, unknown>[] } = {}): Promise<Rig> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ kinds: [{ kind: "progress_claims" }, { kind: "boqs" }] });
  server.registerFunction("create_progress_claim", ({ params }) => ({
    ok: true, kind: "progress_claims", id: "claim-srv",
    data: {
      id: "claim-srv", boq_id: params.boqId, customer_id: params.customerId, milestone_description: params.milestoneDescription, scheduled_date: params.scheduledDate,
      retention_percent: params.retentionPercent ?? 0, status: "milestone_achieved", interim_bill_id: null,
    },
  }));
  const boqs = opts.boqs ?? [
    { id: "boq-1", title: "Original", version: 1, status: "approved" },
    { id: "boq-2", title: "Revision", version: 2, status: "approved" },
    { id: "boq-3", title: "Draft revision", version: 3, status: "draft" },
  ];
  for (const b of boqs) server.upsert({ kind: "boqs", projectId: "p1", id: String(b.id), data: b });
  server.upsert({ kind: "progress_claims", projectId: "p1", id: "claim-old", data: { id: "claim-old", boq_id: "boq-1", customer_id: "c-here", milestone_description: "Mobilisation", scheduled_date: "2026-09-01", status: "invoiced", interim_bill_id: "b1" } });
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  await seedOrgKinds(idb, [{ kind: "customers", rows: CUSTOMERS }]);
  let n = 0;
  const real = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++n}` });
  let enqueued = 0;
  const outbox: Outbox = { ...real, enqueue: async (input) => { enqueued += 1; return real.enqueue(input); } };
  return { idb, server, outbox, enqueued: () => enqueued };
}
const pushed = (r: Rig) => r.server.requests.filter((q) => q.path === "/push").flatMap((q) => q.body.ops as Record<string, unknown>[]);

const manager = (r: Rig, role = "manager") => shellData(r.idb as never, "u1", "orgA", role);
async function local(r: Rig, role = "manager"): Promise<Extract<BillingData, { state: "local" }>> {
  const b = await loadBilling(manager(r, role), "p1");
  if (b.state !== "local") throw new Error(`expected local, got ${b.state}`);
  return b;
}
const INPUT: NewBillingMilestone = { projectId: "p1", boqId: "boq-2", customerId: "c-here", milestoneDescription: "  Slab complete, level 2 ", scheduledDate: "2026-10-30", retentionPercent: "5" };

describe("the registry copy names exactly what the laptop sends, and its rank", () => {
  test("create_progress_claim declares every parameter this writer uses; it is a manager-rank, level-2 (draft) money function", () => {
    const fn = findFunction("create_progress_claim")!;
    for (const p of ["projectId", "boqId", "customerId", "milestoneDescription", "scheduledDate", "retentionPercent"]) expect(fn.declared_params).toContain(p);
    expect([fn.min_role_rank, fn.link_level, fn.money_sensitive]).toEqual([3, 2, true]);
  });
  test("only a manager rank and above is offered the form; a member, a viewer and an unknown role are not", () => {
    expect(["manager", "branch_manager", "admin"].map(mayCreateBillingMilestone)).toEqual([true, true, true]);
    expect(["member", "viewer", "client_viewer", null, "nobody"].map(mayCreateBillingMilestone)).toEqual([false, false, false, false, false]);
  });
});

describe("what the form is offered from the laptop's own copy", () => {
  test("the latest APPROVED BOQ only (a draft revision is not billed against); active customers, the ones billed on this project first", async () => {
    const r = await rig();
    const b = await local(r);
    expect(b.choices.boq).toEqual({ id: "boq-2", title: "Revision", version: 2 });
    expect(b.choices.customers).toEqual([
      { id: "c-here", name: "Lakeview Developers", billedHere: true },
      { id: "c-other", name: "Asha Interiors", billedHere: false },
    ]);
  });

  test("no approved BOQ at all: none is offered", async () => {
    const r = await rig({ boqs: [{ id: "boq-d", title: "Draft", version: 1, status: "draft" }] });
    expect((await local(r)).choices.boq).toBeNull();
  });
});

describe("create_progress_claim offline", () => {
  test("kept at once as a waiting DRAFT with no invoice; nothing sent until a flush; then ONE op with the registry's names and no record version; replaced by the server's claim", async () => {
    const r = await rig();
    const data = manager(r);
    const choices = (await local(r)).choices;
    const res = await createBillingMilestoneOffline(data, INPUT, choices, { outbox: r.outbox, newId: () => "t1" });
    expect(res).toEqual({ queued: true, opId: "op-1", tempId: "local-t1" });
    expect(pushed(r)).toEqual([]);

    const during = await local(r);
    expect(during.claims.find((c) => c.id === "local-t1")).toMatchObject({
      description: "Slab complete, level 2", status: "milestone_achieved", scheduledDate: "2026-10-30", waiting: true, customerName: "Lakeview Developers", interimBillId: null, steps: [],
    });
    expect(during.claims.find((c) => c.id === "claim-old")!.waiting).toBe(false);

    await r.outbox.flush();
    expect(pushed(r)).toEqual([expect.objectContaining({
      op_id: "op-1", function_id: "create_progress_claim", project_id: "p1",
      params: { projectId: "p1", boqId: "boq-2", customerId: "c-here", milestoneDescription: "Slab complete, level 2", scheduledDate: "2026-10-30", retentionPercent: 5 },
    })]);
    expect(pushed(r)[0]!.record).toBeUndefined();
    const after = await local(r);
    expect(after.claims.map((c) => [c.id, c.status, c.waiting])).toEqual([["claim-srv", "milestone_achieved", false], ["claim-old", "invoiced", false]]);
  });

  test("the retention is optional and is not sent when blank", async () => {
    const r = await rig();
    const choices = (await local(r)).choices;
    expect((await createBillingMilestoneOffline(manager(r), { ...INPUT, retentionPercent: "" }, choices, { outbox: r.outbox })).queued).toBe(true);
    await r.outbox.flush();
    expect(Object.keys(pushed(r)[0]!.params as object).sort()).toEqual(["boqId", "customerId", "milestoneDescription", "projectId", "scheduledDate"]);
  });

  test("refused in words with nothing queued: a member, no text, text over 2,000 letters, a date that is not a real day, retention out of range", async () => {
    const r = await rig();
    const choices = (await local(r)).choices;
    const data = manager(r);
    const cases: [string, Promise<Awaited<ReturnType<typeof createBillingMilestoneOffline>>>][] = [
      ["role", createBillingMilestoneOffline(manager(r, "member"), INPUT, choices, { outbox: r.outbox })],
      ["description", createBillingMilestoneOffline(data, { ...INPUT, milestoneDescription: "   " }, choices, { outbox: r.outbox })],
      ["description", createBillingMilestoneOffline(data, { ...INPUT, milestoneDescription: "x".repeat(2001) }, choices, { outbox: r.outbox })],
      ["date", createBillingMilestoneOffline(data, { ...INPUT, scheduledDate: "2026-02-30" }, choices, { outbox: r.outbox })],
      ["date", createBillingMilestoneOffline(data, { ...INPUT, scheduledDate: "" }, choices, { outbox: r.outbox })],
      ["retention", createBillingMilestoneOffline(data, { ...INPUT, retentionPercent: "101" }, choices, { outbox: r.outbox })],
      ["retention", createBillingMilestoneOffline(data, { ...INPUT, retentionPercent: "-1" }, choices, { outbox: r.outbox })],
      ["retention", createBillingMilestoneOffline(data, { ...INPUT, retentionPercent: "lots" }, choices, { outbox: r.outbox })],
    ];
    for (const [reason, promise] of cases) {
      const res = await promise;
      expect(res.queued).toBe(false);
      if (!res.queued) {
        expect(res.reason).toBe(reason as never);
        expect(res.message).toContain("Nothing was saved");
      }
    }
    expect(r.enqueued()).toBe(0);
  });

  test("a BOQ that is not the one offered, a customer that is not on the laptop or is inactive, another project, another person: refused, nothing queued", async () => {
    const r = await rig();
    const choices = (await local(r)).choices;
    const data = manager(r);
    const reasons = await Promise.all([
      createBillingMilestoneOffline(data, { ...INPUT, boqId: "boq-3" }, choices, { outbox: r.outbox }),
      createBillingMilestoneOffline(data, { ...INPUT, boqId: "" }, { ...choices, boq: null }, { outbox: r.outbox }),
      createBillingMilestoneOffline(data, { ...INPUT, customerId: "c-gone" }, choices, { outbox: r.outbox }),
      createBillingMilestoneOffline(data, { ...INPUT, customerId: "" }, choices, { outbox: r.outbox }),
      createBillingMilestoneOffline(data, { ...INPUT, projectId: "p9" }, choices, { outbox: r.outbox }),
      createBillingMilestoneOffline(shellData(r.idb as never, "u2", "orgA", "manager"), INPUT, choices, { outbox: r.outbox }),
      createBillingMilestoneOffline(shellData(r.idb as never, "u1", "orgB", "manager"), INPUT, choices, { outbox: r.outbox }),
    ]);
    expect(reasons.map((x) => (x.queued ? "queued" : x.reason))).toEqual(["no_boq", "no_boq", "no_customer", "no_customer", "not_on_laptop", "not_on_laptop", "not_on_laptop"]);
    expect(r.enqueued()).toBe(0);
  });

  test("a refusal by the server (the customer is not this project's client) leaves no waiting row and keeps what the person typed as a draft", async () => {
    const r = await rig();
    r.server.registerFunction("create_progress_claim", () => ({ rejected: "RECORD_NOT_FOUND" }));
    const choices = (await local(r)).choices;
    await createBillingMilestoneOffline(manager(r), { ...INPUT, customerId: "c-other" }, choices, { outbox: r.outbox, newId: () => "t2" });
    await r.outbox.flush();
    const after = await local(r);
    expect(after.claims.map((c) => c.id)).toEqual(["claim-old"]);
    const draft = await r.outbox.getDraft("op-1");
    expect(draft?.functionId).toBe("create_progress_claim");
    expect(draft?.params).toMatchObject({ customerId: "c-other", milestoneDescription: "Slab complete, level 2" });
  });

  test("the screen's draft sentence says no money and no invoice, and that a person with the billing role confirms it online", () => {
    expect(DRAFT_UNTIL_CONFIRMED).toContain("Draft until confirmed");
    expect(DRAFT_UNTIL_CONFIRMED).toContain("no money is posted");
    expect(DRAFT_UNTIL_CONFIRMED).toContain("no invoice");
    expect(DRAFT_UNTIL_CONFIRMED).toContain("billing role confirms it online");
  });
});
