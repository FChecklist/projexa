/// <reference types="bun-types" />
// R67 D-67 -- the one required-field convention.
//
// save-label.ts shipped with the CreateScreen archetype but without a
// sibling test; this is it. The rule it encodes is the one correction C-11
// picked out of the audit ("the good create-form pattern in PROJEXA is
// /labour/new's 'Save (Name, Daily Rate)' disabled-with-reason button"), and
// it is now what every migrated create screen's primary reads.

import { describe, expect, test } from "bun:test";
import { saveLabel, saveDisabledReason } from "./save-label";

describe("saveLabel", () => {
  test("nothing missing is just the verb", () => {
    expect(saveLabel("Save", [])).toBe("Save");
  });

  test("what is missing is named IN THE LABEL, in form order", () => {
    // The whole point: the user reads what is needed without hovering,
    // without an asterisk, and without a separate helper sentence.
    expect(saveLabel("Save", ["Name", "Daily Rate"])).toBe("Save (Name, Daily Rate)");
    expect(saveLabel("Save", ["Title"])).toBe("Save (Title)");
  });

  test("the verb is the caller's -- not every create screen says 'Save'", () => {
    expect(saveLabel("Upload", ["File"])).toBe("Upload (File)");
  });

  test("blank and whitespace-only names are dropped, never rendered as empty parentheses", () => {
    expect(saveLabel("Save", ["", "  ", "Unit"])).toBe("Save (Unit)");
    expect(saveLabel("Save", ["", "   "])).toBe("Save");
  });

  test("names are trimmed, so a stray space cannot produce 'Save ( Name)'", () => {
    expect(saveLabel("Save", [" Name "])).toBe("Save (Name)");
  });
});

describe("saveDisabledReason", () => {
  test("a live control explains nothing -- undefined, not an empty string", () => {
    // The repo's disabled-with-reason convention treats undefined as "this
    // control is available"; an empty string would render an empty tooltip.
    expect(saveDisabledReason([], false)).toBeUndefined();
  });

  test("missing fields are listed for the assistive-technology reader too", () => {
    expect(saveDisabledReason(["Name", "Unit"], false)).toBe("Still needed: Name, Unit");
  });

  test("saving wins over the missing list -- the button is busy, not incomplete", () => {
    expect(saveDisabledReason(["Name"], true)).toBe("Saving…");
    expect(saveDisabledReason([], true)).toBe("Saving…");
  });
});
