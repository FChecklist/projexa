import { describe, expect, test } from "bun:test";
import { FAKE_BASE_URL, canonicalJson, createFakeSyncServer, sha256Hex } from "./fake-sync-server";

// The fake is the yardstick three other test files are measured against, so it gets its own tests: each
// behaviour the contract promises is asserted here once, against the REAL sync client talking to the fake.

const rfi = (id: string, subject = "S") => ({ kind: "rfis", projectId: "p1", id, data: { subject } });

describe("the contract's fixed canonical-JSON vector (CONTRACT.md section 1; the backend repo asserts the same)", () => {
  test("canonicalJson and its sha256 match", async () => {
    const input = JSON.parse('{"b":[1,2.5,"x"],"a":{"z":null,"y":"é\\n\\"","x":-0.5},"c":true}');
    expect(canonicalJson(input)).toBe('{"a":{"x":-0.5,"y":"é\\n\\"","z":null},"b":[1,2.5,"x"],"c":true}');
    expect(await sha256Hex(canonicalJson(input))).toBe("bcbc2a5c6e5947a6e1ed5e22aaa51395f6b040407127c6d9a870c7872ce8e565");
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}'); // undefined members dropped
  });
});

describe("fake sync server: reads", () => {
  test("manifest says who, which projects, which kinds, the view class and the release window", async () => {
    const s = createFakeSyncServer({ projects: ["p1", "p2"], release: { current: "2026.10.05-1", minCompatible: "2026.10.03-1" } });
    const m = await s.client.manifest();
    expect(m.user).toMatchObject({ id: "u1", org_id: "orgA" });
    expect(m.projects.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(m.kinds.map((k) => k.kind)).toEqual(["tasks", "boq_lines", "rfis", "progress"]);
    expect(m.view_class).toHaveLength(16);
    expect(m.release).toMatchObject({ current: "2026.10.05-1", min_compatible: "2026.10.03-1", protocol: 2 });
  });

  test("pull is a keyset over (updated_at, id): pages, has_more, an empty page keeps no cursor, and a changed row reappears at its new place", async () => {
    const s = createFakeSyncServer();
    for (const id of ["a", "b", "c"]) s.upsert(rfi(id));
    const first = await s.client.pull({ projectId: "p1", kind: "rfis", after: null, limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(first.has_more).toBe(true);
    const second = await s.client.pull({ projectId: "p1", kind: "rfis", after: first.next_cursor, limit: 2 });
    expect(second.items.map((i) => i.id)).toEqual(["c"]);
    expect(second.has_more).toBe(false);
    const empty = await s.client.pull({ projectId: "p1", kind: "rfis", after: second.next_cursor });
    expect(empty.items).toEqual([]);
    expect(empty.next_cursor).toBeNull();
    s.upsert(rfi("a", "changed")); // gets a new updated_at: seen again by the old cursor
    const again = await s.client.pull({ projectId: "p1", kind: "rfis", after: second.next_cursor });
    expect(again.items.map((i) => i.id)).toEqual(["a"]);
    expect(again.items[0]!.version).toBe(2);
  });

  test("a table without updated_at is ordered by id and a changed row is NOT seen again by the cursor (that is what /changes is for)", async () => {
    const s = createFakeSyncServer();
    s.upsert({ kind: "progress", projectId: "p1", id: "x1", data: { percent: 10 } });
    const first = await s.client.pull({ projectId: "p1", kind: "progress", after: null });
    expect(first.items.map((i) => i.id)).toEqual(["x1"]);
    s.upsert({ kind: "progress", projectId: "p1", id: "x1", data: { percent: 90 }, touch: false });
    const again = await s.client.pull({ projectId: "p1", kind: "progress", after: first.next_cursor });
    expect(again.items).toEqual([]);
    expect(s.getRow("progress", "x1")!.version).toBe(2);
  });

  test("pull by ids returns exactly the named, existing rows of that project", async () => {
    const s = createFakeSyncServer({ projects: ["p1", "p2"] });
    s.upsert(rfi("a"));
    s.upsert({ kind: "rfis", projectId: "p2", id: "z", data: {} });
    s.upsert(rfi("gone"));
    s.remove({ kind: "rfis", projectId: "p1", id: "gone" });
    const page = await s.client.pullIds({ projectId: "p1", kind: "rfis", ids: ["a", "z", "gone", "never"] });
    expect(page.items.map((i) => i.id)).toEqual(["a"]);
  });

  test("an unreadable project or an unknown kind is 404 (not_found)", async () => {
    const s = createFakeSyncServer();
    await expect(s.client.pull({ projectId: "other", kind: "rfis", after: null })).rejects.toMatchObject({ kind: "not_found" });
    await expect(s.client.pull({ projectId: "p1", kind: "nope", after: null })).rejects.toMatchObject({ kind: "not_found" });
    await expect(s.client.changes({ projectId: "other", afterSeq: null })).rejects.toMatchObject({ kind: "not_found" });
    await expect(s.client.ids({ projectId: "other", kind: "rfis", afterId: null })).rejects.toMatchObject({ kind: "not_found" });
  });

  test("hidden fields are removed, the page says redacted, and the signature covers what the client received", async () => {
    const s = createFakeSyncServer({ hiddenFields: ["cost"] });
    s.upsert({ kind: "boq_lines", projectId: "p1", id: "l1", data: { description: "Slab", cost: 999 } });
    const page = await s.client.pull({ projectId: "p1", kind: "boq_lines", after: null });
    expect(page).toMatchObject({ redacted: true, hidden_fields: ["cost"] });
    expect(page.items[0]!.data).toEqual({ id: "l1", description: "Slab" });
    expect(await s.verifyRow({ project: "p1", kind: "boq_lines", id: "l1", version: 1, updated_at: page.items[0]!.updated_at, data: page.items[0]!.data, sig: page.items[0]!.sig! })).toBe(true);
  });
});

describe("fake sync server: versions and signatures", () => {
  test("version goes up by one per change; the signature verifies and breaks if anything signed is altered", async () => {
    const s = createFakeSyncServer();
    s.upsert(rfi("a", "v1"));
    s.upsert(rfi("a", "v2"));
    s.upsert(rfi("a", "v3"));
    const page = await s.client.pull({ projectId: "p1", kind: "rfis", after: null });
    const item = page.items[0]!;
    expect(item.version).toBe(3);
    expect(page.kid).toBe("fake-key-1");
    const signed = { project: "p1", kind: "rfis", id: "a", version: 3, updated_at: item.updated_at, data: item.data, sig: item.sig! };
    expect(await s.verifyRow(signed)).toBe(true);
    expect(await s.verifyRow({ ...signed, version: 2 })).toBe(false);
    expect(await s.verifyRow({ ...signed, data: { ...(item.data as object), subject: "tampered" } })).toBe(false);
    expect(await s.verifyRow({ ...signed, project: "p2" })).toBe(false);
    expect((await s.publicKey()).jwk.crv).toBe("P-256");
  });
});

describe("fake sync server: /changes and /ids", () => {
  test("after_seq null reads only the head; later calls list insert, update and tombstone in order and page by limit", async () => {
    const s = createFakeSyncServer();
    s.upsert(rfi("a"));
    const head = await s.client.changes({ projectId: "p1", afterSeq: null });
    expect(head).toMatchObject({ changes: [], head_seq: 1, next_seq: 1, has_more: false });

    s.upsert(rfi("b"));
    s.upsert(rfi("a", "again"));
    s.remove({ kind: "rfis", projectId: "p1", id: "b" });
    const page = await s.client.changes({ projectId: "p1", afterSeq: head.head_seq, limit: 2 });
    expect(page.changes.map((c) => `${c.id}:${c.version}:${c.op}`)).toEqual(["b:1:I", "a:2:U"]);
    expect(page.has_more).toBe(true);
    const rest = await s.client.changes({ projectId: "p1", afterSeq: page.next_seq, limit: 2 });
    expect(rest.changes.map((c) => `${c.id}:${c.version}:${c.op}`)).toEqual(["b:2:D"]);
    expect(rest.has_more).toBe(false);
  });

  test("a delete made 'before change tracking existed' leaves no tombstone, but /ids no longer lists the row", async () => {
    const s = createFakeSyncServer();
    s.upsert(rfi("a"));
    s.upsert(rfi("b"));
    const head = (await s.client.changes({ projectId: "p1", afterSeq: null })).head_seq;
    s.remove({ kind: "rfis", projectId: "p1", id: "b", silent: true });
    expect((await s.client.changes({ projectId: "p1", afterSeq: head })).changes).toEqual([]);
    const ids = await s.client.ids({ projectId: "p1", kind: "rfis", afterId: null });
    expect(ids.ids).toEqual(["a"]);
  });

  test("ids pages with after_id and has_more", async () => {
    const s = createFakeSyncServer();
    for (const id of ["a", "b", "c"]) s.upsert(rfi(id));
    const p1 = await s.client.ids({ projectId: "p1", kind: "rfis", afterId: null, limit: 2 });
    expect(p1).toEqual({ ids: ["a", "b"], has_more: true, next_id: "b" });
    const p2 = await s.client.ids({ projectId: "p1", kind: "rfis", afterId: p1.next_id, limit: 2 });
    expect(p2).toEqual({ ids: ["c"], has_more: false, next_id: "c" });
  });
});

describe("fake sync server: push", () => {
  const create = (opId: string, subject = "Subject") => ({
    op_id: opId, function_id: "create_rfi", project_id: "p1", params: { subject, question: "Q?" }, client_at: "2026-10-02T10:00:00Z",
  });
  const update = (opId: string, taskId: string, baseVersion: number, extra: Record<string, unknown> = {}, resolution?: "overwrite") => ({
    op_id: opId, function_id: "update_task", project_id: "p1", params: { issueId: taskId, title: "New title" },
    record: { kind: "tasks", id: taskId, base_version: baseVersion }, client_at: "2026-10-02T10:00:00Z", ...(resolution ? { resolution } : {}), ...extra,
  });

  test("applied: a create makes a row with a new id at version 1 and reports record_id, route and version; the row is then pullable", async () => {
    const s = createFakeSyncServer();
    const res = await s.client.push({ deviceId: "d", ops: [create("op-1")] });
    expect(res.results[0]).toMatchObject({ status: "applied", version: 1 });
    const id = res.results[0]!.record_id!;
    expect(res.results[0]!.route).toBe(`/rfis/${id}`);
    expect((await s.client.pull({ projectId: "p1", kind: "rfis", after: null })).items.map((i) => i.id)).toEqual([id]);
  });

  test("duplicate: the same op_id is answered again and nothing is applied twice", async () => {
    const s = createFakeSyncServer();
    const first = await s.client.push({ deviceId: "d", ops: [create("op-1")] });
    const again = await s.client.push({ deviceId: "d", ops: [create("op-1")] });
    expect(again.results[0]).toMatchObject({ status: "duplicate", record_id: first.results[0]!.record_id, version: 1 });
    expect((await s.client.ids({ projectId: "p1", kind: "rfis", afterId: null })).ids.length).toBe(1);
  });

  test("an update at the current version applies and bumps it; one based on an OLDER version is a conflict that carries the signed current row", async () => {
    const s = createFakeSyncServer();
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } }); // v1
    const ok = await s.client.push({ deviceId: "d", ops: [update("op-1", "t1", 1)] });
    expect(ok.results[0]).toMatchObject({ status: "applied", version: 2 });
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs" } }); // v3, behind the laptop's back
    const conflict = await s.client.push({ deviceId: "d", ops: [update("op-2", "t1", 2)] });
    expect(conflict.results[0]!.status).toBe("conflict");
    expect(conflict.results[0]!.server).toMatchObject({ kind: "tasks", id: "t1", version: 3, data: { title: "Theirs" } });
    expect(await s.verifyRow({ project: "p1", kind: "tasks", id: "t1", version: 3, updated_at: conflict.results[0]!.server!.updated_at, data: conflict.results[0]!.server!.data, sig: conflict.results[0]!.server!.sig! })).toBe(true);
    expect(s.getRow("tasks", "t1")!.data.title).toBe("Theirs"); // nothing was written
  });

  test("resolution overwrite applies over a newer version", async () => {
    const s = createFakeSyncServer();
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs" } }); // v2
    const res = await s.client.push({ deviceId: "d", ops: [update("op-9", "t1", 2, {}, "overwrite")] });
    expect(res.results[0]).toMatchObject({ status: "applied", version: 3 });
    expect(s.getRow("tasks", "t1")!.data.title).toBe("New title");
  });

  test("rejected (unknown function, unreadable project, a validation the function made) and the transient statuses", async () => {
    const s = createFakeSyncServer();
    s.registerFunction("flaky", () => ({ failed: "EXECUTION_UNCERTAIN" }));
    s.registerFunction("edge_only", () => ({ needsServer: true }));
    const res = await s.client.push({
      deviceId: "d",
      ops: [
        { op_id: "a", function_id: "no_such_function", project_id: "p1", params: {}, client_at: "t" },
        { op_id: "b", function_id: "create_rfi", project_id: "secret", params: { subject: "S", question: "Q" }, client_at: "t" },
        { op_id: "c", function_id: "create_rfi", project_id: "p1", params: { subject: "" }, client_at: "t" },
        { op_id: "d", function_id: "flaky", project_id: "p1", params: {}, client_at: "t" },
        { op_id: "e", function_id: "edge_only", project_id: "p1", params: {}, client_at: "t" },
      ],
    });
    expect(res.results.map((r) => `${r.status}:${r.error?.code ?? ""}`)).toEqual([
      "rejected:FUNCTION_NOT_AVAILABLE", "rejected:PROJECT_NOT_REACHABLE", "rejected:VALUE_REQUIRED", "failed:EXECUTION_UNCERTAIN", "needs_server:",
    ]);
    expect(res.results[2]!.error?.missing).toEqual(["subject", "question"]);
    // a failed or rejected op is not in the ledger: the same op_id can be tried again
    expect(s.ledger.size).toBe(0);
  });

  test("ops in one request are applied in order", async () => {
    const s = createFakeSyncServer();
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
    const res = await s.client.push({ deviceId: "d", ops: [update("first", "t1", 1), update("second", "t1", 2)] });
    expect(res.results.map((r) => `${r.status}:${r.version}`)).toEqual(["applied:2", "applied:3"]);
  });

  test("includeServerOnApplied adds the resulting row to applied and duplicate answers", async () => {
    const s = createFakeSyncServer({ includeServerOnApplied: true });
    const res = await s.client.push({ deviceId: "d", ops: [create("op-1", "Hello")] });
    expect(res.results[0]!.server).toMatchObject({ kind: "rfis", version: 1, data: { subject: "Hello" } });
    const dup = await s.client.push({ deviceId: "d", ops: [create("op-1", "Hello")] });
    expect(dup.results[0]).toMatchObject({ status: "duplicate" });
    expect(dup.results[0]!.server).toMatchObject({ kind: "rfis", version: 1 });
  });

  test("a lost response: the server applied the op, the client sees a network error, and re-sending the same op_id is a duplicate", async () => {
    const s = createFakeSyncServer();
    s.loseNextResponses(1);
    await expect(s.client.push({ deviceId: "d", ops: [create("op-1")] })).rejects.toMatchObject({ kind: "network" });
    expect(s.ledger.size).toBe(1); // it WAS applied
    const retry = await s.client.push({ deviceId: "d", ops: [create("op-1")] });
    expect(retry.results[0]!.status).toBe("duplicate");
    expect((await s.client.ids({ projectId: "p1", kind: "rfis", afterId: null })).ids.length).toBe(1);
  });

  test("more than 50 ops in one request is refused outright", async () => {
    const s = createFakeSyncServer();
    const ops = Array.from({ length: 51 }, (_, i) => create(`op-${i}`));
    await expect(s.client.push({ deviceId: "d", ops })).rejects.toMatchObject({ kind: "bad_response", status: 413 });
  });
});

