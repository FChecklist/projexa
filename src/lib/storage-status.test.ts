/// <reference types="bun-types" />
// R67 D-78. The whole point of this module is what it does when it CANNOT get
// an answer, so that is what these tests are about.
import { afterEach, describe, expect, mock, test } from "bun:test";

const realClient = await import("./veridian-client");

async function loadWith(impl: () => Promise<unknown>) {
  await mock.module("./veridian-client", () => ({ ...realClient, callVeridian: mock(impl) }));
  return import("./storage-status");
}

afterEach(() => {
  mock.restore();
});

describe("getStorageStatus", () => {
  test("reports VERIDIAN's own answer when storage is not configured there", async () => {
    const mod = await loadWith(async () => ({ storageConfigured: false, reason: "missing_env" }));
    expect(await mod.getStorageStatus("org_1")).toBe(false);
  });

  test("reports available when VERIDIAN says so", async () => {
    const mod = await loadWith(async () => ({ storageConfigured: true, reason: "ok" }));
    expect(await mod.getStorageStatus("org_1")).toBe(true);
  });

  test("FAILS OPEN when the probe itself fails -- it must not claim a fact it does not have", async () => {
    const mod = await loadWith(async () => {
      throw new realClient.VeridianApiError("The construction data service did not respond in time.", 504);
    });
    expect(await mod.getStorageStatus("org_1")).toBe(true);
  });

  test("fails open on a response that does not carry the field at all", async () => {
    const mod = await loadWith(async () => ({}));
    expect(await mod.getStorageStatus("org_1")).toBe(true);
  });

  test("no organisation means no per-org call, and no claim either way", async () => {
    const called = mock(async () => ({ storageConfigured: false }));
    await mock.module("./veridian-client", () => ({ ...realClient, callVeridian: called }));
    const mod = await import("./storage-status");
    expect(await mod.getStorageStatus(null)).toBe(true);
    expect(called).not.toHaveBeenCalled();
  });
});

describe("the wording every upload screen shows", () => {
  test("is defined once, and re-exported here from the client-safe module", async () => {
    const mod = await import("./storage-status");
    const limits = await import("./file-limits");
    expect(mod.STORAGE_UNAVAILABLE_BANNER).toBe("File storage is not configured on this server — uploads will fail");
    expect(mod.STORAGE_UNAVAILABLE_REASON).toBe("file storage not configured");
    expect(mod.STORAGE_UNAVAILABLE_BANNER).toBe(limits.STORAGE_UNAVAILABLE_BANNER);
    expect(mod.STORAGE_UNAVAILABLE_REASON).toBe(limits.STORAGE_UNAVAILABLE_REASON);
  });
});
