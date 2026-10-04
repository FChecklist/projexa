import { describe, expect, test } from "bun:test";
import { FAKE_BASE_URL, FAKE_RELEASE, RELEASE_RE, REAL_LIMITS, canonicalJson, createFakeSyncServer, sha256Hex, type FakeServerOptions } from "./fake-sync-server";
import { LOCAL_DB_VERSION } from "../local-db";

// The fake is the yardstick the client's other test files are measured against, so it gets its own tests: each behaviour of the REAL
// service (compliance-tracker supabase/functions/projexa-sync/handler.ts + drizzle/0677-0681) is asserted here once, against the REAL
// sync client talking to the fake. conformance/parity.test.ts then runs the same scenarios against both. Every server here is `strict`
// (exactly the real handler; see the option's comment for the three legacy defaults kept for outbox.test.ts).
//
// CHANGED in the rebuild (review TEST-09): the manifest's user.id is now a VERIDIAN id different from the sign-in id; hidden fields are
// nulled (not removed) and the row says redacted; duplicates carry no server row; an unknown function is FUNCTION_NOT_ALLOWED and an
// unreadable project PROJECT_NOT_READABLE; 51 ops is a 400 (the real handler's answer), not a 413; `resolution` no longer bypasses a
// conflict; release strings use the -NNN build number.

const fake = (o: FakeServerOptions = {}) => createFakeSyncServer({ strict: true, ...o });
const DEVICE = "device-0001";
const rfi = (id: string, subject = "S") => ({ kind: "rfis", projectId: "p1", id, data: { subject } });
/** The push answer exactly as it is on the wire (the client's parser keeps only what it uses). */
const rawPush = async (s: ReturnType<typeof fake>, ops: unknown[]) =>
  (await (await s.fetchImpl(`${FAKE_BASE_URL}/push`, { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify({ device_id: DEVICE, ops }) })).json()) as { results: Record<string, unknown>[] };

describe("the contract's fixed canonical-JSON vector (CONTRACT.md section 1; the backend repo asserts the same)", () => {
  test("canonicalJson and its sha256 match", async () => {
    const input = JSON.parse('{"b":[1,2.5,"x"],"a":{"z":null,"y":"é\\n\\"","x":-0.5},"c":true}');
    expect(canonicalJson(input)).toBe('{"a":{"x":-0.5,"y":"é\\n\\"","z":null},"b":[1,2.5,"x"],"c":true}');
    expect(await sha256Hex(canonicalJson(input))).toBe("bcbc2a5c6e5947a6e1ed5e22aaa51395f6b040407127c6d9a870c7872ce8e565");
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}'); // undefined members dropped
  });
});

