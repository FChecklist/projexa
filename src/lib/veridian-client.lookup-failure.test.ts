/// <reference types="bun-types" />
// UAT 2026-10-12: a lookup of an organisation's own VERIDIAN key that FAILS (database or network) used to read as "No VERIDIAN credentials
// configured for organization ..." -- false, and it cleared on reload. Now: the last key read for that organisation is used only when a
// LATER lookup fails; a removed row still stops working (AR-04 unchanged); and with nothing remembered the caller gets an honest 503.
import { describe, test, expect, mock } from "bun:test";

let mode: "ok" | "absent" | "throw" = "ok";

mock.module("drizzle-orm", () => ({ eq: (_c: unknown, v: string) => ({ __eq: true, v }) }));
mock.module("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => {
            if (mode === "throw") return Promise.reject(new Error("connection reset"));
            return Promise.resolve(mode === "ok" ? [{ apiKey: "key-1" }] : []);
          },
        }),
      }),
    }),
  },
  veridianCredentials: { organizationId: "organization_id" },
}));

describe("a failed credential lookup is not 'no credentials'", () => {
  test("uses the last key read for the organisation when a later lookup fails", async () => {
    const { getVeridianApiKey } = await import("./veridian-client");
    mode = "ok";
    expect(await getVeridianApiKey("org-remember")).toBe("key-1");
    mode = "throw";
    expect(await getVeridianApiKey("org-remember")).toBe("key-1");
  });

  test("a row that is gone is NOT served from memory (removed credentials stop working)", async () => {
    const { getVeridianApiKey } = await import("./veridian-client");
    mode = "ok";
    expect(await getVeridianApiKey("org-removed")).toBe("key-1");
    mode = "absent";
    expect(await getVeridianApiKey("org-removed")).toBeNull();
  });

  test("with nothing remembered, a failed lookup says 'try again' (503), not 'not configured'", async () => {
    const { resolveApiKey } = await import("./veridian-client");
    mode = "throw";
    const err = await resolveApiKey({ organizationId: "org-never-seen" }).catch((e) => e);
    expect(err.status).toBe(503);
    expect(String(err.message)).toContain("try again");
    expect(String(err.message)).not.toContain("No VERIDIAN credentials configured");
  });

  test("a genuinely missing row still fails loud with the AR-04 message", async () => {
    const { resolveApiKey } = await import("./veridian-client");
    mode = "absent";
    const err = await resolveApiKey({ organizationId: "org-no-row" }).catch((e) => e);
    expect(String(err.message)).toContain("No VERIDIAN credentials configured");
  });
});
