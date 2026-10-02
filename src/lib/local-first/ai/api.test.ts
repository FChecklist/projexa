// window.projexa.ai against the shared fake sync server, a fake local database filled by the real replica, and the
// real outbox. Each behaviour of api.ts has a test here that fails when the behaviour breaks (see the planted-bug
// record in the branch report).

import { describe, expect, test } from "bun:test";
import { localDbNameFor, openLocalDb } from "../local-db";
import { ProjexaAiError } from "./api";
import { functionsForRank } from "./registry";
import { makeRig } from "./__fixtures__/ai-rig";

const RFI = { projectId: "p1", subject: "Glass spec", question: "Which supplier?" };
const TASK = { projectId: "p1", issueId: "t1", title: "Pour slab (east)" };
const VOID = { projectId: "p1", receiptId: "mr1", reason: "Duplicate entry" };

async function rejection(p: Promise<unknown>): Promise<ProjexaAiError> {
  try {
    await p;
  } catch (err) {
    expect(err).toBeInstanceOf(ProjexaAiError);
    return err as ProjexaAiError;
  }
  throw new Error("expected a refusal");
}

describe("reads", () => {
  test("manifest says who, role, organisation, projects with names, kinds and the role's functions", async () => {
    const { surface } = await makeRig({ role: "manager" });
    const m = await surface.api.manifest();
    expect(m.person).toEqual({ id: "u1", name: "Asha", role: "manager", roleRank: 3 });
    expect(m.organisation).toEqual({ id: "orgA" });
    expect(m.projects).toEqual([{ id: "p1", name: "Harbor View" }, { id: "p2", name: "Cedar Villa" }]);
    expect(m.kinds).toContain("tasks");
    expect(m.functions.create.map((f) => f.id)).toContain("create_rfi");
    expect(m.functions.create.map((f) => f.id)).not.toContain("create_project");
    // lf-e11: the refreshed registry's removals a manager (rank 3) may ask for; each is a draft (below).
    expect(m.functions.delete.map((f) => f.id)).toContain("void_material_receipt");
    expect(m.functions.delete.map((f) => f.id)).toContain("dispose_document");
    expect(m.functions.delete.map((f) => f.id)).toContain("delete_permit");
    expect(m.functions.delete.map((f) => f.id)).toContain("delete_mom");
    expect(m.functions.delete.every((f) => f.id !== "update_task")).toBe(true);
    expect(m.softwareCanBeChanged).toBe(false);
    expect(m.deletesNeedConfirmation).toBe(true);
    expect(m.integrity).toBe("not_installed");
  });

  test("list / get / search read the laptop copy, scoped to a project and a filter", async () => {
    const { surface } = await makeRig();
    const all = await surface.api.list("tasks");
    expect(all.items.map((r) => r.id).sort()).toEqual(["t1", "t2"]);
    const p1 = await surface.api.list("tasks", { projectId: "p1" });
    expect(p1.items.map((r) => r.id)).toEqual(["t1"]);
    const filtered = await surface.api.list("tasks", { filter: { priority: "low" } });
    expect(filtered.items.map((r) => r.id)).toEqual(["t2"]);
    const limited = await surface.api.list("tasks", { limit: 1 });
    expect(limited.items.length).toBe(1);
    expect(limited.truncated).toBe(true);
    const one = await surface.api.get("rfis", "r1");
    expect(one).toMatchObject({ kind: "rfis", id: "r1", projectId: "p1", pending: false, data: { subject: "Door hardware" } });
    expect(await surface.api.get("rfis", "nope")).toBeNull();
    const found = await surface.api.search("HINGE");
    expect(found.items.map((r) => `${r.kind}:${r.id}`)).toEqual(["rfis:r1"]);
    expect((await surface.api.search("paint", { projectId: "p1" })).items).toEqual([]);
  });

  test("a project that is not the person's is refused", async () => {
    const { surface } = await makeRig();
    expect((await rejection(surface.api.list("tasks", { projectId: "p9" }))).code).toBe("PROJECT_NOT_YOURS");
  });

  test("a laptop that was never prepared says so in plain words", async () => {
    const { surface } = await makeRig({ sync: false });
    const err = await rejection(surface.api.list("tasks"));
    expect(err.code).toBe("NOT_READY");
    expect(err.message).toContain("connected to the internet");
  });

  test("returned data is a copy: changing it does not change the laptop's database", async () => {
    const { surface, idb } = await makeRig();
    const row = await surface.api.get("tasks", "t1");
    (row!.data as Record<string, unknown>).title = "HACKED";
    const db = await openLocalDb(idb, localDbNameFor("u1"));
    expect((((await db.getRecord("tasks", "t1"))!.data) as Record<string, unknown>).title).toBe("Pour slab");
    db.close();
  });
});

