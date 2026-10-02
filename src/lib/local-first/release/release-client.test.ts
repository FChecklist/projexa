import { describe, expect, test } from "bun:test";
import { createReleaseClient, parseCurrentRelease, type InstallRecord } from "./release-client";

const BASE = "https://sync.test/functions/v1/projexa-sync";

const current = (over: Record<string, unknown> = {}) => ({
  current: {
    release_version: "2026.10.02-001",
    manifest_sha256: "a".repeat(64),
    built_at: "2026-10-02T09:30:00Z",
    files: [{ path: "_next/static/a.js", file_no: 4, file_version: 2, sha256: "b".repeat(64), size: 10 }],
  },
  min_compatible: "2026.09.01-001",
  registered: true,
  ...over,
});

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

function fakeSync(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

function client(fetchImpl: typeof fetch, token: string | null = "tok") {
  return createReleaseClient({ baseUrl: BASE, getAccessToken: async () => token, clientVersion: () => "2026.10.02-001", schema: 3, fetchImpl, timeoutMs: 200 });
}

describe("GET /release/current", () => {
  test("sends the person's token and X-Px-Client, and parses the registry's answer", async () => {
    const { calls, fetchImpl } = fakeSync(() => ok(current()));
    const result = await client(fetchImpl).current();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/release/current`);
    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.headers.Authorization).toBe("Bearer tok");
    expect(calls[0]!.headers["X-Px-Client"]).toBe("2026.10.02-001; protocol=2; schema=3");
    expect(result).toEqual({
      current: { release_version: "2026.10.02-001", manifest_sha256: "a".repeat(64), built_at: "2026-10-02T09:30:00Z", files: [{ path: "_next/static/a.js", file_no: 4, file_version: 2, sha256: "b".repeat(64), size: 10 }] },
      min_compatible: "2026.09.01-001",
      registered: true,
    });
  });

  test("silent on every failure: no token, network error, 5xx, 404, non-JSON, wrong shape, timeout", async () => {
    expect(await client(fakeSync(() => ok(current())).fetchImpl, null).current()).toBeNull();
    expect(await client((async () => { throw new TypeError("fetch failed"); }) as typeof fetch).current()).toBeNull();
    for (const status of [500, 503, 404, 426]) {
      expect(await client(fakeSync(() => new Response("{}", { status })).fetchImpl).current()).toBeNull();
    }
    expect(await client(fakeSync(() => new Response("<html>", { status: 200 })).fetchImpl).current()).toBeNull();
    expect(await client(fakeSync(() => ok({ current: { release_version: 1 } })).fetchImpl).current()).toBeNull();
    expect(await client(fakeSync(() => ok(current({ current: { release_version: "x", manifest_sha256: "y", files: [{ path: 1 }] } }))).fetchImpl).current()).toBeNull();
    const hang = (async (_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    expect(await client(hang).current()).toBeNull();
  });

  test("a registry with no current release yet is a valid answer", () => {
    expect(parseCurrentRelease({ current: null, min_compatible: null, registered: false })).toEqual({ current: null, min_compatible: null, registered: false });
  });
});

describe("POST /release/register and POST /install", () => {
  test("register sends an empty body (nothing for the caller to forge) and says whether it was accepted", async () => {
    const accepted = fakeSync(() => ok({ ok: true }));
    expect(await client(accepted.fetchImpl).register()).toBe(true);
    expect(accepted.calls[0]).toMatchObject({ url: `${BASE}/release/register`, method: "POST", body: {} });
    expect(await client(fakeSync(() => new Response("", { status: 500 })).fetchImpl).register()).toBe(false);
    expect(await client((async () => { throw new TypeError("x"); }) as typeof fetch).register()).toBe(false);
  });

  test("recordInstall posts the record as given", async () => {
    const record: InstallRecord = {
      device_id: "d1", release_version: "2026.10.02-001", manifest_sha256: "a".repeat(64), previous_release: null,
      downloaded_at: "2026-10-02T10:00:00Z", installed_at: "2026-10-02T10:00:05Z", files: 3, bytes: 123, status: "installed",
    };
    const sync = fakeSync(() => ok({ ok: true }));
    expect(await client(sync.fetchImpl).recordInstall(record)).toBe(true);
    expect(sync.calls[0]).toMatchObject({ url: `${BASE}/install`, method: "POST", body: record });
    expect(sync.calls[0]!.headers["Content-Type"]).toBe("application/json");
  });
});

describe("ensureRegistered", () => {
  test("a registered release: one call, nothing is registered again", async () => {
    const sync = fakeSync(() => ok(current({ registered: true })));
    const result = await client(sync.fetchImpl).ensureRegistered();
    expect(result!.registered).toBe(true);
    expect(sync.calls.map((c) => `${c.method} ${c.url.replace(BASE, "")}`)).toEqual(["GET /release/current"]);
  });

  test("an unregistered release is registered, then current is read again", async () => {
    let registered = false;
    const sync = fakeSync((call) => {
      if (call.url.endsWith("/release/register")) {
        registered = true;
        return ok({ ok: true });
      }
      return ok(current({ registered }));
    });
    const result = await client(sync.fetchImpl).ensureRegistered();
    expect(sync.calls.map((c) => `${c.method} ${c.url.replace(BASE, "")}`)).toEqual(["GET /release/current", "POST /release/register", "GET /release/current"]);
    expect(result!.registered).toBe(true);
  });

  test("the registry holds SOME release but not the one being installed: it is registered and read again (the install record needs it)", async () => {
    let newOne = false;
    const sync = fakeSync((call) => {
      if (call.url.endsWith("/release/register")) {
        newOne = true;
        return ok({ ok: true });
      }
      const base = current({ registered: true }) as { current: Record<string, unknown> };
      return ok(newOne ? { ...base, current: { ...base.current, release_version: "2026.10.03-002", manifest_sha256: "c".repeat(64) } } : base);
    });
    const wanted = { release_version: "2026.10.03-002", manifest_sha256: "c".repeat(64) };
    const result = await client(sync.fetchImpl).ensureRegistered(undefined, wanted);
    expect(sync.calls.map((c) => `${c.method} ${c.url.replace(BASE, "")}`)).toEqual(["GET /release/current", "POST /release/register", "GET /release/current"]);
    expect(result!.current!.manifest_sha256).toBe(wanted.manifest_sha256);
  });

  test("the registry already holds the release being installed: one call, nothing registered", async () => {
    const sync = fakeSync(() => ok(current({ registered: true })));
    const wanted = { release_version: "2026.10.02-001", manifest_sha256: "a".repeat(64) };
    await client(sync.fetchImpl).ensureRegistered(undefined, wanted);
    expect(sync.calls.map((c) => c.url.replace(BASE, ""))).toEqual(["/release/current"]);
  });

  test("when registering fails the first answer is still returned, and nothing throws", async () => {
    const sync = fakeSync((call) => (call.url.endsWith("/release/register") ? new Response("", { status: 500 }) : ok(current({ registered: false }))));
    const result = await client(sync.fetchImpl).ensureRegistered();
    expect(result!.registered).toBe(false);
    expect(sync.calls).toHaveLength(2);
  });

  test("an unreachable registry is null, with a single attempt", async () => {
    const sync = fakeSync(() => new Response("", { status: 503 }));
    expect(await client(sync.fetchImpl).ensureRegistered()).toBeNull();
    expect(sync.calls).toHaveLength(1);
  });
});
