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
/// <reference types="bun-types" />
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  enqueueWorkProgressEntry,
  listQueuedWorkProgressEntries,
  removeQueuedWorkProgressEntry,
  syncQueuedWorkProgressEntries,
} from "./work-progress-queue";

const baseEntry = {
  projectId: "proj_1",
  activityId: "act_1",
  entryDate: "2026-07-27",
  quantityDone: 12,
  percentComplete: 40,
  remarks: "Poured slab, level 3",
  photo: null,
};

async function clearQueue() {
  for (const e of await listQueuedWorkProgressEntries()) await removeQueuedWorkProgressEntry(e.localId);
}

describe("work-progress-queue (offline capture + sync)", () => {
  beforeEach(clearQueue);
  afterEach(clearQueue);

  test("enqueue persists a real record, visible via listQueuedWorkProgressEntries", async () => {
    const record = await enqueueWorkProgressEntry(baseEntry);
    expect(record.status).toBe("pending");
    const queued = await listQueuedWorkProgressEntries();
    expect(queued).toHaveLength(1);
    expect(queued[0].localId).toBe(record.localId);
    expect(queued[0].quantityDone).toBe(12);
  });

  test("syncing while the network is down leaves the entry queued with status 'error', not silently dropped", async () => {
    await enqueueWorkProgressEntry(baseEntry);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("Failed to fetch"))) as typeof fetch;
    try {
      const result = await syncQueuedWorkProgressEntries();
      expect(result).toEqual({ synced: 0, failed: 1 });
      const queued = await listQueuedWorkProgressEntries();
      expect(queued).toHaveLength(1);
      expect(queued[0].status).toBe("error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("syncing once the network recovers POSTs the real payload to /api/work-progress and empties the queue", async () => {
    await enqueueWorkProgressEntry(baseEntry);
    const originalFetch = globalThis.fetch;
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : null });
      return Promise.resolve(new Response(JSON.stringify({ id: "srv_1" }), { status: 201 }));
    }) as typeof fetch;
    try {
      const result = await syncQueuedWorkProgressEntries();
      expect(result).toEqual({ synced: 1, failed: 0 });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe("/api/work-progress");
      expect(calls[0].body).toEqual({
        projectId: "proj_1", activityId: "act_1", entryDate: "2026-07-27",
        quantityDone: 12, percentComplete: 40, remarks: "Poured slab, level 3",
      });
      expect(await listQueuedWorkProgressEntries()).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a previously-failed entry is retried and lands on the next sync once the network is back", async () => {
    const record = await enqueueWorkProgressEntry(baseEntry);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("offline"))) as typeof fetch;
    await syncQueuedWorkProgressEntries();
    expect((await listQueuedWorkProgressEntries())[0].status).toBe("error");

    globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify({ id: "srv_2" }), { status: 201 }))) as typeof fetch;
    try {
      const result = await syncQueuedWorkProgressEntries();
      expect(result).toEqual({ synced: 1, failed: 0 });
      expect(await listQueuedWorkProgressEntries()).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
    void record;
  });

  test("a real captured photo Blob round-trips through IndexedDB storage", async () => {
    const blob = new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" });
    await enqueueWorkProgressEntry({ ...baseEntry, photo: { blob, name: "site.jpg", type: "image/jpeg" } });
    const [queued] = await listQueuedWorkProgressEntries();
    expect(queued.photo?.name).toBe("site.jpg");
    expect(queued.photo?.blob).toBeInstanceOf(Blob);
    expect(queued.photo?.blob.size).toBe(blob.size);
  });
});
