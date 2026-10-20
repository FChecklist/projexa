/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { ACTION_DELAY_MS, BACKOFF_BASE_MS, ERROR_DELAY_MS, OUTBOX_MAX, createBestStore, createLocalStorageStore, createOutbox, type OutboxStore } from "./outbox";
import type { ClientLogEvent, SendResult } from "./types";

let seq = 0;
function ev(kind: ClientLogEvent["kind"], extra: Partial<ClientLogEvent> = {}): ClientLogEvent {
  seq += 1;
  return {
    id: `id-${seq}`, kind, severity: kind === "action" ? "info" : "error", fingerprint: "f", message: "m", stack: null, route: "/", projectId: null,
    sessionId: "s", apiPath: null, httpMethod: null, httpStatus: null, requestId: null, durationMs: null, actionName: kind === "action" ? "a" : null,
    outcome: null, breadcrumbs: [], context: { userAgent: "", platform: "", screen: "", language: "", online: true, appVersion: "t" },
    occurredAt: new Date(1_700_000_000_000 + seq * 1000).toISOString(), ...extra,
  };
}

function memStore(initial: ClientLogEvent[] = []): OutboxStore & { rows: Map<string, ClientLogEvent> } {
  const rows = new Map(initial.map((e) => [e.id, e]));
  return { rows, loadAll: async () => [...rows.values()], put: async (e) => void rows.set(e.id, e), remove: async (ids) => void ids.forEach((i) => rows.delete(i)) };
}

// a manual clock + timer queue: nothing here waits on real time
function rig(opts: { store?: OutboxStore; send?: (e: ClientLogEvent[]) => Promise<SendResult>; online?: () => boolean; canSend?: () => boolean; max?: number } = {}) {
  let t = 1_000_000;
  const timers: { at: number; fn: () => void; id: number; dead?: boolean }[] = [];
  let nid = 0;
  const sent: ClientLogEvent[][] = [];
  const store = opts.store ?? memStore();
  const outbox = createOutbox({
    store,
    send: opts.send ?? (async (e) => { sent.push(e); return { status: 200, accepted: e.length, rejected: [] }; }),
    now: () => t,
    setTimer: (fn, ms) => { const x = { at: t + ms, fn, id: ++nid }; timers.push(x); return x; },
    clearTimer: (h) => { (h as { dead?: boolean }).dead = true; },
    isOnline: opts.online, canSend: opts.canSend, max: opts.max,
  });
  const advance = async (ms: number) => {
    t += ms;
    for (const x of timers.filter((x) => !x.dead && x.at <= t).sort((a, b) => a.at - b.at)) { x.dead = true; x.fn(); }
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { outbox, store, sent, advance, now: () => t, timers };
}

describe("outbox delivery", () => {
  test("an error goes out ~5 s after it happens, an action waits for the 60 s tick", async () => {
    const r = rig();
    await r.outbox.ready;
    r.outbox.enqueue(ev("error"));
    await r.advance(ERROR_DELAY_MS - 1);
    expect(r.sent.length).toBe(0);
    await r.advance(1);
    expect(r.sent.length).toBe(1);

    const r2 = rig();
    await r2.outbox.ready;
    r2.outbox.enqueue(ev("action"));
    await r2.advance(ERROR_DELAY_MS + 100);
    expect(r2.sent.length).toBe(0);
    await r2.advance(ACTION_DELAY_MS);
    expect(r2.sent.length).toBe(1);
  });

  test("batches are at most 50, errors first", async () => {
    const r = rig();
    await r.outbox.ready;
    for (let i = 0; i < 60; i++) r.outbox.enqueue(ev("action"));
    const err = ev("error");
    r.outbox.enqueue(err);
    await r.advance(ERROR_DELAY_MS);
    expect(r.sent.map((b) => b.length)).toEqual([50, 11]);
    expect(r.sent[0]![0]!.id).toBe(err.id);
    expect(r.outbox.size()).toBe(0);
  });

  test("429 / 5xx / network failure back off exponentially and keep every event; success clears", async () => {
    const results: (SendResult | "throw")[] = [{ status: 429 }, { status: 503 }, "throw", { status: 200, accepted: 1, rejected: [] }];
    let calls = 0;
    const r = rig({ send: async () => { const x = results[calls++]!; if (x === "throw") throw new Error("net"); return x; } });
    await r.outbox.ready;
    r.outbox.enqueue(ev("error"));
    await r.advance(ERROR_DELAY_MS);
    expect(calls).toBe(1);
    expect(r.outbox.size()).toBe(1);
    expect(r.outbox.backoffUntil() - r.now()).toBe(BACKOFF_BASE_MS); // 5 s
    await r.advance(BACKOFF_BASE_MS);
    expect(calls).toBe(2);
    expect(r.outbox.backoffUntil() - r.now()).toBe(BACKOFF_BASE_MS * 2); // 10 s
    await r.advance(BACKOFF_BASE_MS * 2);
    expect(calls).toBe(3);
    expect(r.outbox.backoffUntil() - r.now()).toBe(BACKOFF_BASE_MS * 4); // 20 s
    await r.advance(BACKOFF_BASE_MS * 4);
    expect(calls).toBe(4);
    expect(r.outbox.size()).toBe(0);
  });

  test("a server that has no such route yet (404) is retried later, not discarded", async () => {
    const r = rig({ send: async () => ({ status: 404 }) });
    await r.outbox.ready;
    r.outbox.enqueue(ev("error"));
    await r.advance(ERROR_DELAY_MS);
    expect(r.outbox.size()).toBe(1);
  });

  test("401 means signed out: nothing is dropped, nothing more is sent until resume()", async () => {
    let calls = 0;
    const r = rig({ send: async () => { calls++; return { status: 401 }; } });
    await r.outbox.ready;
    r.outbox.enqueue(ev("error"));
    await r.advance(ERROR_DELAY_MS);
    expect(calls).toBe(1);
    r.outbox.enqueue(ev("error"));
    await r.advance(ERROR_DELAY_MS * 10);
    expect(calls).toBe(1);
    expect(r.outbox.size()).toBe(2);
    expect(r.outbox.isPaused()).toBe(true);
    r.outbox.resume();
    await r.advance(ERROR_DELAY_MS);
    expect(calls).toBe(2);
  });

  test("no work while offline or on a signed-out page; the online event delivers", async () => {
    let online = false;
    const r = rig({ online: () => online });
    await r.outbox.ready;
    r.outbox.enqueue(ev("error"));
    await r.advance(ERROR_DELAY_MS * 5);
    expect(r.sent.length).toBe(0);
    online = true;
    r.outbox.onOnline();
    await r.advance(1);
    expect(r.sent.length).toBe(1);

    const r2 = rig({ canSend: () => false });
    await r2.outbox.ready;
    r2.outbox.enqueue(ev("error"));
    await r2.advance(ERROR_DELAY_MS * 5);
    expect(r2.sent.length).toBe(0);
    expect(r2.outbox.size()).toBe(1);
  });

  test("a batch the server answered 2xx leaves the device, rejected events included (resending them would loop for ever)", async () => {
    const r = rig({ send: async (e) => ({ status: 200, accepted: e.length - 1, rejected: [{ index: 0, reason: "bad" }] }) });
    await r.outbox.ready;
    r.outbox.enqueue(ev("error"));
    r.outbox.enqueue(ev("error"));
    await r.advance(ERROR_DELAY_MS);
    expect(r.outbox.size()).toBe(0);
  });
});

describe("outbox persistence (offline + reload)", () => {
  test("events survive a reload: a new outbox over the same store sends what the old one never could", async () => {
    const store = memStore();
    const r1 = rig({ store, online: () => false });
    await r1.outbox.ready;
    const e = ev("error");
    r1.outbox.enqueue(e);
    await r1.advance(ERROR_DELAY_MS * 3);
    expect(r1.sent.length).toBe(0);
    expect([...store.rows.keys()]).toEqual([e.id]); // on the device

    const r2 = rig({ store }); // "page reloaded", now online
    await r2.outbox.ready;
    await r2.advance(ERROR_DELAY_MS);
    expect(r2.sent.flat().map((x) => x.id)).toEqual([e.id]);
    expect(store.rows.size).toBe(0); // and gone from the device only after the server took it
  });

  test("localStorage fallback store round-trips and removes", async () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    const s = createLocalStorageStore(storage);
    const a = ev("error");
    const b = ev("action");
    await s.put(a);
    await s.put(b);
    await s.put({ ...a, message: "changed" });
    expect((await s.loadAll()).map((x) => [x.id, x.message])).toEqual([[b.id, "m"], [a.id, "changed"]]);
    await s.remove([a.id, b.id]);
    expect(mem.size).toBe(0);
    expect(await createLocalStorageStore(null).loadAll()).toEqual([]); // storage blocked: still no throw
  });
});