describe("role matrix (viewer / member / manager / admin) for create, update, delete", () => {
  // create_rfi and update_task need a member (rank 2); seal_boq and void_material_receipt need a manager (rank 3).
  const cases: { role: string; create: boolean; update: boolean; managerUpdate: boolean; del: boolean }[] = [
    { role: "viewer", create: false, update: false, managerUpdate: false, del: false },
    { role: "member", create: true, update: true, managerUpdate: false, del: false },
    { role: "manager", create: true, update: true, managerUpdate: true, del: true },
    { role: "admin", create: true, update: true, managerUpdate: true, del: true },
  ];
  for (const c of cases) {
    test(`${c.role}`, async () => {
      const { surface, enqueued } = await makeRig({ role: c.role });
      const outcome = async (p: Promise<unknown>) => p.then(() => true, (err: ProjexaAiError) => {
        expect(err.code).toBe("ROLE_TOO_LOW");
        expect(err.message).toContain(`Your role (${c.role})`);
        return false;
      });
      expect(await outcome(surface.api.create("create_rfi", RFI))).toBe(c.create);
      expect(await outcome(surface.api.update("update_task", { kind: "tasks", id: "t1" }, TASK))).toBe(c.update);
      expect(await outcome(surface.api.update("seal_boq", { kind: "boqs", id: "b1" }, { projectId: "p1", boqId: "b1", controlTotals: { amount: 100 }, expectedLineCount: 3 }))).toBe(c.managerUpdate);
      expect(await outcome(surface.api.delete("void_material_receipt", { kind: "material_receipts", id: "mr1" }, VOID))).toBe(c.del);
      // Refused writes never reach the outbox; allowed creates/updates do; a delete is only a draft.
      expect(enqueued()).toBe(Number(c.create) + Number(c.update) + Number(c.managerUpdate));
    });
  }

  test("an unknown role writes nothing but may still read", async () => {
    const { surface } = await makeRig({ role: "stranger" });
    expect((await rejection(surface.api.create("create_rfi", RFI))).code).toBe("ROLE_TOO_LOW");
    expect((await surface.api.list("tasks")).items.length).toBe(2);
    expect((await surface.api.manifest()).functions).toEqual({ create: [], update: [], delete: [] });
  });

  test("no stored identity: plain words, nothing queued", async () => {
    const { surface, enqueued } = await makeRig({ role: null });
    const err = await rejection(surface.api.create("create_rfi", RFI));
    expect(err.code).toBe("ROLE_UNKNOWN");
    expect(enqueued()).toBe(0);
  });
});

