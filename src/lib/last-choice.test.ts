/// <reference types="bun-types" />
// R67 D-80. The item's own unit acceptance: "last-choice get/set round-trips
// and returns null when localStorage throws."
import { afterEach, describe, expect, test } from "bun:test";
import { getLastChoice, lastChoiceKey, setLastChoice } from "./last-choice";

type Store = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };

const original = (globalThis as { window?: unknown }).window;

function useStorage(storage: Store) {
  (globalThis as { window?: unknown }).window = { localStorage: storage };
}

function memoryStorage(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
    removeItem: (k) => { data.delete(k); },
  };
}

/** A Safari private window, an embedded webview with site data off, a sandboxed iframe. */
function throwingStorage(): Store {
  return {
    getItem: () => { throw new DOMException("The operation is insecure.", "SecurityError"); },
    setItem: () => { throw new DOMException("The operation is insecure.", "SecurityError"); },
    removeItem: () => { throw new DOMException("The operation is insecure.", "SecurityError"); },
  };
}

afterEach(() => {
  (globalThis as { window?: unknown }).window = original;
});

describe("lastChoiceKey", () => {
  test("is scoped by user, project and picker -- the same picker on two projects is two habits", () => {
    expect(lastChoiceKey("worker", "proj-cedar")).toBe("veri.lastChoice.self.proj-cedar.worker");
    expect(lastChoiceKey("worker", "proj-marina")).not.toBe(lastChoiceKey("worker", "proj-cedar"));
    expect(lastChoiceKey("material", "proj-cedar")).not.toBe(lastChoiceKey("worker", "proj-cedar"));
  });

  test("a real user id changes the key without changing anything else", () => {
    expect(lastChoiceKey("worker", "proj-cedar", "user-9")).toBe("veri.lastChoice.user-9.proj-cedar.worker");
  });

  test("a missing project is its own bucket, not a collision with every other project", () => {
    expect(lastChoiceKey("task", null)).toBe("veri.lastChoice.self.no-project.task");
    expect(lastChoiceKey("task", undefined)).toBe(lastChoiceKey("task", null));
  });
});

describe("get/set round trip", () => {
  test("what was set is what comes back, in that scope only", () => {
    const storage = memoryStorage();
    useStorage(storage);

    expect(getLastChoice("worker", "proj-cedar")).toBeNull();
    setLastChoice("worker", "proj-cedar", "roster-7");
    expect(getLastChoice("worker", "proj-cedar")).toBe("roster-7");
    // A different project has not learned anything.
    expect(getLastChoice("worker", "proj-marina")).toBeNull();
    // Nor has a different picker.
    expect(getLastChoice("material", "proj-cedar")).toBeNull();
  });

  test("an empty or blank value CLEARS the memory rather than storing a selection of nothing", () => {
    const storage = memoryStorage();
    useStorage(storage);

    setLastChoice("worker", "proj-cedar", "roster-7");
    setLastChoice("worker", "proj-cedar", "");
    expect(getLastChoice("worker", "proj-cedar")).toBeNull();
    expect(storage.data.has(lastChoiceKey("worker", "proj-cedar"))).toBe(false);

    setLastChoice("worker", "proj-cedar", "roster-7");
    setLastChoice("worker", "proj-cedar", null);
    expect(getLastChoice("worker", "proj-cedar")).toBeNull();
  });

  test("a stored blank string reads back as null, not as a selected empty option", () => {
    const storage = memoryStorage();
    storage.data.set(lastChoiceKey("worker", "proj-cedar"), "   ");
    useStorage(storage);
    expect(getLastChoice("worker", "proj-cedar")).toBeNull();
  });
});

describe("storage that throws", () => {
  test("get returns null rather than taking the create screen down with it", () => {
    useStorage(throwingStorage());
    expect(getLastChoice("worker", "proj-cedar")).toBeNull();
  });

  test("set is a silent no-op -- a picker that cannot remember still works", () => {
    useStorage(throwingStorage());
    expect(() => setLastChoice("worker", "proj-cedar", "roster-7")).not.toThrow();
    expect(() => setLastChoice("worker", "proj-cedar", null)).not.toThrow();
  });

  test("no window at all (a server render) is handled the same way", () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(getLastChoice("worker", "proj-cedar")).toBeNull();
    expect(() => setLastChoice("worker", "proj-cedar", "roster-7")).not.toThrow();
  });
});
