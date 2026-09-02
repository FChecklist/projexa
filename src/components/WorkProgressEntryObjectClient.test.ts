/// <reference types="bun-types" />
// R67 lane D22 (item D-77, rec R-289). The one pure decision this screen makes
// on its own: turning the stored basis token into the words a site engineer
// uses. The token matters -- DELTA is summed by the WPR roll-up and SNAPSHOT
// replaces the previous reading (see the schema comment on
// construction_work_progress_entries.entry_basis) -- so a screen that shows
// the raw token, or shows the wrong sentence for it, is a screen that gets
// quantities added up wrong.
import { describe, expect, test } from "bun:test";
import { entryBasisLabel } from "./WorkProgressEntryObjectClient";

describe("entryBasisLabel", () => {
  test("DELTA says it is this period's quantity, which is what gets summed", () => {
    expect(entryBasisLabel("DELTA")).toBe("Delta (this period's quantity)");
  });

  test("SNAPSHOT says it is cumulative to date, which REPLACES the previous reading", () => {
    expect(entryBasisLabel("SNAPSHOT")).toBe("Snapshot (cumulative % to date)");
  });

  test("an unknown token reads as the additive default, matching the column's own default", () => {
    // entry_basis defaults to 'DELTA' in the schema, so a row written before
    // the column existed means DELTA -- the screen must not invent a third
    // meaning for it.
    expect(entryBasisLabel("")).toBe("Delta (this period's quantity)");
    expect(entryBasisLabel("delta")).toBe("Delta (this period's quantity)");
  });

  test("never returns the raw stored token", () => {
    for (const basis of ["DELTA", "SNAPSHOT", "", "anything"]) {
      expect(entryBasisLabel(basis)).not.toBe(basis);
    }
  });
});
