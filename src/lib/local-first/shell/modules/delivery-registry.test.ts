// Every write the delivery screens can put in the outbox, checked against the REAL AI work link registry (src/lib/local-first/ai/
// function-registry.json, a copy of compliance-tracker supabase/functions/ai-work-link/function-registry.generated.json, generated from
// src/lib/pipeline/function-registry.ts). The server only accepts the parameter names a function declares and refuses an op missing a
// required one, so a renamed field here would be dropped or refused on the server even though every laptop test passed (the lesson of
// the live push test: update_task wanted {projectId, issueId, ...}, not taskId). Each writer is called with EVERY optional field filled,
// so no parameter it can send escapes the check.
//
//   function id               params the laptop sends (all of them, optional ones included)
//   record_work_progress      projectId, boqLineItemId, entryDate, quantityDone | percent, remarks
//   record_attendance         projectId, rosterId, date, status, hours
//   record_material_receipt   projectId, materialId, quantity, receivedDate, reference, notes
//   record_material_issue     projectId, materialId, quantity, issuedDate, boqLineItemId, issuedTo, note
//
// The browser-level proof that these exact params reach the push is e2e/lf-delivery-writes.spec.ts / lf-delivery-offline.spec.ts.

import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import registry from "../../ai/function-registry.json";
import type { EnqueueInput, Outbox } from "../../outbox";
import { markAttendanceOffline, recordIssueOffline, recordProgressOffline, recordReceiptOffline, type WriteResult } from "./delivery-writes";
import { deliveryShellData, seedDelivery } from "./delivery-test-seed";

type Fn = { function_id: string; kind: string; link_level: number | null; excluded_reason: string | null; declared_params: string[]; required_params: { name: string; any_of: string[] }[] };
const FUNCTIONS = (registry as { functions: Fn[] }).functions;

async function captureAll(): Promise<Array<{ input: EnqueueInput; result: WriteResult }>> {
  const idb = new IDBFactory();
  await seedDelivery(idb, [
    { projectId: "p1", kind: "activities", rows: [{ id: "a1", name: "Blockwork", unit: "m2" }] },
    { projectId: "p1", kind: "boq_lines", rows: [{ id: "l1", item_code: "01", description: "Blocks", unit: "nos", quantity: "200" }] },
    { projectId: "p1", kind: "roster", rows: [{ id: "w1", name: "Ravi", is_active: true }] },
    { projectId: "p1", kind: "materials", rows: [{ id: "m1", name: "Cement", unit: "bag", is_active: true }] },
  ]);
  const data = deliveryShellData(idb);
  const captured: EnqueueInput[] = [];
  const outbox = { enqueue: async (input: EnqueueInput) => { captured.push(input); return { opId: `op-${captured.length}` }; } } as unknown as Outbox;
  const access = { outbox, newId: () => "fixed" };
  const results = [
    await recordProgressOffline(data, { projectId: "p1", boqLineItemId: "l1", entryDate: "2026-10-02", quantityDone: 4, remarks: "Grid B" }, access),
    await recordProgressOffline(data, { projectId: "p1", boqLineItemId: "l1", entryDate: "2026-10-02", percent: 30, remarks: "Grid C" }, access),
    await markAttendanceOffline(data, { projectId: "p1", rosterId: "w1", date: "2026-10-02", status: "half_day", hours: 4 }, access),
    await recordReceiptOffline(data, { projectId: "p1", materialId: "m1", quantity: 10, receivedDate: "2026-10-02", reference: "DN-1", notes: "dry" }, access),
    await recordIssueOffline(data, { projectId: "p1", materialId: "m1", quantity: 2, issuedDate: "2026-10-02", boqLineItemId: "l1", issuedTo: "Crew A", note: "wall 3" }, access),
  ];
  return results.map((result, i) => ({ result, input: captured[i]! }));
}

describe("every delivery write matches the real registry", () => {
  test("each writer queues exactly one op (nothing refused in this seeded project)", async () => {
    const all = await captureAll();
    expect(all.map((c) => c.result.queued)).toEqual([true, true, true, true, true]);
    expect(all.map((c) => c.input.functionId)).toEqual(["record_work_progress", "record_work_progress", "record_attendance", "record_material_receipt", "record_material_issue"]);
  });

  test("the function id is a write the server accepts on push (link level set, not excluded)", async () => {
    for (const { input } of await captureAll()) {
      const fn = FUNCTIONS.find((f) => f.function_id === input.functionId);
      expect(fn, input.functionId).toBeDefined();
      expect([fn!.kind, fn!.link_level !== null, fn!.excluded_reason]).toEqual(["write", true, null]);
    }
  });

  test("every parameter name sent is one the function declares, and every required parameter is there", async () => {
    for (const { input } of await captureAll()) {
      const fn = FUNCTIONS.find((f) => f.function_id === input.functionId)!;
      const sent = Object.keys(input.params);
      expect({ fn: fn.function_id, undeclared: sent.filter((k) => !fn.declared_params.includes(k)) }).toEqual({ fn: fn.function_id, undeclared: [] });
      const missing = fn.required_params.filter((r) => !r.any_of.some((name) => input.params[name] !== undefined && input.params[name] !== null && input.params[name] !== "")).map((r) => r.name);
      expect({ fn: fn.function_id, missing }).toEqual({ fn: fn.function_id, missing: [] });
      expect(input.projectId).toBe("p1");
      expect(input.params.projectId).toBe("p1");
    }
  });

  test("the exact parameter sets (all optional fields filled) -- a rename shows here first", async () => {
    const keys = (await captureAll()).map(({ input }) => [input.functionId, Object.keys(input.params).sort()]);
    expect(keys).toEqual([
      ["record_work_progress", ["boqLineItemId", "entryDate", "projectId", "quantityDone", "remarks"]],
      ["record_work_progress", ["boqLineItemId", "entryDate", "percent", "projectId", "remarks"]],
      ["record_attendance", ["date", "hours", "projectId", "rosterId", "status"]],
      ["record_material_receipt", ["materialId", "notes", "projectId", "quantity", "receivedDate", "reference"]],
      ["record_material_issue", ["boqLineItemId", "issuedDate", "issuedTo", "materialId", "note", "projectId", "quantity"]],
    ]);
  });
});
