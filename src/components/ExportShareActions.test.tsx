/// <reference types="bun-types" />
// R67 E-18 (R-178). The shared Export / Share control, rendered for real
// through react-dom/server and read as HTML -- the same approach every other
// component test in this repo uses, and for the same reason: the component
// tree really is rendered, so these are assertions about the shipped markup
// rather than a description of it.
//
// The menus open on click, and a static render cannot click. So the menu
// CONTENTS are asserted by rendering the same component with its menu forced
// open is not possible either -- instead the tests below assert the two things
// a static render can prove and that matter most:
//
//   1. the disabled state and its REASON, which is what R-178 is about (a
//      greyed control with nothing to read was the defect), and
//   2. the pure rules the menu is built from -- the wa.me message and the
//      phone/desktop target -- which is where a mistake would actually change
//      what a reader gets.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ExportShareActions, whatsappTarget } from "./ExportShareActions";
import { whatsappHref } from "@/lib/report-document-actions";

function html(node: React.ReactElement): string {
  return renderToStaticMarkup(node);
}

describe("Export is disabled WITH its reason, beside the button", () => {
  test("the reason is real text in the markup, not only a tooltip", () => {
    const markup = html(
      <ExportShareActions canExport={false} exportReason="Run the report first" title="Work Progress Report" />
    );
    // A tooltip cannot be read on a phone, on a printout, or by someone who
    // does not know to hover -- so the sentence has to be IN the page.
    expect(markup).toContain("Run the report first");
    expect(markup).toContain('data-testid="export-share-reason"');
  });

  test("the tie failure is the reason a report that does not add up shows", () => {
    const markup = html(
      <ExportShareActions
        canExport={false}
        exportReason="Totals do not tie – export disabled"
        title="Work Progress Report"
        pdfHref="/api/work-progress/report/pdf?projectId=p1"
      />
    );
    expect(markup).toContain("Totals do not tie – export disabled");
    // Disabled means disabled: the PDF link must not be reachable while the
    // numbers disagree, because a wrong file outlives the screen that made it.
    expect(markup).not.toContain("/api/work-progress/report/pdf");
  });

  test("nothing is wrong: no reason is printed at all", () => {
    const markup = html(
      <ExportShareActions canExport exportReason={null} title="Work Progress Report" pdfHref="/x.pdf" />
    );
    expect(markup).not.toContain('data-testid="export-share-reason"');
  });
});

describe("Share is only rendered when the screen really has a link to give", () => {
  test("no factory, no Share button -- never a button that opens an empty share", () => {
    const markup = html(<ExportShareActions canExport title="Cost Variance" pdfHref="/x.pdf" />);
    expect(markup).toContain('data-testid="export-menu-button"');
    expect(markup).not.toContain('data-testid="share-menu-button"');
  });

  test("with a factory it appears, and carries the share reason when it cannot be pressed", async () => {
    const markup = html(
      <ExportShareActions
        canExport
        title="Project Status"
        shareUrlFactory={async () => "https://example.test/share/abc"}
        shareReason="This report has no public view yet — copy the link instead"
      />
    );
    expect(markup).toContain('data-testid="share-menu-button"');
    expect(markup).toContain("This report has no public view yet — copy the link instead");
  });
});

describe("the WhatsApp message is built by ONE rule (R67 E-12's), not a second one here", () => {
  test("title and link, url-encoded, through wa.me", () => {
    const href = whatsappHref("Work Progress Report – Cedar Heights, 01-09-2026 to 02-09-2026", "https://x.test/s/tok");
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toBe(
      "Work Progress Report – Cedar Heights, 01-09-2026 to 02-09-2026\nhttps://x.test/s/tok"
    );
  });

  test("a phone hands off in the SAME tab -- a second tab handing off to another app is an empty tab left behind", () => {
    expect(whatsappTarget(375)).toBe("_self");
    expect(whatsappTarget(767)).toBe("_self");
    expect(whatsappTarget(768)).toBe("_blank");
    expect(whatsappTarget(1440)).toBe("_blank");
  });
});
