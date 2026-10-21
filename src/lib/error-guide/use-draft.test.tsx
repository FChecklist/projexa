/// <reference types="bun-types" />
// What was typed survives leaving the screen and coming back (unmount + mount = navigating away and back, or a reload), is thrown away on
// success, expires after 2 hours, and a blocked storage never breaks the form.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { clearDraft, DRAFT_TTL_MS, loadDraft, saveDraft, useDraft } from "./use-draft";

const EMPTY = { name: "", note: "" };
beforeEach(() => sessionStorage.clear());
afterEach(cleanup);

describe("useDraft", () => {
  test("typed values come back after leaving and returning", async () => {
    const first = renderHook(() => useDraft("form-a", EMPTY));
    act(() => first.result.current.set({ name: "Lakeview" }));
    act(() => first.result.current.set({ note: "phase 2" }));
    first.unmount(); // the person followed a fix link
    const back = renderHook(() => useDraft("form-a", EMPTY));
    await waitFor(() => expect(back.result.current.value).toEqual({ name: "Lakeview", note: "phase 2" }));
    expect(back.result.current.restored).toBe(true);
  });

  test("a different form key is untouched; a fresh form starts empty and not 'restored'", () => {
    const a = renderHook(() => useDraft("form-a", EMPTY));
    act(() => a.result.current.set({ name: "x" }));
    const b = renderHook(() => useDraft("form-b", EMPTY));
    expect(b.result.current.value).toEqual(EMPTY);
    expect(b.result.current.restored).toBe(false);
  });

  test("clear() (after a successful save) and startFresh() throw the draft away", async () => {
    const a = renderHook(() => useDraft("form-a", EMPTY));
    act(() => a.result.current.set({ name: "x" }));
    act(() => a.result.current.clear());
    expect(loadDraft("form-a")).toBeNull();
    act(() => a.result.current.set({ name: "y" }));
    act(() => a.result.current.startFresh());
    expect(a.result.current.value).toEqual(EMPTY);
    expect(loadDraft("form-a")).toBeNull();
  });

  test("a draft older than 2 hours is not restored", () => {
    const store = new Map<string, string>();
    const s = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    saveDraft("k", { name: "old" }, s, 1000);
    expect(loadDraft("k", s, 1000 + DRAFT_TTL_MS - 1)).toEqual({ name: "old" });
    expect(loadDraft("k", s, 1000 + DRAFT_TTL_MS)).toBeNull();
    expect(store.size).toBe(0);
  });

  test("blocked or corrupt storage degrades to a plain form", () => {
    const broken = { getItem: () => { throw new Error("no"); }, setItem: () => { throw new Error("no"); }, removeItem: () => { throw new Error("no"); } };
    expect(() => saveDraft("k", { a: 1 }, broken)).not.toThrow();
    expect(loadDraft("k", broken)).toBeNull();
    expect(() => clearDraft("k", broken)).not.toThrow();
    sessionStorage.setItem("px-draft:bad", "{nope");
    expect(loadDraft("bad")).toBeNull();
  });
});
