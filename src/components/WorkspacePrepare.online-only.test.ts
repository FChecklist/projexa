import { describe, expect, test } from "bun:test";
import { ONLINE_ONLY_AFTER_ATTEMPTS, shouldOpenOnlineOnly } from "./WorkspacePrepare";

describe("shouldOpenOnlineOnly (a browser that cannot install the worker must not lock the person out)", () => {
  test("keeps retrying for the first tries", () => {
    expect(shouldOpenOnlineOnly(["worker"], 0)).toBe(false);
    expect(shouldOpenOnlineOnly(["worker", "app"], ONLINE_ONLY_AFTER_ATTEMPTS - 2)).toBe(false);
  });
  test("lets the person in once the worker has failed the allowed number of tries", () => {
    expect(shouldOpenOnlineOnly(["worker"], ONLINE_ONLY_AFTER_ATTEMPTS - 1)).toBe(true);
    expect(shouldOpenOnlineOnly(["worker", "app"], 10)).toBe(true);
  });
  test("a failure that is not the worker (e.g. screens not downloaded) still holds the screen", () => {
    expect(shouldOpenOnlineOnly(["app"], 10)).toBe(false);
    expect(shouldOpenOnlineOnly([], 10)).toBe(false);
  });
});
