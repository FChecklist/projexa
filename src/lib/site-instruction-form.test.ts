/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test";
import { readCreatedSiteInstruction, missingSiteInstructionFields, missingSiteInstructionReason, siLabel, siteInstructionFileError } from "./site-instruction-form";

describe("site instruction form rules (R-C14)", () => {
  test("an empty form names every required field, in field order", () => {
    const missing = missingSiteInstructionFields({ issueDate: "", toContractor: " ", description: "" });
    expect(missing).toEqual(["issue date", "to contractor", "instruction"]);
    expect(missingSiteInstructionReason(missing)).toBe("3 required fields still needed - issue date, to contractor, instruction");
  });
  test("a complete form has no reason", () => {
    const missing = missingSiteInstructionFields({ issueDate: "2026-10-19", toContractor: "Apex MEP", description: "Move the duct" });
    expect(missingSiteInstructionReason(missing)).toBeUndefined();
  });
  test("one missing field is singular", () => {
    expect(missingSiteInstructionReason(["instruction"])).toBe("1 required field still needed - instruction");
  });
  test("the file is optional; a wrong type or an oversize file is named", () => {
    expect(siteInstructionFileError(null)).toBeUndefined();
    expect(siteInstructionFileError({ name: "si.pdf", size: 1000 })).toBeUndefined();
    expect(siteInstructionFileError({ name: "photo.JPG", size: 1000 })).toBeUndefined();
    expect(siteInstructionFileError({ name: "si.docx", size: 1000 })).toContain("PDF or a photo");
    expect(siteInstructionFileError({ name: "si.pdf", size: 11 * 1024 * 1024 })).toContain("10 MB");
  });
  test("SI label", () => {
    expect(siLabel(7)).toBe("SI-7");
    expect(siLabel(null)).toBe("–");
  });

  test("the created instruction's id is where Save lands; a clean 201 is a success receipt", () => {
    expect(readCreatedSiteInstruction({ siteInstruction: { id: "si1", siNumber: 4 } })).toEqual({ id: "si1", level: "success", text: "Site instruction SI-4 created" });
  });
  test("a 207 (record saved, file not) is a warning that names the file failure, and still lands on the record", () => {
    const r = readCreatedSiteInstruction({ siteInstruction: { id: "si2", siNumber: 5 }, attachmentError: "storage is down" });
    expect(r.id).toBe("si2");
    expect(r.level).toBe("warning");
    expect(r.text).toContain("file was not attached: storage is down");
  });
  test("an answer with no id is not a save", () => {
    expect(() => readCreatedSiteInstruction({})).toThrow("did not confirm");
    expect(() => readCreatedSiteInstruction(null)).toThrow("did not confirm");
  });
});
