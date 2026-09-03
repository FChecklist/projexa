/// <reference types="bun-types" />
// R67 D-67 -- the create-screen archetype's rules.
//
// R-257 recorded three different conventions on one product: /labour/new's
// "Save (Name, Daily Rate)", Permits' separate counting sentence beside a
// button that said "Create", and /scope/new's teal Save enabled on an empty
// form. These assertions are the one convention, so a fourth cannot appear.
import { describe, expect, test } from "bun:test";
import {
  createSaveLabel,
  createdMessage,
  deleteConfirmation,
  missingCreateFields,
  type CreateField,
} from "./create-screen";
import { saveDisabledReason, saveLabel } from "./save-label";

const PERMIT_FIELDS: CreateField[] = [
  { name: "name", label: "Permit name", kind: "text", required: true },
  { name: "permitAuthority", label: "Issuing authority", kind: "text" },
  { name: "issueDate", label: "Issue date", kind: "date", required: true },
  { name: "endDate", label: "End date", kind: "date", required: true },
  { name: "file", label: "Permit PDF", kind: "file", required: true },
];

describe("saveLabel -- the one convention", () => {
  test("nothing missing leaves the verb alone", () => {
    expect(saveLabel("Save", [])).toBe("Save");
  });

  test("the label names what is missing, in order", () => {
    // The exact string D-73's acceptance asserts.
    expect(saveLabel("Save", ["Name", "Daily Rate"])).toBe("Save (Name, Daily Rate)");
  });

  test("blank entries never produce 'Save (, )'", () => {
    expect(saveLabel("Save", ["Name", "  ", ""])).toBe("Save (Name)");
  });

  test("the disabled reason is a sentence, and disappears when the form is complete", () => {
    expect(saveDisabledReason(["Title"], false)).toBe("Still needed: Title");
    expect(saveDisabledReason([], false)).toBeUndefined();
    expect(saveDisabledReason([], true)).toBe("Saving…");
  });
});

describe("missingCreateFields", () => {
  test("an empty Permit form names every required field and no optional one", () => {
    const missing = missingCreateFields(PERMIT_FIELDS, {}, {});
    expect(missing).toEqual(["Permit name", "Issue date", "End date", "Permit PDF"]);
    // R-257's own rule: "Optional fields carry no marker" -- and they are
    // never named in the Save label either.
    expect(missing).not.toContain("Issuing authority");
  });

  test("a file counts as present only when a File was actually chosen", () => {
    const file = new File(["x"], "permit.pdf", { type: "application/pdf" });
    const values = { name: "BP-2026-0142", issueDate: "2026-01-01", endDate: "2026-12-31" };
    expect(missingCreateFields(PERMIT_FIELDS, values, { file: null })).toEqual(["Permit PDF"]);
    expect(missingCreateFields(PERMIT_FIELDS, values, { file })).toEqual([]);
  });

  test("whitespace is not a value", () => {
    expect(missingCreateFields(PERMIT_FIELDS, { name: "   " }, {})).toContain("Permit name");
  });

  test("typing a field removes it from the label -- D-73's acceptance", () => {
    const fields: CreateField[] = [
      { name: "title", label: "Title", kind: "text", required: true },
      { name: "description", label: "Description", kind: "text", required: true },
    ];
    expect(createSaveLabel(missingCreateFields(fields, {}, {}))).toBe("Save (Title, Description)");
    expect(createSaveLabel(missingCreateFields(fields, { title: "Foundation" }, {}))).toBe("Save (Description)");
  });

  test("requirements the field list does not own are still named", () => {
    // /scope/new: "at least one complete line" is not a field, but it IS
    // required, and the whole point of the label is that it names everything.
    const fields: CreateField[] = [{ name: "title", label: "Title", kind: "text", required: true }];
    expect(createSaveLabel(missingCreateFields(fields, {}, {}, ["Description", "Qty", "Rate"]))).toBe(
      "Save (Title, Description, Qty, Rate)"
    );
  });
});

describe("createdMessage -- the receipt, not a return to an empty form", () => {
  test("names the object and the identifier the user would recognise", () => {
    expect(createdMessage("Permit", "BP-2026-0142")).toBe("Created permit BP-2026-0142");
  });

  test("an object with no readable identifier still confirms the save", () => {
    expect(createdMessage("Permit", null)).toBe("Created permit");
    expect(createdMessage("Permit", "   ")).toBe("Created permit");
  });
});

describe("deleteConfirmation -- name the blast radius, do not ask 'are you sure'", () => {
  test("the exact sentence R-257 quotes", () => {
    expect(deleteConfirmation("Permit", "BP-2026-0142", "and its PDF")).toBe(
      "Delete permit BP-2026-0142 and its PDF? This cannot be undone."
    );
  });

  test("without an identifier it still says what is going", () => {
    expect(deleteConfirmation("BOQ", null)).toBe("Delete this boq? This cannot be undone.");
  });
});
