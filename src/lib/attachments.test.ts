import { describe, expect, test } from "bun:test";
import {
  MB,
  acceptList,
  checkBatch,
  checkFile,
  extensionOf,
  formatSize,
  importSummaryLine,
  importWarnings,
  type AttachPolicy,
} from "./attachments";
import { PERMITS_CARD, SCOPE_CARD, DRAWINGS_CARD, WORK_PROGRESS_CARD } from "./card-catalogue";

const PDF_25: AttachPolicy = {
  label: "Attach PDF, up to 25 MB",
  accept: [".pdf"],
  acceptWords: "a PDF",
  maxBytes: 25 * MB,
  maxFiles: 5,
};

describe("formatSize", () => {
  test("whole megabytes never carry a trailing .0", () => {
    expect(formatSize(30 * MB)).toBe("30 MB");
    expect(formatSize(25 * MB)).toBe("25 MB");
  });

  test("a fractional size keeps one decimal", () => {
    expect(formatSize(24.42 * MB)).toBe("24.4 MB");
  });

  test("below a megabyte it reads in KB, and below that in bytes", () => {
    expect(formatSize(612 * 1024)).toBe("612 KB");
    expect(formatSize(400)).toBe("400 bytes");
  });

  test("a nonsense size says so instead of printing NaN", () => {
    expect(formatSize(Number.NaN)).toBe("unknown size");
    expect(formatSize(-1)).toBe("unknown size");
  });
});

describe("extensionOf", () => {
  test("is case-insensitive and keeps the dot", () => {
    expect(extensionOf("DEWA-permit.PDF")).toBe(".pdf");
    expect(extensionOf("boq.xlsx")).toBe(".xlsx");
  });

  test("a name with no extension yields the empty string, not a guess", () => {
    expect(extensionOf("scan")).toBe("");
    expect(extensionOf("archive.tar.gz")).toBe(".gz");
  });
});

describe("checkFile", () => {
  test("C-07's acceptance sentence, verbatim", () => {
    expect(checkFile({ name: "big.pdf", size: 30 * MB }, PDF_25)).toBe("Too large: 30 MB, limit 25 MB");
  });

  test("C-07's other worked example, verbatim", () => {
    const policy = { ...PDF_25, maxBytes: 20 * MB };
    expect(checkFile({ name: "plan.pdf", size: 24 * MB }, policy)).toBe("Too large: 24 MB, limit 20 MB");
  });

  test("a file exactly on the limit is accepted -- the limit is inclusive", () => {
    expect(checkFile({ name: "edge.pdf", size: 25 * MB }, PDF_25)).toBeNull();
  });

  test("the wrong type names the type and what to attach instead", () => {
    expect(checkFile({ name: "notes.docx", size: 1000 }, PDF_25)).toBe("Wrong type: .docx — attach a PDF");
  });

  test("a file with no extension is refused in words, never silently", () => {
    expect(checkFile({ name: "scan", size: 1000 }, PDF_25)).toBe("Wrong type: no file extension — attach a PDF");
  });

  test("the count is checked before anything else -- a full tray is the fact that matters", () => {
    expect(checkFile({ name: "huge.docx", size: 900 * MB }, PDF_25, 5)).toBe("Too many files: 5 attached, limit 5");
  });
});

describe("checkBatch", () => {
  test("the running count is carried, so the file that breaks the limit is the one refused", () => {
    const policy = { ...PDF_25, maxFiles: 2 };
    const results = checkBatch(
      [
        { name: "a.pdf", size: 10 },
        { name: "b.pdf", size: 10 },
        { name: "c.pdf", size: 10 },
      ],
      policy
    );
    expect(results.map((r) => r.error)).toEqual([null, null, "Too many files: 2 attached, limit 2"]);
  });

  test("a rejected file does not consume a slot", () => {
    const policy = { ...PDF_25, maxFiles: 2 };
    const results = checkBatch(
      [
        { name: "a.docx", size: 10 },
        { name: "b.pdf", size: 10 },
        { name: "c.pdf", size: 10 },
      ],
      policy
    );
    expect(results.map((r) => r.error)).toEqual(["Wrong type: .docx — attach a PDF", null, null]);
  });
});

describe("acceptList", () => {
  test("reads as a list a person would say out loud", () => {
    expect(acceptList(PDF_25)).toBe(".pdf");
    expect(acceptList({ ...PDF_25, accept: [".dwg", ".dxf", ".pdf", ".glb"] })).toBe(".dwg, .dxf, .pdf or .glb");
  });
});

describe("the module policies C-07 names, verbatim", () => {
  test("Permits and Documents", () => {
    expect(PERMITS_CARD.attach?.label).toBe("Attach PDF, up to 25 MB");
    expect(PERMITS_CARD.attach?.accept).toEqual([".pdf"]);
  });

  test("Drawings", () => {
    expect(DRAWINGS_CARD.attach?.label).toBe("Attach DWG, DXF, PDF or GLB");
    expect(DRAWINGS_CARD.attach?.accept).toEqual([".dwg", ".dxf", ".pdf", ".glb"]);
  });

  test("Work Progress", () => {
    expect(WORK_PROGRESS_CARD.attach?.label).toBe("Attach photos, JPG/PNG, up to 10");
    expect(WORK_PROGRESS_CARD.attach?.maxFiles).toBe(10);
  });

  test("Scope, whose limit is the importer's OWN 10 MB and not a larger number we invented", () => {
    expect(SCOPE_CARD.attach?.label).toBe("Attach Excel (.xlsx)");
    expect(SCOPE_CARD.attach?.maxBytes).toBe(10 * MB);
    expect(checkFile({ name: "boq.xlsx", size: 12 * MB }, SCOPE_CARD.attach!)).toBe(
      "Too large: 12 MB, limit 10 MB"
    );
  });
});

describe("the importer's reply", () => {
  test("a clean import says so", () => {
    expect(importSummaryLine({ totalRows: 45, importedLineItems: 45 })).toBe("Imported all 45 rows");
  });

  test("a partial import is never rounded up to a success", () => {
    expect(importSummaryLine({ totalRows: 45, importedLineItems: 40 })).toBe("Imported 40 of 45 rows");
  });

  test("with no row count it still states what landed", () => {
    expect(importSummaryLine({ importedLineItems: 1 })).toBe("Imported 1 line");
    expect(importSummaryLine(null)).toBe("Imported 0 lines");
  });

  test("per-row warnings are shown, and a long list says how many were not", () => {
    expect(importWarnings({ warnings: ["row 3: no unit", "row 9: no rate"] })).toEqual([
      "row 3: no unit",
      "row 9: no rate",
    ]);
    const many = Array.from({ length: 8 }, (_, i) => `row ${i}`);
    expect(importWarnings({ warnings: many }, 5)).toEqual([
      "row 0",
      "row 1",
      "row 2",
      "row 3",
      "row 4",
      "…and 3 more",
    ]);
  });
});
