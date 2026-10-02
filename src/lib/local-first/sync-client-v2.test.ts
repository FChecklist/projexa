import { describe, expect, test } from "bun:test";
import { SYNC_IDS_BODY_MAX_BYTES, SYNC_IDS_LIMIT, SyncError, chunkIds, createSyncClient, manifestSignInId } from "./sync-client";

// The calls added for protocol 2 (CONTRACT.md sections 0-2): changes, ids, pull by ids, push, the X-Px-Client header
// and the 426 -> update_required mapping. The original calls' tests stay in sync-client.test.ts.

type Call = { url: string; init: RequestInit };

function scripted(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    return next.clone();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const make = (responses: (Response | Error)[], extra: Partial<Parameters<typeof createSyncClient>[0]> = {}) => {
  const s = scripted(responses);
  return { ...s, client: createSyncClient({ getAccessToken: async () => "tok", fetchImpl: s.fetchImpl, sleep: async () => {}, baseUrl: "https://x.test/sync", ...extra }) };
};
const body = (c: Call) => JSON.parse(c.init.body as string);
const headers = (c: Call) => c.init.headers as Record<string, string>;

describe("X-Px-Client header (protocol 2, schema 3)", () => {
  test("every call carries it; the release defaults to dev and comes from the injected getter when given", async () => {
    const calls = make([
      json({ user: { id: "u", org_id: "o" }, projects: [], kinds: [] }),
      json({ items: [], next_cursor: null, has_more: false }),
      json({ items: [], next_cursor: null, has_more: false }),
      json({ changes: [], next_seq: 0, has_more: false, head_seq: 0 }),
      json({ ids: [], has_more: false, next_id: null }),
      json({ results: [] }),
    ]);
    await calls.client.manifest();
    await calls.client.pull({ projectId: "p", kind: "k", after: null });
    await calls.client.pullIds({ projectId: "p", kind: "k", ids: ["1"] });
    await calls.client.changes({ projectId: "p", afterSeq: null });
    await calls.client.ids({ projectId: "p", kind: "k", afterId: null });
    await calls.client.push({ deviceId: "d", ops: [] });
    expect(calls.calls.length).toBe(6);
    for (const c of calls.calls) expect(headers(c)["X-Px-Client"]).toBe("dev; protocol=2; schema=3");

    const versioned = make([json({ user: { id: "u", org_id: "o" }, projects: [], kinds: [] })], { getReleaseVersion: () => "2026.10.02-003" });
    await versioned.client.manifest();
    expect(headers(versioned.calls[0]!)["X-Px-Client"]).toBe("2026.10.02-003; protocol=2; schema=3");
  });
});

describe("426 update required", () => {
  test("becomes the kind update_required with what the service said, and is never retried", async () => {
    const m = make([json({ error: "update required", current: "2026.10.05-001", min_compatible: "2026.10.03-002" }, 426)], { maxRetries: 3 });
    const err = await m.client.push({ deviceId: "d", ops: [] }).catch((e) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect(err).toMatchObject({ kind: "update_required", status: 426, update: { current: "2026.10.05-001", minCompatible: "2026.10.03-002" } });
    expect(m.calls.length).toBe(1);
  });

  test("works for every call and tolerates a body that says nothing", async () => {
    const m = make([new Response("", { status: 426 })]);
    await expect(m.client.manifest()).rejects.toMatchObject({ kind: "update_required", update: { current: null, minCompatible: null } });
    await expect(m.client.changes({ projectId: "p", afterSeq: 1 })).rejects.toMatchObject({ kind: "update_required" });
    await expect(m.client.pull({ projectId: "p", kind: "k", after: null })).rejects.toMatchObject({ kind: "update_required" });
    await expect(m.client.ids({ projectId: "p", kind: "k", afterId: null })).rejects.toMatchObject({ kind: "update_required" });
  });

  test("a nested release object in the body is understood too", async () => {
    const m = make([json({ release: { current: "9", min_compatible: "7" } }, 426)]);
    await expect(m.client.manifest()).rejects.toMatchObject({ update: { current: "9", minCompatible: "7" } });
  });
});

describe("pull items carry version, signature and key id", () => {
  test("parsed when present", async () => {
    const m = make([json({
      items: [{ id: "a", updated_at: "2026-10-02T10:00:00Z", version: 3, sig: "SIGSIG", data: { x: 1 } }],
      kid: "key-1", next_cursor: "c1", has_more: false, hidden_fields: [], redacted: false,
    })]);
    const page = await m.client.pull({ projectId: "p", kind: "k", after: null });
    expect(page.kid).toBe("key-1");
    expect(page.items[0]).toMatchObject({ id: "a", version: 3, sig: "SIGSIG" });
  });

  test("an older service without them is tolerated: no version, no signature, no key id", async () => {
    const m = make([json({ items: [{ id: "a", updated_at: "2026-10-02T10:00:00Z", data: {} }], next_cursor: 1, has_more: false, hidden_fields: [], redacted: false })]);
    const page = await m.client.pull({ projectId: "p", kind: "k", after: null });
    expect(page.kid).toBeNull();
    expect(page.items[0]!.version).toBeUndefined();
    expect(page.items[0]!.sig).toBeUndefined();
  });

  test("a version that is not a number is ignored rather than trusted", async () => {
    const m = make([json({ items: [{ id: "a", updated_at: "t", version: "3", sig: "", data: {} }], next_cursor: null, has_more: false })]);
    const page = await m.client.pull({ projectId: "p", kind: "k", after: null });
    expect(page.items[0]!.version).toBeUndefined();
    expect(page.items[0]!.sig).toBeUndefined();
  });
});

describe("pullIds", () => {
  test("posts the exact-rows body and returns the page", async () => {
    const m = make([json({ items: [{ id: "a", updated_at: "t", version: 2, data: {} }], kid: "k1", next_cursor: null, has_more: false, hidden_fields: ["cost"], redacted: true })]);
    const page = await m.client.pullIds({ projectId: "p1", kind: "progress", ids: ["a", "b"] });
    expect(m.calls[0]!.url).toBe("https://x.test/sync/pull");
    expect(body(m.calls[0]!)).toEqual({ project_id: "p1", kind: "progress", ids: ["a", "b"] });
    expect(page.items.length).toBe(1);
    expect(page).toMatchObject({ kid: "k1", redacted: true, hidden_fields: ["cost"], has_more: false });
  });

  // Changed by review F03/SYNC-06: this test used to expect chunks of 200, which the real service answers 413 (4,096-char body cap).
  test("a long id list is split into calls of at most 80 ids (short ids: the count decides) and the pages merged in order", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `r${i}`);
    const reply = (chunk: string[]) => json({ items: chunk.map((id) => ({ id, updated_at: "t", version: 1, data: { id } })), kid: "k", next_cursor: null, has_more: false, hidden_fields: [], redacted: false });
    const chunks = chunkIds("p", "k", ids);
    expect(chunks.map((c) => c.length)).toEqual([80, 80, 80, 80, 80, 50]);
    const m = make(chunks.map(reply));
    const page = await m.client.pullIds({ projectId: "p", kind: "k", ids });
    expect(m.calls.map((c) => body(c).ids.length)).toEqual([80, 80, 80, 80, 80, 50]);
    expect(page.items.map((i) => i.id)).toEqual(ids);
  });

  test("long ids are split by body size: no request body is over 3,500 characters, every id is sent exactly once (uuid, cuid, 64-char)", async () => {
    for (const mk of [() => crypto.randomUUID(), () => "c" + crypto.randomUUID().replace(/-/g, "").slice(0, 23), (i: number) => `${"x".repeat(60)}${String(i).padStart(4, "0")}`]) {
      const ids = Array.from({ length: 200 }, (_, i) => mk(i));
      const m = make([json({ items: [], kid: null, next_cursor: null, has_more: false, hidden_fields: [], redacted: false })]);
      await m.client.pullIds({ projectId: "a-project-id-of-normal-length", kind: "boq_lines", ids });
      const sizes = m.calls.map((c) => (c.init.body as string).length);
      expect(Math.max(...sizes)).toBeLessThanOrEqual(SYNC_IDS_BODY_MAX_BYTES);
      expect(m.calls.every((c) => body(c).ids.length <= SYNC_IDS_LIMIT)).toBe(true);
      expect(m.calls.flatMap((c) => body(c).ids)).toEqual(ids);
    }
    // the worst case the service allows (64-char ids) still fits the deployed 4,096 cap with room for the envelope
    expect(SYNC_IDS_LIMIT).toBeLessThanOrEqual(80);
    expect(SYNC_IDS_BODY_MAX_BYTES).toBeLessThan(4096);
  });
});

