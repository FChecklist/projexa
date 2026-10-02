import { describe, expect, test } from "bun:test";
import { startPresence, type Colleague, type PresenceSource } from "./presence";

const me: Colleague = { userId: "me" };
function source() {
  let cb: ((o: Colleague[]) => void) | null = null;
  const s: PresenceSource & { closed: boolean; tracked: Colleague[]; push(o: Colleague[]): void } = {
    closed: false, tracked: [], onSync(c) { cb = c; }, track(x) { s.tracked.push(x); return new Promise(() => undefined); }, close() { s.closed = true; }, push(o) { cb?.(o); },
  };
  return s;
}

describe("optional presence", () => {
  test("lists online colleagues without yourself; a track() that never settles blocks nothing", async () => {
    const s = source();
    const seen: Colleague[][] = [];
    startPresence(() => s, me, (o) => seen.push(o));
    await new Promise((r) => setTimeout(r, 0));
    s.push([{ userId: "me" }, { userId: "bob", name: "Bob" }]);
    expect(seen).toEqual([[{ userId: "bob", name: "Bob" }]]);
    expect(s.tracked).toEqual([me]);
  });
  test("a connection that throws, or never comes, leaves an empty list and no error", async () => {
    const seen: Colleague[][] = [];
    startPresence(() => { throw new Error("realtime down"); }, me, (o) => seen.push(o));
    startPresence(() => new Promise<PresenceSource>(() => undefined), me, (o) => seen.push(o));
    startPresence(() => null, me, (o) => seen.push(o));
    await new Promise((r) => setTimeout(r, 5));
    expect(seen).toEqual([]);
  });
  test("stop closes the channel, even when it connected after stop", async () => {
    const s = source();
    const stop = startPresence(() => s, me, () => undefined);
    await new Promise((r) => setTimeout(r, 0));
    stop();
    expect(s.closed).toBe(true);
    const late = source();
    const stop2 = startPresence(() => new Promise<PresenceSource>((r) => setTimeout(() => r(late), 5)), me, () => undefined);
    stop2();
    await new Promise((r) => setTimeout(r, 15));
    expect(late.closed).toBe(true);
  });
});
