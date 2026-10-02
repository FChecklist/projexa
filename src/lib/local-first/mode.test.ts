import { describe, expect, test } from "bun:test";
import { LOCAL_FIRST_FLAG, setLocalFirstEnabled } from "./mode";

function storage() {
  const data = new Map<string, string>();
  return { data, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

describe("local-first mode", () => {
  test("turning it on stores exactly '1' (the only value the readers accept) and tells the worker", async () => {
    const s = storage();
    const modes: boolean[] = [];
    expect(await setLocalFirstEnabled(true, { storage: s, sw: { setMode: async (on) => { modes.push(on); return { ok: true }; } } })).toBe(true);
    expect(s.data.get(LOCAL_FIRST_FLAG)).toBe("1");
    expect(modes).toEqual([true]);
  });

  test("turning it off removes the flag and tells the worker", async () => {
    const s = storage();
    s.setItem(LOCAL_FIRST_FLAG, "1");
    const modes: boolean[] = [];
    await setLocalFirstEnabled(false, { storage: s, sw: { setMode: async (on) => { modes.push(on); return { ok: true }; } } });
    expect(s.data.has(LOCAL_FIRST_FLAG)).toBe(false);
    expect(modes).toEqual([false]);
  });

  test("blocked storage or a worker that is not there never throws", async () => {
    const blocked = { setItem: () => { throw new Error("blocked"); }, removeItem: () => { throw new Error("blocked"); } };
    expect(await setLocalFirstEnabled(true, { storage: blocked, sw: { setMode: async () => { throw new Error("no worker"); } } })).toBe(false);
    expect(await setLocalFirstEnabled(true, { storage: null, sw: { setMode: async () => null } })).toBe(false);
  });
});
