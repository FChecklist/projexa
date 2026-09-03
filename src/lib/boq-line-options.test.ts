/// <reference types="bun-types" />
// R67 lane D22 (item D-64). How a BOQ line is named, everywhere. The acceptance
// clause for this item is that no cell anywhere prints a 20+ character id, so
// these pin that a line always resolves to words.
import { describe, expect, test } from "bun:test";
import {
  boqLineHref, boqLineLabel, boqLineSublabel, toSearchOptions, PARENT_LINE_REASON,
  type BoqLineOption,
} from "./boq-line-options";

function line(over: Partial<BoqLineOption> = {}): BoqLineOption {
  return {
    id: "cm4x9k2p0000abcdef123456", boqId: "boq-1", boqTitle: "Fit-out", boqVersion: 2,
    code: "R60SK-A", description: "R60 skiphop sub", unit: "m3", rate: 45,
    quantity: 120, quantityDone: 40, remainingQuantity: 80, isParent: false,
    ...over,
  };
}

describe("boqLineLabel", () => {
  test("is the code and the description, the way the audit asked for it", () => {
    expect(boqLineLabel(line())).toBe("R60SK-A — R60 skiphop sub");
  });

  test("is the description alone when there is no code -- never a blank, never an id", () => {
    expect(boqLineLabel(line({ code: null }))).toBe("R60 skiphop sub");
    expect(boqLineLabel(line({ code: "  " }))).toBe("R60 skiphop sub");
  });

  test("never contains the line's id", () => {
    const l = line();
    expect(boqLineLabel(l)).not.toContain(l.id);
    expect(boqLineLabel(l)).not.toMatch(/^[a-z0-9]{20,}$/);
  });
});

describe("boqLineSublabel", () => {
  test("says the unit and how much of the line is left", () => {
    expect(boqLineSublabel(line())).toBe("m3 · 80 of 120 remaining");
  });

  test("omits an empty unit rather than printing a stray separator", () => {
    expect(boqLineSublabel(line({ unit: "" }))).toBe("80 of 120 remaining");
  });
});

describe("toSearchOptions", () => {
  test("a parent line is offered but not choosable, with the reason spelled out", () => {
    const [option] = toSearchOptions([line({ isParent: true })]);
    expect(option!.disabled).toBe(true);
    expect(option!.disabledReason).toBe(PARENT_LINE_REASON);
    expect(PARENT_LINE_REASON).toBe("parent - pick a child");
  });

  test("an ordinary line is choosable and carries no reason", () => {
    const [option] = toSearchOptions([line()]);
    expect(option!.disabled).toBe(false);
    expect(option!.disabledReason).toBeUndefined();
  });

  test("keeps the id as the VALUE only -- it is a key, never text", () => {
    const [option] = toSearchOptions([line()]);
    expect(option!.value).toBe("cm4x9k2p0000abcdef123456");
    expect(option!.label).not.toContain(option!.value);
    expect(option!.sublabel).not.toContain(option!.value);
  });
});

describe("boqLineHref", () => {
  test("points at the BOQ's own object page, anchored at the line", () => {
    expect(boqLineHref("boq-1", "li-9")).toBe("/scope/boq-1#line-li-9");
  });
});