describe("fake sync server: identity and the manifest", () => {
  test("the manifest names the VERIDIAN person in user.id and the sign-in id in user.auth_user_id: two different strings, like the real one", async () => {
    const s = fake({ projects: ["p1", "p2"], release: { current: "2026.10.05-001", minCompatible: "2026.10.01-001" } }); // the floor is below FAKE_RELEASE
    const m = await s.client.manifest();
    expect(m.user).toMatchObject({ id: s.veridianUserId, auth_user_id: "u1", org_id: "orgA" });
    expect(m.user.id).not.toBe(m.user.auth_user_id);
    expect(m.projects.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(m.kinds.map((k) => k.kind)).toEqual(["tasks", "boq_lines", "rfis", "progress"]);
    expect(m.kinds.find((k) => k.kind === "progress")!.cursor_field).toBe("created_at");
    expect(m.view_class).toHaveLength(16);
    expect(m.release).toMatchObject({ current: "2026.10.05-001", min_compatible: "2026.10.01-001", protocol: 2 });
  });

  test("an empty release registry says null, as the real one does", async () => {
    expect((await fake().client.manifest()).release).toEqual({ current: null, min_compatible: null, protocol: 2 } as never);
  });

  test("a VERIDIAN id equal to the sign-in id is refused at construction (the fake must never hide F01 again)", () => {
    expect(() => createFakeSyncServer({ userId: "same", veridianUserId: "same" })).toThrow();
  });
});

describe("fake sync server: reads", () => {
  test("pull is a keyset over (updated_at, id) with an opaque cursor: pages, has_more, an empty page keeps no cursor, a changed row reappears", async () => {
    const s = fake();
    for (const id of ["a", "b", "c"]) s.upsert(rfi(id));
    const first = await s.client.pull({ projectId: "p1", kind: "rfis", after: null, limit: 2 });
    expect(first.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(first.has_more).toBe(true);
    expect(String(first.next_cursor)).toMatch(/^[A-Za-z0-9_-]+$/);
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

  test("a table without updated_at pages by created_at and a changed row is NOT seen again by the cursor (that is what /changes is for)", async () => {
    const s = fake();
    s.upsert({ kind: "progress", projectId: "p1", id: "x1", data: { percent: 10 } });
    const first = await s.client.pull({ projectId: "p1", kind: "progress", after: null });
    expect(first.items.map((i) => i.id)).toEqual(["x1"]);
    s.upsert({ kind: "progress", projectId: "p1", id: "x1", data: { percent: 90 }, touch: false });
    const again = await s.client.pull({ projectId: "p1", kind: "progress", after: first.next_cursor });
    expect(again.items).toEqual([]);
    expect(s.getRow("progress", "x1")!.version).toBe(2);
  });

  test("pull by ids returns exactly the named, existing rows of that project", async () => {
    const s = fake({ projects: ["p1", "p2"] });
    s.upsert(rfi("a"));
    s.upsert({ kind: "rfis", projectId: "p2", id: "z", data: {} });
    s.upsert(rfi("gone"));
    s.remove({ kind: "rfis", projectId: "p1", id: "gone" });
    const page = await s.client.pullIds({ projectId: "p1", kind: "rfis", ids: ["a", "z", "gone", "never"] });
    expect(page.items.map((i) => i.id)).toEqual(["a"]);
  });

  test("an unreadable project or an unknown kind is ONE 404 {error:'Not found'} (not_found)", async () => {
    const s = fake();
    await expect(s.client.pull({ projectId: "other", kind: "rfis", after: null })).rejects.toMatchObject({ kind: "not_found" });
    await expect(s.client.pull({ projectId: "p1", kind: "nope", after: null })).rejects.toMatchObject({ kind: "not_found" });
    await expect(s.client.changes({ projectId: "other", afterSeq: null })).rejects.toMatchObject({ kind: "not_found" });
    await expect(s.client.ids({ projectId: "other", kind: "rfis", afterId: null })).rejects.toMatchObject({ kind: "not_found" });
  });

  test("hidden fields are NULLED (not removed), the row and the page say redacted, and the signature covers what the client received", async () => {
    const s = fake({ hiddenFields: ["cost"] });
    s.upsert({ kind: "boq_lines", projectId: "p1", id: "l1", data: { description: "Slab", cost: 999 } });
    const page = await s.client.pull({ projectId: "p1", kind: "boq_lines", after: null });
    expect(page).toMatchObject({ redacted: true, hidden_fields: ["cost"] });
    expect(page.items[0]!.data).toEqual({ id: "l1", description: "Slab", cost: null, redacted: true });
    expect(await s.verifyRow({ project: "p1", kind: "boq_lines", id: "l1", version: 1, updated_at: page.items[0]!.updated_at, data: page.items[0]!.data, sig: page.items[0]!.sig! })).toBe(true);
  });
});

describe("fake sync server: the real caps and status codes", () => {
  const send = (s: ReturnType<typeof fake>, path: string, body: unknown, method = "POST") =>
    s.fetchImpl(`${FAKE_BASE_URL}${path}`, { method, headers: { Authorization: "Bearer t", "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

  test("a non-push body over 4,096 characters is 413; at the cap it is read", async () => {
    const s = fake();
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${String(i).padStart(30, "0")}`);
    const over = JSON.stringify({ project_id: "p1", kind: "rfis", ids: ids(120) });
    expect(over.length).toBeGreaterThan(REAL_LIMITS.BODY_MAX_BYTES);
    expect((await send(s, "/pull", over)).status).toBe(413);
    const under = JSON.stringify({ project_id: "p1", kind: "rfis", ids: ids(100) });
    expect(under.length).toBeLessThanOrEqual(REAL_LIMITS.BODY_MAX_BYTES);
    expect((await send(s, "/pull", under)).status).toBe(200);
  });

  test("400 for what the real handler validates: more than 200 ids, a bad id, a page limit out of range, a bad cursor, a bad after_seq", async () => {
    const s = fake();
    expect((await send(s, "/pull", { project_id: "p1", kind: "rfis", ids: Array.from({ length: 201 }, (_, i) => `${i}`) })).status).toBe(400);
    expect((await send(s, "/pull", { project_id: "p1", kind: "rfis", ids: ["bad id with spaces"] })).status).toBe(400);
    expect((await send(s, "/pull", { project_id: "p1", kind: "rfis", after: null, limit: 501 })).status).toBe(400);
    expect((await send(s, "/pull", { project_id: "p1", kind: "rfis", after: "not*a*cursor" })).status).toBe(400);
    expect((await send(s, "/changes", { project_id: "p1", after_seq: -1 })).status).toBe(400);
    expect((await send(s, "/ids", { project_id: "p1", kind: "rfis", after_id: null, limit: 5001 })).status).toBe(400);
  });

  test("an unknown route is 404 and a wrong method 405", async () => {
    const s = fake();
    expect((await send(s, "/nowhere", {})).status).toBe(404);
    expect((await send(s, "/manifest", {}, "POST")).status).toBe(405);
  });

  test("120 requests a minute per person; the 121st is 429 with Retry-After: 60, and the client reads the wait", async () => {
    let now = 1_000_000;
    const s = fake({ now: () => now });
    for (let i = 0; i < REAL_LIMITS.REQUESTS_PER_MINUTE; i++) await s.client.manifest();
    const err = await s.client.manifest().catch((e) => e);
    expect(err).toMatchObject({ kind: "rate_limited", status: 429 });
    expect(s.requests.at(-1)!.status).toBe(429);
    const raw = await send(s, "/manifest", undefined, "GET");
    expect(raw.headers.get("retry-after")).toBe("60");
    now += 60_000;
    await s.client.manifest(); // a minute later it is let through again
  });

  test("notLinked answers 403 NOT_LINKED, signedOut 401", async () => {
    const s = fake();
    s.notLinked = true;
    const raw = await send(s, "/manifest", undefined, "GET");
    expect(raw.status).toBe(403);
    expect(await raw.json()).toMatchObject({ code: "NOT_LINKED" });
    s.notLinked = false;
    s.signedOut = true;
    await expect(s.client.manifest()).rejects.toMatchObject({ kind: "signed_out" });
  });
});

describe("fake sync server: versions and signatures", () => {
  test("version goes up by one per change; the signature verifies and breaks if anything signed is altered", async () => {
    const s = fake();
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
    const s = fake();
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

  test("the head is per project (another project's changes do not move it); an empty page answers next_seq = after_seq", async () => {
    const s = fake({ projects: ["p1", "p2"] });
    s.upsert(rfi("a"));
    s.upsert({ kind: "rfis", projectId: "p2", id: "z", data: {} });
    const h1 = await s.client.changes({ projectId: "p1", afterSeq: null });
    expect(h1.head_seq).toBe(1);
    const none = await s.client.changes({ projectId: "p1", afterSeq: 1 });
    expect(none).toMatchObject({ changes: [], next_seq: 1, head_seq: 1 });
  });

  test("a delete made 'before change tracking existed' leaves no tombstone, but /ids no longer lists the row", async () => {
    const s = fake();
    s.upsert(rfi("a"));
    s.upsert(rfi("b"));
    const head = (await s.client.changes({ projectId: "p1", afterSeq: null })).head_seq;
    s.remove({ kind: "rfis", projectId: "p1", id: "b", silent: true });
    expect((await s.client.changes({ projectId: "p1", afterSeq: head })).changes).toEqual([]);
    const ids = await s.client.ids({ projectId: "p1", kind: "rfis", afterId: null });
    expect(ids.ids).toEqual(["a"]);
  });

  test("ids pages with after_id and has_more; next_id is the page's last id", async () => {
    const s = fake();
    for (const id of ["a", "b", "c"]) s.upsert(rfi(id));
    const p1 = await s.client.ids({ projectId: "p1", kind: "rfis", afterId: null, limit: 2 });
    expect(p1).toEqual({ ids: ["a", "b"], has_more: true, next_id: "b" });
    const p2 = await s.client.ids({ projectId: "p1", kind: "rfis", afterId: p1.next_id, limit: 2 });
    expect(p2).toEqual({ ids: ["c"], has_more: false, next_id: "c" });
  });
});

describe("fake sync server: push (drizzle/0681 + handler.ts push())", () => {
  const create = (opId: string, subject = "Subject") => ({
    op_id: opId, function_id: "create_rfi", project_id: "p1", params: { subject, question: "Q?" }, client_at: "2026-10-02T10:00:00Z",
  });
  const update = (opId: string, taskId: string, baseVersion: number, extra: Record<string, unknown> = {}) => ({
    op_id: opId, function_id: "update_task", project_id: "p1", params: { issueId: taskId, title: "New title" },
    record: { kind: "tasks", id: taskId, base_version: baseVersion }, client_at: "2026-10-02T10:00:00Z", ...extra,
  });

  test("applied: a create makes a row at version 1, reports record_id, route and version, and carries the signed server row", async () => {
    const s = fake();
    const res = await s.client.push({ deviceId: DEVICE, ops: [create("op-00001")] });
    expect(res.results[0]).toMatchObject({ status: "applied", version: 1 });
    const id = res.results[0]!.record_id!;
    expect(res.results[0]!.route).toBe(`/rfis/${id}`);
    expect(res.results[0]!.server).toMatchObject({ kind: "rfis", id, version: 1, data: { subject: "Subject" } });
    expect((await s.client.pull({ projectId: "p1", kind: "rfis", after: null })).items.map((i) => i.id)).toEqual([id]);
  });

  test("duplicate: the same op_id and content is answered again with the stored result and NO server row; nothing is applied twice", async () => {
    const s = fake();
    const first = await s.client.push({ deviceId: DEVICE, ops: [create("op-00001")] });
    const again = await s.client.push({ deviceId: DEVICE, ops: [create("op-00001")] });
    expect(again.results[0]).toMatchObject({ status: "duplicate", record_id: first.results[0]!.record_id, version: 1 });
    expect(again.results[0]!.server).toBeUndefined();
    expect((await s.client.ids({ projectId: "p1", kind: "rfis", afterId: null })).ids.length).toBe(1);
  });

  test("the same op_id with other content is refused OP_ID_REUSED", async () => {
    const s = fake();
    await s.client.push({ deviceId: DEVICE, ops: [create("op-00001", "One")] });
    const res = await s.client.push({ deviceId: DEVICE, ops: [create("op-00001", "Two")] });
    expect(res.results[0]).toMatchObject({ status: "rejected", error: { code: "OP_ID_REUSED" } });
  });

  test("an update at the current version applies; one based on an OLDER version is a conflict with server/base versions and the signed row", async () => {
    const s = fake();
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } }); // v1
    const ok = await s.client.push({ deviceId: DEVICE, ops: [update("op-00001", "t1", 1)] });
    expect(ok.results[0]).toMatchObject({ status: "applied", version: 2 });
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs" } }); // v3, behind the laptop's back
    expect((await rawPush(s, [update("op-00002", "t1", 2)])).results[0]).toMatchObject({ status: "conflict", version: 3, base_version: 2 }); // the wire
    const conflict = await s.client.push({ deviceId: DEVICE, ops: [update("op-00002", "t1", 2)] }); // what the client keeps of it
    expect(conflict.results[0]).toMatchObject({ status: "conflict", version: 3 });
    expect(conflict.results[0]!.server).toMatchObject({ kind: "tasks", id: "t1", version: 3, data: { title: "Theirs" } });
    expect(await s.verifyRow({ project: "p1", kind: "tasks", id: "t1", version: 3, updated_at: conflict.results[0]!.server!.updated_at, data: conflict.results[0]!.server!.data, sig: conflict.results[0]!.server!.sig! })).toBe(true);
    expect(s.getRow("tasks", "t1")!.data.title).toBe("Theirs"); // nothing was written
  });

  test("`resolution` changes nothing on the server: an op based on an older version is a conflict even with resolution 'overwrite'", async () => {
    const s = fake();
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Theirs" } }); // v2
    const res = await s.client.push({ deviceId: DEVICE, ops: [update("op-00009", "t1", 1, { resolution: "overwrite" })] });
    expect(res.results[0]).toMatchObject({ status: "conflict", version: 2 });
    const rebased = await s.client.push({ deviceId: DEVICE, ops: [update("op-00010", "t1", 2, { resolution: "overwrite" })] });
    expect(rebased.results[0]).toMatchObject({ status: "applied", version: 3 });
  });

  test("an edit to a row the server DELETED is a conflict with server: null (the delete moved the version)", async () => {
    const s = fake();
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
    s.remove({ kind: "tasks", projectId: "p1", id: "t1" });
    expect((await rawPush(s, [update("op-00001", "t1", 1)])).results[0]).toMatchObject({ status: "conflict", version: 2, base_version: 1, server: null });
    const res = await s.client.push({ deviceId: DEVICE, ops: [update("op-00001", "t1", 1)] });
    expect(res.results[0]).toMatchObject({ status: "conflict", version: 2 });
    expect(res.results[0]!.server ?? null).toBeNull();
  });

  test("refusals in the real vocabulary, and a held record's later op is PREVIOUS_OP_BLOCKED", async () => {
    const s = fake({ deniedFunctions: ["answer_rfi"] });
    s.registerFunction("flaky", () => ({ failed: "EXECUTION_UNCERTAIN" }));
    s.registerFunction("edge_only", () => ({ needsServer: true }));
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Newer" } }); // v2
    const res = await s.client.push({
      deviceId: DEVICE,
      ops: [
        { op_id: "op-a0001", function_id: "no_such_function", project_id: "p1", params: {}, client_at: "t" },
        { op_id: "op-b0001", function_id: "create_rfi", project_id: "secret", params: { subject: "S", question: "Q" }, client_at: "t" },
        { op_id: "op-c0001", function_id: "create_rfi", project_id: "p1", params: { subject: "" }, client_at: "t" },
        { op_id: "op-d0001", function_id: "flaky", project_id: "p1", params: {}, client_at: "t" },
        { op_id: "op-e0001", function_id: "edge_only", project_id: "p1", params: {}, client_at: "t" },
        { op_id: "op-f0001", function_id: "answer_rfi", project_id: "p1", params: { answer: "x" }, client_at: "t" },
        { op_id: "short", function_id: "create_rfi", project_id: "p1", params: { subject: "S", question: "Q" }, client_at: "t" },
        { op_id: "op-g0001", function_id: "update_task", project_id: "p1", params: { issueId: "t1", description: "x".repeat(70_000) }, client_at: "t" },
        update("op-h0001", "t1", 1), // a conflict holds t1 ...
        update("op-i0001", "t1", 2), // ... so its next op waits
      ],
    });
    expect(res.results.map((r) => `${r.status}:${r.error?.code ?? ""}`)).toEqual([
      "rejected:FUNCTION_NOT_ALLOWED", "rejected:PROJECT_NOT_READABLE", "rejected:VALUE_REQUIRED", "failed:EXECUTION_UNCERTAIN",
      "needs_server:FUNCTION_NOT_AVAILABLE", "rejected:ROLE_TOO_LOW", "rejected:BAD_OP", "rejected:BAD_OP", "conflict:", "failed:PREVIOUS_OP_BLOCKED",
    ]);
    expect(res.results[2]!.error?.missing).toEqual(["subject", "question"]);
    expect(s.ledger.size).toBe(0); // nothing applied
  });

  test("a rejected op answered again is the stored refusal; a failed one may run again", async () => {
    const s = fake();
    let attempt = 0;
    s.registerFunction("flaky", () => (++attempt < 2 ? { failed: "EXECUTION_UNCERTAIN" } : { ok: true, kind: "rfis", id: "srv-ok", data: { subject: "done" } }));
    const bad = { op_id: "op-c0001", function_id: "create_rfi", project_id: "p1", params: { subject: "" }, client_at: "t" };
    await s.client.push({ deviceId: DEVICE, ops: [bad] });
    expect((await s.client.push({ deviceId: DEVICE, ops: [bad] })).results[0]).toMatchObject({ status: "rejected", error: { code: "VALUE_REQUIRED" } });
    const flaky = { op_id: "op-d0001", function_id: "flaky", project_id: "p1", params: {}, client_at: "t" };
    expect((await s.client.push({ deviceId: DEVICE, ops: [flaky] })).results[0]!.status).toBe("failed");
    expect((await s.client.push({ deviceId: DEVICE, ops: [flaky] })).results[0]!.status).toBe("applied");
  });

  test("ops in one request are applied in order", async () => {
    const s = fake();
    s.upsert({ kind: "tasks", projectId: "p1", id: "t1", data: { title: "Old" } });
    const res = await s.client.push({ deviceId: DEVICE, ops: [update("op-first01", "t1", 1), update("op-second1", "t1", 2)] });
    expect(res.results.map((r) => `${r.status}:${r.version}`)).toEqual(["applied:2", "applied:3"]);
  });

  test("a lost response: the server applied the op, the client sees a network error, and re-sending the same op_id is a duplicate", async () => {
    const s = fake();
    s.loseNextResponses(1);
    await expect(s.client.push({ deviceId: DEVICE, ops: [create("op-00001")] })).rejects.toMatchObject({ kind: "network" });
    expect(s.ledger.size).toBe(1); // it WAS applied
    const retry = await s.client.push({ deviceId: DEVICE, ops: [create("op-00001")] });
    expect(retry.results[0]!.status).toBe("duplicate");
    expect((await s.client.ids({ projectId: "p1", kind: "rfis", afterId: null })).ids.length).toBe(1);
  });

  test("more than 50 ops, a short device id, or a push over 256 KB is refused outright (400 / 400 / 413), nothing applied", async () => {
    const s = fake();
    await expect(s.client.push({ deviceId: DEVICE, ops: Array.from({ length: 51 }, (_, i) => create(`op-${String(i).padStart(6, "0")}`)) })).rejects.toMatchObject({ kind: "bad_response", status: 400 });
    await expect(s.client.push({ deviceId: "d", ops: [create("op-00001")] })).rejects.toMatchObject({ kind: "bad_response", status: 400 });
    const big = Array.from({ length: 5 }, (_, i) => create(`op-big-${i}00`, "y".repeat(60_000)));
    await expect(s.client.push({ deviceId: DEVICE, ops: big })).rejects.toMatchObject({ status: 413 });
    expect(s.ledger.size).toBe(0);
  });
});

describe("fake sync server: the release gate (handler.ts updateRequired)", () => {
  test("a release below the floor is 426 with current/min_compatible; at or above it, or not in the YYYY.MM.DD-NNN form, it is not gated", async () => {
    const s = fake({ release: { current: "2026.10.05-002", minCompatible: "2026.10.04-001" } });
    const gated = async (release: string) => (await s.clientWith({ getReleaseVersion: () => release }).manifest().catch((e) => e)).kind === "update_required";
    expect(await gated("2026.10.03-999")).toBe(true);
    expect(await gated("2026.10.04-001")).toBe(false);
    expect(await gated("2026.10.03-1")).toBe(false); // not the release form: exempt, like dev and a commit sha
    expect(await gated("dev")).toBe(false);
    const err = await s.clientWith({ getReleaseVersion: () => "2026.10.03-000" }).manifest().catch((e) => e);
    expect(err.update).toEqual({ current: "2026.10.05-002", minCompatible: "2026.10.04-001" });
  });

  test("another protocol is gated whatever the release", async () => {
    const s = fake();
    const res = await s.fetchImpl(`${FAKE_BASE_URL}/manifest`, { method: "GET", headers: { Authorization: "Bearer t", "X-Px-Client": `${FAKE_RELEASE}; protocol=1; schema=3` } });
    expect(res.status).toBe(426);
    expect(await res.json()).toMatchObject({ code: "UPDATE_REQUIRED", reason: "protocol", protocol: 2 });
  });

  test("the fake's own release, and the contract's, use the -NNN build number", () => {
    expect(FAKE_RELEASE).toMatch(RELEASE_RE);
    expect("2026.10.02-3").not.toMatch(RELEASE_RE);
  });
});

describe("fake sync server: knobs", () => {
  test("requireUpdate answers 426 to everything (a floor above this client); the header sent is recorded", async () => {
    const s = fake();
    s.requireUpdate({ current: "2026.10.05-001", minCompatible: "2026.10.04-001" });
    await expect(s.client.manifest()).rejects.toMatchObject({ kind: "update_required", update: { current: "2026.10.05-001", minCompatible: "2026.10.04-001" } });
    s.requireUpdate(null);
    await s.client.manifest();
    expect(s.requests.at(-1)!.headers["x-px-client"]).toBe(`${FAKE_RELEASE}; protocol=2; schema=${LOCAL_DB_VERSION}`);
    expect(s.requests.at(-1)!.path).toBe("/manifest");
    expect(FAKE_BASE_URL).toContain("fake.sync.test");
  });

  test("failNext refuses before anything is applied", async () => {
    const s = fake();
    s.failNext({ status: 503, path: "/push" });
    await expect(s.client.push({ deviceId: DEVICE, ops: [{ op_id: "op-a0001", function_id: "create_rfi", project_id: "p1", params: { subject: "S", question: "Q" }, client_at: "t" }] })).rejects.toMatchObject({ kind: "server" });
    expect(s.ledger.size).toBe(0);
  });

  test("without `strict` the three legacy defaults outbox.test.ts still relies on hold (and only those)", async () => {
    const s = createFakeSyncServer();
    const res = await s.client.push({ deviceId: "d", ops: [{ op_id: "x", function_id: "no_such", project_id: "p1", params: {}, client_at: "t" }, { op_id: "y", function_id: "create_rfi", project_id: "p1", params: { subject: "S", question: "Q" }, client_at: "t" }] });
    expect(res.results[0]).toMatchObject({ status: "rejected", error: { code: "FUNCTION_NOT_AVAILABLE" } });
    expect(res.results[1]!.status).toBe("applied");
    expect(res.results[1]!.server).toBeUndefined();
  });
});
