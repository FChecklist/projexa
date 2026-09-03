/// <reference types="bun-types" />
// R67 D-14. The decisions the New Document screen makes before the user types
// anything, held to the item's own examples.
import { GlobalRegistrator } from "@happy-dom/global-registrator";
if (typeof globalThis.window === "undefined") GlobalRegistrator.register();

import { afterEach, describe, expect, test } from "bun:test";
import {
  DOCUMENT_CATEGORIES,
  defaultCategory,
  describeFileSize,
  documentSizeError,
  documentTypeError,
  fileStem,
  inferCategory,
  parseEmailHeaders,
  readLastCategory,
  relatesToWord,
  toDateInputValue,
  writeLastCategory,
} from "./document-intake";

afterEach(() => {
  try {
    globalThis.localStorage?.clear();
  } catch {
    // No storage in this environment -- the helpers under test tolerate that.
  }
});

describe("fileStem", () => {
  test("THE ACCEPTANCE: DEWA_permit_2026.pdf names the document DEWA_permit_2026", () => {
    expect(fileStem("DEWA_permit_2026.pdf")).toBe("DEWA_permit_2026");
  });

  test("a dotless name and a dotfile are left alone rather than emptied", () => {
    expect(fileStem("scan")).toBe("scan");
    expect(fileStem(".gitignore")).toBe(".gitignore");
  });

  test("only the LAST extension is dropped", () => {
    expect(fileStem("minutes.2026-05-10.docx")).toBe("minutes.2026-05-10");
  });
});

describe("inferCategory", () => {
  test("THE ACCEPTANCE: a file named for a permit is a permit, not 'other'", () => {
    expect(inferCategory("DEWA_permit_2026.pdf")).toBe("permit");
    expect(inferCategory("Building Permit - Villa 21.PDF")).toBe("permit");
  });

  test("an email file is an email, by either extension", () => {
    expect(inferCategory("FW Approval.eml")).toBe("email");
    expect(inferCategory("FW Approval.MSG")).toBe("email");
  });

  test("anything less certain is left to the user rather than guessed at", () => {
    expect(inferCategory("scan_0012.jpg")).toBeNull();
    expect(inferCategory("Villa21.dwg")).toBeNull();
  });
});

describe("defaultCategory", () => {
  test("what this user filed last wins, then what the file says, then 'other'", () => {
    expect(defaultCategory("scan_0012.jpg", "site_photo")).toBe("site_photo");
    expect(defaultCategory("DEWA_permit_2026.pdf", null)).toBe("permit");
    expect(defaultCategory("scan_0012.jpg", null)).toBe("other");
  });

  test("a remembered value that is no longer a real category is ignored, not rendered", () => {
    expect(defaultCategory("DEWA_permit_2026.pdf", "invoice")).toBe("permit");
    expect(DOCUMENT_CATEGORIES).toContain("email");
  });
});

describe("readLastCategory / writeLastCategory", () => {
  test("round-trips, and never throws when storage is unavailable", () => {
    writeLastCategory("permit");
    expect(readLastCategory()).toBe("permit");
  });
});

describe("documentSizeError", () => {
  test("THE ITEM'S WORDING: a 31 MB file is refused in the same units as the limit", () => {
    expect(documentSizeError(31 * 1024 * 1024)).toBe("This file is 31 MB; the limit is 25 MB");
  });

  test("a file that fits produces no message at all", () => {
    expect(documentSizeError(240_000)).toBeUndefined();
    expect(documentSizeError(null)).toBeUndefined();
  });
});

describe("describeFileSize", () => {
  test("reads in the unit a person would use", () => {
    expect(describeFileSize(512)).toBe("512 B");
    expect(describeFileSize(240_000)).toBe("234.4 KB");
    expect(describeFileSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

describe("parseEmailHeaders", () => {
  const EML = [
    "From: Sumeet Rao <sumeet@skylinebuilders.example>",
    "To: site@skylinebuilders.example",
    "Subject: RE: DEWA connection approval for",
    "  Villa 21 - revised drawings attached",
    "Date: Sun, 10 May 2026 09:14:22 +0400",
    "",
    "Please find attached...",
  ].join("\r\n");

  test("reads From, Subject and Date out of a real header block", () => {
    const headers = parseEmailHeaders(EML);
    expect(headers.from).toBe("Sumeet Rao <sumeet@skylinebuilders.example>");
    // A folded Subject: is joined, not truncated at the first line.
    expect(headers.subject).toBe("RE: DEWA connection approval for Villa 21 - revised drawings attached");
    expect(headers.receivedOn).toBe("2026-05-10");
  });

  test("an unparseable file leaves every field empty rather than guessing", () => {
    expect(parseEmailHeaders("this is not an email at all")).toEqual({ from: "", receivedOn: "", subject: "" });
  });

  test("a header block with no Date leaves the date empty, not today", () => {
    expect(parseEmailHeaders("From: a@b.example\nSubject: Hello\n\nbody").receivedOn).toBe("");
  });
});

describe("toDateInputValue", () => {
  test("an unreadable date is empty, never Invalid Date", () => {
    expect(toDateInputValue("not a date")).toBe("");
    expect(toDateInputValue("")).toBe("");
  });
});

describe("relatesToWord", () => {
  test("a wire value is never shown to a user", () => {
    expect(relatesToWord("rfi")).toBe("RFI");
    expect(relatesToWord("mom")).toBe("Minutes of Meeting");
    expect(relatesToWord("project")).toBe("Project");
    expect(relatesToWord(null)).toBe("—");
    // An unknown discriminator still reads as words rather than as snake_case.
    expect(relatesToWord("boq_line")).toBe("boq line");
  });
});

// ─── R67 D-78: what the drop zone will actually accept ───────────────────────
//
// `accept` filters the PICKER and nothing else, and a file dragged onto the drop
// zone never passes through a picker at all -- which is why this check exists at
// all and why it is the drop zone, not the input, that made it necessary.
describe("documentTypeError", () => {
  test("the formats this module is for pass", () => {
    for (const name of ["DEWA_permit_2026.pdf", "thread.eml", "note.msg", "contract.docx", "boq.xlsx"]) {
      expect(documentTypeError(name)).toBeUndefined();
    }
  });

  test("a photo from any device passes -- the picker's `image/*` half, spelled out", () => {
    for (const name of ["site.jpg", "site.JPEG", "IMG_0042.heic", "scan.tiff", "shot.png"]) {
      expect(documentTypeError(name)).toBeUndefined();
    }
  });

  test("anything else is refused at the field, and is told what it is", () => {
    expect(documentTypeError("drawings.zip")).toBe("Choose a PDF, image, email or Office file — this is a .zip");
    expect(documentTypeError("model.dwg")).toBe("Choose a PDF, image, email or Office file — this is a .dwg");
  });

  test("a file with no extension is refused, and is not accused of having one", () => {
    expect(documentTypeError("scan")).toBe("Choose a PDF, image, email or Office file");
  });

  test("no file chosen is not a type error -- that is the counter's job", () => {
    expect(documentTypeError(null)).toBeUndefined();
  });
});