describe("changes", () => {
  test("posts after_seq (null for the first read) and the limit, capped at 1000", async () => {
    const m = make([json({ changes: [], next_seq: 7, has_more: false, head_seq: 7 })]);
    const first = await m.client.changes({ projectId: "p1", afterSeq: null, limit: 99_999 });
    expect(body(m.calls[0]!)).toEqual({ project_id: "p1", after_seq: null, limit: 1000 });
    expect(first.head_seq).toBe(7);
    await m.client.changes({ projectId: "p1", afterSeq: 7 });
    expect(body(m.calls[1]!)).toEqual({ project_id: "p1", after_seq: 7, limit: 1000 });
  });

  test("parses insert, update and tombstone entries with their versions", async () => {
    const m = make([json({
      changes: [
        { seq: 8, kind: "tasks", id: "t1", version: 1, op: "I" },
        { seq: 9, kind: "tasks", id: "t1", version: 2, op: "U" },
        { seq: 10, kind: "rfis", id: "r1", version: 5, op: "D" },
      ],
      next_seq: 10, has_more: true, head_seq: 40, server_time: "2026-10-02T10:00:00Z",
    })]);
    const page = await m.client.changes({ projectId: "p", afterSeq: 7 });
    expect(page.changes.map((c) => `${c.seq}:${c.kind}:${c.id}:${c.version}:${c.op}`)).toEqual(["8:tasks:t1:1:I", "9:tasks:t1:2:U", "10:rfis:r1:5:D"]);
    expect(page).toMatchObject({ next_seq: 10, has_more: true, head_seq: 40 });
  });

  test("a malformed change is bad_response, not a crash", async () => {
    const m = make([json({ changes: [{ seq: 1, kind: "k", id: "x", version: 1, op: "Z" }], next_seq: 1, has_more: false, head_seq: 1 })]);
    await expect(m.client.changes({ projectId: "p", afterSeq: 0 })).rejects.toMatchObject({ kind: "bad_response" });
    await expect(make([json({ changes: [] })]).client.changes({ projectId: "p", afterSeq: 0 })).rejects.toMatchObject({ kind: "bad_response" });
  });

  test("404 (a project this person may not read) is not_found", async () => {
    await expect(make([json({}, 404)]).client.changes({ projectId: "p", afterSeq: null })).rejects.toMatchObject({ kind: "not_found" });
  });
});

