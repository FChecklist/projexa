/// <reference types="bun-types" />
// Tests the pure notification-content builders. notifyOrgMembers() itself
// goes through a live Supabase-scoped DB query (the org's real membership
// roster + a real insert) -- per this repo's established convention (see
// search-service.test.ts in compliance-tracker), that isn't exercised here
// without a live backend.
import { describe, expect, test } from "bun:test";
import {
  buildRfiCreatedNotification,
  buildSubmittalStatusChangedNotification,
  buildPunchListCreatedNotification,
} from "./notification-service";

describe("buildRfiCreatedNotification", () => {
  test("includes the RFI subject and the acting user's email", () => {
    const n = buildRfiCreatedNotification({ id: "rfi_1", subject: "Foundation waterproofing" }, "proj_1", "raajat@example.com");
    expect(n.title).toBe("New RFI raised");
    expect(n.message).toContain("Foundation waterproofing");
    expect(n.message).toContain("raajat@example.com");
    expect(n.type).toBe("rfi_created");
    expect(n.metadata).toEqual({ rfiId: "rfi_1", projectId: "proj_1" });
  });

  test("falls back to a generic actor label when email is null", () => {
    const n = buildRfiCreatedNotification({ id: "rfi_1", subject: "X" }, "proj_1", null);
    expect(n.message).toContain("A teammate");
  });
});

describe("buildSubmittalStatusChangedNotification", () => {
  test("humanizes the status and includes the submittal title", () => {
    const n = buildSubmittalStatusChangedNotification(
      { id: "sub_1", title: "Structural steel shop drawings", status: "revise_resubmit" },
      "proj_1",
      "raajat@example.com"
    );
    expect(n.message).toContain("Structural steel shop drawings");
    expect(n.message).toContain("revise resubmit");
    expect(n.type).toBe("submittal_status_changed");
    expect(n.metadata).toEqual({ submittalId: "sub_1", projectId: "proj_1" });
  });
});

describe("buildPunchListCreatedNotification", () => {
  test("includes the item's priority and description", () => {
    const n = buildPunchListCreatedNotification(
      { id: "item_1", description: "Leaking pipe in unit 4B", priority: "high" },
      "proj_1",
      "raajat@example.com"
    );
    expect(n.message).toContain("high-priority");
    expect(n.message).toContain("Leaking pipe in unit 4B");
    expect(n.type).toBe("punch_list_created");
    expect(n.metadata).toEqual({ punchListItemId: "item_1", projectId: "proj_1" });
  });
});
