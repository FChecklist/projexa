import { describe, expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import { createFakeSyncServer, type FakeSyncServer } from "../../__fixtures__/fake-sync-server";
import { createOutbox, type Outbox } from "../../outbox";
import { createReplica } from "../../replica";
import { shellData } from "./documents-test-fixtures";
import { loadFfeItem, loadPunchItem, loadRfi, loadRfis, loadSubmittal } from "./site-records";
import {
  advanceFfeOffline, answerRfiOffline, canOffer, closeRfiOffline, createRfiOffline, createSiteDiaryOffline, markPunchReadyOffline, nextFfeStatus,
  reviewSubmittalOffline, verifyPunchClosedOffline,
} from "./site-writes";

// The writes of the site cluster through the REAL outbox and replica against the shared fake sync server. The handlers stand in for the
// AI work link's functions: the SERVER decides (here: it refuses a self-review, as the real one does).

type Rig = { idb: IDBFactory; server: FakeSyncServer; outbox: Outbox; enqueued: () => number };

async function rig(): Promise<Rig> {
  const idb = new IDBFactory();
  const server = createFakeSyncServer({ kinds: [{ kind: "rfis" }, { kind: "submittals" }, { kind: "punch_list" }, { kind: "site_diaries" }, { kind: "ffe_items" }] });
  server.registerFunction("answer_rfi", ({ params, target }) => (target ? { ok: true, kind: "rfis", id: target.id, data: { ...target.data, answer: params.answer, status: "answered" } } : { rejected: "RECORD_NOT_FOUND" }));
  server.registerFunction("review_submittal", () => ({ rejected: "SELF_APPROVAL" }));
  server.registerFunction("create_rfi", ({ params }) => ({ ok: true, kind: "rfis", id: "r-new", data: { id: "r-new", number: 7, subject: params.subject, question: params.question, status: "open" } }));
  server.upsert({ kind: "rfis", projectId: "p1", id: "r1", data: { id: "r1", number: 1, subject: "Lintel", question: "q", status: "open" } });
  server.upsert({ kind: "rfis", projectId: "p1", id: "r2", data: { id: "r2", number: 2, subject: "Slab", question: "q", status: "answered", answer: "a" } });
  server.upsert({ kind: "submittals", projectId: "p1", id: "s1", data: { id: "s1", number: 1, title: "Tiles", status: "pending" } });
  server.upsert({ kind: "punch_list", projectId: "p1", id: "x1", data: { id: "x1", number: 1, description: "Door", status: "open" } });
  server.upsert({ kind: "punch_list", projectId: "p1", id: "x2", data: { id: "x2", number: 2, description: "Paint", status: "ready_for_review" } });
  server.upsert({ kind: "ffe_items", projectId: "p1", id: "f1", data: { id: "f1", item_name: "Chair", status: "specified", unit_cost: 100 } });
  await createReplica({ userId: "u1", client: server.client, idb, yieldFn: async () => {} }).sync();
  let n = 0;
  const real = createOutbox({ userId: "u1", client: server.client, deviceId: "dev-1", idb, autoFlush: false, locks: null, sleep: async () => {}, newOpId: () => `op-${++n}` });
  let enqueued = 0;
  const outbox: Outbox = { ...real, enqueue: async (input) => { enqueued += 1; return real.enqueue(input); } };
  return { idb, server, outbox, enqueued: () => enqueued };
}
const pushed = (r: Rig) => r.server.requests.filter((q) => q.path === "/push").flatMap((q) => q.body.ops as Record<string, unknown>[]);

describe("an answer to an RFI", () => {
  test("kept at once and marked waiting; nothing sent until a flush; then one op with the intent and base version", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    const res = await answerRfiOffline(data, { projectId: "p1", rfiId: "r1", answer: " Use 200mm. " }, { outbox: r.outbox });
    expect(res).toEqual({ queued: true, opId: "op-1" });
    expect(pushed(r)).toEqual([]);
    const shown = await loadRfi(data, "r1", "p1");
    expect(shown.state === "local" && [shown.item.answer, shown.item.status, shown.item.waiting]).toEqual(["Use 200mm.", "answered", true]);
    await r.outbox.flush();
    expect(pushed(r)).toEqual([expect.objectContaining({ function_id: "answer_rfi", params: { projectId: "p1", rfiId: "r1", answer: "Use 200mm." }, record: { kind: "rfis", id: "r1", base_version: 1 } })]);
    const after = await loadRfi(data, "r1", "p1");
    expect(after.state === "local" && after.item.waiting).toBe(false);
  });
  test("refused on the laptop: an empty answer, an RFI already answered, an unknown RFI, a read-only role, a project not on the laptop", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    const w = (d = data, id = "r1", answer = "x", projectId = "p1") => answerRfiOffline(d, { projectId, rfiId: id, answer }, { outbox: r.outbox });
    expect(await w(data, "r1", "  ")).toEqual({ queued: false, reason: "invalid" });
    expect(await w(data, "r2")).toEqual({ queued: false, reason: "wrong_state" });
    expect(await w(data, "nope")).toEqual({ queued: false, reason: "unknown_record" });
    expect(await w(shellData(r.idb as never, "u1", "orgA", "viewer"))).toEqual({ queued: false, reason: "not_allowed" });
    expect(await w(data, "r1", "x", "p9")).toEqual({ queued: false, reason: "not_on_laptop" });
    expect(r.enqueued()).toBe(0);
  });
});

