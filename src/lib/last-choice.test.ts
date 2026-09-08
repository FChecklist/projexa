/// <reference types="bun-types" />
// R67 D-80. The item's own unit acceptance: "last-choice get/set round-trips
// and returns null when localStorage throws."
//
// R80 GAP-8 adds the axis that was missing: the PERSON. Every key used to
// carry the literal "self", so two people on one browser profile shared one
// memory. The tests below now pin that they do not.
import { afterEach, describe, expect, test } from "bun:test";
import { getLastChoice, lastChoiceKey, setLastChoice, UNKNOWN_USER_SCOPE } from "./last-choice";

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
    expect(lastChoiceKey("worker", "proj-cedar", null)).toBe("veri.lastChoice.v2.self.proj-cedar.worker");
    expect(lastChoiceKey("worker", "proj-marina", null)).not.toBe(lastChoiceKey("worker", "proj-cedar", null));
    expect(lastChoiceKey("material", "proj-cedar", null)).not.toBe(lastChoiceKey("worker", "proj-cedar", null));
  });

  test("a real user id changes the key without changing anything else", () => {
    expect(lastChoiceKey("worker", "proj-cedar", "user-9")).toBe("veri.lastChoice.v2.user-9.proj-cedar.worker");
  });

  // R80 GAP-8, the defect this fix exists for: a site office machine signed in
  // as two people in turn must not hand the second one the first one's habits.
  test("two users on ONE browser profile do not share a bucket", () => {
    expect(lastChoiceKey("worker", "proj-cedar", "user-9")).not.toBe(lastChoiceKey("worker", "proj-cedar", "user-4"));
    // ...and neither of them collides with the not-yet-known bucket.
    expect(lastChoiceKey("worker", "proj-cedar", "user-9")).not.toBe(lastChoiceKey("worker", "proj-cedar", null));
  });

  test("null and undefined both mean 'identity not known', which is its own bucket", () => {
    expect(lastChoiceKey("worker", "proj-cedar", undefined)).toBe(lastChoiceKey("worker", "proj-cedar", null));
    expect(lastChoiceKey("worker", "proj-cedar", null)).toContain(`.${UNKNOWN_USER_SCOPE}.`);
  });

  // The v1 prefix carried no version segment; orphaning those keys is what
  // stops a pre-fix "self" entry being read back as though it were a person's.
  test("keys are v2-prefixed, so nothing written under the old shared scope is read back", () => {
    expect(lastChoiceKey("worker", "proj-cedar", "user-9").startsWith("veri.lastChoice.v2.")).toBe(true);
    expect(lastChoiceKey("worker", "proj-cedar", "user-9")).not.toBe("veri.lastChoice.user-9.proj-cedar.worker");
  });

  test("a missing project is its own bucket, not a collision with every other project", () => {
    expect(lastChoiceKey("task", null, null)).toBe("veri.lastChoice.v2.self.no-project.task");
    expect(lastChoiceKey("task", undefined, null)).toBe(lastChoiceKey("task", null, null));
  });
});

describe("get/set round trip", () => {
  test("what was set is what comes back, in that scope only", () => {
    const storage = memoryStorage();
    useStorage(storage);

    expect(getLastChoice("worker", "proj-cedar", "user-9")).toBeNull();
    setLastChoice("worker", "proj-cedar", "roster-7", "user-9");
    expect(getLastChoice("worker", "proj-cedar", "user-9")).toBe("roster-7");
    // A different project has not learned anything.
    expect(getLastChoice("worker", "proj-marina", "user-9")).toBeNull();
    // Nor has a different picker.
    expect(getLastChoice("material", "proj-cedar", "user-9")).toBeNull();
    // Nor has the next person to sign in on this browser.
    expect(getLastChoice("worker", "proj-cedar", "user-4")).toBeNull();
  });

  test("an empty or blank value CLEARS the memory rather than storing a selection of nothing", () => {
    const storage = memoryStorage();
    useStorage(storage);

    setLastChoice("worker", "proj-cedar", "roster-7", "user-9");
    setLastChoice("worker", "proj-cedar", "", "user-9");
    expect(getLastChoice("worker", "proj-cedar", "user-9")).toBeNull();
    expect(storage.data.has(lastChoiceKey("worker", "proj-cedar", "user-9"))).toBe(false);

    setLastChoice("worker", "proj-cedar", "roster-7", "user-9");
    setLastChoice("worker", "proj-cedar", null, "user-9");
    expect(getLastChoice("worker", "proj-cedar", "user-9")).toBeNull();
  });

  test("a stored blank string reads back as null, not as a selected empty option", () => {
    const storage = memoryStorage();
    storage.data.set(lastChoiceKey("worker", "proj-cedar", "user-9"), "   ");
    useStorage(storage);
    expect(getLastChoice("worker", "proj-cedar", "user-9")).toBeNull();
  });
});