describe("outbox drop policy: the oldest action goes first, an error is never dropped", () => {
  test("full of actions: the oldest action is evicted", async () => {
    const r = rig({ max: 5 });
    await r.outbox.ready;
    const first = ev("action");
    r.outbox.enqueue(first);
    for (let i = 0; i < 5; i++) r.outbox.enqueue(ev("action"));
    expect(r.outbox.size()).toBe(5);
    expect(r.outbox.pending().some((x) => x.id === first.id)).toBe(false);
  });

  test("full of errors, then more arrive: every error is kept, the cap is soft for them", async () => {
    const r = rig({ max: 5 });
    await r.outbox.ready;
    const errors = Array.from({ length: 8 }, () => ev("error"));
    errors.forEach((e) => r.outbox.enqueue(e));
    expect(r.outbox.pending().map((x) => x.id)).toEqual(errors.map((e) => e.id));
    expect([...(r.store as ReturnType<typeof memStore>).rows.keys()].sort()).toEqual(errors.map((e) => e.id).sort());
  });

  test("a mixed queue sheds actions only, however many errors there are", async () => {
    const r = rig({ max: 6 });
    await r.outbox.ready;
    const errors = Array.from({ length: 4 }, () => ev("error"));
    const actions = Array.from({ length: 10 }, () => ev("action"));
    [...actions.slice(0, 5), ...errors, ...actions.slice(5)].forEach((e) => r.outbox.enqueue(e));
    const ids = new Set(r.outbox.pending().map((x) => x.id));
    for (const e of errors) expect(ids.has(e.id)).toBe(true);
    expect(r.outbox.size()).toBe(6);
    expect(OUTBOX_MAX).toBe(500);
  });
});

describe("the device database is created only when there is something to keep", () => {
  test("a browser with nothing to report never gets a database: start-up reads and clean-up do not open one", async () => {
    let opened = 0;
    const factory = { databases: async () => [], open: () => { opened++; throw new Error("must not open"); } } as unknown as IDBFactory;
    const store = createBestStore({ indexedDB: factory });
    expect(await store.loadAll()).toEqual([]);
    await store.remove(["x"]);
    expect(opened).toBe(0);
  });

  test("an existing database is read at start-up so an earlier page's events are resumed", async () => {
    let opened = 0;
    const factory = { databases: async () => [{ name: "px-client-log" }], open: () => { opened++; throw new Error("no real idb here"); } } as unknown as IDBFactory;
    const store = createBestStore({ indexedDB: factory });
    await store.loadAll(); // open fails in this fake -> falls back to localStorage, never throws
    expect(opened).toBe(1);
  });
});
