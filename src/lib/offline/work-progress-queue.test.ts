// Owner directive PROJEXA_ERP_END_TO_END_REQUIREMENT_ANALYSIS_GAP_FILL_AND_IMPLEMENTATION:
// exercises the REAL work-progress-queue.ts module end to end (enqueue,
// list, sync-with-network-failure-stays-queued, sync-with-network-recovery-
// lands-server-side, remove) against a real IndexedDB implementation
// (fake-indexeddb -- this is genuinely browser-local storage, not a live
// backend/DB, so it's a different case from this repo's established
// "no live DB in .test.ts" convention, e.g. notification-service.test.ts).
// A live-site Playwright run of e2e/offline-work-progress-sync.spec.ts is
// blocked in this environment the same way the immediately-prior PR's
// pivot/chart E2E run was (projexa-ai.com/login currently serves
// compliance-tracker's login UI, not PROJEXA's -- a pre-existing prod
// deployment issue, see PROGRESS.md) -- this test is the honest substitute,
// proving the real sync logic against a real IndexedDB, not a fake result.
//
// Post-audit fix (PR #54 review): every call below now passes an explicit
// `scope` (a stand-in for the signed-in user's Supabase auth id), and two
// new describe blocks prove the two audit findings are actually fixed:
// "cross-user isolation" (a second scope can't see or drain a first
// scope's queue) and "concurrent sync dedupe" (two overlapping sync calls
// for the same scope don't double-POST the same entry).
/// <reference types="bun-types" />
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  enqueueWorkProgressEntry,
  listQueuedWorkProgressEntries,
  removeQueuedWorkProgressEntry,
  syncQueuedWorkProgressEntries,
} from "./work-progress-queue";

const USER_A = "user_a_11111111-1111-1111-1111-111111111111";
const USER_B = "user_b_22222222-2222-2222-2222-222222222222";

const baseEntry = {
  projectId: "proj_1",
  activityId: "act_1",
  entryDate: "2026-07-27",
  quantityDone: 12,
  percentComplete: 40,
  remarks: "Poured slab, level 3",
  photo: null,
};

async function clearQueue(scope: string) {
  for (const e of await listQueuedWorkProgressEntries(scope)) await removeQueuedWorkProgressEntry(scope, e.localId);
}

async function clearAll() {
  await clearQueue(USER_A);
  await clearQueue(USER_B);
}

describe("work-progress-queue (offline capture + sync)", () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test("enqueue persists a real record, visible via listQueuedWorkProgressEntries", async () => {
    const record = await enqueueWorkProgressEntry(USER_A, baseEntry);
    expect(record.status).toBe("pending");
    const queued = await listQueuedWorkProgressEntries(USER_A);
    expect(queued).toHaveLength(1);
    expect(queued[0].localId).toBe(record.localId);
    expect(queued[0].quantityDone).toBe(12);
  });

  test("syncing while the network is down leaves the entry queued with status 'error', not silently dropped", async () => {
    await enqueueWorkProgressEntry(USER_A, baseEntry);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
    try {
      const result = await syncQueuedWorkProgressEntries(USER_A);
      expect(result).toEqual({ synced: 0, failed: 1 });
      const queued = await listQueuedWorkProgressEntries(USER_A);
      expect(queued).toHaveLength(1);
      expect(queued[0].status).toBe("error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("syncing once the network recovers POSTs the real payload to /api/work-progress and empties the queue", async () => {
    await enqueueWorkProgressEntry(USER_A, baseEntry);
    const originalFetch = globalThis.fetch;
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return Promise.resolve(new Response(JSON.stringify({ id: "srv_1" }), { status: 201 }));
    }) as typeof fetch;
    try {
      const result = await syncQueuedWorkProgressEntries(USER_A);
      expect(result).toEqual({ synced: 1, failed: 0 });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("/api/work-progress");
      expect(calls[0].body).toEqual({
        projectId: "proj_1", activityId: "act_1", entryDate: "2026-07-27",
        quantityDone: 12, percentComplete: 40, remarks: "Poured slab, level 3",
      });
      expect(await listQueuedWorkProgressEntries(USER_A)).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a previously-failed entry is retried and lands on the next sync once the network is back", async () => {
    const record = await enqueueWorkProgressEntry(USER_A, baseEntry);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    await syncQueuedWorkProgressEntries(USER_A);
    expect((await listQueuedWorkProgressEntries(USER_A))[0].status).toBe("error");

    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ id: "srv_2" }), { status: 201 }))) as typeof fetch;
    try {
      const result = await syncQueuedWorkProgressEntries(USER_A);
      expect(result).toEqual({ synced: 1, failed: 0 });
      expect(await listQueuedWorkProgressEntries(USER_A)).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
    void record;
  });

  test("a real captured photo Blob round-trips through IndexedDB storage", async () => {
    const blob = new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" });
    await enqueueWorkProgressEntry(USER_A, { ...baseEntry, photo: { blob, name: "site.jpg", type: "image/jpeg" } });
    const [queued] = await listQueuedWorkProgressEntries(USER_A);
    expect(queued.photo?.name).toBe("site.jpg");
    expect(queued.photo?.blob).toBeInstanceOf(Blob);
    expect(queued.photo?.blob.size).toBe(blob.size);
  });
});

