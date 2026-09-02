/// <reference types="bun-types" />
// R67 lane I (WS-I item I-05, R-177): the org-level BOQ category list on
// /settings.
//
// WHAT THIS TEST CAN AND CANNOT REACH, stated honestly rather than papered
// over: rendered through react-dom/server's renderToStaticMarkup (the pattern
// WorkProgressReportClient.test.tsx established here, for the reason documented
// in that file -- @happy-dom/global-registrator is declared in package.json but
// absent from node_modules in this environment). renderToStaticMarkup does NOT
// run effects, so this card is asserted in its FIRST-PAINT state, before
// load()'s fetch. That is a real state a user sees, and it is exactly where the
// role gate has to already be right: the edit controls must not flash into
// existence for someone who may not use them.
//
// The two behaviours that need a live DOM -- rename()'s 409 path and the
// verbatim "Used by 12 BOQ lines" refusal -- are covered server-side, where the
// rule actually lives, by
// compliance-tracker/src/lib/services/construction-boq-category-service.test.ts.
// This file deliberately does not restate them as a mock of themselves.
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import BoqCategoriesCard from "./BoqCategoriesCard";

describe("BoqCategoriesCard -- canEdit=false (the read-only render)", () => {
  const html = renderToStaticMarkup(<BoqCategoriesCard canEdit={false} />);

  test("shows the card and says what the list is FOR", () => {
    expect(html).toContain("BOQ Categories");
    expect(html).toContain("The categories offered on every BOQ line");
  });

  test("offers NO Delete button", () => {
    expect(html).not.toContain("Delete");
  });

  test("offers NO add row -- no 'Add a category' field and no Add button", () => {
    expect(html).not.toContain("Add a category");
    expect(html).not.toContain('aria-label="New category name"');
  });

  test("first paint is an explicit loading state, not an empty card that reads as 'no categories'", () => {
    expect(html).toContain("Loading…");
    expect(html).not.toContain("No categories yet.");
  });
});

describe("BoqCategoriesCard -- canEdit=true", () => {
  const html = renderToStaticMarkup(<BoqCategoriesCard canEdit />);

  test("offers the labelled add row", () => {
    expect(html).toContain('aria-label="New category name"');
    expect(html).toContain('placeholder="Add a category"');
    expect(html).toContain(">Add</button>");
  });

  test("Add starts disabled -- an empty name can never be submitted", () => {
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Add<\/button>/);
  });

  test("still shows the same explanatory copy as the read-only render", () => {
    expect(html).toContain("BOQ Categories");
    expect(html).toContain("The categories offered on every BOQ line");
  });
});
