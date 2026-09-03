/// <reference types="bun-types" />
// R67 lane D22 (review finding, second half). ScreenFrame is the OTHER D-09
// fork -- copied from an upstream whose source is not on this machine and is
// not published -- and it was the one still carrying no test. Its sibling
// ObjectScreen.test.tsx pins the slot as an OBJECT screen uses it; this file
// pins the frame's own contract, which that test never reaches:
//
//   * the three built-in LIST actions (Filter | Export | + New) that every
//     other screen in this app still depends on, in that fixed order -- the
//     part of the file that is byte-for-byte upstream and must STAY so, since
//     a future kit release will be diffed against it;
//   * the one behavioural difference: headerActions REPLACES those three
//     rather than joining them;
//   * disabled-with-reason on a header action, in words;
//   * the footer that never vanishes (GLOBAL/M29), because it carries the
//     message area.
//
// Rendered with react-dom/server for the reason WorkProgressReportClient.test
// gives: @happy-dom/global-registrator is declared in package.json but is not
// installed in this environment. renderToStaticMarkup still renders the real
// component tree; it just reads the result as an HTML string.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ScreenFrame, type ScreenFrameProps } from "./ScreenFrame";

const base: ScreenFrameProps = {
  breadcrumb: "Scope of Work",
  messages: [],
  children: <p>body</p>,
};

function render(over: Partial<ScreenFrameProps> = {}): string {
  return renderToStaticMarkup(<ScreenFrame {...base} {...over} />);
}

/** Where each needle first appears, so an ORDER can be asserted rather than mere presence. */
function positions(html: string, needles: string[]): number[] {
  return needles.map((n) => html.indexOf(n));
}

describe("the built-in list actions the fork must keep unchanged", () => {
  test("renders Filter, Export and + New in that fixed order", () => {
    const html = render({
      filterAction: { label: "Filter" },
      exportAction: { label: "Export" },
      newAction: { label: "+ New" },
    });
    const at = positions(html, ["Filter", "Export", "+ New"]);
    expect(at.every((i) => i >= 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });

  test("an action the screen does not offer renders nothing at all", () => {
    // Not a disabled ghost: a list with no export simply has no Export button.
    const html = render({ filterAction: { label: "Filter" } });
    expect(html).toContain("Filter");
    expect(html).not.toContain("Export");
    expect(html).not.toContain("+ New");
  });
});

describe("the one behavioural difference from the kit", () => {
  test("headerActions REPLACES the three built-ins rather than joining them", () => {
    // The reason the fork exists (D-63). A header reading
    // "Filter Export + New Edit Export PDF …" would be worse than either.
    const html = render({
      filterAction: { label: "Filter" },
      exportAction: { label: "Export" },
      newAction: { label: "+ New" },
      headerActions: <button type="button">Edit</button>,
    });
    expect(html).toContain("Edit");
    expect(html).not.toContain("Filter");
    expect(html).not.toContain("+ New");
  });

  test("renders the supplied actions in the order given", () => {
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
    expect(at).toEqual([...at].sort((a, b) => a - b));
  });
});

describe("a header action that cannot be pressed says why", () => {
  test("shows the reason in words, not only as a title attribute", () => {
    // WS-G's disabled-with-reason rule: a tooltip is not an explanation on a
    // touch screen, and this is the control D-52 disables on /scope.
    const html = render({ newAction: { label: "Import", disabledReason: "Select a project first" } });
    expect(html).toContain("Select a project first");
    // The ATTRIBUTE, not the substring: every one of these buttons carries
    // `disabled:opacity-50` in its class list whether or not it is disabled.
    expect(html).toContain('disabled=""');
  });

  test("an enabled action carries no reason and is not disabled", () => {
    const html = render({ newAction: { label: "Import" } });
    expect(html).toContain("Import");
    expect(html).not.toContain('disabled=""');
  });
});

describe("the footer that never vanishes (GLOBAL/M29)", () => {
  test("is present even with zero actions and zero messages", () => {
    // It carries the message area, so a screen with nothing to say still has
    // somewhere to say it. Toasts vanish; this must not.
    expect(render()).toContain("<footer");
  });

  test("renders the message area's text and count when there are messages", () => {
    const html = render({ messages: [{ level: "error", text: "Import failed – nothing was saved." }] });
    expect(html).toContain("Import failed – nothing was saved.");
    expect(html).toContain("1 message");
  });
});

describe("the header message strip", () => {
  test("renders above the body when supplied", () => {
    const html = render({ headerMessageStrip: "Locked by Suresh until 14:32", children: <p>body</p> });
    const [strip, body] = positions(html, ["Locked by Suresh until 14:32", "body"]);
    expect(strip).toBeGreaterThanOrEqual(0);
    expect(body).toBeGreaterThan(strip);
  });

  test("adds no empty band when the screen has no object-level state to show", () => {
    expect(render()).not.toContain("bg-ct-cloud");
  });
});
