import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dateCellRenderers, formatListDate, houseDateDisplay } from "./list-date-cells";

describe("list date cells", () => {
  test("one fixed format, whatever the runtime locale", () => {
    expect(formatListDate("2026-10-01")).toBe("01-10-2026");
    expect(formatListDate("2026-10-01T23:30:00Z")).toBe("01-10-2026");
  });
  test("empty is an en dash; text that is not a date is shown as it is", () => {
    expect(formatListDate(null)).toBe("–");
    expect(formatListDate("")).toBe("–");
    expect(formatListDate("TBC")).toBe("TBC");
  });
  test("only date columns get a renderer, and it reads that column's own field", () => {
    const r = dateCellRenderers([{ field: "endDate", type: "date" }, { field: "name", type: "text" }, { field: "issueDate", type: "date" }]);
    expect(Object.keys(r).sort()).toEqual(["endDate", "issueDate"]);
    expect(r.endDate!({ endDate: "2026-11-30", issueDate: "2026-01-02" })).toBe("30-11-2026");
    expect(r.issueDate!({ endDate: "2026-11-30", issueDate: "2026-01-02" })).toBe("02-01-2026");
  });
});

describe("F58: the permit detail shows its dates in the house form, and only in display mode", () => {
  const columns = [{ field: "name", type: "text" }, { field: "issueDate", type: "date" }, { field: "endDate", type: "date" }] as const;
  const values = { name: "Fit-out", issueDate: "2026-10-01", endDate: "2027-09-30T00:00:00Z" };
  test("display mode: the date columns become text carrying dd-mm-yyyy (not the kit's m/d/yyyy)", () => {
    const shown = houseDateDisplay(columns, values, "display");
    expect(shown.columns.map((c) => c.type)).toEqual(["text", "text", "text"]);
    expect(shown.values).toEqual({ name: "Fit-out", issueDate: "01-10-2026", endDate: "30-09-2027" });
  });
  test("edit mode: columns and values are untouched, so the date picker keeps its ISO value", () => {
    const shown = houseDateDisplay(columns, values, "edit");
    expect(shown.columns.map((c) => c.type)).toEqual(["text", "date", "date"]);
    expect(shown.values).toBe(values);
  });
  test("the permit detail screen passes its details through it", () => {
    const src = readFileSync(join(import.meta.dir, "..", "components", "PermitObjectClient.tsx"), "utf8");
    expect(src).toContain("houseDateDisplay(REQUIRED_COLUMNS, values, mode)");
    expect(src).toContain("columns={shownRequired.columns}");
  });
});

describe("never the runtime's own locale", () => {
  test("a runtime whose default locale writes day-first still gets the fixed format", () => {
    const original = Date.prototype.toLocaleDateString;
    Date.prototype.toLocaleDateString = function (this: Date, locale?: Intl.LocalesArgument, options?: Intl.DateTimeFormatOptions) {
      return locale === undefined ? "01/10/2026" : original.call(this, locale, options);
    } as typeof Date.prototype.toLocaleDateString;
    try {
      expect(formatListDate("2026-10-01")).toBe("01-10-2026");
    } finally {
      Date.prototype.toLocaleDateString = original;
    }
  });
});

describe("every list that uses the kit's ListScreen routes its date columns through renderCell", () => {
  for (const [file, arg] of [["PermitsListClient.tsx", "columns"], ["BudgetsClient.tsx", "columns"], ["ProjectsListClient.tsx", "COLUMNS"]] as const) {
    test(file, () => {
      const src = readFileSync(join(import.meta.dir, "..", "components", file), "utf8");
      expect(src).toContain(`...dateCellRenderers(${arg})`);
    });
  }
});