describe("writes through the outbox", () => {
  test("create: checked, queued with the optimistic row, then applied by the server", async () => {
    const { surface, outbox, server } = await makeRig();
    server.registerFunction("create_rfi", ({ params }) => ({ ok: true, kind: "rfis", id: "r2", data: { subject: params.subject, question: params.question, status: "open" } }));
    const res = await surface.api.create("create_rfi", RFI);
    expect(res).toMatchObject({ status: "queued", opId: "op-1", tempId: "local-id1" });
    const pending = await surface.api.get("rfis", "local-id1");
    expect(pending).toMatchObject({ pending: true, data: { subject: "Glass spec" } });
    const [op] = await outbox.listPending();
    expect(op).toMatchObject({ functionId: "create_rfi", projectId: "p1", params: RFI, creates: { kind: "rfis", id: "local-id1" } });
    const report = await outbox.flush();
    expect(report.applied).toBe(1);
    expect(server.pushedOpIds()).toEqual(["op-1"]);
    expect((await surface.api.get("rfis", "r2"))?.data).toMatchObject({ subject: "Glass spec" });
  });

  test("update: carries the record and the version it was based on, changes the row at once", async () => {
    const { surface, outbox } = await makeRig();
    await surface.api.update("update_task", { kind: "tasks", id: "t1" }, TASK);
    const [op] = await outbox.listPending();
    expect(op.record).toEqual({ kind: "tasks", id: "t1", baseVersion: 1 });
    expect(await surface.api.get("tasks", "t1")).toMatchObject({ pending: true, data: { title: "Pour slab (east)" } });
  });

  test("offline: writes queue, nothing is lost, and they go once the server answers", async () => {
    const { surface, outbox, server } = await makeRig();
    server.registerFunction("update_task", ({ target, params }) => ({ ok: true, kind: "tasks", id: "t1", data: { ...target!.data, title: params.title } }));
    server.failNext({ status: 503, times: 20 });
    await surface.api.update("update_task", { kind: "tasks", id: "t1" }, TASK);
    const first = await outbox.flush();
    expect(first.applied).toBe(0);
    expect(await outbox.pendingCount()).toBe(1);
    server.failNext({ status: 503, times: 0 });
    const second = await outbox.flush();
    expect(second.applied).toBe(1);
    expect(server.getRow("tasks", "t1")?.data.title).toBe("Pour slab (east)");
    expect(await outbox.pendingCount()).toBe(0);
  });

  test("wrong action, missing and unknown params are refused in plain words before anything is queued", async () => {
    const { surface, enqueued } = await makeRig();
    expect((await rejection(surface.api.update("create_rfi", { kind: "rfis", id: "r1" }, RFI))).code).toBe("WRONG_ACTION");
    const missing = await rejection(surface.api.create("create_rfi", { projectId: "p1", subject: "x" }));
    expect(missing.code).toBe("MISSING_PARAMS");
    expect(missing.missing).toEqual(["question"]);
    expect((await rejection(surface.api.create("create_rfi", { ...RFI, sql: "drop" }))).code).toBe("UNKNOWN_PARAMS");
    expect((await rejection(surface.api.create("rewrite_app", RFI))).code).toBe("UNKNOWN_FUNCTION");
    expect((await rejection(surface.api.create("create_rfi", { ...RFI, projectId: "p9" }))).code).toBe("PROJECT_NOT_YOURS");
    expect((await rejection(surface.api.update("update_task", { kind: "tasks", id: "t2" }, TASK))).code).toBe("WRONG_PROJECT");
    expect((await rejection(surface.api.create("create_project", { name: "X" }))).code).toBe("NEEDS_ONLINE");
    // lf-e11: and no manual offers it (the static one included): a manual must not promise what the surface always refuses
    expect(Object.values((await surface.api.manual()).writes.functions).flat().map((f) => f.id)).not.toContain("create_project");
    expect(enqueued()).toBe(0);
  });
});

