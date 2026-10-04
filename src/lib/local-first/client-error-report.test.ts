import { describe, expect, test } from "bun:test";
import { createClientErrorReporter, ERR_PENDING_KEY } from "./client-error-report";

const mem = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe("client error reporter (Audit 37 point 33)", () => {
  test("sends the error and clears the buffer on success", async () => {
    const sent: unknown[] = [];
    const st = mem();
    const r = createClientErrorReporter({ storage: st, send: async (x) => { sent.push(...x); return true; } });
    await r.report("sync", new Error("boom"), "outbox");
    expect(sent).toHaveLength(1);
    expect((sent[0] as { message: string }).message).toBe("Error: boom");
    expect(st.m.has(ERR_PENDING_KEY)).toBe(false);
  });
  test("keeps the error when offline and sends it with the next flush", async () => {
    let up = false;
    const got: unknown[] = [];
    const st = mem();
    const r = createClientErrorReporter({ storage: st, send: async (x) => { if (!up) return false; got.push(...x); return true; } });
    await r.report("peer", "offline-one");
    expect(JSON.parse(st.m.get(ERR_PENDING_KEY)!)).toHaveLength(1);
    up = true;
    await r.flush();
    expect(got).toHaveLength(1);
    expect(st.m.has(ERR_PENDING_KEY)).toBe(false);
  });
  test("a render loop cannot flood: at most 5 per minute", async () => {
    let n = 0;
    const r = createClientErrorReporter({ storage: mem(), now: () => 1000, send: async (x) => { n += x.length; return true; } });
    for (let i = 0; i < 50; i++) await r.report("loop", "x");
    expect(n).toBe(5);
  });
});
