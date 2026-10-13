import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "../../__fixtures__/fake-sync-server";
import golden from "../../__fixtures__/real-sync-rows.json";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { createOutbox, type Outbox } from "../../outbox";
import { emptyLine, type LineItemDraft } from "@/lib/boq-helpers";
import { deliveryShellData, seedDelivery } from "./delivery-test-seed";
import { loadScopeList, loadScopeRevise, type ScopeReviseData } from "./scope-adapter";
import { addScopeItemsOffline, reviseBoqOffline, scopeNotQueuedMessage, type LinkableChangeOrder } from "./scope-writes";

// R-96 (add a scope item) and R-98 / R-97 (change of scope: a revision carried out FOR an approved change order), with no network. A scope item is a
// create_boq_revision that keeps every line and adds the new ones; a change of scope is the same revision with sourceChangeOrderId. The laptop checks the
// server's rules from its own copy: a line with work recorded on site cannot be removed or reduced, only an approved change order nobody has made a
// revision from can be linked, and a BOQ can be revised only once. Real outbox against the shared fake sync server.
// The server's end of the same rules: compliance-tracker src/lib/pipeline/executor.offline-scope-change.test.ts.

type Row = Record<string, unknown>;
const line = (over: Row): Row => ({ ...(golden.boq_lines[0] as Row), boq_id: "boq-1", parent_line_item_id: null, breakdown_percentage: null, budget_percentage: 25, ...over });

const BOQ: Row = { ...(golden.boqs[0] as Row), id: "boq-1", title: "Villa BOQ", status: "approved", version: 1, project_id: "p1", parent_boq_id: null };
const LINES: Row[] = [
  line({ id: "li-a1", item_code: "A1", description: "Blockwork", unit: "sqm", quantity: 100, rate: 50, amount: 5000 }),
  line({ id: "li-a2", item_code: "A2", description: "Plaster", unit: "sqm", quantity: 200, rate: 20, amount: 4000 }),
];
const PROGRESS: Row[] = [{ id: "pr1", boq_line_item_id: "li-a1", entry_date: "2026-10-01", percent_complete: 40, created_at: "2026-10-01T08:00:00Z" }];
const CHANGE_ORDERS: Row[] = [
  { id: "co-ok", number: 7, title: "Extra waterproofing", status: "approved", boq_revision_id: null },
  { id: "co-draft", number: 8, title: "Still a draft", status: "draft", boq_revision_id: null },
  { id: "co-linked", number: 5, title: "Already carried out", status: "approved", boq_revision_id: "boq-0" },
];

type Rig = { idb: IDBFactory; server: FakeSyncServer; outbox: Outbox; enqueued: () => number };

