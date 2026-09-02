/// <reference types="bun-types" />
// R67 lane I (WS-I item I-05, R-177): the labelled Category control on a BOQ
// line row. Every branch asserted below is a real product rule from the item,
// not a rendering detail:
//   * it is LABELLED -- a visible label on the first row, an aria-label on
//     every row (the item folds the unlabelled-inputs finding into this
//     control, so an assertion that the label exists IS the acceptance);
//   * a line with no category is never blocked -- the first option is the
//     "no category" chip wording, shared with the rest of the app through
//     NO_CATEGORY_CHIP_LABEL rather than retyped here;
//   * "+ Add new…" is inline, so nobody has to leave a half-entered BOQ;
//   * a value the org's list does not contain (imported, or added on another
//     row) is still SELECTED, offered as its own option, never silently reset
//     to blank -- silently blanking it would delete a category from a line the
//     user never touched;
//   * a failed category load degrades to free text instead of blocking BOQ
//     entry behind a broken list.
//
// Rendered through react-dom/server's renderToStaticMarkup, the pattern
// WorkProgressReportClient.test.tsx established in this repo and for the reason
// documented there (@happy-dom/global-registrator is declared but absent from
// node_modules here). That reads the real component's output as an HTML string.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import BoqCategorySelect, { type BoqCategory } from "./BoqCategorySelect";
import { NO_CATEGORY_CHIP_LABEL } from "@/lib/boq-helpers";

const CATEGORIES: BoqCategory[] = [
  { id: "cat-civil", name: "Civil", isActive: true },
  { id: "cat-gypsum", name: "Gypsum", isActive: true },
  { id: "cat-paint", name: "Paint", isActive: true },
];

const noop = () => {};

function render(props: Partial<Parameters<typeof BoqCategorySelect>[0]> = {}) {
  return renderToStaticMarkup(
    <BoqCategorySelect
      value=""
      categories={CATEGORIES}
      failed={false}
      onChange={noop}
      onAddNew={noop}
      {...props}
    />
  );
}

function optionValues(html: string): string[] {
  return Array.from(html.matchAll(/<option value="([^"]*)"/g)).map((m) => m[1]);
}

describe("BoqCategorySelect -- labelling (the unlabelled-inputs finding)", () => {
  test("showLabel renders a VISIBLE 'Category' label bound to the control", () => {
    const html = render({ showLabel: true });
    const forMatch = html.match(/<label for="([^"]+)"[^>]*>Category<\/label>/);
    expect(forMatch).not.toBeNull();
    // The htmlFor must actually point at the select, not just exist.
    expect(html).toContain(`id="${forMatch![1]}"`);
  });

  test("every row carries aria-label=\"Category\", including rows with no visible label", () => {
    expect(render({ showLabel: false })).toContain('aria-label="Category"');
    expect(render({ showLabel: true })).toContain('aria-label="Category"');
  });

  test("only the first row shows the visible label -- the rest are not repeated", () => {
    expect(render({ showLabel: false })).not.toContain(">Category</label>");
  });
});

describe("BoqCategorySelect -- the options offered", () => {
  test("the first option is the shared 'no category' wording, with an empty value", () => {
    const html = render();
    // Matched loosely on purpose: with value="" React also marks this option
    // selected="", which a literal string match would miss. What matters is
    // that the FIRST option has an empty value and carries the shared chip
    // wording -- not retyped here, imported, so a reword cannot desync it.
    expect(optionValues(html)[0]).toBe("");
    expect(html).toMatch(new RegExp(`<option value=""[^>]*>${NO_CATEGORY_CHIP_LABEL}</option>`));
  });

  test("every org category is offered, in the order the list gives them", () => {
    const values = optionValues(render());
    expect(values).toEqual(["", "Civil", "Gypsum", "Paint", "__add_new__"]);
  });

  test("'+ Add new…' is offered inline, last", () => {
    const html = render();
    expect(html).toContain("+ Add new…");
    expect(optionValues(html).at(-1)).toBe("__add_new__");
  });
});

describe("BoqCategorySelect -- a value the org list does not contain", () => {
  test("an unlisted value is still rendered as its own option and stays SELECTED", () => {
    const html = render({ value: "Waterproofing" });
    expect(optionValues(html)).toEqual(["", "Civil", "Gypsum", "Paint", "Waterproofing", "__add_new__"]);
    // React renders the selected option of a value-bound <select> with selected="".
    expect(html).toMatch(/<option value="Waterproofing" selected=""/);
  });

  test("a listed value adds no extra option -- the list is not duplicated", () => {
    expect(optionValues(render({ value: "Civil" }))).toEqual(["", "Civil", "Gypsum", "Paint", "__add_new__"]);
  });

  test("case and surrounding spaces do not make a known category look unlisted", () => {
    expect(optionValues(render({ value: "  civil " }))).toEqual(["", "Civil", "Gypsum", "Paint", "__add_new__"]);
  });

  test("an empty value adds no phantom option -- it selects the 'no category' one", () => {
    const html = render({ value: "" });
    expect(optionValues(html)).toEqual(["", "Civil", "Gypsum", "Paint", "__add_new__"]);
    expect(html).toMatch(/<option value="" selected=""/);
  });
});

describe("BoqCategorySelect -- a failed category load degrades to free text", () => {
  test("failed renders a text INPUT, not the select, so BOQ entry is never blocked", () => {
    const html = render({ failed: true, value: "Civil" });
    expect(html).not.toContain("<select");
    expect(html).toContain('aria-label="Category"');
    expect(html).toContain('value="Civil"');
  });

  test("the free-text fallback keeps its label too", () => {
    const html = render({ failed: true, showLabel: true });
    expect(html).toMatch(/<label for="[^"]+"[^>]*>Category<\/label>/);
  });
});
