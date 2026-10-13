// A line saved with NO item code reaches the revise form under an invented one, `_row_<id>` (boq-helpers toDrafts). scopeReductions keyed the old
// line by its description and the new one by that invented code, so an UNTOUCHED revision of an uncoded line with progress read as "would be
// removed entirely" (found live 2026-10-13, Demo Organization, "Brick partition 230mm"). Pure functions only; each test fails without the fix.
import { describe, expect, test } from "bun:test";
import { latestProgress, revisionVariation, scopeReductions } from "./scope-writes";
import { toDrafts, type BoqLineItemRow } from "@/lib/boq-helpers";

const uncoded: BoqLineItemRow[] = [
  { id: "aw0wynqx3448vfbem18jgwyy", itemCode: null, description: "Brick partition 230mm", unit: "sqm", quantity: "100", rate: "50", amount: "5000", activityId: null },
];
const progress = latestProgress([{ boqLineItemId: "aw0wynqx3448vfbem18jgwyy", entryDate: "2026-10-12", percentComplete: 95, createdAt: null }]);

describe("scopeReductions -- a line without an item code is still the same line under its invented _row_ code", () => {
  test("the form invents the code (this is the shape the bug needs)", () => {
    expect(toDrafts(uncoded)[0].itemCode).toBe("_row_aw0wynqx3448vfbem18jgwyy");
  });

  test("an untouched revision of an uncoded line with progress is not a reduction", () => {
    expect(scopeReductions(uncoded, progress, toDrafts(uncoded))).toEqual([]);
  });

  test("raising the quantity of an uncoded line with progress is not a reduction", () => {
    const grown = toDrafts(uncoded).map((d) => ({ ...d, quantity: "120" }));
    expect(revisionVariation(uncoded, grown).variation).toBe(1000);
    expect(scopeReductions(uncoded, progress, grown)).toEqual([]);
  });

  test("a de-duplicated invented code (_row_<id>_x) is still the same line", () => {
    const drafts = toDrafts(uncoded).map((d) => ({ ...d, itemCode: `${d.itemCode}_x` }));
    expect(scopeReductions(uncoded, progress, drafts)).toEqual([]);
  });

  test("a REAL reduction and a REAL removal of an uncoded line with progress are still refused", () => {
    const reduced = toDrafts(uncoded).map((d) => ({ ...d, quantity: "50" }));
    expect(scopeReductions(uncoded, progress, reduced)).toEqual(['"Brick partition 230mm" is 95% complete on site and this revision reduces it']);
    expect(scopeReductions(uncoded, progress, [])).toEqual(['"Brick partition 230mm" is 95% complete on site and would be removed entirely']);
  });

  test("an invented code that names a DIFFERENT row does not hide a removal", () => {
    const other = toDrafts(uncoded).map((d) => ({ ...d, itemCode: "_row_someotherrow" }));
    expect(scopeReductions(uncoded, progress, other)).toEqual(['"Brick partition 230mm" is 95% complete on site and would be removed entirely']);
  });

  test("coded lines behave exactly as before", () => {
    const coded: BoqLineItemRow[] = [{ ...uncoded[0], itemCode: "A1" }];
    expect(scopeReductions(coded, progress, toDrafts(coded))).toEqual([]);
    expect(scopeReductions(coded, progress, [])).toHaveLength(1);
  });
});
