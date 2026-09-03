/// <reference types="bun-types" />
// R67 E-12 (R-136). What the document's header actions do, and -- more
// importantly -- what they refuse to do and in whose words.
import { describe, expect, test } from "bun:test";
import {
  BREAKUP_SOURCE_REPORT,
  EXPORT_FORMATS,
  NO_DOCUMENT_REASON,
  SHAREABLE_REPORTS,
  exportDisabledReason,
  reportExportHref,
  shareDisabledReason,
  whatsappHref,
} from "./report-document-actions";

describe("the export link (R67 E-12)", () => {
  test("names the report, the project and the format, and nothing else when nothing else was chosen", () => {
    expect(reportExportHref("project-status", "xlsx", { projectId: "p-1" })).toBe(
      "/api/reports/project-status/export?projectId=p-1&format=xlsx"
    );
  });

  test("carries the filters, so the FILE matches the table it was exported from", () => {
    expect(reportExportHref("budget-variance", "pdf", { projectId: "p-1", category: "Civil Works, Phase 2", vendorId: "v-9" })).toBe(
      "/api/reports/budget-variance/export?projectId=p-1&format=pdf&category=Civil+Works%2C+Phase+2&vendorId=v-9"
    );
  });

  test("all three formats are server-rendered -- PROJEXA gains no PDF or XLSX library", () => {
    expect([...EXPORT_FORMATS]).toEqual(["pdf", "xlsx", "csv"]);
  });
});

describe("why Export cannot be pressed, in words (R67 E-12, narrowed by E-18)", () => {
  test("nothing has been run yet", () => {
    expect(exportDisabledReason({ hasResult: false, tieMessage: null })).toBe("Run the report first");
  });

  test("the numbers disagree -- and THAT reason outranks every other, because it is the one that would produce a WRONG file", () => {
    expect(
      exportDisabledReason({ hasResult: true, tieMessage: "Totals do not tie (difference AED 120.00)" })
    ).toBe("Totals do not tie (difference AED 120.00)");
  });

  // R67 E-18 (R-178). A report with no server-rendered document still has its
  // browser-built CSV, so "no PDF" must NOT disable the whole control -- that
  // took away the one file the screen really could produce. The fact did not
  // disappear; it moved onto the format it is about.
  test("a report with no document schema can still export: the button stays live", () => {
    expect(exportDisabledReason({ hasResult: true, tieMessage: null })).toBeNull();
  });

  test("...and the missing formats say so themselves, naming the one that works", () => {
    expect(NO_DOCUMENT_REASON).toBe("Not available for this report yet — export CSV instead");
  });
});

describe("why Share cannot be pressed, in words (R67 E-12)", () => {
  test("only a report whose PUBLIC page can render it may be shared -- a link that 404s is worse than no link", () => {
    expect(shareDisabledReason("project-status", true)).toBeNull();
    expect(shareDisabledReason("work-progress", true)).toBeNull();
    expect(shareDisabledReason("attendance", true)).toBe("This report has no public view yet — copy the link instead");
    expect(shareDisabledReason("project-status", false)).toBe("Run the report first");
  });

  test("the shareable list is the two reports that really have a public renderer", () => {
    expect([...SHAREABLE_REPORTS]).toEqual(["work-progress", "project-status"]);
  });
});

describe("WhatsApp (R67 E-12)", () => {
  test("the title AND the link, in one message, through wa.me -- the same pattern the MoM object page ships", () => {
    expect(whatsappHref("Project Status Report · Cedar Heights", "https://projexa-ai.com/share/report/tok")).toBe(
      "https://wa.me/?text=Project%20Status%20Report%20%C2%B7%20Cedar%20Heights%0Ahttps%3A%2F%2Fprojexa-ai.com%2Fshare%2Freport%2Ftok"
    );
  });
});

describe("a report whose rows live in another report (R67 E-12)", () => {
  test("Project Status prints the BOQ budget breakup, which is the budget-variance report", () => {
    expect(BREAKUP_SOURCE_REPORT["project-status"]).toBe("budget-variance");
    // ...and no other report borrows rows, so this stays a named exception
    // rather than a habit.
    expect(Object.keys(BREAKUP_SOURCE_REPORT)).toEqual(["project-status"]);
  });
});
