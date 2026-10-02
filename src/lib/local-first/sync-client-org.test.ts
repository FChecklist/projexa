// lf-e7: what the sync client reads of the ORGANISATION kinds, the role / class fingerprints, the epoch and /heads (backend drizzle/0684,
// 0686; handler.ts manifest, pull, changes, heads). Every field is optional: an older service answers without them and nothing changes.
import { describe, expect, test } from "bun:test";
import { ORG_PROJECT, SyncError, createSyncClient } from "./sync-client";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function make(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responses[Math.min(calls.length - 1, responses.length - 1)]!.clone();
  }) as unknown as typeof fetch;
  return { calls, client: createSyncClient({ getAccessToken: async () => "tok", fetchImpl, sleep: async () => {}, maxRetries: 0 }) };
}

describe("sync client: organisation kinds and classes (lf-e7)", () => {
  test("the sentinel project is the backend's", () => {
    expect(ORG_PROJECT).toBe("__org__");
  });

  test("manifest: org_kinds (filtered, always project_scoped false, peer_shareable kept) and org_view_class", async () => {
    const m = make([json({
      user: { id: "u", org_id: "o" }, projects: [], kinds: [], view_class: "v1", org_view_class: "ov1",
      org_kinds: [
        { kind: "vendors", project_scoped: false, cursor_field: "created_at", deletes_supported: true, peer_shareable: true },
        { kind: "org_people", project_scoped: false, deletes_supported: true, peer_shareable: false },
        { kind: 7 }, null, "x", { kind: "" },
        { kind: "sneaky", project_scoped: true },
      ],
    })]);
    const man = await m.client.manifest();
    expect(man.org_view_class).toBe("ov1");
    expect(man.org_kinds).toEqual([
      { kind: "vendors", project_scoped: false, cursor_field: "created_at", deletes_supported: true, peer_shareable: true },
      { kind: "org_people", project_scoped: false, deletes_supported: true, peer_shareable: false },
      { kind: "sneaky", project_scoped: false },
    ]);
  });

  test("manifest from an older service: no org_kinds, no org_view_class (absent, not empty)", async () => {
    const man = await make([json({ user: { id: "u", org_id: "o" }, projects: [], kinds: [] })]).client.manifest();
    expect("org_kinds" in man).toBe(false);
    expect("org_view_class" in man).toBe(false);
  });

  test("an organisation pull is the project route with project_id __org__ (the handler accepts the sentinel); sig3 and the classes are kept", async () => {
    const m = make([json({ items: [{ id: "ven-1", updated_at: "2026-10-02T00:00:00Z", version: 2, data: { id: "ven-1" }, sig: "s2", sig3: "s3" }], kid: "k", next_cursor: null, has_more: false, hidden_fields: [], redacted: false, org_view_class: "ov1", view_class: "v1" })]);
    const page = await m.client.pull({ projectId: ORG_PROJECT, kind: "vendors", after: null });
    expect(JSON.parse(m.calls[0]!.init.body as string)).toEqual({ project_id: "__org__", kind: "vendors", after: null, limit: 500 });
    expect(page.items[0]).toMatchObject({ sig: "s2", sig3: "s3", version: 2 });
    expect(page.org_view_class).toBe("ov1");
    expect(page.view_class).toBe("v1");
  });

  test("changes: reset_required and epoch are read; absent when the service does not send them", async () => {
    const m = make([
      json({ changes: [], next_seq: 9, has_more: false, head_seq: 9, reset_required: true, epoch: "e1" }),
      json({ changes: [], next_seq: 9, has_more: false, head_seq: 9 }),
    ]);
    const a = await m.client.changes({ projectId: ORG_PROJECT, afterSeq: 3 });
    expect(a).toMatchObject({ reset_required: true, epoch: "e1", head_seq: 9 });
    const b = await m.client.changes({ projectId: "p", afterSeq: 3 });
    expect("reset_required" in b).toBe(false);
    expect("epoch" in b).toBe(false);
  });

  test("heads: GET /heads, only whole non-negative numbers survive", async () => {
    const m = make([json({ heads: { p1: 5, __org__: 7, bad: -1, worse: "9", frac: 1.5 }, projects_etag: "e", view_class: "v", org_view_class: "ov", epoch: "ep" })]);
    const h = await m.client.heads!();
    expect(m.calls[0]!.url.endsWith("/heads")).toBe(true);
    expect(m.calls[0]!.init.method).toBe("GET");
    expect(h).toMatchObject({ heads: { p1: 5, __org__: 7 }, projects_etag: "e", view_class: "v", org_view_class: "ov", epoch: "ep" });
  });

  test("heads: a malformed answer is bad_response; an older service's 404 is not_found", async () => {
    await expect(make([json({ heads: [] })]).client.heads!()).rejects.toMatchObject({ kind: "bad_response" });
    const err = await make([json({ error: "Not found" }, 404)]).client.heads!().catch((e) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect(err.kind).toBe("not_found");
  });
});
