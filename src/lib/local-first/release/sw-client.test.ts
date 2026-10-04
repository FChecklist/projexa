import { describe, expect, test } from "bun:test";
import { createSwClient, ensureServiceWorker, postToServiceWorker, type SwContainerLike, type SwTarget } from "./sw-client";

// A fake private channel: port1 is what the page listens on, port2 is what the "worker" replies through.
function channelFactory() {
  return () => {
    const port1 = { onmessage: null as ((e: { data: unknown }) => void) | null, closed: false, close() { this.closed = true; } };
    const port2 = { postMessage: (data: unknown) => queueMicrotask(() => port1.onmessage?.({ data })) };
    return { port1, port2: port2 as unknown as Transferable };
  };
}

function worker(reply: ((message: Record<string, unknown>) => unknown) | null): SwTarget & { received: Record<string, unknown>[] } {
  const received: Record<string, unknown>[] = [];
  return {
    received,
    postMessage(message: unknown, transfer: Transferable[]) {
      received.push(message as Record<string, unknown>);
      const answer = reply ? reply(message as Record<string, unknown>) : undefined;
      if (answer !== undefined) (transfer[0] as unknown as { postMessage(m: unknown): void }).postMessage(answer);
    },
  };
}

const container = (over: Partial<SwContainerLike> = {}): SwContainerLike => ({
  controller: null,
  getRegistration: async () => undefined,
  register: async () => ({}),
  ready: Promise.resolve({}),
  ...over,
});

describe("talking to the service worker", () => {
  test("a message goes to the controlling worker and its reply comes back on a private channel", async () => {
    const w = worker((m) => ({ ok: true, type: m.type }));
    const reply = await postToServiceWorker({ type: "STATUS" }, { container: container({ controller: w }), channel: channelFactory() });
    expect(reply).toEqual({ ok: true, type: "STATUS" });
    expect(w.received).toEqual([{ type: "STATUS" }]);
  });

  test("with no controller yet (first load), the registration's active worker is used", async () => {
    const w = worker(() => ({ ok: true }));
    const reply = await postToServiceWorker({ type: "STATUS" }, { container: container({ getRegistration: async () => ({ active: w }) }), channel: channelFactory() });
    expect(reply).toEqual({ ok: true });
  });

  test("no service worker at all, no active worker, or a worker that never answers: null, never a throw or a hang", async () => {
    expect(await postToServiceWorker({ type: "STATUS" }, { container: null })).toBeNull();
    expect(await postToServiceWorker({ type: "STATUS" }, { container: container() })).toBeNull();
    const silent = worker(null);
    const started = Date.now();
    expect(await postToServiceWorker({ type: "STATUS" }, { container: container({ controller: silent }), channel: channelFactory(), timeoutMs: 40 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    const broken: SwTarget = { postMessage() { throw new Error("DataCloneError"); } };
    expect(await postToServiceWorker({ type: "STATUS" }, { container: container({ controller: broken }), channel: channelFactory() })).toBeNull();
  });

  test("the typed client sends exactly the messages the worker understands", async () => {
    const w = worker(() => ({ ok: true }));
    const client = createSwClient({ container: container({ controller: w }), channel: channelFactory() });
    await client.useRelease("2026.10.02-001", "person-1", true);
    await client.useRelease("2026.10.02-001");
    await client.setMode(false);
    await client.setPerson("person-2");
    await client.clearPerson("person-2");
    await client.clearPerson(null);
    await client.status();
    expect(w.received).toEqual([
      { type: "USE_RELEASE", version: "2026.10.02-001", personId: "person-1", localFirst: true },
      { type: "USE_RELEASE", version: "2026.10.02-001" },
      { type: "SET_MODE", localFirst: false },
      { type: "SET_PERSON", personId: "person-2" },
      { type: "CLEAR_PERSON", personId: "person-2" },
      { type: "CLEAR_PERSON" },
      { type: "STATUS" },
    ]);
  });
});

describe("ensureServiceWorker", () => {
  test("registers /sw.js, waits for it to be ready and active", async () => {
    const registered: string[] = [];
    const ok = await ensureServiceWorker({ container: container({ register: async (url) => { registered.push(url); return {}; }, controller: worker(null) }) });
    expect(ok).toBe(true);
    expect(registered).toEqual(["/sw.js"]);
  });

  test("false when the browser has no service worker, registration fails, or it never becomes ready", async () => {
    expect(await ensureServiceWorker({ container: null })).toBe(false);
    expect(await ensureServiceWorker({ container: container({ register: async () => { throw new Error("SecurityError"); } }) })).toBe(false);
    expect(await ensureServiceWorker({ container: container({ ready: new Promise(() => {}) }), timeoutMs: 30 })).toBe(false);
    expect(await ensureServiceWorker({ container: container() })).toBe(false); // ready, but nothing active yet
  });
});
