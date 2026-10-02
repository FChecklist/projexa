import { describe, expect, test } from "bun:test";
import { SYNC_BASE_URL, SyncError, createSyncClient } from "./sync-client";

type Call = { url: string; init: RequestInit };

function scripted(responses: (Response | Error | (() => Promise<Response>))[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next.clone();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

const goodPage = { items: [{ id: "1", updated_at: "2026-10-02T00:00:00Z", data: { a: 1 } }], next_cursor: 7, has_more: false, hidden_fields: ["cost"], redacted: true };
const waits: number[] = [];
const sleep = async (ms: number) => { waits.push(ms); };
const make = (responses: Parameters<typeof scripted>[0], extra: Partial<Parameters<typeof createSyncClient>[0]> = {}) => {
  const s = scripted(responses);
  waits.length = 0;
  return { ...s, client: createSyncClient({ getAccessToken: async () => "tok", fetchImpl: s.fetchImpl, sleep, backoffMs: 100, ...extra }) };
};

describe("sync client", () => {
  test("defaults to the Supabase edge function and sends the bearer token, no cookies", async () => {
    const m = make([json({ user: { id: "u", org_id: "o" }, projects: [], kinds: [] })]);
    await m.client.manifest();
    expect(SYNC_BASE_URL).toBe("https://pcrjmlpuqsbocqfwoxod.supabase.co/functions/v1/projexa-sync");
    expect(m.calls[0]!.url).toBe(`${SYNC_BASE_URL}/manifest`);
    expect((m.calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(m.calls[0]!.init.credentials).toBe("omit");
  });

  test("pull posts the contract body, caps the limit at 500 and parses the page", async () => {
    const m = make([json(goodPage)]);
    const page = await m.client.pull({ projectId: "p1", kind: "boq_lines", after: null, limit: 9999 });
    expect(JSON.parse(m.calls[0]!.init.body as string)).toEqual({ project_id: "p1", kind: "boq_lines", after: null, limit: 500 });
    expect(page).toMatchObject({ next_cursor: 7, has_more: false, redacted: true, hidden_fields: ["cost"] });
  });

  test("401 stops at once (no retry) and says signed out", async () => {
    const m = make([json({}, 401)]);
    await expect(m.client.manifest()).rejects.toMatchObject({ kind: "signed_out" });
    expect(m.calls.length).toBe(1);
  });

  test("no access token at all is signed out without any request", async () => {
    const s = scripted([json({})]);
    const client = createSyncClient({ getAccessToken: async () => null, fetchImpl: s.fetchImpl });
    await expect(client.manifest()).rejects.toMatchObject({ kind: "signed_out" });
    expect(s.calls.length).toBe(0);
  });

  test("404 is not_found and is not retried", async () => {
    const m = make([json({}, 404)]);
    await expect(m.client.pull({ projectId: "x", kind: "k", after: null })).rejects.toMatchObject({ kind: "not_found" });
    expect(m.calls.length).toBe(1);
  });

  test("429 and 5xx back off and then succeed; Retry-After wins over the default wait", async () => {
    const m = make([json({}, 429, { "Retry-After": "2" }), json({}, 503), json(goodPage)]);
    const page = await m.client.pull({ projectId: "p", kind: "k", after: null });
    expect(page.items.length).toBe(1);
    expect(m.calls.length).toBe(3);
    expect(waits).toEqual([2000, 200]); // Retry-After, then 100 * 2^1
  });

  test("gives up after the retries with the last failure's kind", async () => {
    const m = make([json({}, 500)], { maxRetries: 2 });
    await expect(m.client.manifest()).rejects.toMatchObject({ kind: "server", status: 500 });
    expect(m.calls.length).toBe(3);
    const t = make([json({}, 429)], { maxRetries: 1 });
    await expect(t.client.manifest()).rejects.toMatchObject({ kind: "rate_limited" });
  });

  test("a network failure is retried and then reported as network", async () => {
    const m = make([new TypeError("failed to fetch")], { maxRetries: 1 });
    await expect(m.client.manifest()).rejects.toMatchObject({ kind: "network" });
    expect(m.calls.length).toBe(2);
  });

  test("a request that outlasts the timeout is aborted and reported as timeout", async () => {
    const hang = () => new Promise<Response>(() => {});
    const s = {
      calls: 0,
      fetchImpl: ((_u: string, init: RequestInit) => {
        s.calls += 1;
        return new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
      }) as unknown as typeof fetch,
    };
    void hang;
    const client = createSyncClient({ getAccessToken: async () => "t", fetchImpl: s.fetchImpl, timeoutMs: 20, maxRetries: 1, sleep });
    await expect(client.manifest()).rejects.toMatchObject({ kind: "timeout" });
    expect(s.calls).toBe(2);
  });

  test("the caller's abort cancels without retrying", async () => {
    const controller = new AbortController();
    const s = {
      calls: 0,
      fetchImpl: ((_u: string, init: RequestInit) => {
        s.calls += 1;
        return new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
      }) as unknown as typeof fetch,
    };
    const client = createSyncClient({ getAccessToken: async () => "t", fetchImpl: s.fetchImpl, sleep });
    const p = client.manifest(controller.signal);
    setTimeout(() => controller.abort(), 10);
    await expect(p).rejects.toMatchObject({ kind: "aborted" });
    expect(s.calls).toBe(1);
  });

  test("a body that is not the contract is bad_response, not a crash", async () => {
    const m = make([json({ nope: true })]);
    await expect(m.client.manifest()).rejects.toBeInstanceOf(SyncError);
    await expect(make([json({ items: "x", has_more: false })]).client.pull({ projectId: "p", kind: "k", after: null })).rejects.toMatchObject({ kind: "bad_response" });
  });
});

// Package lf-fc (review cost:COST-04): the service's DAILY quota answer is a 429 with no Retry-After ("Try again tomorrow"). Retrying it
// within seconds only spends more of the quota, so it is reported at once; a 429 WITH Retry-After is still waited and retried, and the
// wait the service asked for travels on the error so the replica can pause every request until then.
describe("sync client: 429s", () => {
  test("a 429 WITHOUT Retry-After (the daily quota) is not retried", async () => {
    const m = make([json({ error: "Too many requests today. Try again tomorrow." }, 429), json(goodPage)], { maxRetries: 3 });
    await expect(m.client.pull({ projectId: "p", kind: "k", after: null })).rejects.toMatchObject({ kind: "rate_limited", status: 429 });
    expect(m.calls.length).toBe(1);
    expect(waits).toEqual([]);
  });

  test("a 429 WITH Retry-After that outlasts the retries carries the uncapped wait the service asked for", async () => {
    const m = make([json({}, 429, { "Retry-After": "60" })], { maxRetries: 1 });
    const err = await m.client.manifest().catch((e) => e);
    expect(err).toMatchObject({ kind: "rate_limited", retryAfterMs: 60_000 });
    expect(m.calls.length).toBe(2);
    expect(waits).toEqual([30_000]); // the client's own wait stays capped
  });
});
