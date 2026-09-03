/// <reference types="bun-types" />
// R67 D-05/D-06. Two properties matter here and both are user-visible: a
// receipt survives exactly ONE navigation (never re-announcing itself later),
// and nothing this module does can take a screen down -- a hostile or absent
// sessionStorage must degrade to "no message", never to an exception.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import { parseScreenMessage, setScreenMessage, takeScreenMessage } from "./screen-message";

afterEach(() => {
  try {
    window.sessionStorage.clear();
  } catch {
    // nothing to clear
  }
});

describe("setScreenMessage / takeScreenMessage", () => {
  test("hands a receipt to the next screen", () => {
    setScreenMessage("permits.list", { level: "success", text: "Permit BP-2026-0142 deleted" });
    expect(takeScreenMessage("permits.list")).toEqual({ level: "success", text: "Permit BP-2026-0142 deleted" });
  });

  test("is shown once: a second read returns nothing, so a stale receipt cannot re-announce itself", () => {
    setScreenMessage("permits.list", { level: "success", text: "Permit BP-2026-0142 deleted" });
    takeScreenMessage("permits.list");
    expect(takeScreenMessage("permits.list")).toBeNull();
  });

  test("keys do not leak into one another", () => {
    setScreenMessage("permits.object", { level: "success", text: "Permit created" });
    expect(takeScreenMessage("permits.list")).toBeNull();
    expect(takeScreenMessage("permits.object")).toEqual({ level: "success", text: "Permit created" });
  });

  test("reading a key that was never written is simply nothing", () => {
    expect(takeScreenMessage("nothing.here")).toBeNull();
  });
});

describe("parseScreenMessage", () => {
  test("accepts a real message", () => {
    expect(parseScreenMessage('{"level":"success","text":"Permit created"}')).toEqual({
      level: "success",
      text: "Permit created",
    });
  });

  test("rejects corrupted storage rather than rendering junk at the user", () => {
    expect(parseScreenMessage("not json")).toBeNull();
    expect(parseScreenMessage("null")).toBeNull();
    expect(parseScreenMessage('{"level":"success"}')).toBeNull();
    expect(parseScreenMessage('{"text":"no level"}')).toBeNull();
    expect(parseScreenMessage('{"level":"shouty","text":"bad level"}')).toBeNull();
    expect(parseScreenMessage('{"level":"success","text":""}')).toBeNull();
  });
});
