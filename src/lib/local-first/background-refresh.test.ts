import { describe, expect, test } from "bun:test";
import { createBackgroundRefresh } from "./background-refresh";

function rig(over: Partial<Parameters<typeof createBackgroundRefresh>[0]> = {}) {
  const calls: string[] = [];
  let t = 1_000_000;
  const run = createBackgroundRefresh({
    now: () => t,
    ready: () => true,
    online: () => true,
    visible: () => true,
    activeProject: () => "p1",
    syncProject: async (p) => { calls.push(`project:${p}`); },
    syncAll: async () => { calls.push("all"); },
    ...over,
  });
  return { run, calls, advance: (ms: number) => { t += ms; } };
}

describe("background refresh of the laptop copy", () => {
  test("the first run does the whole copy once, later runs only the open project", async () => {
    const r = rig();
    expect(await r.run()).toBe("all");
    r.advance(3 * 60_000);
    expect(await r.run()).toBe("project");
    expect(r.calls).toEqual(["all", "project:p1"]);
  });
  test("not more often than every two minutes", async () => {
    const r = rig();
    await r.run();
    r.advance(30_000);
    expect(await r.run()).toBe("skipped");
    expect(r.calls).toEqual(["all"]);
  });
  test("the whole copy again after six hours (new or removed projects)", async () => {
    const r = rig();
    await r.run();
    r.advance(6 * 60 * 60_000 + 1);
    expect(await r.run()).toBe("all");
  });
  test("nothing before the laptop is prepared, offline, or while the page is hidden", async () => {
    for (const over of [{ ready: () => false }, { online: () => false }, { visible: () => false }]) {
      const r = rig(over);
      expect(await r.run()).toBe("skipped");
      expect(r.calls).toEqual([]);
    }
  });
  test("a failure is silent and the next due run retries", async () => {
    let fail = true;
    const r = rig({ syncAll: async () => { if (fail) throw new Error("down"); } });
    expect(await r.run()).toBe("failed");
    fail = false;
    r.advance(3 * 60_000);
    expect(await r.run()).toBe("all");
  });
  test("one run at a time", async () => {
    let release: () => void = () => {};
    const r = rig({ syncAll: () => new Promise<void>((res) => { release = res; }) });
    const first = r.run();
    expect(await r.run()).toBe("skipped");
    release();
    await first;
  });
});
