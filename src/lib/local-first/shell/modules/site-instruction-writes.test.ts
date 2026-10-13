import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { findFunction } from "../../ai/registry";
import { createOutbox, type Outbox } from "../../outbox";
import { createReplica } from "../../replica";
import { shellData } from "./documents-test-fixtures";
import { loadSiteInstructions } from "./site-records";
import { createSiteInstructionOffline, siteRefusalText } from "./site-writes";

// R-C14: create_site_instruction kept on the laptop, sent with the registry's parameter names (the two flags only when set, as yes/no),
// and replaced by the server's row (which carries the SI number). Real replica and outbox against the shared fake sync server.

type Rig = { idb: IDBFactory; server: FakeSyncServer; outbox: Outbox; enqueued: () => number };

async function rig(): Promise<Rig> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ kinds: [{ kind: "site_instructions" }] });
  server.registerFunction("create_site_instruction", ({ params }) => ({
    ok: true, kind: "site_instructions", id: "si-srv",
    data: {
      id: "si-srv", si_number: 4, issue_date: params.issueDate, issued_by: "u1", to_contractor: params.toContractor, description: params.description,
      drawing_ref: params.drawingRef ?? null, cost_impact: params.costImpact === true, time_impact: params.timeImpact === true, boq_id: null,
    },
  }));
  server.upsert({ kind: "site_instructions", projectId: "p1", id: "si-old", data: { id: "si-old", si_number: 3, issue_date: "2026-09-01", to_contractor: "Ace", description: "Hold the pour", cost_impact: false, time_impact: true } });
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  let n = 0;
  const real = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++n}` });
  let enqueued = 0;
  const outbox: Outbox = { ...real, enqueue: async (input) => { enqueued += 1; return real.enqueue(input); } };
  return { idb, server, outbox, enqueued: () => enqueued };
}
const pushed = (r: Rig) => r.server.requests.filter((q) => q.path === "/push").flatMap((q) => q.body.ops as Record<string, unknown>[]);

const INPUT = { projectId: "p1", issueDate: "2026-10-05", toContractor: "  Ace Builders ", description: " Change the lintel to 200 mm ", drawingRef: "A-201", costImpact: true };

describe("the registry copy names exactly what the laptop sends", () => {
  test("create_site_instruction declares every parameter this writer uses", () => {
    const declared = findFunction("create_site_instruction")!.declared_params;
    for (const p of ["projectId", "issueDate", "toContractor", "description", "drawingRef", "costImpact", "timeImpact"]) expect(declared).toContain(p);
  });
});

describe("create_site_instruction", () => {
  test("kept at once with no number, listed as waiting, sent with the registry's names, replaced by the server's numbered row", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    const res = await createSiteInstructionOffline(data, INPUT, { outbox: r.outbox, newId: () => "t1" });
    expect(res).toEqual({ queued: true, opId: "op-1", tempId: "local-t1" });

    const during = await loadSiteInstructions(data, "p1");
    expect(during.state === "local" && during.rows.map((x) => [x.id, x.siNumber, x.waiting, x.toContractor, x.description, x.costImpact, x.timeImpact])).toEqual([
      ["local-t1", null, true, "Ace Builders", "Change the lintel to 200 mm", true, false],
      ["si-old", 3, false, "Ace", "Hold the pour", false, true],
    ]);

    await r.outbox.flush();
    expect(pushed(r)).toEqual([expect.objectContaining({ function_id: "create_site_instruction", project_id: "p1", params: { projectId: "p1", issueDate: "2026-10-05", toContractor: "Ace Builders", description: "Change the lintel to 200 mm", drawingRef: "A-201", costImpact: true } })]);

    const after = await loadSiteInstructions(data, "p1");
    expect(after.state === "local" && after.rows.map((x) => [x.id, x.siNumber, x.waiting])).toEqual([["si-srv", 4, false], ["si-old", 3, false]]);
  });

  test("a flag that is not set is not sent, and no drawing reference is sent when it is empty", async () => {
    const r = await rig();
    await createSiteInstructionOffline(shellData(r.idb as never), { projectId: "p1", issueDate: "2026-10-05", toContractor: "Ace", description: "x", drawingRef: "  ", costImpact: false }, { outbox: r.outbox });
    await r.outbox.flush();
    expect(pushed(r)[0]!.params).toEqual({ projectId: "p1", issueDate: "2026-10-05", toContractor: "Ace", description: "x" });
  });

  test("a missing contractor or instruction, or a date that is not a real day: refused, nothing kept or enqueued", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    for (const bad of [{ toContractor: "  " }, { description: "" }, { issueDate: "2026-02-30" }, { issueDate: "" }]) {
      expect(await createSiteInstructionOffline(data, { ...INPUT, ...bad }, { outbox: r.outbox })).toEqual({ queued: false, reason: "invalid" });
    }
    expect(r.enqueued()).toBe(0);
    const list = await loadSiteInstructions(data, "p1");
    expect(list.state === "local" && list.rows.map((x) => x.id)).toEqual(["si-old"]);
    expect(siteRefusalText("invalid")).toContain("check the values");
  });

  test("a read-only role is refused (not_allowed); a project the laptop does not hold is not_on_laptop", async () => {
    const r = await rig();
    expect(await createSiteInstructionOffline(shellData(r.idb as never, "u1", "orgA", "viewer"), INPUT, { outbox: r.outbox })).toEqual({ queued: false, reason: "not_allowed" });
    expect(await createSiteInstructionOffline(shellData(r.idb as never), { ...INPUT, projectId: "p9" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "not_on_laptop" });
    expect(r.enqueued()).toBe(0);
  });
});
