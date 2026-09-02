/// <reference types="bun-types" />
// R67 D-38. The point of these cases is the failure modes, not the happy path:
// this module's whole contract is "a storage that is blocked, absent or
// throwing degrades to 'no rail selection'", because that is the state every
// caller already handles.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { RAIL_PROJECT_KEY, readRailProject, subscribeRailProject, writeRailProject } from "./rail-project";

afterEach(() => {
  try { window.sessionStorage.clear(); } catch {}
});

describe("rail-project", () => {
  test("a written project id round-trips", () => {
    writeRailProject("proj-cedar");
    expect(readRailProject()).toBe("proj-cedar");
  });

  test("null clears the selection -- the rail's real 'All projects' state", () => {
    writeRailProject("proj-cedar");
    writeRailProject(null);
    expect(readRailProject()).toBeNull();
  });

  test("nothing stored reads as null, not as an empty string", () => {
    expect(readRailProject()).toBeNull();
  });

  test("an empty stored value is treated as no selection", () => {
    window.sessionStorage.setItem(RAIL_PROJECT_KEY, "");
    expect(readRailProject()).toBeNull();
  });

  test("a storage that THROWS on read degrades to null rather than taking the page down", () => {
    const real = window.sessionStorage.getItem;
    // @ts-expect-error -- deliberately breaking the API the way a locked-down
    // browser does.
    window.sessionStorage.getItem = () => { throw new Error("The operation is insecure."); };
    try {
      expect(readRailProject()).toBeNull();
    } finally {
      window.sessionStorage.getItem = real;
    }
  });

  test("a storage that THROWS on write is swallowed -- switching project still works, it just does not persist", () => {
    const real = window.sessionStorage.setItem;
    // @ts-expect-error -- see above.
    window.sessionStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    try {
      expect(() => writeRailProject("proj-cedar")).not.toThrow();
    } finally {
      window.sessionStorage.setItem = real;
    }
  });

  test("a same-tab subscriber is notified, and unsubscribing really stops it", () => {
    const seen: (string | null)[] = [];
    const unsubscribe = subscribeRailProject((id) => seen.push(id));

    writeRailProject("proj-cedar");
    writeRailProject(null);
    expect(seen).toEqual(["proj-cedar", null]);

    unsubscribe();
    writeRailProject("proj-marina");
    expect(seen).toEqual(["proj-cedar", null]);
  });
});
