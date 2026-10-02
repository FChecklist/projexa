import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { localDbNameFor, openLocalDb } from "../../local-db";
import { createOutbox, type Outbox } from "../../outbox";
import { createReplica } from "../../replica";
import { amendMinutesOffline, canProposeEdits, editDocumentDetailsOffline } from "./documents-writes";
import { loadMomObject } from "./moms-adapter";
import { loadDocumentObject } from "./documents-adapter";
import { docRow, momRow, shellData } from "./documents-test-fixtures";

// The two registered writes of the documents cluster, through the REAL outbox and the REAL replica against the shared fake sync server.
// The server-side handlers below stand in for compliance-tracker's update_mom_minutes / update_document_metadata (they apply the params).

type Rig = { idb: IDBFactory; server: FakeSyncServer; outbox: Outbox; enqueued: () => number };

async function rig(opts: { seed?: boolean } = {}): Promise<Rig> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ kinds: [{ kind: "documents" }, { kind: "meeting_minutes" }] });
  server.registerFunction("update_mom_minutes", ({ params, target }) =>
    target ? { ok: true, kind: "meeting_minutes", id: target.id, data: { ...target.data, minutes: params.minutes } } : { rejected: "RECORD_NOT_FOUND" });
  server.registerFunction("update_document_metadata", ({ params, target }) => {
    if (!target) return { rejected: "RECORD_NOT_FOUND" };
    const data = { ...target.data };
    if ("name" in params) data.name = params.name;
    if ("category" in params) data.category = params.category;
    if ("expiryDate" in params) data.expiry_date = params.expiryDate;
    return { ok: true, kind: "documents", id: target.id, data };
  });
  if (opts.seed !== false) {
    server.upsert({ kind: "meeting_minutes", projectId: "p1", id: "m1", data: momRow("m1") });
    server.upsert({ kind: "meeting_minutes", projectId: "p1", id: "m2", data: momRow("m2", { status: "published", published_at: "2026-04-02T12:00:00Z" }) });
    server.upsert({ kind: "documents", projectId: "p1", id: "d1", data: docRow("d1") });
    server.upsert({ kind: "documents", projectId: "p1", id: "pm1", data: docRow("pm1", { category: "permit", expiry_date: "2026-06-01T00:00:00Z" }) });
  }
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  let n = 0;
  const real = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++n}` });
  let enqueued = 0;
  const outbox: Outbox = { ...real, enqueue: async (input) => { enqueued += 1; return real.enqueue(input); } };
  return { idb, server, outbox, enqueued: () => enqueued };
}

const pushed = (r: Rig) => r.server.requests.filter((q) => q.path === "/push").flatMap((q) => q.body.ops as Record<string, unknown>[]);

describe("amend the minutes offline (update_mom_minutes)", () => {
  test("kept on the laptop at once and marked waiting; nothing sent until a flush; then ONE op with the person's intent and the base version", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    const result = await amendMinutesOffline(data, { projectId: "p1", meetingId: "m1", minutes: "Slab pour moved to Tuesday." }, { outbox: r.outbox });
    expect(result).toEqual({ ok: true, opId: "op-1" });
    expect(pushed(r)).toEqual([]);

    const shown = await loadMomObject(data, "m1", "p1");
    if (shown.state !== "local") throw new Error("unreachable");
    expect(shown.mom.minutes).toBe("Slab pour moved to Tuesday.");
    expect(shown.mom.waiting).toBe(true);

    await r.outbox.flush();
    expect(pushed(r)).toEqual([
      expect.objectContaining({
        op_id: "op-1", function_id: "update_mom_minutes", project_id: "p1",
        params: { projectId: "p1", meetingId: "m1", minutes: "Slab pour moved to Tuesday." },
        record: { kind: "meeting_minutes", id: "m1", base_version: 1 },
      }),
    ]);
    expect(r.server.getRow("meeting_minutes", "m1")!.data.minutes).toBe("Slab pour moved to Tuesday.");
    const after = await loadMomObject(data, "m1", "p1");
    if (after.state !== "local") throw new Error("unreachable");
    expect(after.mom.waiting).toBe(false);
  });

  test("published minutes are locked: not offered, nothing queued", async () => {
    const r = await rig();
    const result = await amendMinutesOffline(shellData(r.idb as never), { projectId: "p1", meetingId: "m2", minutes: "x" }, { outbox: r.outbox });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("published and locked");
    expect(r.enqueued()).toBe(0);
  });

  test("a MoM the laptop does not hold, another person, another project, or a read-only role: nothing queued", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    expect((await amendMinutesOffline(data, { projectId: "p1", meetingId: "nope", minutes: "x" }, { outbox: r.outbox })).ok).toBe(false);
    expect((await amendMinutesOffline(shellData(r.idb as never, "u2"), { projectId: "p1", meetingId: "m1", minutes: "x" }, { outbox: r.outbox })).ok).toBe(false);
    expect((await amendMinutesOffline(data, { projectId: "p2", meetingId: "m1", minutes: "x" }, { outbox: r.outbox })).ok).toBe(false);
    expect((await amendMinutesOffline(shellData(r.idb as never, "u1", "orgA", "viewer"), { projectId: "p1", meetingId: "m1", minutes: "x" }, { outbox: r.outbox })).ok).toBe(false);
    expect((await amendMinutesOffline(shellData(r.idb as never, "u1", "orgB"), { projectId: "p1", meetingId: "m1", minutes: "x" }, { outbox: r.outbox })).ok).toBe(false);
    expect(r.enqueued()).toBe(0);
  });
});

describe("edit a document's details offline (update_document_metadata)", () => {
  test("documents: name, category and expiry go out as the registry's params; the laptop copy shows them at once", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    const result = await editDocumentDetailsOffline(data, "documents", { projectId: "p1", documentId: "d1", details: { name: " Signed contract ", category: "legal", expiryDate: "2027-01-31" } }, { outbox: r.outbox });
    expect(result.ok).toBe(true);
    const shown = await loadDocumentObject(data, "d1", "p1");
    if (shown.state !== "local") throw new Error("unreachable");
    expect([shown.doc.name, shown.doc.category, shown.doc.expiryDate, shown.doc.waiting]).toEqual(["Signed contract", "legal", "2027-01-31", true]);

    await r.outbox.flush();
    expect(pushed(r)[0]).toMatchObject({
      function_id: "update_document_metadata",
      params: { projectId: "p1", documentId: "d1", name: "Signed contract", category: "legal", expiryDate: "2027-01-31" },
      record: { kind: "documents", id: "d1", base_version: 1 },
    });
  });

  test("permits never send a category (it would move the permit out of the permits); drawings send only the name", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    await editDocumentDetailsOffline(data, "permits", { projectId: "p1", documentId: "pm1", details: { name: "Building permit", category: "contract", expiryDate: "2026-12-31" } }, { outbox: r.outbox });
    await editDocumentDetailsOffline(data, "drawings", { projectId: "p1", documentId: "d1", details: { name: "GF plan", category: "x", expiryDate: "2026-12-31" } }, { outbox: r.outbox });
    await r.outbox.flush();
    expect(pushed(r).map((o) => o.params)).toEqual([
      { projectId: "p1", documentId: "pm1", name: "Building permit", expiryDate: "2026-12-31" },
      { projectId: "p1", documentId: "d1", name: "GF plan" },
    ]);
  });

  test("an empty name, a bad date, or nothing to change: refused on the laptop with a plain message, nothing queued", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    for (const details of [{ name: "  " }, { expiryDate: "next tuesday" }, { expiryDate: "2026-13-45" }, {}]) {
      const res = await editDocumentDetailsOffline(data, "documents", { projectId: "p1", documentId: "d1", details }, { outbox: r.outbox });
      expect(res.ok).toBe(false);
    }
    expect(r.enqueued()).toBe(0);
  });

  test("a conflict (someone else changed it first) is detected by the server from the base version: nothing is overwritten", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    await editDocumentDetailsOffline(data, "documents", { projectId: "p1", documentId: "d1", details: { name: "Mine" } }, { outbox: r.outbox });
    r.server.upsert({ kind: "documents", projectId: "p1", id: "d1", data: docRow("d1", { name: "Theirs" }) });
    await r.outbox.flush();
    expect(r.server.getRow("documents", "d1")!.data.name).toBe("Theirs");
    expect((await r.outbox.getConflicts()).map((c) => c.opId)).toEqual(["op-1"]);
  });
});

test("read-only roles (rank 1 in the AI work link) are not offered edits; every other role is, and the server decides", () => {
  expect(["viewer", "client_viewer", "external_auditor", "stage_0"].map(canProposeEdits)).toEqual([false, false, false, false]);
  expect(["member", "pm", "owner", null].map(canProposeEdits)).toEqual([true, true, true, true]);
});

test("the laptop database is this person's own: the queued op lives in projexa-local:u1", async () => {
  const r = await rig();
  await amendMinutesOffline(shellData(r.idb as never), { projectId: "p1", meetingId: "m1", minutes: "y" }, { outbox: r.outbox });
  const db = await openLocalDb(r.idb as never, localDbNameFor("u1"));
  expect((await db.listOps()).map((o) => o.functionId)).toEqual(["update_mom_minutes"]);
  db.close();
});
