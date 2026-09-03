/// <reference types="bun-types" />
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { clearFooterMessage, setFooterMessage, takeFooterMessage } from "./footer-message";

// bun's test runner has no DOM, so sessionStorage is stood up here as the
// smallest thing that behaves like one. That is deliberate: the module's whole
// contract is "written on one route, read once on another", and a fake store
// proves that contract without a browser.
class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null; }
  setItem(key: string, value: string) { this.map.set(key, value); }
  removeItem(key: string) { this.map.delete(key); }
  clear() { this.map.clear(); }
}

const globalWithStorage = globalThis as unknown as { sessionStorage?: unknown };

// Installed with defineProperty, NOT plain assignment. `bun test` runs every
// file in one process unless --isolate is passed, and another file in this
// suite installs a DOM in which `sessionStorage` is a READONLY accessor on
// globalThis; a plain `globalThis.sessionStorage = …` then throws
// "Attempted to assign to readonly property" and every test here fails --
// only in the full run, never on its own, which is the worst way for a test
// to be wrong. defineProperty replaces the property whatever its shape, and
// restoring the original DESCRIPTOR puts an accessor back as an accessor
// rather than flattening it into a value.
const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");

function installStorage(value: unknown) {
  Object.defineProperty(globalThis, "sessionStorage", { value, configurable: true, writable: true });
}

beforeEach(() => { installStorage(new MemoryStorage()); });
afterEach(() => {
  if (originalDescriptor) Object.defineProperty(globalThis, "sessionStorage", originalDescriptor);
  else delete globalWithStorage.sessionStorage;
});

describe("footer message receipts", () => {
  test("a receipt written for one route is read on that route", () => {
    setFooterMessage("/scope/abc", { level: "success", text: "BOQ Fit-out v1 created - 128 lines, AED 1,254,300" });
    expect(takeFooterMessage("/scope/abc")).toEqual({ level: "success", text: "BOQ Fit-out v1 created - 128 lines, AED 1,254,300" });
  });

  test("it is taken exactly once -- a reload must not re-announce an import from twenty minutes ago", () => {
    setFooterMessage("/scope/abc", { level: "success", text: "done" });
    expect(takeFooterMessage("/scope/abc")).not.toBeNull();
    expect(takeFooterMessage("/scope/abc")).toBeNull();
  });

  test("a receipt for a different route is not shown here", () => {
    setFooterMessage("/scope/abc", { level: "success", text: "done" });
    expect(takeFooterMessage("/scope/xyz")).toBeNull();
  });

  test("an abandoned flow can drop its receipt without showing it", () => {
    setFooterMessage("/scope/abc", { level: "success", text: "done" });
    clearFooterMessage("/scope/abc");
    expect(takeFooterMessage("/scope/abc")).toBeNull();
  });

  test("corrupt stored JSON degrades to no message, never to a thrown screen", () => {
    (globalWithStorage.sessionStorage as MemoryStorage).setItem("veri.footer./scope/abc", "{not json");
    expect(takeFooterMessage("/scope/abc")).toBeNull();
  });

  test("a stored value with no text is not a message", () => {
    (globalWithStorage.sessionStorage as MemoryStorage).setItem("veri.footer./scope/abc", JSON.stringify({ level: "success" }));
    expect(takeFooterMessage("/scope/abc")).toBeNull();
  });

  test("an unrecognised level falls back to success rather than rendering an unstyled message", () => {
    (globalWithStorage.sessionStorage as MemoryStorage).setItem("veri.footer./scope/abc", JSON.stringify({ level: "banana", text: "done" }));
    expect(takeFooterMessage("/scope/abc")).toEqual({ level: "success", text: "done" });
  });

  test("with sessionStorage unavailable, writing and reading are both survivable no-ops", () => {
    // Same reason as the beforeEach above: plain assignment throws when a
    // sibling file has installed a readonly accessor.
    installStorage(undefined);
    expect(() => setFooterMessage("/scope/abc", { level: "success", text: "done" })).not.toThrow();
    expect(takeFooterMessage("/scope/abc")).toBeNull();
    expect(() => clearFooterMessage("/scope/abc")).not.toThrow();
  });
});