// Audit finding #1 (medium, blocking): shared/handed-off field tablets are
// this feature's explicit target persona. Supervisor A queuing entries
// offline, logging out, and Supervisor B logging in on the same device
// before A's queue drains must NOT expose or auto-sync A's data under B's
// session.
describe("work-progress-queue: per-user isolation (audit finding -- shared-device cross-user leak)", () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test("a second user's session cannot see the first user's queued entries", async () => {
    await enqueueWorkProgressEntry(USER_A, baseEntry);
    // User B logs into the same device/browser before A's entry drains.
    const queuedForB = await listQueuedWorkProgressEntries(USER_B);
    expect(queuedForB).toHaveLength(0);
    // A's entry is still exactly where A left it -- isolated, not deleted.
    expect(await listQueuedWorkProgressEntries(USER_A)).toHaveLength(1);
  });

  test("syncing under the second user's session does not touch or drain the first user's queued entries", async () => {
    await enqueueWorkProgressEntry(USER_A, baseEntry);
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(new Response(JSON.stringify({ id: "srv_b" }), { status: 201 }));
    }) as typeof fetch;
    try {
      // B logs in and the mount-effect sync fires under B's session.
      const result = await syncQueuedWorkProgressEntries(USER_B);
      expect(result).toEqual({ synced: 0, failed: 0 });
      expect(fetchCalls).toBe(0); // B's own (empty) queue never touches the network.
      // A's entry is untouched -- neither synced-away nor visible to B.
      const stillQueuedForA = await listQueuedWorkProgressEntries(USER_A);
      expect(stillQueuedForA).toHaveLength(1);
      expect(stillQueuedForA[0].status).toBe("pending");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// Audit finding #2 (medium, blocking): a component remount racing the
// 'online' event, or a flaky connection firing multiple 'online' events,
// used to let two overlapping syncQueuedWorkProgressEntries() calls both
// read the same pending entries before either flipped to "syncing",
// double-POSTing the same entry.
describe("work-progress-queue: concurrent sync dedupe (audit finding -- duplicate POST race)", () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test("two concurrent sync calls for the same scope produce exactly one POST for the queued entry", async () => {
    await enqueueWorkProgressEntry(USER_A, baseEntry);
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      // Yield a couple of microtasks before resolving, widening the
      // window a naive (non-mutexed) implementation would double-read in.
      return Promise.resolve().then(() => Promise.resolve()).then(
        () => new Response(JSON.stringify({ id: "srv_race" }), { status: 201 })
      );
    }) as typeof fetch;
    try {
      const [r1, r2] = await Promise.all([
        syncQueuedWorkProgressEntries(USER_A),
        syncQueuedWorkProgressEntries(USER_A),
      ]);
      expect(fetchCalls).toBe(1);
      expect(r1).toEqual({ synced: 1, failed: 0 });
      expect(r2).toEqual({ synced: 1, failed: 0 });
      expect(await listQueuedWorkProgressEntries(USER_A)).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a third call made after the first drain completes runs independently (lock releases, not stuck)", async () => {
    await enqueueWorkProgressEntry(USER_A, baseEntry);
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(new Response(JSON.stringify({ id: "srv_1" }), { status: 201 }));
    }) as typeof fetch;
    try {
      await Promise.all([syncQueuedWorkProgressEntries(USER_A), syncQueuedWorkProgressEntries(USER_A)]);
      expect(fetchCalls).toBe(1);

      await enqueueWorkProgressEntry(USER_A, baseEntry);
      const result = await syncQueuedWorkProgressEntries(USER_A);
      expect(result).toEqual({ synced: 1, failed: 0 });
      expect(fetchCalls).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// Audit follow-up (non-blocking, "fix if time permits"): a permanently
// invalid entry (e.g. its activityId was deleted server-side) used to
// retry forever on every 'online' event with no cap.
describe("work-progress-queue: max-attempt cap (audit follow-up -- retries forever)", () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test("an entry that fails 5 times in a row is marked 'failed' and stops being retried automatically", async () => {
    await enqueueWorkProgressEntry(USER_A, baseEntry);
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls += 1;
      return Promise.resolve(new Response(JSON.stringify({ error: "activity no longer exists" }), { status: 404 }));
    }) as typeof fetch;
    try {
      for (let i = 0; i < 5; i++) {
        await syncQueuedWorkProgressEntries(USER_A);
      }
      expect(fetchCalls).toBe(5);
      const [entry] = await listQueuedWorkProgressEntries(USER_A);
      expect(entry.status).toBe("failed");
      expect(entry.attempts).toBe(5);

      // A 6th sync (e.g. the next 'online' event) must not retry it.
      await syncQueuedWorkProgressEntries(USER_A);
      expect(fetchCalls).toBe(5);
      expect((await listQueuedWorkProgressEntries(USER_A))[0].status).toBe("failed");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
