/// <reference types="bun-types" />
// R67 D-18. The MoM create form's own rules, tested against the same
// functions the component calls. See mom-form.ts's header for why the "type a
// title and watch the primary rename itself" assertion lives here rather than
// as a simulated keystroke: React's onChange on a controlled <input
// type="text">/<textarea> does not fire under this repo's bun + happy-dom +
// React 19 harness, which was verified directly rather than worked around
// blind.
import { describe, expect, test } from "bun:test";
import {
  TITLE_REQUIRED_MESSAGE,
  addAttendee,
  buildCreateMeetingBody,
  missingMeetingFields,
  parseAgendaLines,
} from "./mom-form";

// What the kit's ObjectScreen renders on the primary, reproduced here so the
// rule and the label can be asserted together.
function saveButtonLabel(missing: string[], submitting = false): string {
  const reason = submitting ? "Creating…" : missing.length ? missing.join(", ") : undefined;
  const disabled = submitting || missing.length > 0;
  return `Save${disabled && reason ? ` (${reason})` : ""}`;
}

describe("missingMeetingFields (D-18 acceptance: the primary names what is missing)", () => {
  test("an empty title with the date pre-filled reads 'Save (Title)' and is disabled", () => {
    const missing = missingMeetingFields({ title: "", scheduledAt: "2026-09-02T13:15" });
    expect(missing).toEqual(["Title"]);
    expect(saveButtonLabel(missing)).toBe("Save (Title)");
  });

  test("a typed title makes the primary plain 'Save' and enabled", () => {
    const missing = missingMeetingFields({ title: "Weekly Site Coordination", scheduledAt: "2026-09-02T13:15" });
    expect(missing).toEqual([]);
    expect(saveButtonLabel(missing)).toBe("Save");
  });

  test("whitespace is not a title", () => {
    expect(missingMeetingFields({ title: "   ", scheduledAt: "2026-09-02T13:15" })).toEqual(["Title"]);
  });

  test("both missing reads in the form's own reading order", () => {
    expect(saveButtonLabel(missingMeetingFields({ title: "", scheduledAt: "" }))).toBe("Save (Title, Date & time)");
  });

  test("while submitting the primary says so instead of naming fields", () => {
    expect(saveButtonLabel([], true)).toBe("Save (Creating…)");
  });

  test("the on-blur message is the exact sentence the item specifies", () => {
    expect(TITLE_REQUIRED_MESSAGE).toBe("Enter a meeting title, e.g. Weekly Site Coordination");
  });
});

describe("parseAgendaLines", () => {
  test("one item per line, blank lines and indentation dropped", () => {
    expect(parseAgendaLines("Rebar delivery\n\n   Snag list  \n")).toEqual(["Rebar delivery", "Snag list"]);
  });

  test("an empty agenda is an empty array, never [''] -- which would print a blank bullet on the PDF", () => {
    expect(parseAgendaLines("")).toEqual([]);
    expect(parseAgendaLines("\n\n")).toEqual([]);
  });
});

describe("addAttendee", () => {
  test("adds a trimmed name", () => {
    expect(addAttendee([], "  Arjun Mehta  ")).toEqual(["Arjun Mehta"]);
  });

  test("the comma that committed the chip is not part of the name", () => {
    expect(addAttendee([], "Priya Nair,")).toEqual(["Priya Nair"]);
  });

  test("a duplicate is a no-op rather than a second identical chip", () => {
    expect(addAttendee(["Arjun Mehta"], "Arjun Mehta")).toEqual(["Arjun Mehta"]);
  });

  test("an empty commit leaves the list alone and does not push ''", () => {
    expect(addAttendee(["Arjun Mehta"], "   ")).toEqual(["Arjun Mehta"]);
    expect(addAttendee([], ",")).toEqual([]);
  });

  test("does not mutate the list it was given", () => {
    const original = ["Arjun Mehta"];
    addAttendee(original, "Priya Nair");
    expect(original).toEqual(["Arjun Mehta"]);
  });
});

describe("buildCreateMeetingBody", () => {
  const draft = {
    title: "  Weekly Site Coordination  ",
    scheduledAt: "2026-09-02T13:15",
    meetingType: "client",
    attendees: ["Arjun Mehta"],
    attendeeDraft: "Priya Nair",
    agenda: "Rebar delivery\n\nSnag list",
  };

  test("carries the three fields that previously existed only in Edit mode", () => {
    const body = buildCreateMeetingBody(draft, "proj-1", () => "2026-09-02T09:15:00.000Z");
    expect(body.meetingType).toBe("client");
    expect(body.attendees).toEqual(["Arjun Mehta", "Priya Nair"]);
    expect(body.agenda).toEqual(["Rebar delivery", "Snag list"]);
  });

  test("a name still sitting in the attendee input at Save is kept, not silently dropped", () => {
    const body = buildCreateMeetingBody({ ...draft, attendees: [] }, "proj-1", () => "x");
    expect(body.attendees).toEqual(["Priya Nair"]);
  });

  test("the title is trimmed and the project is carried through", () => {
    const body = buildCreateMeetingBody(draft, "proj-1", () => "x");
    expect(body.title).toBe("Weekly Site Coordination");
    expect(body.projectId).toBe("proj-1");
  });

  test("scheduledAt is whatever the zone converter returned -- never the raw wall clock", () => {
    const body = buildCreateMeetingBody(draft, "proj-1", (wall) => {
      expect(wall).toBe("2026-09-02T13:15");
      return "2026-09-02T09:15:00.000Z";
    });
    expect(body.scheduledAt).toBe("2026-09-02T09:15:00.000Z");
  });
});