describe("deletes become drafts", () => {
  test("a delete only makes a draft; nothing is queued until the person confirms", async () => {
    const { surface, enqueued, outbox } = await makeRig({ role: "manager" });
    const res = await surface.api.delete("void_material_receipt", { kind: "material_receipts", id: "mr1" }, VOID);
    expect(res).toMatchObject({ status: "draft", draftId: "draft-id1" });
    expect(enqueued()).toBe(0);
    const drafts = await surface.api.drafts();
    expect(drafts).toHaveLength(1);
    expect(drafts[0].summary).toContain("GRN-7");
    const confirmed = await surface.confirmDraft("draft-id1");
    expect(confirmed.status).toBe("queued");
    const [op] = await outbox.listPending();
    expect(op).toMatchObject({ functionId: "void_material_receipt", record: { kind: "material_receipts", id: "mr1", baseVersion: 1 } });
    expect(await surface.api.drafts()).toEqual([]);
  });

  test("the AI surface has no way to confirm or discard a draft", async () => {
    const { surface } = await makeRig({ role: "manager" });
    const names = Object.keys(surface.api);
    expect(names.some((n) => /confirm|discard|approve/i.test(n))).toBe(false);
    // and a draft listed to the AI is a copy: editing it changes nothing
    await surface.api.delete("void_material_receipt", { kind: "material_receipts", id: "mr1" }, VOID);
    const [d] = await surface.api.drafts();
    d.params.receiptId = "other";
    expect(surface.drafts.get("draft-id1")!.params.receiptId).toBe("mr1");
  });

  test("a discarded draft never runs", async () => {
    const { surface, enqueued } = await makeRig({ role: "manager" });
    await surface.api.delete("void_material_receipt", { kind: "material_receipts", id: "mr1" }, VOID);
    expect(surface.discardDraft("draft-id1")).toBe(true);
    expect((await rejection(surface.confirmDraft("draft-id1"))).code).toBe("NOT_FOUND");
    expect(enqueued()).toBe(0);
  });

  test("confirming re-checks the role (it may have changed since the AI asked)", async () => {
    const { surface, setIdentity, enqueued } = await makeRig({ role: "manager" });
    await surface.api.delete("void_material_receipt", { kind: "material_receipts", id: "mr1" }, VOID);
    await setIdentity({ role: "member" });
    expect((await rejection(surface.confirmDraft("draft-id1"))).code).toBe("ROLE_TOO_LOW");
    expect(enqueued()).toBe(0);
  });

  test("with \"let my AI act without asking\" ON, a delete is queued at once", async () => {
    const { surface, enqueued } = await makeRig({ role: "manager", actWithoutAsking: true });
    expect((await surface.api.manifest()).deletesNeedConfirmation).toBe(false);
    const res = await surface.api.delete("dispose_document", { kind: "documents", id: "d1" }, { projectId: "p1", documentId: "d1" });
    expect(res.status).toBe("queued");
    expect(enqueued()).toBe(1);
  });

  // lf-e11 (owner brief: "money-sensitive functions never skip the confirmation").
  test("with \"act without asking\" ON, a MONEY-sensitive delete is still a draft the person confirms", async () => {
    const { surface, enqueued } = await makeRig({ role: "manager", actWithoutAsking: true });
    const res = await surface.api.delete("void_material_receipt", { kind: "material_receipts", id: "mr1" }, VOID);
    expect(res.status).toBe("draft");
    expect(enqueued()).toBe(0);
    expect((await surface.api.drafts()).map((d) => d.functionId)).toEqual(["void_material_receipt"]);
  });
});

describe("the manual", () => {
  for (const [role, rank] of [["viewer", 1], ["member", 2], ["manager", 3], ["admin", 5]] as const) {
    test(`lists exactly the functions a ${role} may use`, async () => {
      const { surface } = await makeRig({ role });
      const manual = await surface.api.manual();
      const expected = functionsForRank(rank);
      for (const action of ["create", "update", "delete"] as const) {
        // lf-e11: create_project is never run by this surface (NEEDS_ONLINE), so the manual no longer offers it
        expect(manual.writes.functions[action].map((f) => f.id)).toEqual(expected[action].map((f) => f.function_id).filter((id) => id !== "create_project"));
        for (const f of manual.writes.functions[action]) expect(f.min_role_rank).toBeLessThanOrEqual(rank);
      }
      expect(manual.for_role).toEqual({ role, rank });
      expect(manual.software_can_be_changed).toBe(false);
    });
  }
});

describe("tamper: a changed installed file switches the surface off", () => {
  test("every call is refused, with the reason, and the page is told once", async () => {
    const reported: unknown[] = [];
    const { surface, enqueued } = await makeRig({
      deps: {
        integrity: async () => ({ status: "tampered", version: "2026.10.02-1", problems: [{ path: "_next/static/app.js", problem: "hash" }], message: "files changed", checkedAt: 1 }),
        onTamper: (r) => reported.push(r),
      },
    });
    for (const call of [
      () => surface.api.manifest(), () => surface.api.list("tasks"), () => surface.api.get("tasks", "t1"), () => surface.api.search("slab"),
      () => surface.api.create("create_rfi", RFI), () => surface.api.update("update_task", { kind: "tasks", id: "t1" }, TASK),
      () => surface.api.delete("void_material_receipt", { kind: "material_receipts", id: "mr1" }, VOID), () => surface.api.manual(), () => surface.api.drafts(),
    ]) {
      expect((await rejection(call())).code).toBe("SOFTWARE_TAMPERED");
    }
    expect(enqueued()).toBe(0);
    expect(reported).toHaveLength(1);
  });

  test("a check that crashes is treated as tampered, never as fine", async () => {
    const { surface } = await makeRig({ deps: { integrity: async () => { throw new Error("cache unreadable"); } } });
    expect((await rejection(surface.api.list("tasks"))).code).toBe("SOFTWARE_TAMPERED");
  });
});
