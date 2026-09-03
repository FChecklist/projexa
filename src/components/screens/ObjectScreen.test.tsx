/// <reference types="bun-types" />
// R67 lane D22 (review finding). ObjectScreen and ScreenFrame here are a D-09
// FORK of an upstream whose source is not on this machine and is not published.
// Other lanes will build on the fork, and nothing pinned its contract: the two
// additions that make it a fork -- the header-actions slot, and the footer Edit
// it suppresses -- were readable in a comment and asserted nowhere.
//
// These are the three things a caller is entitled to rely on:
//   1. headerActions render, in the order given;
//   2. supplying headerActions suppresses the footer's own Edit button, because
//      the caller now owns that whole area and two Edit buttons on one screen
//      would be worse than either arrangement;
//   3. the footer primary reads "Save (<reason>)" when it is disabled -- the
//      composition D-60's acceptance clause quotes character for character.
//
// Rendered with react-dom/server for the reason WorkProgressReportClient.test's
// own header gives: @happy-dom/global-registrator is declared in package.json
// but is not installed in this environment, so the browser-query APIs are not
// available. renderToStaticMarkup still renders the real component tree; it
// just reads the result as an HTML string.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ObjectScreen, type ObjectScreenProps } from "./ObjectScreen";

const base: ObjectScreenProps = {
  breadcrumb: "Minutes of Meeting / Meeting",
  title: "Weekly Site Coordination",
  mode: "display",
  hasDraft: false,
  messages: [],
  children: <p>body</p>,
};

function render(over: Partial<ObjectScreenProps> = {}): string {
  return renderToStaticMarkup(<ObjectScreen {...base} {...over} />);
}

/** Where each needle first appears, so an ORDER can be asserted rather than mere presence. */
function positions(html: string, needles: string[]): number[] {
  return needles.map((n) => html.indexOf(n));
}

describe("the fork's header-actions slot", () => {
  test("renders the actions it is given, in the order it is given them", () => {
    const html = render({
      headerActions: (
        <>
          <button type="button">Edit</button>
          <button type="button">Export PDF</button>
          <button type="button">Share on WhatsApp</button>
          <button type="button">Share link</button>
        </>
      ),
    });
    const at = positions(html, ["Edit", "Export PDF", "Share on WhatsApp", "Share link"]);
    expect(at.every((i) => i >= 0)).toBe(true);
    // D-63's fixed order, read off the rendered document rather than trusted.
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  test("supplying headerActions suppresses the FOOTER's own Edit button", () => {
    // This is the whole divergence from the kit: the kit puts Edit in the
    // footer, and the fork lets a caller move it into the header. If the footer
    // one survived, every forked screen would show Edit twice.
    const withHeader = render({ onEdit: () => undefined, headerActions: <button type="button">Edit</button> });
    expect(withHeader.split("Edit").length - 1).toBe(1);
  });

  test("without headerActions the kit's own footer Edit is still rendered", () => {
    // The fork must not change behaviour for the screens that did not ask for
    // the slot -- most of this app's object pages.
    expect(render({ onEdit: () => undefined })).toContain("Edit");
  });

  test("header actions are hidden while editing -- the footer's Save/Cancel pair owns that state", () => {
    const html = render({ mode: "edit", headerActions: <button type="button">Export PDF</button> });
    expect(html).not.toContain("Export PDF");
    expect(html).toContain("Save");
    expect(html).toContain("Cancel");
  });
});

describe("the footer primary's disabled reason", () => {
  test('reads "Save (<reason>)" -- the composition D-60 asserts character for character', () => {
    const html = render({
      mode: "create",
      saveDisabled: true,
      saveDisabledReason: "Title, 1 line with Description, Qty, Rate",
    });
    expect(html).toContain("Save (Title, 1 line with Description, Qty, Rate)");
  });

  test("is the bare word when nothing is missing, not an empty pair of brackets", () => {
    const html = render({ mode: "edit" });
    expect(html).toContain(">Save<");
    expect(html).not.toContain("Save (");
  });

  test("a disabled Save with no reason still says Save, never 'Save ()'", () => {
    const html = render({ mode: "edit", saveDisabled: true });
    expect(html).not.toContain("Save (");
  });
});

describe("Delete stays isolated in the footer", () => {
  test("is not rendered into the header actions area even when one is supplied", () => {
    const html = render({
      onDelete: () => undefined,
      headerActions: <button type="button">Edit</button>,
    });
    // The kit's own rule, kept by the fork: a destructive action is never
    // adjacent to a common one. Delete appears after the header actions.
    const [edit, del] = positions(html, ["Edit", "Delete"]);
    expect(edit).toBeGreaterThanOrEqual(0);
    expect(del).toBeGreaterThan(edit);
  });

  test("says why it cannot be pressed rather than disappearing", () => {
    const html = render({ onDelete: () => undefined, deleteDisabledReason: "Only a draft BOQ can be deleted" });
    expect(html).toContain("Only a draft BOQ can be deleted");
    expect(html).toContain("Delete");
  });
});