// R80 GAP-8 follow-up. The unknown bucket has to be READ-ONLY, not merely
// empty-to-start-with. It was empty only because the v2 prefix orphaned v1's
// keys; the moment anything wrote into it, it would refill with exactly the
// shared-scope contents the prefix bump existed to abandon -- and /api/shell
// failing is not a rare path on a site connection, it is the normal one when
// the link drops.
describe("the not-yet-known identity is read-only", () => {
  test("a set with no user id writes NOTHING -- not even under the unknown scope", () => {
    const storage = memoryStorage();
    useStorage(storage);

    setLastChoice("worker", "proj-cedar", "roster-7", null);

    expect(storage.data.size).toBe(0);
    expect(storage.data.has(lastChoiceKey("worker", "proj-cedar", null))).toBe(false);
    expect(getLastChoice("worker", "proj-cedar", null)).toBeNull();
  });

  test("undefined is treated the same as null, because both mean 'nobody named'", () => {
    const storage = memoryStorage();
    useStorage(storage);

    setLastChoice("worker", "proj-cedar", "roster-7", undefined);

    expect(storage.data.size).toBe(0);
    expect(getLastChoice("worker", "proj-cedar", undefined)).toBeNull();
  });

  // The leak this closes, played out: a storekeeper saves a receipt while the
  // shell bootstrap is still in flight (or after it failed outright, which
  // records userId: null), then hands the site laptop to the next person.
  test("a save made before the identity lands is not handed to the next person on that browser", () => {
    const storage = memoryStorage();
    useStorage(storage);

    // First person, identity not known yet.
    setLastChoice("material", "proj-cedar", "mat-cement", null);
    // Second person, same browser profile, identity also not known yet.
    expect(getLastChoice("material", "proj-cedar", null)).toBeNull();
    // ...and once the second person's identity DOES land, still nothing.
    expect(getLastChoice("material", "proj-cedar", "user-4")).toBeNull();
  });

  test("a named user is unaffected -- the refusal is about the missing id, not about writing", () => {
    const storage = memoryStorage();
    useStorage(storage);

    setLastChoice("material", "proj-cedar", "mat-cement", "user-9");
    expect(getLastChoice("material", "proj-cedar", "user-9")).toBe("mat-cement");
    expect(storage.data.size).toBe(1);
  });
});

describe("storage that throws", () => {
  test("get returns null rather than taking the create screen down with it", () => {
    useStorage(throwingStorage());
    expect(getLastChoice("worker", "proj-cedar", "user-9")).toBeNull();
  });

  test("set is a silent no-op -- a picker that cannot remember still works", () => {
    useStorage(throwingStorage());
    expect(() => setLastChoice("worker", "proj-cedar", "roster-7", "user-9")).not.toThrow();
    expect(() => setLastChoice("worker", "proj-cedar", null, "user-9")).not.toThrow();
  });

  test("no window at all (a server render) is handled the same way", () => {
    (globalThis as { window?: unknown }).window = undefined;
    expect(getLastChoice("worker", "proj-cedar", "user-9")).toBeNull();
    expect(() => setLastChoice("worker", "proj-cedar", "roster-7", "user-9")).not.toThrow();
    expect(() => setLastChoice("worker", "proj-cedar", "roster-7", null)).not.toThrow();
  });
});
