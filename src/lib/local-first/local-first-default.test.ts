import { describe, expect, test } from "bun:test";
import { LOCAL_FIRST_FLAG, LOCAL_FIRST_OPT_OUT, applyLocalFirstDefault, setLocalFirstEnabled } from "./mode";

// Owner order 2026-10-02: "the user never has to think". Found by the first real-browser run of the offline e2e: nothing in the app ever turned the flag on, so
// after a deploy local-first would have been inert for every real person. A signed-in browser that has not decided is turned ON; a person's own "off" is respected.

function storage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}
const noWorker = { setMode: async () => ({ ok: true }) };

describe("local-first is ON by default for a signed-in person", () => {
  test("a browser that has not decided gets exactly '1', once", () => {
    const s = storage();
    expect(applyLocalFirstDefault(s)).toBe(true);
    expect(s.data.get(LOCAL_FIRST_FLAG)).toBe("1");
    expect(applyLocalFirstDefault(s)).toBe(false); // idempotent: nothing more to do
    expect(s.data.get(LOCAL_FIRST_FLAG)).toBe("1");
  });

  test("a flag that already exists is a decision and is never overwritten ('1' stays on, anything else stays off)", () => {
    const on = storage({ [LOCAL_FIRST_FLAG]: "1" });
    expect(applyLocalFirstDefault(on)).toBe(false);
    expect(on.data.get(LOCAL_FIRST_FLAG)).toBe("1");
    const off = storage({ [LOCAL_FIRST_FLAG]: "0" });
    expect(applyLocalFirstDefault(off)).toBe(false);
    expect(off.data.get(LOCAL_FIRST_FLAG)).toBe("0");
  });

  test("a person who turned it off on purpose stays off: the default never quietly turns it back on", () => {
    const s = storage({ [LOCAL_FIRST_OPT_OUT]: "1" });
    expect(applyLocalFirstDefault(s)).toBe(false);
    expect(s.data.has(LOCAL_FIRST_FLAG)).toBe(false);
  });

  test("setLocalFirstEnabled(false) writes that opt-out, setLocalFirstEnabled(true) clears it, so the choice survives the next page load", async () => {
    const s = storage();
    applyLocalFirstDefault(s);
    expect(s.data.get(LOCAL_FIRST_FLAG)).toBe("1");
    await setLocalFirstEnabled(false, { storage: s, sw: noWorker });
    expect(s.data.has(LOCAL_FIRST_FLAG)).toBe(false);
    expect(s.data.get(LOCAL_FIRST_OPT_OUT)).toBe("1");
    expect(applyLocalFirstDefault(s)).toBe(false); // next page load: still off
    expect(s.data.has(LOCAL_FIRST_FLAG)).toBe(false);
    await setLocalFirstEnabled(true, { storage: s, sw: noWorker });
    expect(s.data.get(LOCAL_FIRST_FLAG)).toBe("1");
    expect(s.data.has(LOCAL_FIRST_OPT_OUT)).toBe(false);
  });

  test("blocked or missing storage never throws and turns nothing on", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(applyLocalFirstDefault(blocked)).toBe(false);
    expect(applyLocalFirstDefault(null)).toBe(false);
  });
});
