// shell-outbox.ts: the on-laptop shell starts the person's outbox at once (so a reload's waiting ops are resumed), sends on a nudge,
// and redraws once per burst of outbox events. The browser-level proof is e2e/lf-delivery-offline.spec.ts ("a progress entry typed on
// the laptop ... is sent exactly once"), which failed before this module existed: after an offline reload nothing was ever sent.

import { describe, expect, test } from "bun:test";
import type { OutboxEvent, FlushReport } from "../outbox";
import { connectShellOutbox } from "./shell-outbox";

function fakeOutbox() {
  const listeners = new Set<(e: OutboxEvent) => void>();
  const calls = { flush: 0, created: [] as string[] };
  const outbox = {
    flush: async () => {
      calls.flush += 1;
      return {} as FlushReport;
    },
    subscribe: (fn: (e: OutboxEvent) => void) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  const emit = (e: OutboxEvent) => listeners.forEach((fn) => fn(e));
  const getOutbox = (userId: string) => {
    calls.created.push(userId);
    return outbox;
  };
  return { outbox, emit, getOutbox, calls, listeners };
}

function manualTimers() {
  const queue: Array<{ fn: () => void; cleared: boolean }> = [];
  return {
    setTimer: (fn: () => void) => {
      const t = { fn, cleared: false };
      queue.push(t);
      return t;
    },
    clearTimer: (h: unknown) => {
      (h as { cleared: boolean }).cleared = true;
    },
    run: () => {
      for (const t of queue.splice(0)) if (!t.cleared) t.fn();
    },
  };
}

const applied: OutboxEvent = { type: "applied", opId: "o1", functionId: "record_work_progress", projectId: "p1", kind: "progress", recordId: "srv-1", created: true };

describe("connectShellOutbox", () => {
  test("starts THIS person's outbox at once (that is what resumes ops a reload left waiting)", () => {
    const f = fakeOutbox();
    connectShellOutbox("user-7", { getOutbox: f.getOutbox, onSettled: () => {} });
    expect(f.calls.created).toEqual(["user-7"]);
    expect(f.listeners.size).toBe(1);
  });

  test("a nudge (back online, the tab came back) sends what waits; after stop it does nothing", async () => {
    const f = fakeOutbox();
    const s = connectShellOutbox("u", { getOutbox: f.getOutbox, onSettled: () => {} });
    s.nudge();
    s.nudge();
    expect(f.calls.flush).toBe(2);
    s.stop();
    s.nudge();
    expect(f.calls.flush).toBe(2);
  });

  test("redraws once per burst of settling events, and again for a later burst", () => {
    const f = fakeOutbox();
    const t = manualTimers();
    let redraws = 0;
    connectShellOutbox("u", { getOutbox: f.getOutbox, onSettled: () => redraws++, setTimer: t.setTimer, clearTimer: t.clearTimer });
    f.emit(applied);
    f.emit({ type: "changed" });
    f.emit({ type: "rejected", opId: "o2", functionId: "record_attendance", projectId: "p1", message: "no" });
    expect(redraws).toBe(0);
    t.run();
    expect(redraws).toBe(1);
    f.emit({ type: "changed" });
    t.run();
    expect(redraws).toBe(2);
  });

  test("events that change nothing on screen do not redraw; stop cancels a pending redraw and unsubscribes", () => {
    const f = fakeOutbox();
    const t = manualTimers();
    let redraws = 0;
    const s = connectShellOutbox("u", { getOutbox: f.getOutbox, onSettled: () => redraws++, setTimer: t.setTimer, clearTimer: t.clearTimer });
    f.emit({ type: "signed_out" });
    f.emit({ type: "not_linked" });
    t.run();
    expect(redraws).toBe(0);
    f.emit(applied);
    s.stop();
    t.run();
    expect(redraws).toBe(0);
    expect(f.listeners.size).toBe(0);
  });

  test("a flush that rejects does not throw out of nudge", async () => {
    const f = fakeOutbox();
    f.outbox.flush = async () => {
      throw new Error("broken");
    };
    const s = connectShellOutbox("u", { getOutbox: f.getOutbox, onSettled: () => {} });
    expect(() => s.nudge()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