describe("ids", () => {
  test("posts the inventory request, caps the limit at 5000, and parses the page", async () => {
    const m = make([json({ ids: ["a", "b"], has_more: true, next_id: "b" })]);
    const page = await m.client.ids({ projectId: "p", kind: "rfis", afterId: null, limit: 1_000_000 });
    expect(body(m.calls[0]!)).toEqual({ project_id: "p", kind: "rfis", after_id: null, limit: 5000 });
    expect(page).toEqual({ ids: ["a", "b"], has_more: true, next_id: "b" });
  });
});

describe("push", () => {
  const op = {
    op_id: "11111111-1111-4111-8111-111111111111", function_id: "update_task", project_id: "p1", params: { issueId: "t1", title: "New" },
    record: { kind: "tasks", id: "t1", base_version: 4 }, client_at: "2026-10-02T10:00:00Z",
  };

  test("posts exactly the contract's body", async () => {
    const m = make([json({ results: [] })]);
    await m.client.push({ deviceId: "dev-1", ops: [op, { ...op, op_id: "22222222-2222-4222-8222-222222222222", resolution: "overwrite" }] });
    expect(m.calls[0]!.url).toBe("https://x.test/sync/push");
    expect(body(m.calls[0]!)).toEqual({ device_id: "dev-1", ops: [op, { ...op, op_id: "22222222-2222-4222-8222-222222222222", resolution: "overwrite" }] });
    expect(m.calls[0]!.init.credentials).toBe("omit");
  });

  test("parses every status, the new version, the record id and route, a conflict's server row and a rejection's error", async () => {
    const serverRow = { kind: "tasks", id: "t1", version: 6, updated_at: "2026-10-02T10:05:00Z", data: { title: "Theirs" }, sig: "S", kid: "k" };
    const m = make([json({
      results: [
        { op_id: "a", status: "applied", record_id: "srv-1", route: "/rfis/srv-1", version: 1 },
        { op_id: "b", status: "duplicate", record_id: "srv-1", version: 1 },
        { op_id: "c", status: "conflict", server: serverRow },
        { op_id: "d", status: "rejected", error: { code: "NOT_PERMITTED" } },
        { op_id: "e", status: "rejected", error: { code: "VALUE_REQUIRED", missing: ["subject"] } },
        { op_id: "f", status: "failed", error: { code: "EXECUTION_UNCERTAIN" } },
        { op_id: "g", status: "needs_server" },
      ],
      server_time: "2026-10-02T10:06:00Z",
    })]);
    const res = await m.client.push({ deviceId: "d", ops: [] });
    expect(res.results.map((r) => `${r.op_id}:${r.status}`)).toEqual(["a:applied", "b:duplicate", "c:conflict", "d:rejected", "e:rejected", "f:failed", "g:needs_server"]);
    expect(res.results[0]).toMatchObject({ record_id: "srv-1", route: "/rfis/srv-1", version: 1 });
    expect(res.results[2]!.server).toEqual(serverRow);
    expect(res.results[4]!.error).toEqual({ code: "VALUE_REQUIRED", missing: ["subject"] });
  });

  test("a status this version has never heard of is a transient failure (the op is kept and asked again), not a crash", async () => {
    const m = make([json({ results: [{ op_id: "a", status: "teleported" }] })]);
    const res = await m.client.push({ deviceId: "d", ops: [] });
    expect(res.results[0]).toMatchObject({ op_id: "a", status: "failed", error: { code: "UNKNOWN_STATUS" } });
  });

  test("a body that is not the contract is bad_response", async () => {
    await expect(make([json({ nope: 1 })]).client.push({ deviceId: "d", ops: [] })).rejects.toMatchObject({ kind: "bad_response" });
    await expect(make([json({ results: [{ status: "applied" }] })]).client.push({ deviceId: "d", ops: [] })).rejects.toMatchObject({ kind: "bad_response" });
  });

  test("a lost connection is retried by the client's own retry rules (the op_id makes that safe)", async () => {
    const m = make([new TypeError("lost"), json({ results: [{ op_id: "a", status: "duplicate", version: 2 }] })], { maxRetries: 1 });
    const res = await m.client.push({ deviceId: "d", ops: [op] });
    expect(m.calls.length).toBe(2);
    expect(res.results[0]!.status).toBe("duplicate");
    // the SAME body both times: the op_id never changes
    expect(body(m.calls[0]!)).toEqual(body(m.calls[1]!));
  });
});

// Review F01 / F1: the manifest's user.id is the VERIDIAN person (compliance.users.id); the laptop knows the person by the sign-in id.
describe("manifestSignInId (whose manifest is this)", () => {
  test("the server's auth_user_id wins over user.id, and survives manifest parsing", async () => {
    const m = make([json({ user: { id: "ckq1w2e3r4t5y6u7i8o9p0a1", auth_user_id: "11111111-1111-4111-8111-111111111111", org_id: "o" }, projects: [], kinds: [] })]);
    const manifest = await m.client.manifest();
    expect(manifest.user.auth_user_id).toBe("11111111-1111-4111-8111-111111111111");
    expect(manifestSignInId(manifest)).toBe("11111111-1111-4111-8111-111111111111");
  });

  test("an older server without auth_user_id is compared by user.id", () => {
    expect(manifestSignInId({ user: { id: "u1", org_id: "o" } })).toBe("u1");
  });

  test("an auth_user_id that is not a string never matches anything (fails closed, never falls back to user.id)", () => {
    expect(manifestSignInId({ user: { id: "u1", org_id: "o", auth_user_id: 42 as unknown as string } })).toBe("");
  });
});
