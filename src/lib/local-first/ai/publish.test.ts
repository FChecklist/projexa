// lf-e11: window.projexa cannot be swapped by a script in the page -- not by assignment, not by delete, and not by
// Object.defineProperty (the attack that worked while the property was configurable) -- yet PROJEXA itself can still take it down and
// publish the next person's surface on the same page.
import { describe, expect, test } from "bun:test";
import type { ProjexaAi } from "./api";
import { publishAiSurface } from "./publish";

const fakeApi = (tag: string) => Object.freeze({ version: 1, tag }) as unknown as ProjexaAi;

describe("publishAiSurface", () => {
  test("Object.defineProperty, assignment and delete cannot replace window.projexa", () => {
    const win: Record<string, unknown> = {};
    const api = fakeApi("real");
    publishAiSurface(win, api);
    expect(() => Object.defineProperty(win, "projexa", { value: { ai: fakeApi("evil") } })).toThrow();
    expect(() => { "use strict"; win.projexa = { ai: fakeApi("evil") }; }).toThrow();
    expect(() => { "use strict"; delete win.projexa; }).toThrow();
    expect((win.projexa as { ai: unknown }).ai).toBe(api);
    const d = Object.getOwnPropertyDescriptor(win, "projexa")!;
    expect(d.configurable).toBe(false);
    expect(d.set).toBeUndefined();
  });

  test("the holder is frozen and its ai read-only", () => {
    const win: Record<string, unknown> = {};
    publishAiSurface(win, fakeApi("real"));
    const holder = win.projexa as { ai: unknown };
    expect(Object.isFrozen(holder)).toBe(true);
    expect(() => { "use strict"; holder.ai = fakeApi("evil"); }).toThrow();
  });

  test("PROJEXA takes it down, publishes the next person's, and an old take-down never removes the new one", () => {
    const win: Record<string, unknown> = {};
    const first = publishAiSurface(win, fakeApi("asha"));
    first();
    expect(win.projexa).toBeUndefined();
    const second = fakeApi("omar");
    publishAiSurface(win, second);
    expect((win.projexa as { ai: unknown }).ai).toBe(second);
    first(); // a late detach of the first person
    expect((win.projexa as { ai: unknown }).ai).toBe(second);
  });

  test("the ready event fires with the surface version", () => {
    const events: unknown[] = [];
    const win = { dispatchEvent: (e: Event) => { events.push((e as CustomEvent).detail); return true; } };
    publishAiSurface(win, fakeApi("real"));
    expect(events).toEqual([{ version: 1 }]);
  });
});