describe("approvals are the server's", () => {
  test("a submittal review below rank 3 is not offered; at rank 3 only the request is sent, and the server's refusal puts the row back", async () => {
    const r = await rig();
    expect(await reviewSubmittalOffline(shellData(r.idb as never, "u1", "orgA", "member"), { projectId: "p1", submittalId: "s1", status: "approved" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "not_allowed" });
    const data = shellData(r.idb as never, "u1", "orgA", "manager");
    expect(await reviewSubmittalOffline(data, { projectId: "p1", submittalId: "s1", status: "nonsense" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "invalid" });
    expect((await reviewSubmittalOffline(data, { projectId: "p1", submittalId: "s1", status: "approved", comments: "ok" }, { outbox: r.outbox })).queued).toBe(true);
    await r.outbox.flush();
    expect(pushed(r)[0]).toMatchObject({ function_id: "review_submittal", params: { projectId: "p1", submittalId: "s1", status: "approved", comments: "ok" } });
    // the server said SELF_APPROVAL: the laptop does not keep a decision the server refused
    const s = await loadSubmittal(data, "s1", "p1");
    expect(s.state === "local" && s.item.status).toBe("pending");
  });
  test("punch: done needs an open item; verify needs rank 3 and an item ready for review", async () => {
    const r = await rig();
    const member = shellData(r.idb as never, "u1", "orgA", "member");
    const manager = shellData(r.idb as never, "u1", "orgA", "manager");
    expect(await markPunchReadyOffline(member, { projectId: "p1", itemId: "x2" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "wrong_state" });
    expect(await verifyPunchClosedOffline(manager, { projectId: "p1", itemId: "x1" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "wrong_state" });
    expect((await markPunchReadyOffline(member, { projectId: "p1", itemId: "x1" }, { outbox: r.outbox })).queued).toBe(true);
    expect(await verifyPunchClosedOffline(member, { projectId: "p1", itemId: "x2" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "not_allowed" });
    expect((await verifyPunchClosedOffline(manager, { projectId: "p1", itemId: "x2" }, { outbox: r.outbox })).queued).toBe(true);
    const x = await loadPunchItem(manager, "x2", "p1");
    expect(x.state === "local" && [x.item.status, x.item.waiting]).toEqual(["verified_closed", true]);
  });
  test("RFI close needs an answered RFI", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    expect(await closeRfiOffline(data, { projectId: "p1", rfiId: "r1" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "wrong_state" });
    expect((await closeRfiOffline(data, { projectId: "p1", rfiId: "r2" }, { outbox: r.outbox })).queued).toBe(true);
  });
});

describe("FF&E status is money sensitive", () => {
  test("only the next status, only for a role at rank 3 that sees cost", async () => {
    const r = await rig();
    const manager = shellData(r.idb as never, "u1", "orgA", "manager");
    expect(nextFfeStatus("specified")).toBe("ordered");
    expect(nextFfeStatus("installed")).toBeNull();
    expect(await advanceFfeOffline(shellData(r.idb as never, "u1", "orgA", "member"), { projectId: "p1", itemId: "f1", status: "ordered" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "not_allowed" });
    expect(await advanceFfeOffline(manager, { projectId: "p1", itemId: "f1", status: "installed" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "wrong_state" });
    expect((await advanceFfeOffline(manager, { projectId: "p1", itemId: "f1", status: "ordered" }, { outbox: r.outbox })).queued).toBe(true);
    const f = await loadFfeItem(manager, "f1", "p1");
    expect(f.state === "local" && f.item.status).toBe("ordered");
  });
  test("canOffer: unknown role is offered (the server decides); known roles by rank", () => {
    expect([canOffer(null, 3), canOffer("viewer", 2), canOffer("member", 2), canOffer("member", 3), canOffer("manager", 3)]).toEqual([true, false, true, false, true]);
  });
});

describe("creates", () => {
  test("a new RFI exists on the laptop at once with no number (the server's), and the server's row replaces it", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    expect(await createRfiOffline(data, { projectId: "p1", subject: " ", question: "q" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "invalid" });
    expect(await createRfiOffline(data, { projectId: "p1", subject: "s", question: "q", dueDate: "31/12" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "invalid" });
    const res = await createRfiOffline(data, { projectId: "p1", subject: "Window sill", question: "Height?" }, { outbox: r.outbox, newId: () => "t1" });
    expect(res).toMatchObject({ queued: true, tempId: "local-t1" });
    const list = await loadRfis(data, "p1");
    const row = list.state === "local" ? list.rows.find((x) => x.id === "local-t1") : undefined;
    expect(row).toMatchObject({ number: null, subject: "Window sill", status: "open", waiting: true });
    await r.outbox.flush();
    expect(pushed(r)[0]).toMatchObject({ function_id: "create_rfi", params: { projectId: "p1", subject: "Window sill", question: "Height?" } });
  });
  test("a site diary entry needs a real date and a whole labour count; text fields are trimmed and optional", async () => {
    const r = await rig();
    const data = shellData(r.idb as never);
    const base = { projectId: "p1", diaryDate: "2026-04-05" };
    expect(await createSiteDiaryOffline(data, { ...base, diaryDate: "yesterday" }, { outbox: r.outbox })).toEqual({ queued: false, reason: "invalid" });
    expect(await createSiteDiaryOffline(data, { ...base, labourCount: 2.5 }, { outbox: r.outbox })).toEqual({ queued: false, reason: "invalid" });
    expect((await createSiteDiaryOffline(data, { ...base, weather: " Clear ", workDone: "", labourCount: 12 }, { outbox: r.outbox })).queued).toBe(true);
    await r.outbox.flush();
    expect(pushed(r)[0]).toMatchObject({ function_id: "create_site_diary", params: { projectId: "p1", diaryDate: "2026-04-05", labourCount: 12, weather: "Clear" } });
    expect((pushed(r)[0]!.params as Record<string, unknown>).workDone).toBeUndefined();
  });
});
