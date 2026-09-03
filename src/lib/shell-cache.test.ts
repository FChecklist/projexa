/// <reference types="bun-types" />
// R67 F-01. Four properties, each of which corresponds to a way this could be
// silently wrong: it must actually skip the request inside the TTL (or it does
// nothing), it must share one in-flight request (or two components mounting
// together still make two calls), it must NOT cache failures (or one blip
// becomes a minute of broken header), and `force` must really bypass (or
// M24Shell's cross-tab identity fix, F_025, is blunted by a 60 s window).
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  cachedShellJson,
  invalidateShellCache,
  peekShellCache,
  subscribeShellCache,
  writeShellCache,
  ShellFetchError,
  SHELL_CACHE_TTL_MS,
} from "./shell-cache";

const realFetch = globalThis.fetch;
let requestCount = 0;

function stubFetch(body: unknown, status = 200, delayMs = 0) {
  requestCount = 0;
  globalThis.fetch = (async () => {
    requestCount += 1;
    if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

beforeEach(() => invalidateShellCache());
afterEach(() => {
  globalThis.fetch = realFetch;
  invalidateShellCache();
});

describe("cachedShellJson", () => {
  test("a second read inside the TTL makes NO request", async () => {
    stubFetch({ organization: { name: "Skyline Builders" } });

    const first = await cachedShellJson<{ organization: { name: string } }>("org", "/api/organization");
    const second = await cachedShellJson<{ organization: { name: string } }>("org", "/api/organization");

    expect(first.organization.name).toBe("Skyline Builders");
    expect(second).toEqual(first);
    expect(requestCount).toBe(1);
  });

  test("two concurrent readers share ONE in-flight request", async () => {
    stubFetch({ projects: [] }, 200, 20);

    const [a, b] = await Promise.all([
      cachedShellJson("projects", "/api/projects"),
      cachedShellJson("projects", "/api/projects"),
    ]);

    expect(a).toEqual(b);
    expect(requestCount).toBe(1);
  });

  test("a failure is NOT cached -- the next read retries", async () => {
    stubFetch({ error: "No organisation on this account" }, 400);

    await expect(cachedShellJson("org", "/api/organization")).rejects.toThrow("No organisation on this account");
    await expect(cachedShellJson("org", "/api/organization")).rejects.toThrow("No organisation on this account");

    expect(requestCount).toBe(2);
  });

  test("the error carries the backend's own words and status", async () => {
    stubFetch({ error: "No organisation on this account" }, 400);

    try {
      await cachedShellJson("org", "/api/organization");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ShellFetchError);
      expect((err as ShellFetchError).status).toBe(400);
      expect((err as ShellFetchError).message).toBe("No organisation on this account");
    }
  });

  test("a non-JSON error body still fails with the status, not with data", async () => {
    requestCount = 0;
    globalThis.fetch = (async () => {
      requestCount += 1;
      return new Response("<html>502</html>", { status: 502 });
    }) as typeof fetch;

    await expect(cachedShellJson("org", "/api/organization")).rejects.toThrow("HTTP 502");
  });

  test("force bypasses a warm entry -- F_025's cross-tab identity re-read", async () => {
    stubFetch({ organization: { name: "A" } });
    await cachedShellJson("org", "/api/organization");
    expect(requestCount).toBe(1);

    await cachedShellJson("org", "/api/organization", { force: true });

    expect(requestCount).toBe(2);
  });

  test("an expired entry is refetched", async () => {
    stubFetch({ organization: { name: "A" } });
    await cachedShellJson("org", "/api/organization", { ttlMs: 0 });
    await cachedShellJson("org", "/api/organization", { ttlMs: 0 });

    expect(requestCount).toBe(2);
  });

  test("invalidateShellCache drops one key without touching the others", async () => {
    stubFetch({ ok: true });
    await cachedShellJson("org", "/api/organization");
    await cachedShellJson("projects", "/api/projects");
    expect(requestCount).toBe(2);

    invalidateShellCache("org");
    await cachedShellJson("org", "/api/organization");
    await cachedShellJson("projects", "/api/projects");

    expect(requestCount).toBe(3);
  });

  test("the default window is a minute -- long enough to cover a navigation, short enough to stay current", () => {
    expect(SHELL_CACHE_TTL_MS).toBe(60_000);
  });
});

// R67 F-11 (R-146). The store gained a write side so an optimistic append can
// reach a panel that is already mounted. Three ways that could be silently
// wrong: a peek that ignores the TTL (it would resurrect data a read would have
// discarded), a write that does not notify (the panel never re-renders), and a
// listener that is not really removed on unsubscribe (a leak, and a setState on
// an unmounted component).
describe("peek / write / subscribe", () => {
  test("peekShellCache returns what is cached, and undefined once it is stale", async () => {
    stubFetch({ value: 1 });
    await cachedShellJson("k", "/api/thing");

    expect(peekShellCache<{ value: number }>("k")).toEqual({ value: 1 });
    // A zero-length window makes every entry stale, without waiting a minute.
    expect(peekShellCache("k", 0)).toBeUndefined();
  });

  test("writeShellCache puts a value in with no request, and tells subscribers", () => {
    stubFetch({ never: "requested" });
    let notified = 0;
    const unsubscribe = subscribeShellCache("k", () => { notified += 1; });

    writeShellCache("k", { value: 2 });

    expect(peekShellCache<{ value: number }>("k")).toEqual({ value: 2 });
    expect(notified).toBe(1);
    expect(requestCount).toBe(0);
    unsubscribe();
  });

  test("unsubscribe really stops the listener", () => {
    let notified = 0;
    const unsubscribe = subscribeShellCache("k", () => { notified += 1; });
    unsubscribe();

    writeShellCache("k", { value: 3 });

    expect(notified).toBe(0);
  });

  test("invalidating a key notifies too -- a panel must learn its data went away", () => {
    let notified = 0;
    const unsubscribe = subscribeShellCache("k", () => { notified += 1; });
    writeShellCache("k", { value: 4 });
    invalidateShellCache("k");
    unsubscribe();

    expect(notified).toBe(2);
    expect(peekShellCache("k")).toBeUndefined();
  });

  test("a listener on one key is not called for another key's write", () => {
    let notified = 0;
    const unsubscribe = subscribeShellCache("k", () => { notified += 1; });
    writeShellCache("other", { value: 5 });
    unsubscribe();

    expect(notified).toBe(0);
  });
});