async function rig(): Promise<Rig> {
  const idb = new IDBFactory();
  await seedDelivery(idb, [
    { projectId: "p1", kind: "boqs", rows: [BOQ] },
    { projectId: "p1", kind: "boq_lines", rows: LINES },
    { projectId: "p1", kind: "progress", rows: PROGRESS },
    { projectId: "p1", kind: "change_orders", rows: CHANGE_ORDERS },
  ], { projectIds: ["p1"] });
  const server = createFakeSyncServer({ kinds: [{ kind: "boqs" }] });
  server.registerFunction("create_boq_revision", ({ params }) => ({ ok: true, kind: "boqs", id: "boq-2", data: { id: "boq-2", title: params.title, status: "draft", version: 2, project_id: "p1", parent_boq_id: params.boqId } }));
  let n = 0;
  const real = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++n}` });
  let enqueued = 0;
  const outbox: Outbox = { ...real, enqueue: async (input) => { enqueued += 1; return real.enqueue(input); } };
  return { idb, server, outbox, enqueued: () => enqueued };
}
const pushed = (r: Rig) => r.server.requests.filter((q) => q.path === "/push").flatMap((q) => q.body.ops as Record<string, unknown>[]);

async function ready(r: Rig): Promise<Extract<ScopeReviseData, { state: "ready" }>> {
  const d = await loadScopeRevise(deliveryShellData(r.idb as never), "boq-1", "p1");
  if (d.state !== "ready") throw new Error(`expected ready, got ${d.state}`);
  return d;
}

const item = (over: Partial<LineItemDraft> = {}): LineItemDraft => ({ ...emptyLine(), description: "Waterproofing", unit: "sqm", quantity: "80", rate: "35", itemCode: "A3", ...over });
async function base(r: Rig) {
  const d = await ready(r);
  return { projectId: "p1", parentBoqId: "boq-1", parent: d.parent, parentVersion: d.boq.version, boqTitle: d.boq.title, progress: new Map(Object.entries(d.progress ?? {})) };
}
const access = (r: Rig) => ({ userId: "u1", idb: r.idb as never, outbox: r.outbox });

describe("what the laptop knows before it offers a change of scope", () => {
  test("only an APPROVED change order that no revision has been made from yet can be linked; a draft one and one already linked are not offered", async () => {
    const r = await rig();
    const d = await ready(r);
    expect(d.changeOrders).toEqual([{ id: "co-ok", number: 7, title: "Extra waterproofing" }]);
    expect(d.revisionWaiting).toBe(false);
    expect(d.progress).toEqual({ "li-a1": 40 });
  });

  test("no change orders copied to the laptop: none is offered (and nothing breaks)", async () => {
    const idb = new IDBFactory();
    await seedDelivery(idb, [{ projectId: "p1", kind: "boqs", rows: [BOQ] }, { projectId: "p1", kind: "boq_lines", rows: LINES }], { projectIds: ["p1"] });
    const d = await loadScopeRevise(deliveryShellData(idb as never), "boq-1", "p1");
    expect(d.state === "ready" && d.changeOrders).toEqual([]);
  });
});

describe("add a scope item offline (create_boq_revision with every line kept)", () => {
  test("ONE op: the parent's lines plus the new item, no override, no record version; the next revision is listed as waiting; sent as typed", async () => {
    const r = await rig();
    const res = await addScopeItemsOffline({ ...(await base(r)), items: [item(), emptyLine()] }, access(r));
    expect(res.queued).toBe(true);
    const list = await loadScopeList(deliveryShellData(r.idb as never), "p1");
    expect(list.state === "local" && list.rows.filter((x) => x.waiting).map((x) => [x.title, x.version, x.lineCount])).toEqual([["Villa BOQ", 2, 3]]);

    await r.outbox.flush();
    const [op] = pushed(r);
    expect(op).toMatchObject({ function_id: "create_boq_revision", project_id: "p1" });
    const params = op!.params as { boqId: string; title: string; lineItems: Row[]; allowScopeReductionOverride?: unknown; sourceChangeOrderId?: unknown };
    expect([params.boqId, params.title, params.allowScopeReductionOverride, params.sourceChangeOrderId]).toEqual(["boq-1", "Villa BOQ", undefined, undefined]);
    expect(params.lineItems.map((l) => [l.itemCode, l.quantity, l.rate])).toEqual([["A1", 100, 50], ["A2", 200, 20], ["A3", 80, 35]]);
  });

  test("a line with work recorded on site is not touched by adding an item, so the progress guard has nothing to refuse (A1 is 40% done)", async () => {
    const r = await rig();
    const res = await addScopeItemsOffline({ ...(await base(r)), items: [item({ itemCode: "A9", description: "Extra door" })] }, access(r));
    expect(res.queued).toBe(true);
  });

  test("refused in words with nothing queued: no item typed, a missing field, an item code the BOQ already uses", async () => {
    const r = await rig();
    const b = await base(r);
    expect(await addScopeItemsOffline({ ...b, items: [emptyLine()] }, access(r))).toEqual({ queued: false, reason: "invalid" });
    expect(await addScopeItemsOffline({ ...b, items: [item({ unit: "" })] }, access(r))).toEqual({ queued: false, reason: "invalid" });
    expect(await addScopeItemsOffline({ ...b, items: [item({ itemCode: "A1" })] }, access(r))).toEqual({ queued: false, reason: "invalid" });
    expect(r.enqueued()).toBe(0);
  });

  test("a BOQ can be revised only once: a second revision while one is waiting is refused in words, nothing more is queued", async () => {
    const r = await rig();
    const b = await base(r);
    expect((await addScopeItemsOffline({ ...b, items: [item()] }, access(r))).queued).toBe(true);
    const second = await addScopeItemsOffline({ ...b, items: [item({ itemCode: "A4", description: "Second item" })] }, access(r));
    expect(second).toEqual({ queued: false, reason: "revision_waiting" });
    expect(scopeNotQueuedMessage("revision_waiting")).toContain("already waiting to be sent");
    expect(r.enqueued()).toBe(1);
    expect((await ready(r)).revisionWaiting).toBe(true);
  });
});

describe("change of scope offline: a revision carried out for an approved change order (R-98)", () => {
  test("sourceChangeOrderId is sent; the change order is then not offered again while that revision waits", async () => {
    const r = await rig();
    const b = await base(r);
    const linkable: LinkableChangeOrder[] = (await ready(r)).changeOrders;
    const res = await addScopeItemsOffline({ ...b, items: [item()], sourceChangeOrderId: "co-ok", linkable }, access(r));
    expect(res.queued).toBe(true);
    await r.outbox.flush();
    expect(pushed(r)[0]!.params).toMatchObject({ boqId: "boq-1", sourceChangeOrderId: "co-ok" });
    const op = (await (await openLocalDb(r.idb as never, localDbNameFor("u1"))).listOps());
    expect(op).toEqual([]); // the server took it
  });

  test("a change order that is a draft, already linked, unknown, or not in the offered list is refused in words, nothing queued", async () => {
    const r = await rig();
    const b = await base(r);
    const linkable = (await ready(r)).changeOrders;
    for (const sourceChangeOrderId of ["co-draft", "co-linked", "co-nope"]) {
      const res = await addScopeItemsOffline({ ...b, items: [item()], sourceChangeOrderId, linkable }, access(r));
      expect({ sourceChangeOrderId, res }).toEqual({ sourceChangeOrderId, res: { queued: false, reason: "change_order" } });
    }
    expect(scopeNotQueuedMessage("change_order")).toContain("approved change order");
    expect(r.enqueued()).toBe(0);
  });

  test("a change of scope that REMOVES or REDUCES work with progress is refused here (A1 is 40% done), change order or not; raising it is allowed", async () => {
    const r = await rig();
    const b = await base(r);
    const linkable = (await ready(r)).changeOrders;
    const kept = (await ready(r)).parent.map((p) => ({ ...emptyLine(), description: p.description, unit: p.unit ?? "", quantity: String(p.quantity), rate: String(p.rate), itemCode: p.itemCode ?? "" }));
    const reduced = kept.map((l) => (l.itemCode === "A1" ? { ...l, quantity: "60" } : l));
    const removed = kept.filter((l) => l.itemCode !== "A1");
    for (const lines of [reduced, removed]) {
      const res = await reviseBoqOffline({ ...b, title: "Change of scope", lines, sourceChangeOrderId: "co-ok", linkable }, access(r));
      expect(res).toEqual({ queued: false, reason: "blocked" });
    }
    expect(scopeNotQueuedMessage("blocked")).toContain("remove or reduce a line that already has work recorded on site");
    expect(r.enqueued()).toBe(0);
    const raised = kept.map((l) => (l.itemCode === "A1" ? { ...l, quantity: "120" } : l));
    expect((await reviseBoqOffline({ ...b, title: "Change of scope", lines: raised, sourceChangeOrderId: "co-ok", linkable }, access(r))).queued).toBe(true);
  });

  test("removing a line with NO work recorded (A2) is allowed", async () => {
    const r = await rig();
    const b = await base(r);
    const kept = (await ready(r)).parent.filter((p) => p.itemCode !== "A2").map((p) => ({ ...emptyLine(), description: p.description, unit: p.unit ?? "", quantity: String(p.quantity), rate: String(p.rate), itemCode: p.itemCode ?? "" }));
    expect((await reviseBoqOffline({ ...b, title: "Drop plaster", lines: kept }, access(r))).queued).toBe(true);
  });
});
