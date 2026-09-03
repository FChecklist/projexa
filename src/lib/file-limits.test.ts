/// <reference types="bun-types" />
// R67 D-09. The three rules every upload field in this product states before
// the upload rather than after it: too big, wrong type, and how both are
// worded.
import { describe, expect, test } from "bun:test";
import { describeExtensions, describeFileSize, fileExtension, fileSizeError, fileTypeError } from "./file-limits";

describe("describeFileSize", () => {
  test("states the size in the same unit as the limit", () => {
    expect(describeFileSize(14 * 1024 * 1024, 10)).toBe("14 MB");
    expect(describeFileSize(62 * 1024 * 1024, 50)).toBe("62 MB");
  });

  test("uses a decimal only where rounding would read 'is 10 MB; the limit is 10 MB'", () => {
    expect(describeFileSize(10.4 * 1024 * 1024, 10)).toBe("10.4 MB");
    expect(describeFileSize(50.3 * 1024 * 1024, 50)).toBe("50.3 MB");
    // A size that rounds to something OTHER than the limit keeps the whole number.
    expect(describeFileSize(11.4 * 1024 * 1024, 10)).toBe("11 MB");
  });
});

describe("fileSizeError", () => {
  test("names both numbers", () => {
    expect(fileSizeError(14 * 1024 * 1024, 10)).toBe("This file is 14 MB; the limit is 10 MB");
    expect(fileSizeError(62 * 1024 * 1024, 50)).toBe("This file is 62 MB; the limit is 50 MB");
  });

  test("a file at or under the limit passes, and no file chosen is not an error", () => {
    expect(fileSizeError(50 * 1024 * 1024, 50)).toBeUndefined();
    expect(fileSizeError(1024, 50)).toBeUndefined();
    expect(fileSizeError(null, 50)).toBeUndefined();
  });
});

describe("describeExtensions", () => {
  test("reads as a sentence, not as an accept attribute", () => {
    expect(describeExtensions([".dwg", ".dxf", ".pdf"])).toBe(".dwg, .dxf or .pdf");
    expect(describeExtensions([".glb", ".gltf", ".fbx", ".mp4"])).toBe(".glb, .gltf, .fbx or .mp4");
    expect(describeExtensions([".pdf"])).toBe(".pdf");
  });
});

describe("fileTypeError", () => {
  const DWG = [".dwg", ".dxf", ".pdf"] as const;

  test("a mismatched type is named at the field, in the allowed list's own words", () => {
    // R67 D-78 adds the second clause: the user is told what they actually
    // chose, not left comparing the sentence with a file name they can no
    // longer see.
    expect(fileTypeError("walkthrough.mp4", DWG)).toBe("Choose a .dwg, .dxf or .pdf file — this is a .mp4");
  });

  test("D-78's own example, on a single-extension field", () => {
    expect(fileTypeError("plan.pdf", [".dwg"])).toBe("Choose a .dwg file — this is a .pdf");
    expect(fileTypeError("contract.docx", [".pdf"])).toBe("Choose a .pdf file — this is a .docx");
  });

  test("an allowed type passes, whatever the case of its extension", () => {
    expect(fileTypeError("AR-101.dwg", DWG)).toBeUndefined();
    expect(fileTypeError("AR-101.DWG", DWG)).toBeUndefined();
    expect(fileTypeError("site.pdf", DWG)).toBeUndefined();
  });

  test("a file with no extension is refused, and is not accused of having one", () => {
    expect(fileTypeError("drawing", DWG)).toBe("Choose a .dwg, .dxf or .pdf file");
  });

  test("fileExtension reads the last dot, lower-cased, and \"\" when there is none", () => {
    expect(fileExtension("AR-101.Rev.B.DWG")).toBe(".dwg");
    expect(fileExtension("drawing")).toBe("");
  });

  test("no file chosen is not a type error -- that is the counter's job", () => {
    expect(fileTypeError(null, DWG)).toBeUndefined();
  });
});
