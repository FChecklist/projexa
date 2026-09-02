/// <reference types="bun-types" />
// R67 D-19. Every rule the people picker renders, tested against the same
// functions the combobox calls.
import { describe, expect, test } from "bun:test";
import {
  ACTION_ITEM_VALIDATION_MESSAGE,
  CHOOSE_ASSIGNEE_REASON,
  addActionItemDisabledReason,
  displayNameOf,
  groupOrgUsers,
  initialsOf,
  roleLabelOf,
} from "./org-user-picker";

const ARJUN = { id: "u1", name: "Arjun Mehta", email: "arjun.mehta@skyline.example", role: "pm" };
const PRIYA = { id: "u2", name: "Priya Nair", email: "priya@skyline.example", role: "site_engineer" };
const ACCOUNTS = { id: "u3", name: null, email: "accounts.team@skyline.example", role: "member" };

describe("initialsOf", () => {
  test("first and last initial of a real name", () => {
    expect(initialsOf(ARJUN)).toBe("AM");
  });

  test("a single-word name gives its first two letters", () => {
    expect(initialsOf({ name: "Sumeet", email: "s@x.example" })).toBe("SU");
  });

  test("falls back to the email's local part when there is no name", () => {
    expect(initialsOf(ACCOUNTS)).toBe("AT");
  });

  test("never returns an empty avatar", () => {
    expect(initialsOf({ name: "   ", email: "@x.example" })).toBe("?");
  });
});

describe("displayNameOf / roleLabelOf", () => {
  test("the person's name, or their email when they have none -- never the id", () => {
    expect(displayNameOf(ARJUN)).toBe("Arjun Mehta");
    expect(displayNameOf(ACCOUNTS)).toBe("accounts.team@skyline.example");
  });

  test("roles read as words", () => {
    expect(roleLabelOf("site_engineer")).toBe("Site Engineer");
    expect(roleLabelOf("pm")).toBe("Project Manager");
  });

  test("a role nobody has mapped yet is humanised, not hidden", () => {
    expect(roleLabelOf("quantity_surveyor")).toBe("Quantity Surveyor");
  });
});

describe("groupOrgUsers", () => {
  test("the meeting's own attendees come first", () => {
    const groups = groupOrgUsers([ARJUN, PRIYA, ACCOUNTS], ["Priya Nair"]);
    expect(groups.inMeeting.map((u) => u.id)).toEqual(["u2"]);
    expect(groups.others.map((u) => u.id)).toEqual(["u1", "u3"]);
  });

  test("an attendee written as an email address still matches", () => {
    const groups = groupOrgUsers([ARJUN, PRIYA], ["arjun.mehta@skyline.example"]);
    expect(groups.inMeeting.map((u) => u.id)).toEqual(["u1"]);
  });

  test("case and stray spacing in the typed attendee name do not break the match", () => {
    const groups = groupOrgUsers([ARJUN], ["  arjun MEHTA "]);
    expect(groups.inMeeting.map((u) => u.id)).toEqual(["u1"]);
  });

  test("an attendee who is not a user of this org simply does not appear -- an action item needs a real id", () => {
    const groups = groupOrgUsers([ARJUN], ["The client's architect"]);
    expect(groups.inMeeting).toEqual([]);
    expect(groups.others.map((u) => u.id)).toEqual(["u1"]);
  });

  test("no attendees at all leaves everyone in the second group rather than dropping them", () => {
    const groups = groupOrgUsers([ARJUN, PRIYA], []);
    expect(groups.inMeeting).toEqual([]);
    expect(groups.others.length).toBe(2);
  });
});

describe("addActionItemDisabledReason", () => {
  test("with nothing chosen the reason names the assignee -- the field that used to demand a pasted id", () => {
    expect(addActionItemDisabledReason({ title: "", assigneeId: "" })).toBe(CHOOSE_ASSIGNEE_REASON);
  });

  test("with an assignee but no title it names the title", () => {
    expect(addActionItemDisabledReason({ title: "  ", assigneeId: "u1" })).toBe("Give the action a title");
  });

  test("with both, Add is enabled", () => {
    expect(addActionItemDisabledReason({ title: "Order rebar", assigneeId: "u1" })).toBeUndefined();
  });

  test("while adding, the reason says so rather than naming a field", () => {
    expect(addActionItemDisabledReason({ title: "Order rebar", assigneeId: "u1", busy: true })).toBe("Adding…");
  });

  test("the combined sentence is the exact one the item specifies", () => {
    expect(ACTION_ITEM_VALIDATION_MESSAGE).toBe("Choose an assignee and give the action a title");
  });
});
