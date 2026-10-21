/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { backUrl, consumeReturn, entryForScreen, listTrail, markReturnReady, pushReturn, RETURN_PARAM, TRAIL_MAX, TRAIL_TTL_MS, withReturnTo } from "./return-trail";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}
const T0 = 1_000_000_000_000;
const entry = (n: number) => ({ returnUrl: `/permits/new?projectId=p${n}`, label: `form ${n}`, destination: `/finance/currencies?x=${n}` });

describe("the return trail", () => {
  test("pushes the full current address and a label; the destination path is stored without its query", () => {
    const s = memory();
    const e = pushReturn({ ...entry(1), draftKey: "permit-new" }, s, T0);
    expect(e.returnUrl).toBe("/permits/new?projectId=p1");
    expect(e.destination).toBe("/finance/currencies");
    expect(e.draftKey).toBe("permit-new");
    expect(listTrail(s, T0 + 1)[0].id).toBe(e.id);
  });

  test("keeps at most 5 entries: the oldest falls off", () => {
    const s = memory();
    for (let i = 1; i <= 7; i++) pushReturn(entry(i), s, T0 + i);
    const list = listTrail(s, T0 + 10);
    expect(list.length).toBe(TRAIL_MAX);
    expect(list.map((e) => e.label)).toEqual(["form 3", "form 4", "form 5", "form 6", "form 7"]);
  });

  test("an entry expires after 2 hours and not before", () => {
    const s = memory();
    pushReturn(entry(1), s, T0);
    expect(listTrail(s, T0 + TRAIL_TTL_MS - 1).length).toBe(1);
    expect(listTrail(s, T0 + TRAIL_TTL_MS).length).toBe(0);
  });

  test("consuming returns the entry once and removes it", () => {
    const s = memory();
    const e = pushReturn(entry(1), s, T0);
    expect(consumeReturn(e.id, s, T0 + 5)?.label).toBe("form 1");
    expect(consumeReturn(e.id, s, T0 + 6)).toBeNull();
    expect(listTrail(s, T0 + 7).length).toBe(0);
  });

  test("the destination screen finds its entry by ?returnTo=<id>, and by its own path after the marker is lost (a reload keeps working)", () => {
    const s = memory();
    const e = pushReturn(entry(1), s, T0);
    expect(entryForScreen("/finance/currencies", `?${RETURN_PARAM}=${e.id}`, s, T0 + 1)?.id).toBe(e.id);
    expect(entryForScreen("/finance/currencies", "", s, T0 + 1)?.id).toBe(e.id);
    expect(entryForScreen("/somewhere/else", "", s, T0 + 1)).toBeNull();
    expect(entryForScreen("/somewhere/else", "?returnTo=nope", s, T0 + 1)).toBeNull();
  });

  test("a save on the destination screen marks its entries ready; other screens' entries are untouched", () => {
    const s = memory();
    const a = pushReturn(entry(1), s, T0);
    const b = pushReturn({ ...entry(2), destination: "/vendors/new" }, s, T0 + 1);
    markReturnReady("/finance/currencies", s, T0 + 2);
    const list = listTrail(s, T0 + 3);
    expect(list.find((e) => e.id === a.id)?.ready).toBe(true);
    expect(list.find((e) => e.id === b.id)?.ready).toBeUndefined();
  });

  test("after a save that moved the person on, the strip follows them to the next screen until they go back (or it is 30 minutes old)", () => {
    const s = memory();
    const e = pushReturn(entry(1), s, T0);
    // not saved yet: the strip belongs to its destination only
    expect(entryForScreen("/finance/currencies/abc", "", s, T0 + 1)).toBeNull();
    markReturnReady("/finance/currencies", s, T0 + 2);
    // saved, and the create screen has landed on the new record
    expect(entryForScreen("/finance/currencies/abc", "?created=1", s, T0 + 3)?.id).toBe(e.id);
    expect(entryForScreen("/anything/else", "", s, T0 + 4)?.id).toBe(e.id);
    // too old to follow
    expect(entryForScreen("/anything/else", "", s, T0 + 31 * 60 * 1000)).toBeNull();
    // going back removes it
    consumeReturn(e.id, s, T0 + 5);
    expect(entryForScreen("/anything/else", "", s, T0 + 6)).toBeNull();
  });

  test("the way back never leaves the site and drops the markers; the destination link carries the marker", () => {
    const s = memory();
    const e = pushReturn({ returnUrl: "/permits/new?projectId=p1&focus=name&returnTo=zz", label: "x", destination: "/a" }, s, T0);
    expect(backUrl(e)).toBe("/permits/new?projectId=p1");
    const evil = pushReturn({ returnUrl: "https://evil.example/x", label: "x", destination: "/a" }, s, T0 + 1);
    expect(backUrl(evil)).toBe("/dashboard");
    expect(withReturnTo("/finance/currencies?x=1", "r1")).toBe("/finance/currencies?x=1&returnTo=r1");
  });

  test("storage that throws or holds garbage never breaks anything", () => {
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); }, removeItem: () => {} };
    expect(() => pushReturn(entry(1), broken, T0)).not.toThrow();
    expect(listTrail(broken, T0)).toEqual([]);
    const garbage = memory();
    garbage.setItem("px-return-trail", "{not json");
    expect(listTrail(garbage, T0)).toEqual([]);
    expect(consumeReturn("x", null, T0)).toBeNull();
  });
});
