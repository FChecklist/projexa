/// <reference types="bun-types" />
// R67 lane D22 (item D-58). The two pure decisions in AttendeesField: what a
// membership row is called in the attendee list, and how an external attendee
// reads once name and company are combined.
import { describe, expect, test } from "bun:test";
import { externalAttendeeLabel, memberDisplayName } from "./AttendeesField";

describe("memberDisplayName", () => {
  test("prefers the display name", () => {
    expect(memberDisplayName({ user_id: "u1", role: "admin", profiles: { display_name: "Arjun Mehta", email: "a@x.test" } })).toBe("Arjun Mehta");
  });

  test("falls back to the email rather than showing a blank chip", () => {
    expect(memberDisplayName({ user_id: "u1", role: "member", profiles: { display_name: "  ", email: "a@x.test" } })).toBe("a@x.test");
  });

  test("handles the array shape a nested Supabase select can return", () => {
    expect(memberDisplayName({ user_id: "u1", role: "member", profiles: [{ display_name: "Priya Nair", email: null }] })).toBe("Priya Nair");
  });

  test("a row with no profile at all contributes nothing, instead of a row labelled 'null'", () => {
    expect(memberDisplayName({ user_id: "u1", role: "member", profiles: null })).toBeNull();
    expect(memberDisplayName({ user_id: "u1", role: "member", profiles: { display_name: null, email: null } })).toBeNull();
  });
});

describe("externalAttendeeLabel", () => {
  test("names the company when one is given", () => {
    expect(externalAttendeeLabel("Ravi Menon", "Aecom")).toBe("Ravi Menon (Aecom)");
  });

  test("is just the name when no company is given, never an empty bracket", () => {
    expect(externalAttendeeLabel("Ravi Menon", "")).toBe("Ravi Menon");
    expect(externalAttendeeLabel("  Ravi Menon  ", "   ")).toBe("Ravi Menon");
  });

  test("no name is no attendee", () => {
    expect(externalAttendeeLabel("   ", "Aecom")).toBe("");
  });
});
