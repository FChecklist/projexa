/// <reference types="bun-types" />
// The outbox reports saves to the project timeline from the first-load / workspace-prepare path. That report must never be what installs
// the log (patching fetch, opening a database, adding listeners): with nothing installed it does nothing at all.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.document === "undefined") GlobalRegistrator.register();

import { describe, expect, test } from "bun:test";
import { __clientLogForTest, logActionIfInstalled } from "./install";

describe("logActionIfInstalled", () => {
  test("with the log not installed it does nothing and does not install it", () => {
    const fetchBefore = window.fetch;
    expect(() => logActionIfInstalled("Set a line budget", "ok")).not.toThrow();
    expect(__clientLogForTest()).toBeNull();
    expect(window.fetch).toBe(fetchBefore);
  });
});