describe("fake sync server: knobs", () => {
  test("requireUpdate answers 426 to everything; the header sent is recorded", async () => {
    const s = createFakeSyncServer();
    s.requireUpdate({ current: "2026.10.05-1", minCompatible: "2026.10.04-1" });
    await expect(s.client.manifest()).rejects.toMatchObject({ kind: "update_required", update: { current: "2026.10.05-1", minCompatible: "2026.10.04-1" } });
    s.requireUpdate(null);
    await s.client.manifest();
    expect(s.requests.at(-1)!.headers["x-px-client"]).toBe("2026.10.02-3; protocol=2; schema=3");
    expect(s.requests.at(-1)!.path).toBe("/manifest");
    expect(FAKE_BASE_URL).toContain("fake.sync.test");
  });

  test("signedOut answers 401", async () => {
    const s = createFakeSyncServer();
    s.signedOut = true;
    await expect(s.client.manifest()).rejects.toMatchObject({ kind: "signed_out" });
  });

  test("failNext refuses before anything is applied", async () => {
    const s = createFakeSyncServer();
    s.failNext({ status: 503, path: "/push" });
    await expect(s.client.push({ deviceId: "d", ops: [{ op_id: "a", function_id: "create_rfi", project_id: "p1", params: { subject: "S", question: "Q" }, client_at: "t" }] })).rejects.toMatchObject({ kind: "server" });
    expect(s.ledger.size).toBe(0);
  });
});
