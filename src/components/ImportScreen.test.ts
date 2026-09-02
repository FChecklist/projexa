/// <reference types="bun-types" />
// R67 lane D22 (item D-68). The two sentences the acceptance clause quotes
// literally -- the summary line and the primary button's disabled reason --
// live in these pure functions so all three import screens say them the same
// way, and so they can be asserted without a browser.
import { describe, expect, test } from "bun:test";
import { importDisabledReason, importSummaryLine } from "./ImportScreen";

const base = {
  hasFile: true, busy: false, errorRows: 0, skipRowsWithErrors: false,
  blockingErrors: 0, unmappedRequired: [] as string[], importableRows: 38,
};

describe("importSummaryLine", () => {
  test("reads exactly as the acceptance clause names it", () => {
    expect(importSummaryLine(38, 3)).toBe("38 rows ready, 3 with errors");
  });

  test("says 'row' and 'error' in the singular when there is one of each", () => {
    expect(importSummaryLine(1, 1)).toBe("1 row ready, 1 with error");
  });

  test("a clean file still states the zero rather than hiding the clause", () => {
    expect(importSummaryLine(38, 0)).toBe("38 rows ready, 0 with errors");
  });

  test("takes the noun the import is really about", () => {
    expect(importSummaryLine(38, 2, { one: "activity", many: "activities" })).toBe("38 activities ready, 2 with errors");
  });
});

describe("importDisabledReason", () => {
  test("no file chosen reads 'Choose a file'", () => {
    expect(importDisabledReason({ ...base, hasFile: false })).toBe("Choose a file");
  });

  test("rows with errors read 'Fix 3 rows' -- the item's own wording", () => {
    expect(importDisabledReason({ ...base, errorRows: 3 })).toBe("Fix 3 rows");
    expect(importDisabledReason({ ...base, errorRows: 1 })).toBe("Fix 1 row");
  });

  test("turning on Skip rows with errors is the other way out, and clears the reason", () => {
    expect(importDisabledReason({ ...base, errorRows: 3, skipRowsWithErrors: true })).toBeNull();
  });

  test("an unmapped required field names the field, not just a count", () => {
    expect(importDisabledReason({ ...base, unmappedRequired: ["Qty", "Rate"] })).toBe("2 required fields unmapped - Qty, Rate");
    expect(importDisabledReason({ ...base, unmappedRequired: ["Rate"] })).toBe("1 required field unmapped - Rate");
  });

  test("an unreadable file outranks the per-row count -- there is nothing to fix row by row", () => {
    expect(importDisabledReason({ ...base, blockingErrors: 1, errorRows: 3 })).toBe("This file cannot be read");
  });

  test("skipping every row leaves nothing to import, and says so instead of a silent no-op", () => {
    expect(importDisabledReason({ ...base, errorRows: 3, skipRowsWithErrors: true, importableRows: 0 })).toBe("Nothing left to import");
  });

  test("is null -- the button is live -- on a clean, fully mapped file", () => {
    expect(importDisabledReason(base)).toBeNull();
  });

  test("an in-flight import says so rather than inviting a second click", () => {
    expect(importDisabledReason({ ...base, busy: true })).toBe("Importing…");
  });
});
